import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { processJob } from '../automation/processor.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kolvex-automation-test-'));
process.env.DATA_DIR = dir;
process.env.DB_PATH = path.join(dir, 'crm.db');
process.env.SESSION_SECRET = 'isolated-automation-test';
process.env.TZ = 'America/Asuncion';
const { db, companies, deals, users, whatsapp, comments, automationStore: store } = await import('../server/db.js');
const { batchPreview, enrollBatch, prepareJobs, claimJob, reportJob, receiveReply, localClock } = await import('../server/automation.js');
const { routes } = await import('../server/routes.js');
const user = users.create({ name: 'Lucía', email: 'admin@test.local', password_hash: 'unused', role: 'admin' });
const now = Date.now();
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => {
  db.exec('DELETE FROM companies; DELETE FROM whatsapp_automation_rules; DELETE FROM whatsapp_incoming_events;');
  store.saveConfig({ enabled: false, daily_limit: 30, interval_seconds: 60, start_hour: 0, end_hour: 24 });
});
function fixture({ phone = '0981123456', rubro = 'Restaurante', delay = 3 } = {}) {
  const company = companies.create({ name: 'Negocio de prueba', telefono: phone, rubro, contacto_nombre: 'Ana' });
  const deal = deals.create({ company_id: company.id, title: 'Web', stage: 'prospecto', owner_id: user.id });
  const flow = whatsapp.saveFlow(null, { name: 'Restaurantes', description: '', active: 1, steps: [
    { title: 'Saludo', message: 'Hola {{contacto}}, soy {{vendedor}}. ¿Vemos la web de {{empresa}}?', delay_days: 0 },
    { title: 'Retomar', message: '¿Conversamos sobre {{empresa}}?', delay_days: delay },
  ] });
  store.saveRule(rubro, flow.id);
  return { company, deal, flow };
}
function enroll() {
  const preview = batchPreview(user);
  enrollBatch(user, preview.fingerprint, now);
  return preview;
}
function enable(fields = {}) { store.saveConfig({ ...store.config(), enabled: true, ...fields }); }
function route(method, pattern, body = {}, params = {}, who = user) {
  return routes.find(([m, p]) => m === method && p === pattern)[3]({ body, params, user: who, query: {} });
}
const result = (job, fields = {}) => ({ claim_token: job.claim_token, result: 'sent', provider_id: `fake-${job.id}`, ...fields });

test('previsualiza sin crear ejecuciones; deduplica teléfonos y usa reglas específicas antes de la general', () => {
  const fx = fixture();
  fixture({ phone: '+595981123456' });
  fixture({ phone: '021123456' });
  const blocked = fixture({ phone: '0981123457' }); whatsapp.block(blocked.company.id);
  store.saveRule('*', fx.flow.id);
  const preview = batchPreview(user);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].phone, '595981123456');
  assert.match(preview.rows[0].message, /Hola Ana, soy Lucía/);
  assert.equal(whatsapp.runs().length, 0);
  assert.equal(store.jobs().length, 0);
  assert.equal(preview.skipped['Número ya incluido'], 1);
  assert.equal(preview.skipped['No contactar'], 1);
});

test('un lote solo se crea si coincide con la simulación y no se vuelve a incluir el teléfono', () => {
  const fx = fixture();
  const preview = batchPreview(user);
  companies.update(fx.company.id, { name: 'Cambió' });
  assert.throws(() => enrollBatch(user, preview.fingerprint), { status: 409 });
  assert.equal(whatsapp.runs().length, 0);
  enroll();
  assert.equal(whatsapp.runs().length, 1);
  assert.equal(batchPreview(user).rows.length, 0);
  assert.equal(claimJob(now).job, null);
});

test('envío simulado registra historial y avanza una sola vez; el siguiente paso respeta el plazo', async () => {
  fixture(); enroll(); enable();
  const { job } = claimJob(now);
  assert.ok(job);
  assert.equal(claimJob(now + 1000).job, null);
  let sends = 0;
  let persisted;
  const api = async (p, body) => p.endsWith('/check') ? { allowed: true } : reportJob(job.id, body, now);
  await processJob({ job, api, persist: async (r) => { persisted = r; }, adapter: {
    recentReply: async () => null, send: async () => { sends++; return 'fake-whatsapp-123'; },
  } });
  assert.equal(sends, 1);
  assert.equal(persisted.body.provider_id, 'fake-whatsapp-123');
  assert.equal(store.job(job.id).state, 'sent');
  const run = whatsapp.run(job.run_id);
  assert.equal(run.step_index, 1);
  assert.equal(deals.get(run.deal_id).stage, 'contactado');
  assert.equal((Date.parse(run.next_due) - Date.parse(localClock(now).day)) / 86400e3, 3);
  assert.equal(claimJob(now + 61000).job, null);
  reportJob(job.id, persisted.body, now);
  assert.equal(comments.byCompany(run.company_id).filter((c) => c.type === 'whatsapp').length, 1);
  assert.equal(whatsapp.run(run.id).step_index, 1);
});

test('respeta horario, separación mínima y cupo diario', () => {
  fixture(); fixture({ phone: '0981123457' }); enroll();
  const hour = localClock(now).hour;
  enable({ start_hour: hour === 0 ? 1 : 0, end_hour: hour === 0 ? 24 : hour });
  assert.equal(claimJob(now).job, null);
  enable({ start_hour: 0, end_hour: 24, daily_limit: 1 });
  const { job } = claimJob(now);
  reportJob(job.id, result(job), now);
  assert.equal(claimJob(now + 1000).job, null);
  assert.equal(claimJob(now + 61000).job, null);
  enable({ daily_limit: 2 });
  assert.ok(claimJob(now + 61000).job);
});

test('un error después de invocar el envío queda incierto y no se reintenta', async () => {
  fixture(); enroll(); enable();
  const { job } = claimJob(now);
  let sends = 0;
  await processJob({ job, persist: async () => {}, api: async (p, b) => p.endsWith('/check') ? { allowed: true } : reportJob(job.id, b, now),
    adapter: { recentReply: async () => null, send: async () => { sends++; throw new Error('Se perdió conexión'); } } });
  assert.equal(sends, 1);
  assert.equal(store.job(job.id).state, 'uncertain');
  assert.equal(whatsapp.run(job.run_id).step_index, 0);
  assert.equal(claimJob(now + 600000).job, null);
});

test('si se pierde la respuesta HTTP al reportar, el recibo guardado se reenvía sin reenviar el mensaje', async () => {
  fixture(); enroll(); enable(); const { job } = claimJob(now);
  let receipt; let sends = 0;
  await assert.rejects(processJob({ job, persist: async (value) => { receipt = value; }, api: async (p, body) => {
    if (p.endsWith('/check')) return { allowed: true };
    reportJob(job.id, body, now); throw new Error('HTTP desconectado');
  }, adapter: { recentReply: async () => null, send: async () => { sends++; return 'fake-persisted'; } } }));
  reportJob(receipt.id, receipt.body, now);
  assert.equal(sends, 1);
  assert.equal(whatsapp.run(job.run_id).step_index, 1);
});

test('una respuesta anterior al envío cancela el mensaje y finaliza el flujo', async () => {
  fixture(); enroll(); enable(); const { job } = claimJob(now);
  let sends = 0;
  await processJob({ job, persist: async () => {}, api: async (p, b) => p === '/reply' ? receiveReply(b) : reportJob(job.id, b, now),
    adapter: { recentReply: async () => ({ phone: job.phone, timestamp: now + 1000, message: 'Sí, contame' }), send: async () => { sends++; } } });
  assert.equal(sends, 0);
  assert.equal(whatsapp.run(job.run_id).status, 'responded');
  assert.equal(store.job(job.id).state, 'cancelled');
  assert.equal(claimJob(now + 61000).job, null);
});

test('detecta bajas, no procesa dos veces la misma respuesta y excluye el número de futuros lotes', () => {
  fixture(); enroll(); const run = whatsapp.runs()[0];
  const reply = { phone: '595981123456', timestamp: now + 1000, message: 'No me escribas' };
  assert.equal(receiveReply(reply).stopped, 1);
  assert.equal(receiveReply(reply).stopped, 0);
  assert.equal(whatsapp.blocked(run.company_id), true);
  assert.equal(whatsapp.run(run.id).status, 'stopped');
  assert.equal(deals.get(run.deal_id).next_followup, null);
  assert.equal(batchPreview(user).rows.length, 0);
});

test('una pausa en el CRM entre claim y envío impide enviar', async () => {
  fixture(); enroll(); enable(); const { job } = claimJob(now);
  const run = whatsapp.run(job.run_id);
  route('POST', '/api/whatsapp/runs/:id/action', { action: 'pause', version: run.version }, { id: run.id });
  const checked = route('POST', '/api/whatsapp/automation/jobs/:id/check', { claim_token: job.claim_token }, { id: job.id });
  assert.equal(checked.allowed, false);
  let sends = 0;
  await processJob({ job, persist: async () => {}, api: async (p, b) => p.endsWith('/check') ? checked : reportJob(job.id, b, now),
    adapter: { recentReply: async () => null, send: async () => { sends++; } } });
  assert.equal(sends, 0);
  assert.equal(store.job(job.id).state, 'cancelled');
});

test('si se pausa durante un envío ya iniciado, guarda el envío y mantiene la pausa en el siguiente paso', () => {
  fixture(); enroll(); enable(); const { job } = claimJob(now);
  const run = whatsapp.run(job.run_id);
  route('POST', '/api/whatsapp/runs/:id/action', { action: 'pause', version: run.version }, { id: run.id });
  reportJob(job.id, result(job), now);
  assert.equal(whatsapp.run(run.id).status, 'paused');
  assert.equal(whatsapp.run(run.id).step_index, 1);
  assert.equal(whatsapp.run(run.id).next_due, null);
});

test('si el worker desaparece, retiene el envío para revisión y permite confirmar un recibo tardío', () => {
  fixture(); enroll(); enable(); const { job } = claimJob(now);
  assert.equal(claimJob(now + 301000).job, null);
  assert.equal(store.job(job.id).state, 'uncertain');
  reportJob(job.id, result(job), now + 302000);
  assert.equal(store.job(job.id).state, 'sent');
});

test('cambiar el teléfono o cerrar la negociación invalida una tarea pendiente', () => {
  const fx = fixture(); enroll(); prepareJobs(now);
  companies.update(fx.company.id, { telefono: '0981123457' }); enable();
  assert.equal(claimJob(now).job, null);
  assert.equal(store.jobs()[0].state, 'cancelled');
});

test('rechaza acciones de miembros, configuraciones inválidas y resultados con token ajeno', () => {
  assert.throws(() => route('PATCH', '/api/whatsapp/automation', { enabled: true }, {}, { ...user, role: 'member' }), { status: 403 });
  assert.throws(() => route('PATCH', '/api/whatsapp/automation', { interval_seconds: 0 }), { status: 400 });
  assert.throws(() => route('PATCH', '/api/whatsapp/automation', { start_hour: 20, end_hour: 10 }), { status: 400 });
  fixture(); enroll(); enable(); const { job } = claimJob(now);
  assert.throws(() => reportJob(job.id, result(job, { claim_token: 'incorrect' })), { status: 409 });
  assert.equal(store.job(job.id).state, 'processing');
  assert.throws(() => route('POST', '/api/whatsapp/runs/:id/action', { action: 'sent', version: 0, message: 'Manual' }, { id: job.run_id }), { status: 409 });
});
