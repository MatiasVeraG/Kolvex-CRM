import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { whatsappUrl, renderMessage } from '../shared/whatsapp.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kolvex-whatsapp-test-'));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = path.join(tempDir, 'crm.db');
process.env.SESSION_SECRET = 'isolated-test-secret';
process.env.TZ = 'America/Asuncion';
const { db, companies, deals, users, whatsapp } = await import('../server/db.js');
const { routes } = await import('../server/routes.js');
const user = users.create({ name: 'Vendedora', email: 'test@example.com', password_hash: 'unused' });
after(() => { db.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });

function call(method, path, { body = {}, params = {} } = {}) {
  const route = routes.find(([m, p]) => m === method && p === path);
  assert.ok(route, `${method} ${path}`);
  return route[3]({ user, params, body, query: {}, req: { socket: { remoteAddress: '127.0.0.1' } } });
}
const template = () => ({ name: 'Prueba', description: 'Un embudo', active: 1, steps: [
  { title: 'Presentación', message: 'Hola {{contacto}}, soy {{vendedor}}. ¿Conversamos sobre {{empresa}}?', delay_days: 0 },
  { title: 'Seguimiento', message: 'Hola {{contacto}}, retomo el contacto.', delay_days: 3 },
] });
function fixture(overrides = {}) {
  const c = call('POST', '/api/companies', { body: { name: 'Tienda de prueba', telefono: '0981123456', ...overrides } });
  const f = call('POST', '/api/whatsapp/flows', { body: template() });
  return { c, f, d: c.deals[0] };
}
const start = ({ d, f }) => call('POST', '/api/deals/:id/whatsapp', { params: { id: d.id }, body: { flow_id: f.id } });
const action = (run, type, extra = {}) => call('POST', '/api/whatsapp/runs/:id/action', {
  params: { id: run.id }, body: { action: type, version: run.version, ...extra },
});
const detail = (id) => call('GET', '/api/companies/:id', { params: { id } });

test('normaliza teléfonos y codifica el mensaje; personaliza variables sin interpretar texto del prospecto', () => {
  assert.equal(whatsappUrl('0981 123 456', 'Hola & gracias!'), 'https://wa.me/595981123456?text=Hola%20%26%20gracias!');
  assert.equal(whatsappUrl('+595 981 123456'), 'https://wa.me/595981123456');
  assert.equal(whatsappUrl('021123456'), null);
  assert.equal(renderMessage('{{contacto}} / {{empresa}} / {{vendedor}}', { name: 'Tienda $&' }, user), 'Tienda $& / Tienda $& / Vendedora');
});

test('valida mensajes, variables, cantidad de pasos y plazos', () => {
  for (const body of [
    { ...template(), steps: [] },
    { ...template(), steps: [{ title: 'X', message: '', delay_days: 0 }] },
    { ...template(), steps: [{ title: 'X', message: '{{desconocida}}', delay_days: 0 }] },
    { ...template(), steps: [{ title: 'X', message: '{{mal formada}}', delay_days: 0 }] },
    { ...template(), steps: [{ title: 'X', message: 'Hola', delay_days: -1 }] },
    { ...template(), steps: [null] },
  ]) assert.throws(() => call('POST', '/api/whatsapp/flows', { body }), { status: 400 });
});

test('inicia sin registrar envío, evita duplicados y conserva la plantilla original al editarla', () => {
  const fixtureData = fixture();
  const { c, f, d } = fixtureData;
  const run = start(fixtureData);
  assert.equal(run.step_index, 0);
  assert.equal(deals.get(d.id).stage, 'prospecto');
  assert.equal(detail(c.id).comments.filter((x) => x.type === 'whatsapp').length, 0);
  assert.equal(deals.get(d.id).next_followup, run.next_due);
  assert.throws(() => start(fixtureData), { status: 400 });
  call('PATCH', '/api/whatsapp/flows/:id', { params: { id: f.id }, body: { ...f, active: 0, steps: [{ title: 'Cambio', message: 'Nuevo mensaje', delay_days: 9 }] } });
  assert.deepEqual(whatsapp.run(run.id).steps, f.steps);
  assert.equal(whatsapp.run(run.id).flow_name, f.name);
});

test('rechaza celulares inválidos, flujos archivados y negociaciones cerradas', () => {
  assert.throws(() => start(fixture({ telefono: '021123456' })), { status: 400 });
  const fx = fixture();
  whatsapp.saveFlow(fx.f.id, { ...fx.f, active: 0 });
  assert.throws(() => start(fx), { status: 400 });
  whatsapp.saveFlow(fx.f.id, { ...fx.f, active: 1 });
  deals.update(fx.d.id, { stage: 'ganado' });
  assert.throws(() => start(fx), { status: 400 });
});

test('confirmar registra el texto real, avanza, cambia a contactado y evita doble registro o envíos anticipados', () => {
  const fx = fixture();
  const before = start(fx);
  const run = action(before, 'sent', { message: 'Hola, este es el mensaje editado.' });
  assert.equal(run.step_index, 1);
  assert.equal(run.status, 'active');
  assert.equal(deals.get(fx.d.id).stage, 'contactado');
  assert.equal(deals.get(fx.d.id).next_followup, run.next_due);
  const delta = (Date.parse(run.next_due) - Date.parse(before.next_due)) / 86400e3;
  assert.equal(delta, 3);
  assert.throws(() => action(before, 'sent', { message: 'Duplicado' }), { status: 409 });
  assert.throws(() => action(run, 'sent', { message: 'Demasiado pronto' }), { status: 400 });
  assert.equal(whatsapp.run(run.id).step_index, 1);
  const sent = detail(fx.c.id).comments.filter((c) => c.type === 'whatsapp');
  assert.equal(sent.length, 1);
  assert.ok(sent[0].body.endsWith('Hola, este es el mensaje editado.'));
  assert.equal(sent[0].user_id, user.id);
});

test('pausa, reanuda y detiene al recibir respuesta; valida fechas reales', () => {
  const fx = fixture();
  let run = action(start(fx), 'pause');
  assert.equal(run.status, 'paused');
  assert.equal(deals.get(fx.d.id).next_followup, null);
  assert.throws(() => action(run, 'sent', { message: 'No corresponde' }), { status: 400 });
  assert.throws(() => action(run, 'resume', { next_due: '2026-02-30' }), { status: 400 });
  run = action(run, 'resume', { next_due: '2026-11-15' });
  assert.equal(deals.get(fx.d.id).next_followup, '2026-11-15');
  run = action(run, 'responded');
  assert.equal(run.status, 'responded');
  assert.equal(deals.get(fx.d.id).next_followup, null);
  assert.throws(() => action(run, 'resume', { next_due: '2026-11-16' }), { status: 400 });
});

test('completar el último paso cierra el flujo y permite otro sin perder historial', () => {
  const fx = fixture();
  let run = action(start(fx), 'sent', { message: 'Primero' });
  run = action(run, 'reschedule', { next_due: '2020-01-01' });
  run = action(run, 'sent', { message: 'Segundo' });
  assert.equal(run.status, 'completed');
  assert.equal(run.next_due, null);
  assert.equal(run.step_index, 2);
  assert.equal(deals.get(fx.d.id).next_followup, null);
  assert.ok(start(fx).id !== run.id);
  assert.equal(detail(fx.c.id).whatsapp_runs.length, 2);
});

test('no contactar detiene todos los flujos de la empresa e impide nuevas ejecuciones', () => {
  const fx = fixture();
  const d2 = deals.create({ company_id: fx.c.id, title: 'Sistema de gestión', owner_id: user.id });
  const first = start(fx);
  const second = start({ ...fx, d: d2 });
  action(first, 'do_not_contact');
  assert.equal(whatsapp.run(second.id).status, 'stopped');
  assert.equal(detail(fx.c.id).whatsapp_blocked, true);
  assert.equal(deals.get(d2.id).next_followup, null);
  assert.throws(() => start(fx), { status: 400 });
  assert.throws(() => start({ ...fx, d: d2 }), { status: 400 });
});

test('cerrar una negociación detiene su flujo sin cambiar el avance', () => {
  const fx = fixture();
  const run = start(fx);
  const updated = call('PATCH', '/api/deals/:id', { params: { id: fx.d.id }, body: { stage: 'ganado' } });
  assert.equal(updated.next_followup, null);
  assert.equal(whatsapp.run(run.id).status, 'stopped');
  assert.equal(whatsapp.run(run.id).step_index, 0);
});

test('detener un flujo conserva seguimientos que se editaron manualmente', () => {
  const fx = fixture();
  const run = start(fx);
  deals.update(fx.d.id, { next_followup: '2030-12-01' });
  action(run, 'stop');
  assert.equal(deals.get(fx.d.id).next_followup, '2030-12-01');
});

test('eliminar la empresa borra ejecuciones dependientes sin romper las plantillas', () => {
  const fx = fixture();
  const run = start(fx);
  companies.remove(fx.c.id);
  assert.equal(whatsapp.run(run.id), undefined);
  assert.ok(whatsapp.flow(fx.f.id));
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
