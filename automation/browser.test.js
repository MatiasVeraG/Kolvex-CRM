import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { enterCRM, sendNextThroughUI, simulateThroughUI } from './browser-flow.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kolvex-browser-test-'));
let child, browser, context, crm, base, token;
let sendClicks = 0;
let scenario = 'success';
async function api(p, method = 'GET', body) {
  const res = await fetch(`${base}/api${p}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(res.ok, `${method} ${p}: ${res.status}`);
  return res.json();
}
async function addProspect(phone) {
  const c = await api('/companies', 'POST', { name: 'Prospecto ficticio', telefono: phone, rubro: 'Prueba' });
  const flow = await api('/whatsapp/flows', 'POST', { name: 'Prueba del robot', steps: [{ title: 'Saludo', message: 'Hola {{empresa}}, soy {{vendedor}}. ¿Conversamos?', delay_days: 0 }] });
  await api('/whatsapp/automation/rules', 'POST', { rubro: 'Prueba', flow_id: flow.id });
  return c;
}
async function prepare() {
  const preview = await api('/whatsapp/automation/preview', 'POST', {});
  await api('/whatsapp/automation/enroll', 'POST', { fingerprint: preview.fingerprint });
  await api('/whatsapp/automation', 'PATCH', { enabled: true, interval_seconds: 1, start_hour: 0, end_hour: 24 });
  await crm.goto(`${base}/#/robot`);
  await crm.getByTestId('robot-next').waitFor();
}

before(async () => {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, DB_PATH: path.join(dataDir, 'crm.db'),
    ADMIN_NAME: 'Robot de prueba', ADMIN_EMAIL: 'browser@test.local', ADMIN_PASSWORD: 'browser-local-test', SESSION_SECRET: 'browser-test-secret', RESET_ADMIN: 'false' };
  child = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('El CRM no inició')), 8000);
    child.stdout.on('data', (chunk) => { if (chunk.toString().includes('CRM en')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('El CRM se cerró')); });
  });
  token = (await api('/auth/login', 'POST', { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })).token;
  browser = await chromium.launch({ headless: true, ...(process.env.WA_CHROME_PATH ? { executablePath: process.env.WA_CHROME_PATH } : { channel: process.env.WA_BROWSER_CHANNEL || 'chrome' }) });
  context = await browser.newContext({ locale: 'es-PY', timezoneId: 'America/Asuncion' });
  // Ninguna solicitud llega a WhatsApp: se sustituye toda la pantalla remota.
  await context.route('https://web.whatsapp.com/**', async (route) => {
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><body>
      <h1>WhatsApp simulado · Sin envíos reales</h1><div id="messages"></div>
      <footer><div contenteditable="true" role="textbox"></div><button aria-label="Enviar">Enviar</button></footer>
      <script>
      const scenario = ${JSON.stringify(scenario)};
      const text = new URLSearchParams(location.search).get('text');
      document.querySelector('[contenteditable]').textContent = text;
      if (scenario === 'reply') {
        const incoming = document.createElement('div'); incoming.className = 'message-in';
        const meta = document.createElement('div');
        const d = new Date();
        meta.setAttribute('data-pre-plain-text', '[' + d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0') + ', ' + d.getDate() + '/' + (d.getMonth()+1) + '/' + d.getFullYear() + '] Ana: ');
        const content = document.createElement('span'); content.className='selectable-text'; content.textContent='Sí, contame más';
        meta.append(content); incoming.append(meta); document.querySelector('#messages').append(incoming);
      }
      document.querySelector('button').onclick = () => {
        fetch('/clicked');
        const wrap = document.createElement('div'); wrap.setAttribute('data-id','fake-browser-message-' + Date.now());
        const msg = document.createElement('div'); msg.className='message-out';
        const content = document.createElement('span'); content.className='selectable-text'; content.textContent=text;
        const icon = document.createElement('span'); icon.setAttribute('data-icon',scenario==='uncertain'?'msg-time':'msg-check');
        msg.append(content,icon); wrap.append(msg); document.querySelector('#messages').append(wrap);
      };
      </script></body></html>` });
  });
  context.on('request', (request) => { if (request.url() === 'https://web.whatsapp.com/clicked') sendClicks++; });
  crm = await context.newPage();
  await enterCRM(crm, { url: base, email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
}, { timeout: 20000 });

after(async () => {
  await browser?.close();
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited;
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Playwright entra al CRM, pulsa Contactar, envía en la pantalla simulada y vuelve a registrar', { timeout: 15000 }, async () => {
  const company = await addProspect('0981123456');
  const simulation = await simulateThroughUI(crm);
  assert.match(simulation, /1 prospectos elegibles/);
  assert.equal((await api(`/companies/${company.id}`)).whatsapp_runs.length, 0);
  await prepare();
  const receipts = [];
  const result = await sendNextThroughUI({ crm, persist: async (r) => receipts.push(r), timeout: 5000, confirmationTimeout: 2000 });
  assert.equal(result.state, 'sent');
  assert.equal(sendClicks, 1);
  assert.equal(receipts.length, 1);
  const detail = await api(`/companies/${company.id}`);
  assert.equal(detail.whatsapp_runs[0].status, 'completed');
  assert.equal(detail.comments.filter((c) => c.type === 'whatsapp').length, 1);
  assert.match(detail.comments.find((c) => c.type === 'whatsapp').body, /fake-browser-message-/);
  if (process.env.BROWSER_TEST_SCREENSHOT) await crm.screenshot({ path: process.env.BROWSER_TEST_SCREENSHOT });
});

test('si ve una respuesta reciente, registra la respuesta sin pulsar Enviar', { timeout: 15000 }, async () => {
  await delay(1100);
  scenario = 'reply';
  const company = await addProspect('0981123457'); await prepare();
  const result = await sendNextThroughUI({ crm, persist: async () => {}, timeout: 5000 });
  assert.equal(result.state, 'responded');
  assert.equal(sendClicks, 1);
  const detail = await api(`/companies/${company.id}`);
  assert.equal(detail.whatsapp_runs[0].status, 'responded');
});

test('si no aparece confirmación de WhatsApp, detiene el robot sin repetir el clic', { timeout: 15000 }, async () => {
  await delay(1100);
  scenario = 'uncertain';
  await addProspect('0981123458'); await prepare();
  await assert.rejects(sendNextThroughUI({ crm, persist: async () => {}, timeout: 5000, confirmationTimeout: 300 }), /no se repite el envío/);
  assert.equal(sendClicks, 2);
  const state = await api('/whatsapp/automation');
  assert.ok(state.jobs.some((j) => j.state === 'uncertain'));
  assert.equal(await crm.getByTestId('browser-robot').getAttribute('data-status'), 'uncertain');
});
