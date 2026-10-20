import crypto from 'node:crypto';
import { automationStore as store, companies, deals, whatsapp, comments, tx } from './db.js';
import { renderMessage, whatsappUrl } from '../shared/whatsapp.js';

export const phoneNumber = (value) => whatsappUrl(value)?.split('/').pop() || null;
export function localClock(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'America/Asuncion',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
function dueAfter(days, now) {
  const date = new Date(`${localClock(now).day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
let workerSeen = null;

export function batchPreview(user) {
  const rules = store.rules();
  const seen = new Set();
  const rows = [];
  const skipped = {};
  const skip = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  for (const deal of deals.list()) {
    const company = companies.get(deal.company_id);
    const phone = phoneNumber(company.telefono);
    const rule = rules.find((r) => r.rubro.toLowerCase() === (company.rubro || '').trim().toLowerCase()) || rules.find((r) => r.rubro === '*');
    if (deal.stage !== 'prospecto') { skip('No está en Prospecto'); continue; }
    if (!phone) { skip('Sin celular válido'); continue; }
    if (whatsapp.blocked(company.id)) { skip('No contactar'); continue; }
    if (store.enrolled(phone) || seen.has(phone)) { skip('Número ya incluido'); continue; }
    if (whatsapp.runs(company.id).length) { skip('Empresa con seguimiento previo'); continue; }
    if (!rule || !rule.active) { skip('Sin regla activa para el rubro'); continue; }
    const flow = whatsapp.flow(rule.flow_id);
    const message = renderMessage(flow.steps[0].message, company, user);
    if (message.includes('{{') || message.includes('}}')) { skip('Variables sin completar'); continue; }
    seen.add(phone);
    rows.push({ deal_id: deal.id, company_id: company.id, company_name: company.name, rubro: company.rubro,
      phone, flow_id: flow.id, flow_name: flow.name, steps: flow.steps,
      message, first_due: dueAfter(flow.steps[0].delay_days, Date.now()) });
  }
  return { rows, skipped, fingerprint: fingerprint({ user: user.id, name: user.name, rows }) };
}

export function enrollBatch(user, hash, now = Date.now()) {
  return tx(() => {
    const preview = batchPreview(user);
    if (!hash || hash !== preview.fingerprint) fail('La selección cambió. Vuelve a simular antes de preparar el lote.', 409);
    for (const item of preview.rows) {
      const run = whatsapp.start(item.deal_id, { id: item.flow_id, name: item.flow_name, steps: item.steps }, item.first_due);
      store.enroll(run, item.phone, user, now);
      deals.update(item.deal_id, { next_followup: run.next_due });
      comments.create({ company_id: item.company_id, deal_id: item.deal_id, user_id: user.id, system: 1,
        body: `${user.name} incorporó la empresa al flujo automático "${item.flow_name}".` });
    }
    return { enrolled: preview.rows.length };
  });
}

function usable(run, enrollment) {
  if (!run || !enrollment || run.status !== 'active' || ['ganado', 'perdido'].includes(run.stage)) return false;
  const company = companies.get(run.company_id);
  return !whatsapp.blocked(company.id) && phoneNumber(company.telefono) === enrollment.phone;
}

// Se invoca antes de cada claim. Es idempotente y valida el estado vivo del CRM.
export function prepareJobs(now = Date.now()) {
  let queued = 0;
  for (const entry of store.enrollments()) {
    const run = whatsapp.run(entry.run_id);
    if (!usable(run, entry) || !run.next_due || run.next_due > localClock(now).day) continue;
    if (store.busy(run.id)) continue;
    const message = renderMessage(run.steps[run.step_index].message, companies.get(run.company_id), { name: entry.sender_name });
    if (message.includes('{{') || message.includes('}}')) continue;
    const existing = store.stepJob(run.id, run.step_index);
    if (existing?.state === 'cancelled') store.requeueCancelled(run);
    else queued += Number(store.queue(run, entry.phone, message));
  }
  return queued;
}

function validJob(job, now) {
  const run = whatsapp.run(job.run_id);
  return usable(run, store.enrollment(job.run_id)) && run.step_index === job.step_index &&
    run.version === job.run_version && run.next_due && run.next_due <= localClock(now).day;
}

export function claimJob(now = Date.now()) {
  return tx(() => {
    store.stale(now - 5 * 60e3);
    const config = store.config();
    const clock = localClock(now);
    if (!config.enabled || clock.hour < config.start_hour || clock.hour >= config.end_hour ||
        store.processing() || store.attempts(clock.day) >= config.daily_limit ||
        now - store.lastAttempt() < config.interval_seconds * 1000) return { job: null };
    prepareJobs(now);
    for (const job of store.pending()) {
      if (!validJob(job, now)) { store.updateJob(job.id, { state: 'cancelled' }); continue; }
      const token = crypto.randomBytes(24).toString('hex');
      const claimed = store.updateJob(job.id, { state: 'processing', claim_token: token, started_at: now, local_day: clock.day });
      return { job: { ...claimed, enrollment_started_at: store.enrollment(job.run_id).started_at } };
    }
    return { job: null };
  });
}

export function reportJob(id, body, now = Date.now()) {
  return tx(() => {
    const job = store.job(id);
    if (!job) fail('Envío no encontrado.', 404);
    if (typeof body.claim_token !== 'string' || job.claim_token !== body.claim_token) fail('Identificador de envío inválido.', 409);
    if (job.state === 'sent') return { ok: true, state: 'sent' }; // reenvío de recibo, nunca del mensaje
    if (!['processing', 'uncertain'].includes(job.state)) fail('Este envío ya no acepta resultados.', 409);
    if (body.result === 'uncertain') {
      store.updateJob(id, { state: 'uncertain', detail: 'Resultado de envío incierto. Revisar el chat antes de resolver.' });
      return { ok: true, state: 'uncertain' };
    }
    if (body.result === 'cancelled') {
      store.updateJob(id, { state: 'cancelled', finished_at: now, detail: 'El worker confirmó que no invocó el envío.' });
      return { ok: true, state: 'cancelled' };
    }
    if (body.result !== 'sent' || typeof body.provider_id !== 'string' || !body.provider_id.trim() || body.provider_id.length > 300) fail('Resultado o identificador de WhatsApp inválido.');
    store.updateJob(id, { state: 'sent', provider_id: body.provider_id, finished_at: now, detail: null });
    const run = whatsapp.run(job.run_id);
    const entry = store.enrollment(job.run_id);
    comments.create({ company_id: run.company_id, deal_id: run.deal_id, user_id: entry.sender_id, type: 'whatsapp',
      body: `Envío automático · ${run.flow_name} · Paso ${job.step_index + 1}\nID WhatsApp: ${body.provider_id}\n\n${job.message}` });
    // Una respuesta o una baja durante el envío conserva prioridad sobre el avance.
    if (['active', 'paused'].includes(run.status) && run.step_index === job.step_index) {
      const index = job.step_index + 1;
      const nextDue = index === run.steps.length || run.status === 'paused' ? null : dueAfter(run.steps[index].delay_days, now);
      whatsapp.update(run.id, { status: index === run.steps.length ? 'completed' : run.status, step_index: index, next_due: nextDue });
      const deal = deals.get(run.deal_id);
      deals.update(deal.id, { ...(deal.stage === 'prospecto' ? { stage: 'contactado' } : {}),
        ...(deal.next_followup === run.next_due ? { next_followup: nextDue } : {}) });
    }
    return { ok: true, state: 'sent' };
  });
}

export function receiveReply({ phone, timestamp, message = '' }) {
  const normalized = phoneNumber(phone);
  if (!normalized || !Number.isFinite(timestamp)) fail('Respuesta inválida.');
  return tx(() => {
    if (typeof message !== 'string' || message.length > 10000) fail('Texto de respuesta inválido.');
    if (!store.rememberReply(fingerprint({ phone: normalized, timestamp, message }))) return { stopped: 0 };
    let stopped = 0;
    const optOut = /^(baja|stop|no me escribas|no contactar|no me contacten)[.!\s]*$/i.test(message.trim());
    const entries = store.enrollments().filter((e) => e.phone === normalized && timestamp >= Math.floor(e.started_at / 1000) * 1000);
    if (optOut && entries.length) {
      // La baja también vale si el último paso ya se había completado.
      for (const deal of deals.list()) {
        if (phoneNumber(deal.telefono) !== normalized) continue;
        whatsapp.block(deal.company_id);
        const open = whatsapp.openRun(deal.id);
        if (open) {
          whatsapp.update(open.id, { ...open, status: 'stopped', next_due: null });
          store.cancelPending(open.id);
          if (deal.next_followup === open.next_due) deals.update(deal.id, { next_followup: null });
        }
      }
    }
    for (const entry of entries) {
      const run = whatsapp.run(entry.run_id);
      if (!['active', 'paused'].includes(run.status) && !optOut) continue;
      if (optOut) whatsapp.block(run.company_id);
      whatsapp.update(run.id, { ...run, status: optOut ? 'stopped' : 'responded', next_due: null });
      store.cancelPending(run.id);
      const deal = deals.get(run.deal_id);
      deals.update(deal.id, { ...(deal.stage === 'prospecto' ? { stage: 'contactado' } : {}),
        ...(deal.next_followup === run.next_due ? { next_followup: null } : {}) });
      comments.create({ company_id: run.company_id, deal_id: run.deal_id, user_id: entry.sender_id, type: 'whatsapp',
        body: `Respuesta recibida${optOut ? ' · No contactar' : ' · Flujo automático finalizado'}\n\n${String(message).slice(0, 4000) || '[Respuesta sin texto]'}` });
      stopped++;
    }
    return { stopped };
  });
}

export function automationRoutes(HttpError) {
  const admin = (fn) => (context) => {
    if (context.user.role !== 'admin') throw new HttpError(403, 'Solo los administradores pueden gestionar la automatización.');
    try { return fn(context); } catch (e) { if (e.status) throw new HttpError(e.status, e.message); throw e; }
  };
  return [
    ['GET', '/api/whatsapp/automation', {}, admin(() => {
      store.stale(Date.now() - 5 * 60e3);
      return { config: store.config(), rules: store.rules(), jobs: store.jobs().map(({ claim_token, ...j }) => j), counts: store.countByState(),
        worker: workerSeen && Date.now() - workerSeen.last_seen < 180000 ? workerSeen : null };
    })],
    ['POST', '/api/whatsapp/automation/heartbeat', {}, admin(({ body }) => { workerSeen = { ready: body.ready === true, last_seen: Date.now() }; return { ok: true }; })],
    ['PATCH', '/api/whatsapp/automation', {}, admin(({ body }) => {
      const next = { ...store.config() };
      for (const [key, min, max] of [['daily_limit', 1, 1000], ['interval_seconds', 1, 3600], ['start_hour', 0, 23], ['end_hour', 1, 24]]) {
        if (!(key in body)) continue;
        if (!Number.isInteger(body[key]) || body[key] < min || body[key] > max) fail(`Valor inválido para ${key}.`);
        next[key] = body[key];
      }
      if ('enabled' in body) {
        if (typeof body.enabled !== 'boolean') fail('Estado inválido.');
        next.enabled = body.enabled;
      }
      if (next.start_hour >= next.end_hour) fail('La hora de inicio debe ser anterior al cierre.');
      store.saveConfig(next); return next;
    })],
    ['POST', '/api/whatsapp/automation/rules', {}, admin(({ body }) => {
      if (typeof body.rubro !== 'string' || !body.rubro.trim() || body.rubro.length > 500) fail('Selecciona un rubro o * para todos los demás.');
      const flow = whatsapp.flow(Number(body.flow_id));
      if (!flow?.active) fail('Selecciona un flujo disponible.');
      store.saveRule(body.rubro.trim(), flow.id); return store.rules();
    })],
    ['POST', '/api/whatsapp/automation/rules/remove', {}, admin(({ body }) => { store.removeRule(String(body.rubro || '')); return { ok: true }; })],
    ['GET', '/api/whatsapp/automation/targets', {}, admin(() => store.enrollments().filter((e) => ['active', 'paused'].includes(whatsapp.run(e.run_id)?.status)).map((e) => e.phone))],
    ['POST', '/api/whatsapp/automation/preview', {}, admin(({ user }) => batchPreview(user))],
    ['POST', '/api/whatsapp/automation/enroll', {}, admin(({ user, body }) => enrollBatch(user, body.fingerprint))],
    ['POST', '/api/whatsapp/automation/claim', {}, admin(() => claimJob())],
    ['POST', '/api/whatsapp/automation/jobs/:id/result', {}, admin(({ params, body }) => reportJob(Number(params.id), body))],
    ['POST', '/api/whatsapp/automation/jobs/:id/check', {}, admin(({ params, body }) => {
      const job = store.job(Number(params.id));
      return { allowed: !!job && job.claim_token === body.claim_token && job.state === 'processing' &&
        store.config().enabled && validJob(job, Date.now()) };
    })],
    ['POST', '/api/whatsapp/automation/reply', {}, admin(({ body }) => receiveReply(body))],
    ['POST', '/api/whatsapp/automation/jobs/:id/resolve', {}, admin(({ params, body }) => {
      const job = store.job(Number(params.id));
      if (!job || job.state !== 'uncertain') fail('Solo se pueden revisar envíos inciertos.');
      if (body.result === 'sent') return reportJob(job.id, { claim_token: job.claim_token, result: 'sent', provider_id: body.provider_id });
      if (body.result !== 'cancelled') fail('Resultado inválido.');
      // Nunca se reintenta automáticamente, ni siquiera después de una revisión.
      store.updateJob(job.id, { state: 'cancelled', finished_at: Date.now(), detail: 'Revisado: no enviado. Flujo pausado.' });
      const run = whatsapp.run(job.run_id);
      if (run.status === 'active') {
        whatsapp.update(run.id, { ...run, status: 'paused', next_due: null });
        const deal = deals.get(run.deal_id);
        if (deal.next_followup === run.next_due) deals.update(deal.id, { next_followup: null });
      }
      return { ok: true };
    })],
  ];
}
