import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../components/ui.jsx';

export default function BrowserRobot() {
  const { user } = useApp();
  const [job, setJob] = useState(null);
  const [status, setStatus] = useState('ready');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [reply, setReply] = useState('');
  if (user.role !== 'admin') return <div className="page"><div role="alert" className="alert">El robot requiere un administrador.</div></div>;
  const work = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); setStatus('error'); }
    finally { setBusy(false); }
  };
  const next = () => work(async () => {
    const { job: nextJob } = await api('/whatsapp/automation/claim', { method: 'POST', body: {} });
    setJob(nextJob); setOpened(false); setProviderId(''); setReply('');
    setStatus(nextJob ? 'contact' : 'idle');
  });
  const check = () => work(async () => {
    const result = await api(`/whatsapp/automation/jobs/${job.id}/check`, { method: 'POST', body: { claim_token: job.claim_token } });
    setStatus(result.allowed ? 'allowed' : 'blocked');
  });
  const finish = (result) => work(async () => {
    await api(`/whatsapp/automation/jobs/${job.id}/result`, { method: 'POST', body: { claim_token: job.claim_token, result, ...(result === 'sent' ? { provider_id: providerId } : {}) } });
    setJob(null); setStatus(result === 'uncertain' ? 'uncertain' : 'done');
  });
  const responded = () => work(async () => {
    await api('/whatsapp/automation/reply', { method: 'POST', body: { phone: job.phone, timestamp: Date.now(), message: reply } });
    await api(`/whatsapp/automation/jobs/${job.id}/result`, { method: 'POST', body: { claim_token: job.claim_token, result: 'cancelled' } });
    setJob(null); setStatus('done');
  });
  const waUrl = job && `https://web.whatsapp.com/send?phone=${job.phone}&text=${encodeURIComponent(job.message)}`;
  return <div className="page wa-contact" data-testid="browser-robot" data-status={busy ? 'busy' : status}>
    <div className="page-head"><div><h1>Robot de navegador</h1><p className="muted">Playwright recorre el CRM, abre WhatsApp Web, envía y vuelve a registrar el resultado.</p></div><a className="btn btn-ghost" href="#/flujos">Configurar lotes y horarios</a></div>
    <p className="muted">Prepara los prospectos en Flujos WhatsApp y ejecuta <code>npm run robot</code> desde la carpeta automation. El robot usa una ventana propia. Vincula WhatsApp desde esa ventana la primera vez.</p>
    {error && <div role="alert" className="alert">{error}</div>}
    {!job ? <section className="panel wa-contact">
      <p role="status">{status === 'idle' ? 'Sin mensajes disponibles: revisa la activación, horario, límite o fecha del siguiente paso.' : status === 'done' ? 'Resultado registrado. Listo para el siguiente contacto.' : status === 'uncertain' ? 'Envío retenido para revisión. Revisa su resultado en Flujos WhatsApp.' : 'Listo para buscar el próximo prospecto.'}</p>
      <div><button data-testid="robot-next" className="btn btn-primary" disabled={busy || status === 'uncertain' || status === 'error'} onClick={next}>Buscar próximo prospecto</button></div>
    </section> : <section className="panel wa-contact" data-testid="robot-job" data-job-id={job.id} data-phone={job.phone} data-since={job.enrollment_started_at}>
      <h2>Contactar · {job.company_name || job.phone}</h2>
      <p className="muted">{job.phone} · {job.flow_name} · Paso {job.step_index + 1}</p>
      <p className="wa-message" data-testid="robot-message">{job.message}</p>
      <div className="wa-actions"><a data-testid="robot-open" className="btn btn-wa" href={waUrl} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}>Contactar · Abrir WhatsApp Web</a>
        <button data-testid="robot-check" className="btn btn-ghost" disabled={busy} onClick={check}>Verificar que el envío sigue habilitado</button></div>
      {status === 'blocked' && <p className="alert">El envío se pausó o el prospecto cambió. No envíes este mensaje.</p>}
      <label className="field"><span className="field-label">Identificador del mensaje enviado en WhatsApp</span><input data-testid="robot-provider-id" value={providerId} onChange={(e) => setProviderId(e.target.value)} /></label>
      <div className="wa-actions"><button data-testid="robot-sent" className="btn btn-primary" disabled={busy || !opened || !providerId.trim()} onClick={() => finish('sent')}>Ya lo envié · Registrar</button>
        <button data-testid="robot-uncertain" className="btn btn-ghost" disabled={busy} onClick={() => finish('uncertain')}>Resultado incierto · Detener</button>
        <button data-testid="robot-cancel" className="btn btn-ghost" disabled={busy} onClick={() => finish('cancelled')}>Cancelar sin enviar</button></div>
      <label className="field"><span className="field-label">Respuesta recibida del prospecto</span><textarea data-testid="robot-reply" value={reply} maxLength={4000} onChange={(e) => setReply(e.target.value)} /></label>
      <div><button data-testid="robot-responded" className="btn btn-ghost" disabled={busy || !reply.trim()} onClick={responded}>Respondió · Finalizar seguimiento</button></div>
    </section>}
  </div>;
}
