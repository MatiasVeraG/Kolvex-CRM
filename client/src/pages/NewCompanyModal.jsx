import { useState } from 'react';
import { api } from '../api.js';
import { Modal, useApp, useToast } from '../components/ui.jsx';
import CompanyFields, { emptyCompany } from '../components/CompanyFields.jsx';

export default function NewCompanyModal({ onClose, onCreated }) {
  const { user, activeTeam, meta, reloadMeta } = useApp();
  const toast = useToast();
  const [form, setForm] = useState(emptyCompany);
  const [deal, setDeal] = useState({ owner_id: user.id, priority: '', stage: 'prospecto' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const c = await api('/companies', { method: 'POST', body: { ...form, deal } });
      toast(`${c.name} agregada`);
      reloadMeta();
      onClose();
      onCreated?.(c);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Nueva empresa" onClose={onClose} wide
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" form="new-company" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Crear empresa'}</button>
      </>}>
      <form id="new-company" onSubmit={submit}>
        <CompanyFields value={form} onChange={setForm} />
        <h3 className="form-section">Negociación inicial</h3>
        <div className="grid-form">
          <label className="field">
            <span className="field-label">Estado</span>
            <select id="nc-stage" value={deal.stage} onChange={(e) => setDeal({ ...deal, stage: e.target.value })}>
              {meta.stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Responsable</span>
            <select id="nc-owner" value={deal.owner_id ?? ''} onChange={(e) => setDeal({ ...deal, owner_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Sin responsable</option>
              {activeTeam.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Prioridad</span>
            <select id="nc-prio" value={deal.priority} onChange={(e) => setDeal({ ...deal, priority: e.target.value })}>
              <option value="">Sin prioridad</option>
              {meta.priorities.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
        </div>
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}
