import { useState } from 'react';
import { api, todayIso, fmtDate, parseLocal } from '../api.js';
import { FLOW_VARIABLES, RUN_LABELS } from '../../../shared/whatsapp.js';
import { useApp, useFetch, useToast, Spinner, Modal, EmptyState } from '../components/ui.jsx';
import WhatsAppAutomation from '../components/WhatsAppAutomation.jsx';

const newStep = () => ({ title: '', message: '', delay_days: 0 });
export default function WhatsAppFlows() {
  const { user } = useApp();
  const flows = useFetch(() => api('/whatsapp/flows'), []);
  const runs = useFetch(() => api('/whatsapp/runs'), [], { interval: 30000 });
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('due');
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState('');
  const due = (r) => r.status === 'active' && r.next_due <= todayIso();
  const visible = (runs.data || []).filter((r) => (!mine || r.owner_id === user.id) &&
    (filter === 'all' || (filter === 'due' ? due(r) : r.status === filter)) &&
    `${r.company_name} ${r.flow_name}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page">
    <div className="page-head"><div><h1>Flujos de WhatsApp</h1><p className="muted">Organiza tus mensajes y el seguimiento de cada prospecto.</p></div>
      <button className="btn btn-primary" onClick={() => setEditing({ name: '', description: '', active: 1, steps: [newStep()] })}>+ Crear flujo</button>
    </div>
    <WhatsAppAutomation flows={flows.data || []} />
    <section className="panel">
      <header className="panel-head"><h2>Plantillas de mensajes</h2></header>
      <p className="muted wa-intro">Define los textos y cuántos días esperar entre mensajes. Para iniciar un flujo, abre una empresa y pulsa «Contactar».</p>
      {flows.error && <div className="alert">{flows.error}<button className="btn btn-ghost btn-sm" onClick={() => flows.reload()}>Reintentar</button></div>}
      {flows.loading && !flows.data ? <Spinner /> : <div className="wa-flow-grid">{(flows.data || []).map((f) => <article key={f.id} className="wa-flow-card">
        <div className="wa-run-head"><h3>{f.name}</h3><span className="tag">{f.active ? 'Disponible' : 'Archivado'}</span></div>
        <p className="muted">{f.description || 'Sin descripción'}</p>
        <div className="wa-run-head"><span className="muted small">{f.steps.length} pasos · {f.steps.reduce((sum, s) => sum + s.delay_days, 0)} días previstos</span><button className="btn btn-ghost btn-sm" onClick={() => setEditing(f)}>Editar flujo</button></div>
      </article>)}</div>}
    </section>
    <section className="panel">
      <header className="panel-head"><h2>Seguimientos <span className="muted">· {(runs.data || []).filter(due).length} pendientes para hoy o vencidos</span></h2></header>
      <div className="filters wa-filters">
        <input type="search" placeholder="Buscar empresa o flujo…" aria-label="Buscar seguimiento" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Estado del flujo" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="due">Para hoy y vencidos</option><option value="all">Todos los estados</option>{Object.entries(RUN_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Solo mis negociaciones</label>
      </div>
      {runs.error && <div className="alert">{runs.error}<button className="btn btn-ghost btn-sm" onClick={() => runs.reload()}>Reintentar</button></div>}
      {runs.loading && !runs.data ? <Spinner /> : !visible.length ? <EmptyState title="Sin seguimientos con estos filtros">Los flujos iniciados desde «Contactar» aparecerán aquí.</EmptyState> : <div className="table-wrap"><table className="table">
        <thead><tr><th>Empresa / flujo</th><th>Avance</th><th>Estado</th><th>Próximo seguimiento</th><th>Responsable</th><th>Acción</th></tr></thead>
        <tbody>{visible.map((r) => <tr key={r.id}>
          <td><a className="strong" href={`#/empresas/${r.company_id}`}>{r.company_name}</a><div className="muted small">{r.flow_name}</div></td>
          <td>{r.step_index}/{r.steps.length} enviados<div className="muted small">{r.steps[r.step_index]?.title || 'Sin más pasos'}</div></td>
          <td>{RUN_LABELS[r.status]}</td><td className={due(r) ? 'text-alert' : ''}>{fmtDate(parseLocal(r.next_due))}</td><td>{r.owner_name || 'Sin responsable'}</td>
          <td><a className="btn btn-ghost btn-sm" href={`#/empresas/${r.company_id}${['active', 'paused'].includes(r.status) ? `/contactar/${r.deal_id}` : ''}`}>{['active', 'paused'].includes(r.status) ? 'Continuar' : 'Ver ficha'}</a></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    {editing && <FlowEditor flow={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); flows.reload(true); }} />}
  </div>;
}

function FlowEditor({ flow, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => structuredClone(flow));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setStep = (i, key, value) => setForm((f) => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, [key]: value } : s) }));
  const move = (i, offset) => setForm((f) => {
    const steps = [...f.steps];
    [steps[i], steps[i + offset]] = [steps[i + offset], steps[i]];
    return { ...f, steps };
  });
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/whatsapp/flows${flow.id ? `/${flow.id}` : ''}`, { method: flow.id ? 'PATCH' : 'POST', body: form });
      toast('Flujo guardado'); onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return <Modal title={flow.id ? 'Editar flujo' : 'Crear flujo'} wide onClose={onClose}>
    <form onSubmit={save} className="wa-contact">
      <fieldset disabled={busy} className="wa-fieldset">
        <label className="field"><span className="field-label">Nombre</span><input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej.: Primer contacto · Páginas web" /></label>
        <label className="field"><span className="field-label">Descripción / objetivo</span><textarea rows={2} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked ? 1 : 0 })} />Disponible para iniciar nuevos seguimientos</label>
        <p className="muted small">Archivar o editar una plantilla no modifica los flujos ya iniciados. Variables disponibles: {FLOW_VARIABLES.map((v) => `{{${v}}}`).join(', ')}.</p>
        {form.steps.map((s, i) => <section className="wa-step-editor" key={i}>
          <div className="wa-run-head"><h3>Paso {i + 1}</h3><div className="wa-actions">
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Subir paso ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Bajar paso ${i + 1}`} disabled={i === form.steps.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="btn btn-ghost btn-sm danger" disabled={form.steps.length === 1} onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => i !== j) })}>Quitar</button>
          </div></div>
          <label className="field"><span className="field-label">Título del paso</span><input required maxLength={120} value={s.title} onChange={(e) => setStep(i, 'title', e.target.value)} /></label>
          <label className="field"><span className="field-label">{i === 0 ? 'Días desde que inicia el flujo (0 = hoy)' : 'Días de espera desde el envío anterior'}</span><input required type="number" min="0" max="365" step="1" value={s.delay_days} onChange={(e) => setStep(i, 'delay_days', e.target.value)} /></label>
          <label className="field"><span className="field-label">Mensaje</span><textarea required rows={5} maxLength={4000} value={s.message} onChange={(e) => setStep(i, 'message', e.target.value)} placeholder="Hola, {{contacto}}. Soy {{vendedor}}, de Kolvex…" /></label>
        </section>)}
        <button type="button" className="btn btn-ghost" disabled={form.steps.length >= 20} onClick={() => setForm({ ...form, steps: [...form.steps, newStep()] })}>+ Agregar paso</button>
      </fieldset>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="form-actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar flujo'}</button></div>
    </form>
  </Modal>;
}
