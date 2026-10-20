import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { processJob } from '../automation/processor.js';

test('API HTTP + worker de simulación: login, selección por rubro, lote y avance sin WhatsApp real', { timeout: 20000 }, async () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kolvex-http-test-'));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, DB_PATH: path.join(dataDir, 'crm.db'),
    ADMIN_NAME: 'Prueba', ADMIN_EMAIL: 'test@crm.local', ADMIN_PASSWORD: 'only-for-local-test', RESET_ADMIN: 'false', SESSION_SECRET: 'http-test-secret' };
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let token;
  const base = `http://127.0.0.1:${port}`;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('El servidor no inició')), 8000);
      child.stdout.on('data', (chunk) => { if (chunk.toString().includes('CRM en')) { clearTimeout(timer); resolve(); } });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Servidor finalizado: ${code}`)); });
    });
    const request = async (p, method = 'GET', body) => {
      const res = await fetch(`${base}/api${p}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      assert.ok(res.ok, `${method} ${p}: ${res.status} ${res.ok ? '' : await res.text()}`);
      return res.json();
    };
    assert.equal((await fetch(`${base}/api/whatsapp/automation`)).status, 401);
    token = (await request('/auth/login', 'POST', { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })).token;
    const company = await request('/companies', 'POST', { name: 'Restaurante ficticio', rubro: 'Restaurante', telefono: '0981123456' });
    const flow = await request('/whatsapp/flows', 'POST', { name: 'Prueba HTTP', steps: [{ title: 'Saludo', message: 'Hola {{empresa}}, soy {{vendedor}}.', delay_days: 0 }] });
    await request('/whatsapp/automation/rules', 'POST', { rubro: 'Restaurante', flow_id: flow.id });
    const simulated = await promisify(execFile)(process.execPath, ['worker.js', '--simulate'], { cwd: path.join(root, 'automation'), env: { ...env, CRM_URL: base, CRM_EMAIL: env.ADMIN_EMAIL, CRM_PASSWORD: env.ADMIN_PASSWORD } });
    const output = JSON.parse(simulated.stdout);
    assert.equal(output.mode, 'simulation');
    assert.equal(output.eligible, 1);
    assert.equal((await request(`/companies/${company.id}`)).whatsapp_runs.length, 0);
    const preview = await request('/whatsapp/automation/preview', 'POST', {});
    assert.equal((await request('/whatsapp/automation/enroll', 'POST', { fingerprint: preview.fingerprint })).enrolled, 1);
    assert.equal((await request('/whatsapp/automation/claim', 'POST', {})).job, null);
    await request('/whatsapp/automation', 'PATCH', { enabled: true, start_hour: 0, end_hour: 24 });
    const { job } = await request('/whatsapp/automation/claim', 'POST', {});
    let sends = 0;
    await processJob({ job, api: (p, b) => request(`/whatsapp/automation${p}`, 'POST', b), persist: async () => {},
      adapter: { recentReply: async () => null, send: async () => { sends++; return 'fake-http-provider-id'; } } });
    const detail = await request(`/companies/${company.id}`);
    assert.equal(sends, 1);
    assert.equal(detail.whatsapp_runs[0].status, 'completed');
    assert.equal(detail.comments.filter((c) => c.type === 'whatsapp').length, 1);
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
