// Acceso a la base de datos (SQLite incluido en Node 22, sin paquetes externos).
// Todo el SQL del proyecto vive en este archivo: si más adelante quieren pasar a
// PostgreSQL, este es el único módulo que hay que reescribir.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const STAGES = [
  { id: 'prospecto', label: 'Prospecto' },
  { id: 'contactado', label: 'Contactado' },
  { id: 'reunion', label: 'Reunión agendada' },
  { id: 'propuesta', label: 'Propuesta enviada' },
  { id: 'negociacion', label: 'Negociación' },
  { id: 'ganado', label: 'Ganado' },
  { id: 'perdido', label: 'Perdido' },
];
export const STAGE_IDS = STAGES.map((s) => s.id);
export const COMMENT_TYPES = ['reunion', 'llamada', 'whatsapp', 'email', 'nota'];
export const PRIORITIES = ['A', 'B', 'C'];

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'crm.db');
export { DATA_DIR };

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  rubro           TEXT,
  ciudad          TEXT,
  direccion       TEXT,
  telefono        TEXT,
  email           TEXT,
  web             TEXT,
  presencia       TEXT,
  rating          REAL,
  reviews         INTEGER,
  maps_url        TEXT,
  contacto_nombre TEXT,
  contacto_cargo  TEXT,
  notas           TEXT,
  external_id     TEXT UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  stage         TEXT NOT NULL DEFAULT 'prospecto',
  priority      TEXT CHECK (priority IN ('A','B','C')),
  value         INTEGER,
  owner_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  next_followup TEXT,
  lost_reason   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at     TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  deal_id      INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type         TEXT NOT NULL DEFAULT 'nota',
  meeting_date TEXT,
  body         TEXT NOT NULL,
  system       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_comments_company ON comments(company_id, created_at);

CREATE TABLE IF NOT EXISTS whatsapp_flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS whatsapp_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  flow_id INTEGER REFERENCES whatsapp_flows(id) ON DELETE SET NULL,
  flow_name TEXT NOT NULL,
  steps TEXT NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  next_due TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_open_deal ON whatsapp_runs(deal_id) WHERE status IN ('active', 'paused');
CREATE INDEX IF NOT EXISTS idx_whatsapp_due ON whatsapp_runs(status, next_due);
CREATE TABLE IF NOT EXISTS whatsapp_blocks (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whatsapp_automation_settings (id INTEGER PRIMARY KEY CHECK (id = 1), config TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS whatsapp_automation_rules (
  rubro TEXT PRIMARY KEY COLLATE NOCASE,
  flow_id INTEGER NOT NULL REFERENCES whatsapp_flows(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whatsapp_enrollments (
  run_id INTEGER PRIMARY KEY REFERENCES whatsapp_runs(id) ON DELETE CASCADE,
  phone TEXT NOT NULL UNIQUE,
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS whatsapp_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES whatsapp_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  run_version INTEGER NOT NULL,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  claim_token TEXT,
  started_at INTEGER,
  local_day TEXT,
  finished_at INTEGER,
  provider_id TEXT,
  detail TEXT,
  UNIQUE(run_id, step_index)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_jobs_state ON whatsapp_jobs(state, started_at);
CREATE TABLE IF NOT EXISTS whatsapp_incoming_events (event_key TEXT PRIMARY KEY);
`);

// Ayuda para transacciones
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const plain = (row) => (row ? { ...row } : row);
const plainAll = (rows) => rows.map((r) => ({ ...r }));

// ---------- Usuarios ----------
const USER_COLS = 'id, name, email, role, active, created_at';
export const users = {
  count: () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
  list: () => plainAll(db.prepare(`SELECT ${USER_COLS},
      (SELECT COUNT(*) FROM comments WHERE user_id = users.id) AS comment_count,
      (SELECT COUNT(*) FROM deals WHERE owner_id = users.id) AS deal_count
    FROM users ORDER BY active DESC, name`).all()),
  // Cuántos registros dependen del usuario (si tiene alguno, no se puede eliminar)
  usage: (id) => ({
    comments: db.prepare('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?').get(id).n,
    deals: db.prepare('SELECT COUNT(*) AS n FROM deals WHERE owner_id = ?').get(id).n,
  }),
  remove: (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id).changes,
  get: (id) => plain(db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id)),
  getWithHash: (email) => plain(db.prepare('SELECT * FROM users WHERE email = ?').get(email)),
  getHashById: (id) => db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id)?.password_hash,
  create: ({ name, email, password_hash, role = 'member' }) => {
    const r = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, password_hash, role);
    return users.get(r.lastInsertRowid);
  },
  update: (id, fields) => {
    updateRow('users', id, fields, ['name', 'email', 'role', 'active', 'password_hash'], false);
    return users.get(id);
  },
  adminCount: () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n,
};

function updateRow(table, id, fields, allowed, touch = true) {
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`);
  if (touch) sets.push("updated_at = datetime('now')");
  const values = keys.map((k) => (fields[k] === undefined ? null : fields[k]));
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
}

// ---------- Empresas ----------
export const COMPANY_FIELDS = ['name', 'rubro', 'ciudad', 'direccion', 'telefono', 'email', 'web', 'presencia', 'rating', 'reviews', 'maps_url', 'contacto_nombre', 'contacto_cargo', 'notas'];

export const companies = {
  list: ({ q, rubro, ciudad, stage, owner, priority, limit = 50, offset = 0 } = {}) => {
    const where = [];
    const args = [];
    if (q) {
      where.push('(c.name LIKE ? OR c.telefono LIKE ? OR c.contacto_nombre LIKE ? OR c.direccion LIKE ?)');
      const like = `%${q}%`;
      args.push(like, like, like, like);
    }
    if (rubro) { where.push('c.rubro = ?'); args.push(rubro); }
    if (ciudad) { where.push('c.ciudad = ?'); args.push(ciudad); }
    if (stage) { where.push('d.stage = ?'); args.push(stage); }
    if (priority) { where.push('d.priority = ?'); args.push(priority); }
    if (owner === 'none') where.push('d.owner_id IS NULL');
    else if (owner) { where.push('d.owner_id = ?'); args.push(Number(owner)); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // Cada empresa se muestra con su negociación más reciente
    const base = `
      FROM companies c
      LEFT JOIN deals d ON d.id = (SELECT id FROM deals WHERE company_id = c.id ORDER BY id DESC LIMIT 1)
      LEFT JOIN users u ON u.id = d.owner_id
      ${w}`;
    const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...args).n;
    const rows = db.prepare(`
      SELECT c.id, c.name, c.rubro, c.ciudad, c.telefono, c.presencia, c.rating, c.reviews, c.updated_at,
             d.id AS deal_id, d.stage, d.priority, d.next_followup, u.name AS owner_name,
             (SELECT MAX(created_at) FROM comments WHERE company_id = c.id AND system = 0) AS last_comment_at
      ${base}
      ORDER BY CASE d.priority WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END, c.reviews DESC, c.name
      LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { total, rows: plainAll(rows) };
  },
  get: (id) => plain(db.prepare('SELECT * FROM companies WHERE id = ?').get(id)),
  create: (fields) => {
    const keys = COMPANY_FIELDS.filter((k) => fields[k] !== undefined);
    const r = db.prepare(`INSERT INTO companies (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
      .run(...keys.map((k) => fields[k]));
    return companies.get(r.lastInsertRowid);
  },
  update: (id, fields) => { updateRow('companies', id, fields, COMPANY_FIELDS); return companies.get(id); },
  remove: (id) => db.prepare('DELETE FROM companies WHERE id = ?').run(id).changes,
  facets: () => ({
    rubros: db.prepare("SELECT DISTINCT rubro FROM companies WHERE rubro IS NOT NULL AND rubro <> '' ORDER BY rubro").all().map((r) => r.rubro),
    ciudades: db.prepare("SELECT DISTINCT ciudad FROM companies WHERE ciudad IS NOT NULL AND ciudad <> '' ORDER BY ciudad").all().map((r) => r.ciudad),
  }),
};

// ---------- Negociaciones ----------
const DEAL_SELECT = `
  SELECT d.*, c.name AS company_name, c.rubro, c.ciudad, c.telefono, u.name AS owner_name,
         (SELECT COUNT(*) FROM comments WHERE company_id = c.id AND system = 0) AS comment_count
  FROM deals d
  JOIN companies c ON c.id = d.company_id
  LEFT JOIN users u ON u.id = d.owner_id`;
export const DEAL_FIELDS = ['title', 'stage', 'priority', 'value', 'owner_id', 'next_followup', 'lost_reason'];

export const deals = {
  list: ({ q, owner, rubro, priority } = {}) => {
    const where = [];
    const args = [];
    if (q) { where.push('(c.name LIKE ? OR d.title LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    if (owner === 'none') where.push('d.owner_id IS NULL');
    else if (owner) { where.push('d.owner_id = ?'); args.push(Number(owner)); }
    if (rubro) { where.push('c.rubro = ?'); args.push(rubro); }
    if (priority) { where.push('d.priority = ?'); args.push(priority); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return plainAll(db.prepare(`${DEAL_SELECT} ${w}
      ORDER BY CASE d.priority WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END, d.updated_at DESC`).all(...args));
  },
  byCompany: (companyId) => plainAll(db.prepare(`${DEAL_SELECT} WHERE d.company_id = ? ORDER BY d.id DESC`).all(companyId)),
  get: (id) => plain(db.prepare(`${DEAL_SELECT} WHERE d.id = ?`).get(id)),
  create: (fields) => {
    const keys = ['company_id', ...DEAL_FIELDS].filter((k) => fields[k] !== undefined);
    const r = db.prepare(`INSERT INTO deals (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
      .run(...keys.map((k) => fields[k]));
    return deals.get(r.lastInsertRowid);
  },
  update: (id, fields) => {
    const f = { ...fields };
    updateRow('deals', id, f, DEAL_FIELDS);
    if (f.stage !== undefined) {
      const closed = f.stage === 'ganado' || f.stage === 'perdido';
      db.prepare(`UPDATE deals SET closed_at = ${closed ? "COALESCE(closed_at, datetime('now'))" : 'NULL'} WHERE id = ?`).run(id);
    }
    return deals.get(id);
  },
  remove: (id) => db.prepare('DELETE FROM deals WHERE id = ?').run(id).changes,
};

// ---------- Comentarios ----------
const COMMENT_SELECT = `
  SELECT cm.*, u.name AS user_name, d.title AS deal_title
  FROM comments cm
  LEFT JOIN users u ON u.id = cm.user_id
  LEFT JOIN deals d ON d.id = cm.deal_id`;
export const comments = {
  byCompany: (companyId) => plainAll(db.prepare(`${COMMENT_SELECT} WHERE cm.company_id = ?
    ORDER BY COALESCE(cm.meeting_date, cm.created_at) DESC, cm.id DESC`).all(companyId)),
  get: (id) => plain(db.prepare(`${COMMENT_SELECT} WHERE cm.id = ?`).get(id)),
  create: ({ company_id, deal_id = null, user_id, type = 'nota', meeting_date = null, body, system = 0 }) => {
    const r = db.prepare(`INSERT INTO comments (company_id, deal_id, user_id, type, meeting_date, body, system)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(company_id, deal_id, user_id, type, meeting_date, body, system);
    return comments.get(r.lastInsertRowid);
  },
  update: (id, fields) => {
    const keys = ['type', 'meeting_date', 'body', 'deal_id'].filter((k) => fields[k] !== undefined);
    if (keys.length) {
      db.prepare(`UPDATE comments SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...keys.map((k) => fields[k]), id);
    }
    return comments.get(id);
  },
  remove: (id) => db.prepare('DELETE FROM comments WHERE id = ?').run(id).changes,
};

// Las ejecuciones guardan una copia del flujo: editar una plantilla no cambia
// mensajes ni plazos de prospectos que ya están en seguimiento.
const flowRow = (row) => row && ({ ...row, steps: JSON.parse(row.steps) });
const RUN_SELECT = `SELECT r.*, d.company_id, d.stage, d.owner_id, c.name AS company_name,
  c.telefono, u.name AS owner_name FROM whatsapp_runs r
  JOIN deals d ON d.id = r.deal_id JOIN companies c ON c.id = d.company_id
  LEFT JOIN users u ON u.id = d.owner_id`;
export const whatsapp = {
  flows: () => db.prepare('SELECT * FROM whatsapp_flows ORDER BY active DESC, id').all().map(flowRow),
  flow: (id) => flowRow(db.prepare('SELECT * FROM whatsapp_flows WHERE id = ?').get(id)),
  saveFlow: (id, { name, description, steps, active }) => {
    if (id) db.prepare("UPDATE whatsapp_flows SET name = ?, description = ?, steps = ?, active = ?, updated_at = datetime('now') WHERE id = ?")
      .run(name, description, JSON.stringify(steps), active, id);
    else id = Number(db.prepare('INSERT INTO whatsapp_flows (name, description, steps, active) VALUES (?, ?, ?, ?)')
      .run(name, description, JSON.stringify(steps), active).lastInsertRowid);
    return whatsapp.flow(id);
  },
  blocked: (id) => !!db.prepare('SELECT 1 FROM whatsapp_blocks WHERE company_id = ?').get(id),
  block: (id) => db.prepare('INSERT OR IGNORE INTO whatsapp_blocks (company_id) VALUES (?)').run(id),
  runs: (companyId) => db.prepare(`${RUN_SELECT} ${companyId ? 'WHERE d.company_id = ?' : ''}
    ORDER BY CASE r.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, r.next_due, r.id DESC`)
    .all(...(companyId ? [companyId] : [])).map(flowRow),
  run: (id) => flowRow(db.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(id)),
  openRun: (dealId) => flowRow(db.prepare("SELECT * FROM whatsapp_runs WHERE deal_id = ? AND status IN ('active','paused')").get(dealId)),
  start: (dealId, flow, nextDue) => {
    const r = db.prepare('INSERT INTO whatsapp_runs (deal_id, flow_id, flow_name, steps, next_due) VALUES (?, ?, ?, ?, ?)')
      .run(dealId, flow.id, flow.name, JSON.stringify(flow.steps), nextDue);
    return whatsapp.run(r.lastInsertRowid);
  },
  update: (id, { status, step_index, next_due }) => {
    db.prepare("UPDATE whatsapp_runs SET status = ?, step_index = ?, next_due = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?")
      .run(status, step_index, next_due, id);
    return whatsapp.run(id);
  },
};

// Persistencia de automatización. Los envíos inciertos nunca se reintentan solos.
export const automationStore = {
  rememberReply: (key) => db.prepare('INSERT OR IGNORE INTO whatsapp_incoming_events (event_key) VALUES (?)').run(key).changes,
  config: () => {
    const row = db.prepare('SELECT config FROM whatsapp_automation_settings WHERE id = 1').get();
    return row ? JSON.parse(row.config) : { enabled: false, daily_limit: 30, interval_seconds: 60, start_hour: 9, end_hour: 18 };
  },
  saveConfig: (config) => db.prepare('INSERT INTO whatsapp_automation_settings (id, config) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET config = excluded.config').run(JSON.stringify(config)),
  rules: () => plainAll(db.prepare('SELECT r.*, f.name AS flow_name, f.active FROM whatsapp_automation_rules r JOIN whatsapp_flows f ON f.id = r.flow_id ORDER BY r.rubro').all()),
  saveRule: (rubro, flowId) => db.prepare('INSERT INTO whatsapp_automation_rules (rubro, flow_id) VALUES (?, ?) ON CONFLICT(rubro) DO UPDATE SET flow_id = excluded.flow_id').run(rubro, flowId),
  removeRule: (rubro) => db.prepare('DELETE FROM whatsapp_automation_rules WHERE rubro = ?').run(rubro),
  enrolled: (phone) => !!db.prepare('SELECT 1 FROM whatsapp_enrollments WHERE phone = ?').get(phone),
  enroll: (run, phone, user, now) => db.prepare('INSERT INTO whatsapp_enrollments (run_id, phone, sender_id, sender_name, started_at) VALUES (?, ?, ?, ?, ?)').run(run.id, phone, user.id, user.name, now),
  enrollment: (id) => plain(db.prepare('SELECT * FROM whatsapp_enrollments WHERE run_id = ?').get(id)),
  enrollments: () => plainAll(db.prepare('SELECT * FROM whatsapp_enrollments').all()),
  jobs: () => plainAll(db.prepare('SELECT j.*, c.name AS company_name FROM whatsapp_jobs j JOIN whatsapp_runs r ON r.id = j.run_id JOIN deals d ON d.id = r.deal_id JOIN companies c ON c.id = d.company_id ORDER BY j.id DESC LIMIT 100').all()),
  job: (id) => plain(db.prepare('SELECT * FROM whatsapp_jobs WHERE id = ?').get(id)),
  stepJob: (runId, index) => plain(db.prepare('SELECT * FROM whatsapp_jobs WHERE run_id = ? AND step_index = ?').get(runId, index)),
  busy: (runId) => !!db.prepare("SELECT 1 FROM whatsapp_jobs WHERE run_id = ? AND state IN ('processing','uncertain')").get(runId),
  processing: () => !!db.prepare("SELECT 1 FROM whatsapp_jobs WHERE state = 'processing'").get(),
  stale: (before) => db.prepare("UPDATE whatsapp_jobs SET state = 'uncertain', detail = 'El worker dejó de confirmar el resultado. Revisar en WhatsApp.' WHERE state = 'processing' AND started_at < ?").run(before),
  attempts: (day) => db.prepare('SELECT COUNT(*) AS n FROM whatsapp_jobs WHERE local_day = ? AND started_at IS NOT NULL').get(day).n,
  lastAttempt: () => db.prepare('SELECT MAX(started_at) AS t FROM whatsapp_jobs').get().t || 0,
  pending: () => plainAll(db.prepare("SELECT * FROM whatsapp_jobs WHERE state = 'pending' ORDER BY id").all()),
  queue: (run, phone, message) => db.prepare('INSERT OR IGNORE INTO whatsapp_jobs (run_id, step_index, run_version, phone, message) VALUES (?, ?, ?, ?, ?)').run(run.id, run.step_index, run.version, phone, message).changes,
  updateJob: (id, fields) => {
    updateRow('whatsapp_jobs', id, fields, ['state', 'claim_token', 'started_at', 'local_day', 'finished_at', 'provider_id', 'detail'], false);
    return automationStore.job(id);
  },
  cancelPending: (runId) => db.prepare("UPDATE whatsapp_jobs SET state = 'cancelled', detail = 'El seguimiento cambió antes del envío.' WHERE run_id = ? AND state = 'pending'").run(runId),
  requeueCancelled: (run) => db.prepare("UPDATE whatsapp_jobs SET state = 'pending', run_version = ?, detail = NULL, claim_token = NULL WHERE run_id = ? AND step_index = ? AND state = 'cancelled' AND (started_at IS NULL OR detail = 'El worker confirmó que no invocó el envío.')").run(run.version, run.id, run.step_index),
  countByState: () => plainAll(db.prepare('SELECT state, COUNT(*) AS total FROM whatsapp_jobs GROUP BY state').all()),
};

if (!whatsapp.flows().length) whatsapp.saveFlow(null, {
  name: 'Explorar necesidades digitales · Borrador',
  description: 'Textos de ejemplo para revisar con el equipo antes de contactar. Ajusta los mensajes y los plazos a tu embudo.',
  active: 1,
  steps: [
    { title: 'Presentación', delay_days: 0, message: 'Hola, {{contacto}}. Soy {{vendedor}}, de Kolvex. Ayudamos a negocios como {{empresa}} con páginas web, presencia digital y sistemas de gestión. ¿Te parece que conversemos para ver si hay algo en lo que podamos ayudarles?' },
    { title: 'Detectar la necesidad', delay_days: 3, message: 'Hola, {{contacto}}. Retomo mi mensaje anterior. En {{empresa}}, ¿les serviría mejorar cómo los encuentran en internet, recibir consultas o simplificar la gestión del negocio? Si te interesa, podemos ver juntos qué necesitan.' },
    { title: 'Invitar a conversar', delay_days: 4, message: 'Hola, {{contacto}}. Si están evaluando alguna mejora digital para {{empresa}}, podemos coordinar una charla breve para entender la necesidad y proponerles opciones. ¿Les vendría bien?' },
    { title: 'Cerrar el seguimiento', delay_days: 7, message: 'Hola, {{contacto}}. Cierro por aquí el seguimiento para no insistir. Si más adelante necesitan una web o un sistema para {{empresa}}, quedo a disposición. ¡Gracias por tu tiempo!' },
  ],
});

// ---------- Resumen ----------
export function stats() {
  const byStage = Object.fromEntries(STAGE_IDS.map((s) => [s, 0]));
  for (const r of db.prepare('SELECT stage, COUNT(*) AS n FROM deals GROUP BY stage').all()) byStage[r.stage] = r.n;
  const won = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(value),0) AS total FROM deals WHERE stage = 'ganado'").get();
  const pipeline = db.prepare("SELECT COALESCE(SUM(value),0) AS total FROM deals WHERE stage NOT IN ('ganado','perdido')").get();
  const overdue = db.prepare("SELECT COUNT(*) AS n FROM deals WHERE next_followup IS NOT NULL AND next_followup <= date('now','localtime') AND stage NOT IN ('ganado','perdido')").get();
  const meetingsWeek = db.prepare("SELECT COUNT(*) AS n FROM comments WHERE type = 'reunion' AND system = 0 AND COALESCE(meeting_date, created_at) >= date('now','localtime','-7 days')").get();
  return {
    byStage,
    companies: db.prepare('SELECT COUNT(*) AS n FROM companies').get().n,
    wonCount: won.n,
    wonValue: won.total,
    pipelineValue: pipeline.total,
    overdueFollowups: overdue.n,
    meetingsLast7Days: meetingsWeek.n,
  };
}
