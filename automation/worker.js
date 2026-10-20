import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { processJob } from './processor.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(root, process.env.WA_SESSION_DIR || '.session');
const outbox = path.join(dataDir, 'receipts');
const base = (process.env.CRM_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const url = new URL(base);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
  throw new Error('CRM_URL debe usar HTTPS o HTTP en localhost.');
}
if (!process.env.CRM_EMAIL || !process.env.CRM_PASSWORD) throw new Error('Configura CRM_EMAIL y CRM_PASSWORD en automation/.env.');
let token;
async function login() {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.CRM_EMAIL, password: process.env.CRM_PASSWORD }), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`No se pudo iniciar sesión en el CRM (${res.status}).`);
  const data = await res.json();
  if (data.user.role !== 'admin') throw new Error('El worker requiere un usuario administrador del CRM.');
  token = data.token;
}
async function api(route, body, retry = true) {
  const res = await fetch(`${base}/api/whatsapp/automation${route}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  if (res.status === 401 && retry) { await login(); return api(route, body, false); }
  if (!res.ok) throw new Error(`El CRM rechazó ${route} (${res.status}).`);
  return res.json();
}
await login();
if (process.argv.includes('--simulate')) {
  const preview = await api('/preview', {});
  const config = await api('');
  console.log(JSON.stringify({ mode: 'simulation', eligible: preview.rows.length, skipped: preview.skipped,
    enabled: config.config.enabled, samples: preview.rows.slice(0, 10).map(({ company_name, rubro, flow_name, message, first_due }) => ({ company_name, rubro, flow_name, message, first_due })) }, null, 2));
  process.exit(0);
}

const { default: wwebjs } = await import('whatsapp-web.js');
const { default: qr } = await import('qrcode-terminal');
await fs.mkdir(outbox, { recursive: true });
// Perfil exclusivo. Un cierre abrupto puede dejar este archivo: comprobar que no
// quede un worker vivo antes de quitarlo manualmente.
const lockPath = path.join(dataDir, 'worker.lock');
const lock = await fs.open(lockPath, 'wx').catch(() => { throw new Error('El perfil ya está bloqueado. Comprueba si otro worker está ejecutándose antes de quitar .session/worker.lock.'); });
await lock.writeFile(String(process.pid));

const client = new wwebjs.Client({ authStrategy: new wwebjs.LocalAuth({ dataPath: path.join(dataDir, 'auth') }),
  puppeteer: { headless: true, ...(process.env.WA_CHROME_PATH ? { executablePath: process.env.WA_CHROME_PATH } : {}) },
  webVersionCache: { type: 'local', path: path.join(dataDir, 'web-cache') } });
let ready = false;
let running = true;
let targets = new Set();
let inputFailure = false;
const inboxTasks = new Set();
async function saveReceipt(receipt) {
  const file = path.join(outbox, `${receipt.id}.json`);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(receipt), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}
async function flushReceipts() {
  for (const name of await fs.readdir(outbox)) {
    if (!/^\d+\.json$/.test(name)) continue;
    const file = path.join(outbox, name);
    const receipt = JSON.parse(await fs.readFile(file, 'utf8'));
    await api(`/jobs/${receipt.id}/result`, receipt.body);
    await fs.unlink(file);
  }
}
const phoneOf = async (msg) => {
  if (msg.fromMe || msg.from.endsWith('@g.us') || msg.from === 'status@broadcast') return null;
  if (msg.from.endsWith('@c.us')) return msg.from.split('@')[0];
  const contact = await msg.getContact();
  return contact.number || null;
};
client.on('qr', (value) => { ready = false; console.log('Vincula desde WhatsApp → Dispositivos vinculados.'); qr.generate(value, { small: true }); });
client.on('ready', () => { ready = true; console.log('WhatsApp vinculado. Esperando trabajos habilitados en el CRM.'); });
client.on('auth_failure', () => { ready = false; running = false; console.error('Falló la vinculación de WhatsApp.'); });
client.on('disconnected', () => { ready = false; running = false; console.error('WhatsApp desconectado. Reinicia el worker para volver a vincular.'); });
client.on('message', (msg) => {
  const task = (async () => {
    const phone = await phoneOf(msg);
    if (targets.has(phone)) await api('/reply', { phone, timestamp: msg.timestamp * 1000, message: msg.body || '' });
  })().catch(() => { inputFailure = true; console.error('No se pudo registrar una respuesta. Se detienen los envíos para revisar.'); });
  inboxTasks.add(task);
  task.finally(() => inboxTasks.delete(task));
});
const adapter = {
  async recentReply(job) {
    const chatId = await client.getNumberId(job.phone);
    if (!chatId) throw new Error('El teléfono no tiene cuenta de WhatsApp.');
    const chat = await client.getChatById(chatId._serialized);
    if (chat.unreadCount > 100) throw new Error('Hay demasiados mensajes sin revisar.');
    const messages = await chat.fetchMessages({ limit: 100 });
    const reply = messages.filter((m) => !m.fromMe && m.timestamp * 1000 >= Math.floor(job.enrollment_started_at / 1000) * 1000).sort((a, b) => b.timestamp - a.timestamp)[0];
    return reply ? { phone: job.phone, timestamp: reply.timestamp * 1000, message: reply.body || '' } : null;
  },
  async send(job) {
    if (!ready || inputFailure) throw new Error('WhatsApp no está listo.');
    const message = await client.sendMessage(`${job.phone}@c.us`, job.message, { waitUntilMsgSent: true });
    return message?.id?._serialized;
  },
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { running = false; void client.destroy().catch(() => {}); });
try {
  await flushReceipts();
  targets = new Set(await api('/targets'));
  await api('/heartbeat', { ready: false });
  await client.initialize();
  while (running) {
    await api('/heartbeat', { ready });
    await flushReceipts();
    if (inputFailure) break;
    if (ready && !inputFailure) {
      targets = new Set(await api('/targets'));
      await Promise.all(inboxTasks);
      if (inputFailure) break;
      const { job } = await api('/claim', {});
      if (job) {
        // Una operación colgada no libera el worker para un segundo envío.
        let timer;
        try {
          const result = await Promise.race([
            processJob({ job, adapter, api, persist: saveReceipt }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout: envío retenido para revisión.')), 120000); }),
          ]);
          await fs.unlink(path.join(outbox, `${job.id}.json`));
          console.log(`Trabajo ${job.id}: ${result.result}`);
        } finally { clearTimeout(timer); }
      }
    }
    await delay(5000);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.destroy().catch(() => {});
  await lock.close();
  await fs.unlink(lockPath);
}
