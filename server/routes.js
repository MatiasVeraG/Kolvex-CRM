// Rutas de la API. Cada handler recibe { req, user, params, query, body }
// y devuelve el objeto que se enviará como JSON.
import { STAGES, STAGE_IDS, COMMENT_TYPES, PRIORITIES, COMPANY_FIELDS, users, companies, deals, comments, stats, tx } from './db.js';
import { createToken, verifyPassword, hashPassword, validatePassword } from './auth.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (what = 'Registro') => new HttpError(404, `${what} no encontrado.`);
const forbidden = () => new HttpError(403, 'No tienes permiso para hacer esto.');

const str = (v, max = 2000) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
};
const int = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const date = (v) => {
  const s = str(v, 20);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s)) throw bad('Fecha con formato inválido.');
  return s;
};
const idParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
};
const requireAdmin = (user) => { if (user.role !== 'admin') throw forbidden(); };

function companyInput(body, partial) {
  const out = {};
  for (const k of COMPANY_FIELDS) {
    if (!(k in body)) continue;
    if (k === 'rating') out[k] = num(body[k]);
    else if (k === 'reviews') out[k] = int(body[k]);
    else out[k] = str(body[k], k === 'notas' ? 10000 : 500);
  }
  if (!partial || 'name' in out) {
    if (!out.name) throw bad('El nombre de la empresa es obligatorio.');
  }
  return out;
}

function dealInput(body, partial) {
  const out = {};
  if ('title' in body) out.title = str(body.title, 200);
  if ('stage' in body) {
    if (!STAGE_IDS.includes(body.stage)) throw bad('Estado inválido.');
    out.stage = body.stage;
  }
  if ('priority' in body) {
    const p = str(body.priority, 1);
    if (p && !PRIORITIES.includes(p)) throw bad('Prioridad inválida.');
    out.priority = p;
  }
  if ('value' in body) out.value = int(body.value);
  if ('owner_id' in body) {
    const o = int(body.owner_id);
    if (o && !users.get(o)) throw bad('El responsable no existe.');
    out.owner_id = o;
  }
  if ('next_followup' in body) out.next_followup = date(body.next_followup);
  if ('lost_reason' in body) out.lost_reason = str(body.lost_reason, 500);
  if (!partial && !out.title) out.title = 'Página web';
  if (partial && 'title' in out && !out.title) throw bad('El título no puede quedar vacío.');
  return out;
}

const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || id;

// Registra en el historial de la empresa los cambios importantes de una negociación.
function logDealChanges(before, after, user) {
  const changes = [];
  if (before.stage !== after.stage) changes.push(`cambió el estado de "${stageLabel(before.stage)}" a "${stageLabel(after.stage)}"`);
  if ((before.owner_id || null) !== (after.owner_id || null)) changes.push(`asignó la negociación a ${after.owner_name || 'nadie'}`);
  if (!changes.length) return;
  comments.create({
    company_id: after.company_id, deal_id: after.id, user_id: user.id, type: 'nota', system: 1,
    body: `${user.name} ${changes.join(' y ')}.`,
  });
}

// Límite simple de intentos de login por IP
const attempts = new Map();
function checkRate(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { n: 0, t: now };
  if (now - a.t > 15 * 60e3) { a.n = 0; a.t = now; }
  a.n += 1;
  attempts.set(ip, a);
  if (a.n > 20) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
}

export const routes = [
  // ---------- Sesión ----------
  ['POST', '/api/auth/login', { public: true }, ({ body, req }) => {
    checkRate(req.socket.remoteAddress);
    const email = str(body.email, 200);
    const u = email && users.getWithHash(email);
    if (!u || !u.active || !verifyPassword(String(body.password || ''), u.password_hash)) {
      throw new HttpError(401, 'Email o contraseña incorrectos.');
    }
    return { token: createToken(u), user: users.get(u.id) };
  }],
  ['GET', '/api/me', {}, ({ user }) => user],
  ['POST', '/api/me/password', {}, ({ user, body }) => {
    if (!verifyPassword(String(body.current || ''), users.getHashById(user.id))) throw bad('La contraseña actual no es correcta.');
    const err = validatePassword(body.password);
    if (err) throw bad(err);
    users.update(user.id, { password_hash: hashPassword(body.password) });
    return { ok: true };
  }],
  ['GET', '/api/meta', {}, () => ({ stages: STAGES, commentTypes: COMMENT_TYPES, priorities: PRIORITIES, ...companies.facets() })],

  // ---------- Equipo ----------
  ['GET', '/api/users', {}, () => users.list()],
  ['POST', '/api/users', {}, ({ user, body }) => {
    requireAdmin(user);
    const name = str(body.name, 100);
    const email = str(body.email, 200)?.toLowerCase();
    if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Nombre y email válidos son obligatorios.');
    const err = validatePassword(body.password);
    if (err) throw bad(err);
    if (users.getWithHash(email)) throw bad('Ya existe un usuario con ese email.');
    return users.create({ name, email, password_hash: hashPassword(body.password), role: body.role === 'admin' ? 'admin' : 'member' });
  }],
  ['PATCH', '/api/users/:id', {}, ({ user, params, body }) => {
    requireAdmin(user);
    const id = idParam(params.id);
    const target = users.get(id);
    if (!target) throw notFound('Usuario');
    const f = {};
    if ('name' in body) { f.name = str(body.name, 100); if (!f.name) throw bad('El nombre no puede quedar vacío.'); }
    if ('role' in body) f.role = body.role === 'admin' ? 'admin' : 'member';
    if ('active' in body) f.active = body.active ? 1 : 0;
    if ('password' in body) {
      const err = validatePassword(body.password);
      if (err) throw bad(err);
      f.password_hash = hashPassword(body.password);
    }
    const losingAdmin = target.role === 'admin' && target.active && (f.role === 'member' || f.active === 0);
    if (losingAdmin && users.adminCount() <= 1) throw bad('Debe quedar al menos un administrador activo.');
    return users.update(id, f);
  }],

  // ---------- Empresas ----------
  ['GET', '/api/companies', {}, ({ query }) => companies.list({
    q: str(query.q, 100), rubro: str(query.rubro), ciudad: str(query.ciudad), stage: str(query.stage),
    owner: str(query.owner), priority: str(query.priority),
    limit: Math.min(int(query.limit) || 50, 200), offset: Math.max(int(query.offset) || 0, 0),
  })],
  ['POST', '/api/companies', {}, ({ user, body }) => tx(() => {
    const c = companies.create(companyInput(body, false));
    // Toda empresa nueva arranca con una negociación en "Prospecto"
    const d = deals.create({ company_id: c.id, title: 'Página web', stage: 'prospecto', owner_id: user.id, ...dealInput(body.deal || {}, true) });
    return { ...c, deals: [d] };
  })],
  ['GET', '/api/companies/:id', {}, ({ params }) => {
    const id = idParam(params.id);
    const c = companies.get(id);
    if (!c) throw notFound('Empresa');
    return { ...c, deals: deals.byCompany(id), comments: comments.byCompany(id) };
  }],
  ['PATCH', '/api/companies/:id', {}, ({ params, body }) => {
    const id = idParam(params.id);
    if (!companies.get(id)) throw notFound('Empresa');
    return companies.update(id, companyInput(body, true));
  }],
  ['DELETE', '/api/companies/:id', {}, ({ user, params }) => {
    requireAdmin(user);
    if (!companies.remove(idParam(params.id))) throw notFound('Empresa');
    return { ok: true };
  }],

  // ---------- Negociaciones ----------
  ['GET', '/api/deals', {}, ({ query }) => deals.list({
    q: str(query.q, 100), owner: str(query.owner), rubro: str(query.rubro), priority: str(query.priority),
  })],
  ['POST', '/api/companies/:id/deals', {}, ({ user, params, body }) => {
    const id = idParam(params.id);
    if (!companies.get(id)) throw notFound('Empresa');
    return deals.create({ company_id: id, owner_id: user.id, ...dealInput(body, false) });
  }],
  ['PATCH', '/api/deals/:id', {}, ({ user, params, body }) => tx(() => {
    const id = idParam(params.id);
    const before = deals.get(id);
    if (!before) throw notFound('Negociación');
    const after = deals.update(id, dealInput(body, true));
    logDealChanges(before, after, user);
    return after;
  })],
  ['DELETE', '/api/deals/:id', {}, ({ user, params }) => {
    requireAdmin(user);
    if (!deals.remove(idParam(params.id))) throw notFound('Negociación');
    return { ok: true };
  }],

  // ---------- Comentarios y reuniones ----------
  ['POST', '/api/companies/:id/comments', {}, ({ user, params, body }) => {
    const id = idParam(params.id);
    if (!companies.get(id)) throw notFound('Empresa');
    const text = str(body.body, 10000);
    if (!text) throw bad('El comentario no puede estar vacío.');
    const type = COMMENT_TYPES.includes(body.type) ? body.type : 'nota';
    let dealId = int(body.deal_id);
    if (dealId && deals.get(dealId)?.company_id !== id) dealId = null;
    return comments.create({ company_id: id, deal_id: dealId, user_id: user.id, type, meeting_date: date(body.meeting_date), body: text });
  }],
  ['PATCH', '/api/comments/:id', {}, ({ user, params, body }) => {
    const id = idParam(params.id);
    const c = comments.get(id);
    if (!c) throw notFound('Comentario');
    if (c.system) throw bad('Los registros automáticos no se pueden editar.');
    if (c.user_id !== user.id && user.role !== 'admin') throw forbidden();
    const f = {};
    if ('body' in body) { f.body = str(body.body, 10000); if (!f.body) throw bad('El comentario no puede estar vacío.'); }
    if ('type' in body) { if (!COMMENT_TYPES.includes(body.type)) throw bad('Tipo inválido.'); f.type = body.type; }
    if ('meeting_date' in body) f.meeting_date = date(body.meeting_date);
    return comments.update(id, f);
  }],
  ['DELETE', '/api/comments/:id', {}, ({ user, params }) => {
    const id = idParam(params.id);
    const c = comments.get(id);
    if (!c) throw notFound('Comentario');
    if (c.user_id !== user.id && user.role !== 'admin') throw forbidden();
    comments.remove(id);
    return { ok: true };
  }],

  ['GET', '/api/stats', {}, () => stats()],
];
