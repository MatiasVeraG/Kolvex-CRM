import { useState } from 'react';
import { api, todayIso, fmtDate, parseLocal, whatsappUrl } from '../api.js';
import { renderMessage, RUN_LABELS } from '../../../shared/whatsapp.js';
import { Modal, useApp, useFetch, useToast, Spinner } from './ui.jsx';

export default function WhatsAppContact({ company, onClose, onChange, initialDealId }) {
  const { user } = useApp();
  const toast = useToast();
  const flows = useFetch(() => api('/whatsapp/flows'), []);
  const [dealId, setDealId] = useState(company.deals.find((d) => d.id === initialDealId)?.id || company.deals.find((d) => !['ganado', 'perdido'].includes(d.stage))?.id || company.deals[0]?.id || '');
  const [flowId, setFlowId] = useState('');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(company);
  const runs = current.whatsapp_runs.filter((r) => r.deal_id === Number(dealId));
  const run = runs.find((r) => ['active', 'paused'].includes(r.status));
  const chosen = flows.data?.find((f) => f.id === Number(flowId));
  const deal = current.deals.find((d) => d.id === Number(dealId));
  const eligible = deal && !['ganado', 'perdido'].includes(deal.stage) && !current.whatsapp_blocked && whatsappUrl(current.telefono);

  const reload = async () => {
    setCurrent(await api(`/companies/${company.id}`));
    onChange();
  };
  const start = async () => {
    setBusy(true);
    try {
      await api(`/deals/${dealId}/whatsapp`, { method: 'POST', body: { flow_id: Number(flowId) } });
      await reload(); toast('Flujo iniciado. Revisa el primer mensaje.');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  return <Modal title={`Contactar · ${current.name}`} wide onClose={onClose}>
    <div className="wa-contact">
      <p className="muted">Elige un flujo, revisa el mensaje y ábrelo en WhatsApp. Después de enviarlo, registra el envío aquí para programar el siguiente paso.</p>
      {current.whatsapp_blocked && <div className="alert">Esta empresa está marcada como no contactar por WhatsApp.</div>}
      {!whatsappUrl(current.telefono) && <div className="alert">La empresa necesita un celular válido de Paraguay (+595 9xx o 09xx). Puedes editarlo en su ficha.</div>}
      <label className="field"><span className="field-label">Negociación</span>
        <select value={dealId} onChange={(e) => setDealId(Number(e.target.value))} disabled={busy}>
          {!current.deals.length && <option value="">Sin negociaciones: agrega una en la ficha</option>}
          {current.deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
      </label>
      {run ? <RunComposer key={`${run.id}-${run.version}`} run={run} company={current} user={user} reload={reload} /> : <>
        {deal && ['ganado', 'perdido'].includes(deal.stage) && <p className="alert">La negociación está cerrada. Selecciona o crea una negociación abierta.</p>}
        {flows.loading && <Spinner />}
        {flows.error && <div className="alert">{flows.error}<button className="btn btn-ghost btn-sm" onClick={() => flows.reload()}>Reintentar</button></div>}
        <label className="field"><span className="field-label">Flujo de mensajes</span>
          <select value={flowId} onChange={(e) => setFlowId(e.target.value)} disabled={busy}>
            <option value="">Selecciona un flujo</option>
            {(flows.data || []).filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        {chosen && <><p className="muted">{chosen.description}</p><StepList steps={chosen.steps} index={0} />
          <div className="wa-preview">{renderMessage(chosen.steps[0].message, current, user)}</div></>}
        <div className="form-actions"><a href="#/flujos" onClick={onClose}>Crear o editar flujos</a>
          <button className="btn btn-primary" disabled={!chosen || !eligible || busy} onClick={start}>{busy ? 'Iniciando…' : 'Iniciar flujo'}</button>
        </div>
      </>}
      {runs.some((r) => !['active', 'paused'].includes(r.status)) && <details>
        <summary>Flujos anteriores</summary>
        {runs.filter((r) => !['active', 'paused'].includes(r.status)).map((r) => <p key={r.id}>{r.flow_name} · {RUN_LABELS[r.status]} · {r.step_index}/{r.steps.length} mensajes registrados</p>)}
      </details>}
    </div>
  </Modal>;
}

export function StepList({ steps, index }) {
  return <ol className="wa-steps">{steps.map((s, i) => <li key={i} className={i === index ? 'wa-current' : i < index ? 'wa-done' : ''}>
    <strong>{i < index ? '✓ ' : ''}{s.title}</strong><span className="muted small">{i === 0 ? `Inicio: ${s.delay_days} días` : `${s.delay_days} días después del envío anterior`}</span>
  </li>)}</ol>;
}

function RunComposer({ run, company, user, reload }) {
  const toast = useToast();
  const [message, setMessage] = useState(() => renderMessage(run.steps[run.step_index].message, company, user));
  const [when, setWhen] = useState(run.next_due || todayIso());
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const active = run.status === 'active';
  const due = active && run.next_due <= todayIso();
  const url = whatsappUrl(company.telefono, message);
  const action = async (type) => {
    setBusy(true);
    try {
      await api(`/whatsapp/runs/${run.id}/action`, { method: 'POST', body: { action: type, version: run.version, message, next_due: when } });
      await reload(); toast(type === 'sent' ? 'Envío registrado y seguimiento actualizado' : 'Seguimiento actualizado');
    } catch (e) {
      toast(e.message, 'error');
      await reload().catch(() => {});
    } finally { setBusy(false); }
  };
  return <div className="wa-contact">
    <div className="wa-run-head"><h3>{run.flow_name}</h3><span className="tag">{RUN_LABELS[run.status]}</span></div>
    <StepList steps={run.steps} index={run.step_index} />
    <p><strong>Paso {run.step_index + 1} de {run.steps.length}: {run.steps[run.step_index].title}</strong>
      {run.next_due && <span className={due ? ' text-alert' : ' muted'}> · Seguimiento: {fmtDate(parseLocal(run.next_due))}</span>}</p>
    <label className="field"><span className="field-label">Mensaje personalizado</span>
      <textarea rows={6} maxLength={4000} value={message} disabled={busy || !active} onChange={(e) => { setMessage(e.target.value); setOpened(false); }} />
    </label>
    <p className="muted small">Abrir WhatsApp no registra un envío. El CRM no recibe confirmaciones ni respuestas de WhatsApp; regístralas con los botones de abajo.</p>
    <div className="wa-actions">
      {due && url && message.trim() && !busy && <a className="btn btn-wa" href={url} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}>Abrir mensaje en WhatsApp</a>}
      <button className="btn btn-primary" disabled={busy || !due || !opened || !message.trim()} onClick={() => action('sent')}>Ya lo envié · Registrar</button>
    </div>
    {active && !due && <p className="muted">El siguiente mensaje estará disponible en la fecha indicada. Puedes reprogramarlo.</p>}
    <div className="wa-actions">
      <label className="field"><span className="field-label">{active ? 'Reprogramar seguimiento' : 'Fecha para reanudar'}</span><input type="date" value={when} disabled={busy} onChange={(e) => setWhen(e.target.value)} /></label>
      <button className="btn btn-ghost" disabled={busy || !when} onClick={() => action(active ? 'reschedule' : 'resume')}>{active ? 'Reprogramar' : 'Reanudar'}</button>
    </div>
    <div className="wa-actions">
      <button className="btn btn-ghost" disabled={busy} onClick={() => action('responded')}>Respondió · Finalizar flujo</button>
      {active && <button className="btn btn-ghost" disabled={busy} onClick={() => action('pause')}>Pausar</button>}
      <button className="btn btn-ghost" disabled={busy} onClick={() => action('stop')}>Detener flujo</button>
      <button className="btn btn-ghost danger" disabled={busy} onClick={() => setBlocking(true)}>No contactar</button>
    </div>
    {blocking && <div className="alert">Se detendrán todos los flujos de esta empresa y se bloquearán nuevos seguimientos por WhatsApp.
      <div className="wa-actions"><button className="btn btn-danger" disabled={busy} onClick={() => action('do_not_contact')}>Marcar como no contactar</button><button className="btn btn-ghost" disabled={busy} onClick={() => setBlocking(false)}>Cancelar</button></div>
    </div>}
  </div>;
}
