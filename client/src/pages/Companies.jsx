import { useEffect, useState } from 'react';
import { api, isOverdue, parseLocal, parseUtc, fmtDate, relative } from '../api.js';
import { useApp, useFetch, useDebounced, navigate, PriorityBadge, StageBadge, Spinner, EmptyState } from '../components/ui.jsx';
import NewCompanyModal from './NewCompanyModal.jsx';

const LIMIT = 50;

export default function Companies() {
  const { meta, activeTeam, user } = useApp();
  const [f, setF] = useState({ q: '', rubro: '', ciudad: '', stage: '', owner: '', priority: '' });
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(f.q);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { setOffset(0); }, [dq, f.rubro, f.ciudad, f.stage, f.owner, f.priority]);
  const res = useFetch(() => api('/companies', { query: { ...f, q: dq, limit: LIMIT, offset } }),
    [dq, f.rubro, f.ciudad, f.stage, f.owner, f.priority, offset]);

  const total = res.data?.total ?? 0;
  const rows = res.data?.rows ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Empresas</h1>
          <p className="muted">{res.data ? `${total} ${total === 1 ? 'empresa' : 'empresas'}` : ' '}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>+ Nueva empresa</button>
      </div>

      <div className="filters">
        <input id="co-q" type="search" placeholder="Buscar por nombre, teléfono, contacto o dirección…" value={f.q} onChange={set('q')} aria-label="Buscar" />
        <select id="co-rubro" value={f.rubro} onChange={set('rubro')} aria-label="Rubro">
          <option value="">Todos los rubros</option>
          {meta.rubros.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select id="co-ciudad" value={f.ciudad} onChange={set('ciudad')} aria-label="Ciudad">
          <option value="">Todas las ciudades</option>
          {meta.ciudades.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select id="co-stage" value={f.stage} onChange={set('stage')} aria-label="Estado">
          <option value="">Todos los estados</option>
          {meta.stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select id="co-owner" value={f.owner} onChange={set('owner')} aria-label="Responsable">
          <option value="">Todo el equipo</option>
          <option value={String(user.id)}>Mías</option>
          <option value="none">Sin responsable</option>
          {activeTeam.filter((t) => t.id !== user.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select id="co-prio" value={f.priority} onChange={set('priority')} aria-label="Prioridad">
          <option value="">Toda prioridad</option>
          {meta.priorities.map((p) => <option key={p} value={p}>Prioridad {p}</option>)}
        </select>
      </div>

      {res.error && <div className="alert">{res.error}</div>}
      {res.loading && !res.data ? <Spinner /> : rows.length === 0 ? (
        <EmptyState title="No hay empresas con esos filtros">Prueba quitar algún filtro o agrega una empresa nueva.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="col-prio" aria-label="Prioridad">Pr.</th>
                <th>Empresa</th>
                <th className="hide-md">Rubro</th>
                <th className="hide-md">Ciudad</th>
                <th>Estado</th>
                <th className="hide-sm">Responsable</th>
                <th className="hide-sm">Seguimiento</th>
                <th className="hide-md">Último comentario</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/empresas/${r.id}`)} className="row-link">
                  <td className="col-prio"><PriorityBadge p={r.priority} /></td>
                  <td>
                    <a href={`#/empresas/${r.id}`} className="strong" onClick={(e) => e.stopPropagation()}>{r.name}</a>
                    <div className="muted small">{r.telefono || 'Sin teléfono'}</div>
                  </td>
                  <td className="hide-md">{r.rubro || '—'}</td>
                  <td className="hide-md">{r.ciudad || '—'}</td>
                  <td>{r.stage ? <StageBadge stage={r.stage} /> : '—'}</td>
                  <td className="hide-sm">{r.owner_name || <span className="muted">—</span>}</td>
                  <td className={`hide-sm num${isOverdue(r.next_followup, r.stage) ? ' text-alert' : ''}`}>{r.next_followup ? fmtDate(parseLocal(r.next_followup)) : '—'}</td>
                  <td className="hide-md muted">{r.last_comment_at ? relative(parseUtc(r.last_comment_at)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > LIMIT && (
        <div className="pager">
          <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>← Anterior</button>
          <span className="muted small">{offset + 1}–{Math.min(offset + LIMIT, total)} de {total}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>Siguiente →</button>
        </div>
      )}
      {creating && <NewCompanyModal onClose={() => setCreating(false)} onCreated={(c) => navigate(`/empresas/${c.id}`)} />}
    </div>
  );
}
