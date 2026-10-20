import { useState } from 'react';
import { api } from '../api.js';
import { useApp, useFetch, useToast, Spinner, Modal } from './ui.jsx';

const STATE_LABELS = { pending: 'Pendiente', processing: 'Enviando', sent: 'Aceptado por WhatsApp', uncertain: 'Revisar resultado', cancelled: 'Cancelado' };
export default function WhatsAppAutomation({ flows }) {
  const { user, meta } = useApp();
  const toast = useToast();
  const res = useFetch(() => user.role === 'admin' ? api('/whatsapp/automation') : Promise.resolve(null), [], { interval: 10000 });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [rule, setRule] = useState({ rubro: '', flow_id: '' });
  const [settings, setSettings] = useState(null);
  const [review, setReview] = useState(null);
  const [providerId, setProviderId] = useState('');
  const [confirmEnable, setConfirmEnable] = useState(false);
  if (user.role !== 'admin') return <section className="panel"><h2>Automatización</h2><p className="muted">Un administrador puede configurar reglas por rubro y activar los envíos automáticos.</p></section>;
  const perform = async (work) => {
    setBusy(true);
    try { await work(); await res.reload(true); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  if (!res.data) return <section className="panel">{res.error ? <div className="alert">{res.error}<button className="btn btn-ghost" onClick={() => res.reload()}>Reintentar</button></div> : <Spinner />}</section>;
  const { config, rules, jobs, worker } = res.data;
  const form = settings || config;
  const saveConfig = (body) => api('/whatsapp/automation', { method: 'PATCH', body });
  const simulate = () => perform(async () => { setPreview(await api('/whatsapp/automation/preview', { method: 'POST', body: {} })); });
  return <section className="panel wa-automation">
    <header className="panel-head"><h2>Envíos automáticos por rubro</h2><span className="tag">{config.enabled ? 'Envíos habilitados' : 'Envíos pausados'}</span></header>
    <p className="muted">Asigna un flujo por rubro, simula el lote y revisa los mensajes antes de incorporarlo. El worker abre WhatsApp Web y envía cada paso cuando vence. Se detiene el flujo cuando recibe una respuesta.</p>
    <div className="wa-run-head"><p><strong>WhatsApp: </strong>{worker ? worker.ready ? 'Worker conectado y vinculado' : 'Worker conectado; esperando vinculación' : 'Sin worker conectado'}</p>
      {config.enabled ? <button className="btn btn-danger" disabled={busy} onClick={() => perform(() => saveConfig({ enabled: false }))}>Pausar envíos automáticos</button> : <button className="btn btn-primary" disabled={busy} onClick={() => setConfirmEnable(true)}>Habilitar envíos reales</button>}
    </div>
    <details><summary>Conectar WhatsApp Web</summary><p className="muted">En la carpeta automation, instala las dependencias con npm ci, copia .env.example como .env y configura la URL y el usuario del CRM. Ejecuta npm start y escanea el QR desde Dispositivos vinculados en tu WhatsApp. El worker necesita permanecer encendido para enviar y detectar respuestas.</p><p className="muted">La vinculación usa una integración no oficial con WhatsApp Web. Puede dejar de funcionar si cambia WhatsApp y existe riesgo de restricción de la cuenta. La aceptación de un mensaje no confirma entrega ni lectura.</p></details>
    {res.error && <div className="alert">{res.error}</div>}
    <fieldset disabled={busy} className="wa-fieldset">
      <h3>Horario y ritmo</h3><p className="muted small">Horario de America/Asuncion por defecto (usa TZ del servidor). La pausa impide nuevos envíos; uno ya iniciado puede finalizar.</p>
      <div className="grid-form">
        {[['daily_limit', 'Máximo de intentos por día', 1, 1000], ['interval_seconds', 'Segundos entre mensajes', 1, 3600], ['start_hour', 'Hora de inicio (0–23)', 0, 23], ['end_hour', 'Hora de cierre (1–24)', 1, 24]].map(([key, label, min, max]) => <label className="field" key={key}><span className="field-label">{label}</span><input type="number" min={min} max={max} value={form[key]} onChange={(e) => setSettings({ ...form, [key]: e.target.value === '' ? '' : Number(e.target.value) })} /></label>)}
      </div>
      <div><button className="btn btn-ghost" disabled={!settings} onClick={() => perform(async () => { const { enabled, ...body } = settings; await saveConfig(body); setSettings(null); toast('Horario guardado'); })}>Guardar horario y ritmo</button></div>
      <h3>Reglas de selección</h3>
      <div className="wa-actions">
        <label className="field"><span className="field-label">Rubro</span><select value={rule.rubro} onChange={(e) => setRule({ ...rule, rubro: e.target.value })}><option value="">Seleccionar rubro</option><option value="*">Todos los demás rubros</option>{meta.rubros.map((r) => <option key={r}>{r}</option>)}</select></label>
        <label className="field"><span className="field-label">Flujo a aplicar</span><select value={rule.flow_id} onChange={(e) => setRule({ ...rule, flow_id: e.target.value })}><option value="">Seleccionar flujo</option>{flows.filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <button className="btn btn-ghost" disabled={!rule.rubro || !rule.flow_id} onClick={() => perform(async () => { await api('/whatsapp/automation/rules', { method: 'POST', body: { ...rule, flow_id: Number(rule.flow_id) } }); setPreview(null); toast('Regla guardada'); })}>Guardar regla</button>
      </div>
      {rules.map((r) => <div className="wa-run-head" key={r.rubro}><span><strong>{r.rubro === '*' ? 'Todos los demás rubros' : r.rubro}</strong> → {r.flow_name}{r.active ? '' : ' (archivado)'}</span><button className="btn btn-ghost btn-sm" onClick={() => perform(async () => { await api('/whatsapp/automation/rules/remove', { method: 'POST', body: { rubro: r.rubro } }); setPreview(null); })}>Quitar regla</button></div>)}
      <div><button className="btn btn-primary" disabled={!rules.length} onClick={simulate}>Simular lote y revisar mensajes</button></div>
      <p className="muted small">Se incluyen prospectos nuevos, un solo registro por celular. Se excluyen empresas bloqueadas, con flujos anteriores o sin celular válido. Crear el lote no activa los envíos.</p>
    </fieldset>
    {!!jobs.length && <><h3>Últimos 100 envíos</h3><div className="table-wrap"><table className="table"><thead><tr><th>Empresa</th><th>Paso</th><th>Resultado</th><th>Mensaje / acción</th></tr></thead><tbody>{jobs.map((j) => <tr key={j.id}><td>{j.company_name}</td><td>{j.step_index + 1}</td><td>{STATE_LABELS[j.state]}<div className="muted small">{j.detail}</div></td><td><details><summary>Ver mensaje</summary><p className="wa-message">{j.message}</p>{j.provider_id && <p className="muted small">ID: {j.provider_id}</p>}</details>{j.state === 'uncertain' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setReview(j); setProviderId(''); }}>Revisar resultado</button>}</td></tr>)}</tbody></table></div></>}
    {preview && <Modal title="Simulación del lote · Sin envíos" wide onClose={() => setPreview(null)}>
      <div className="wa-contact"><p><strong>{preview.rows.length} prospectos elegibles</strong>. Revisa el texto y el flujo asignado antes de preparar el lote.</p>
        {Object.entries(preview.skipped).map(([reason, n]) => <p key={reason} className="muted small">{reason}: {n}</p>)}
        {preview.rows.map((r) => <article className="wa-flow-card" key={r.deal_id}><h3>{r.company_name}</h3><p className="muted small">{r.rubro || 'Sin rubro'} · {r.phone} · {r.flow_name} · Primer paso: {r.first_due}</p><p className="wa-message">{r.message}</p><details><summary>Ver todos los pasos</summary>{r.steps.map((s, i) => <p className="wa-message" key={i}><strong>{i + 1}. {s.title} · Espera: {s.delay_days} días</strong><br />{s.message}</p>)}</details></article>)}
        <p className="muted">Preparar el lote registra los seguimientos. Si los envíos ya están habilitados y el worker está conectado, comenzará a procesarlos dentro del horario configurado.</p>
        <button className="btn btn-primary" disabled={busy || !preview.rows.length} onClick={() => perform(async () => { const result = await api('/whatsapp/automation/enroll', { method: 'POST', body: { fingerprint: preview.fingerprint } }); toast(`${result.enrolled} seguimientos preparados`); setPreview(null); })}>Preparar {preview.rows.length} seguimientos</button>
      </div>
    </Modal>}
    {confirmEnable && <Modal title="Habilitar envíos reales" onClose={() => setConfirmEnable(false)}><div className="wa-contact"><p>El worker enviará los mensajes de los lotes preparados, incluidos los próximos pasos que vayan venciendo. Revisa las plantillas y el horario antes de activar.</p><button className="btn btn-primary" disabled={busy} onClick={() => perform(async () => { await saveConfig({ enabled: true }); setConfirmEnable(false); toast('Envíos automáticos habilitados'); })}>Habilitar automatización</button></div></Modal>}
    {review && <Modal title="Revisar envío incierto" onClose={() => setReview(null)}><div className="wa-contact"><p>Revisa el chat en WhatsApp. Un resultado incierto nunca se reenvía automáticamente.</p><p className="wa-message">{review.message}</p><label className="field"><span className="field-label">ID de WhatsApp del mensaje enviado</span><input value={providerId} onChange={(e) => setProviderId(e.target.value)} /></label><button className="btn btn-primary" disabled={busy || !providerId.trim()} onClick={() => perform(async () => { await api(`/whatsapp/automation/jobs/${review.id}/resolve`, { method: 'POST', body: { result: 'sent', provider_id: providerId.trim() } }); setReview(null); })}>Confirmar enviado y avanzar</button><button className="btn btn-ghost" disabled={busy} onClick={() => perform(async () => { await api(`/whatsapp/automation/jobs/${review.id}/resolve`, { method: 'POST', body: { result: 'cancelled' } }); setReview(null); })}>Confirmar no enviado · Pausar flujo</button></div></Modal>}
  </section>;
}
