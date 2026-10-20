import { useMemo, useState } from 'react';
import { api, money, isOverdue, parseLocal, fmtDate } from '../api.js';
import { useApp, useFetch, useDebounced, useToast, navigate, PriorityBadge, Spinner } from '../components/ui.jsx';
import NewCompanyModal from './NewCompanyModal.jsx';

const PAGE = 40;

export default function Board() {
  const { meta, activeTeam, user, stageLabel } = useApp();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [rubro, setRubro] = useState('');
  const [priority, setPriority] = useState('');
  const [limits, setLimits] = useState({});
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q);

  const deals = useFetch(() => api('/deals', { query: { q: dq, owner, rubro, priority } }), [dq, owner, rubro, priority], { interval: 30000 });
  const stats = useFetch(() => api('/stats'), [deals.data], {});

  const byStage = useMemo(() => {
    const m = Object.fromEntries(meta.stages.map((s) => [s.id, []]));
    for (const d of deals.data || []) (m[d.stage] ||= []).push(d);
    return m;
  }, [deals.data, meta.stages]);

  const move = async (dealId, stage) => {
    const deal = deals.data.find((d) => d.id === dealId);
    if (!deal || deal.stage === stage) return;
    const prev = deal.stage;
    deals.setData((list) => list.map((d) => (d.id === dealId ? { ...d, stage } : d)));
    try {
      await api(`/deals/${dealId}`, { method: 'PATCH', body: { stage } });
      toast(`${deal.company_name}: ${stageLabel(stage)}`);
      stats.reload(true);
    } catch (e) {
      deals.setData((list) => list.map((d) => (d.id === dealId ? { ...d, stage: prev } : d)));
      toast(e.message, 'error');
    }
  };

  const s = stats.data;
  const open = s ? Object.entries(s.byStage).filter(([k]) => k !== 'ganado' && k !== 'perdido').reduce((a, [, n]) => a + n, 0) : null;

  return (
    <div className="page page-board">
      <div className="page-head">
        <div>
          <h1>Negociaciones</h1>
          <p className="muted">Arrastra una tarjeta para cambiar su estado, o ábrela para ver la empresa y sus comentarios.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>+ Nueva empresa</button>
      </div>

      {s && (
        <dl className="kpis">
          <div><dt>En curso</dt><dd>{open}</dd></div>
          <div><dt>Reuniones (7 días)</dt><dd>{s.meetingsLast7Days}</dd></div>
          <div className={s.overdueFollowups ? 'kpi-alert' : ''}><dt>Seguimientos vencidos</dt><dd>{s.overdueFollowups}</dd></div>
          <div><dt>Ganadas</dt><dd>{s.wonCount}</dd></div>
          <div><dt>Monto en curso</dt><dd className="kpi-money">{money(s.pipelineValue)}</dd></div>
        </dl>
      )}

      <div className="filters">
        <input id="board-q" type="search" placeholder="Buscar empresa…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar empresa" />
        <select id="board-owner" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Responsable">
          <option value="">Todo el equipo</option>
          <option value={String(user.id)}>Mis negociaciones</option>
          <option value="none">Sin responsable</option>
          {activeTeam.filter((t) => t.id !== user.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select id="board-rubro" value={rubro} onChange={(e) => setRubro(e.target.value)} aria-label="Rubro">
          <option value="">Todos los rubros</option>
          {meta.rubros.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select id="board-prio" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Prioridad">
          <option value="">Toda prioridad</option>
          {meta.priorities.map((p) => <option key={p} value={p}>Prioridad {p}</option>)}
        </select>
      </div>

      {deals.error && <div className="alert">{deals.error}</div>}
      {deals.loading && !deals.data ? <Spinner /> : (
        <div className="board" role="list">
          {meta.stages.map((st) => {
            const items = byStage[st.id] || [];
            const limit = limits[st.id] || PAGE;
            return (
              <section
                key={st.id}
                className={`column column-${st.id}${overStage === st.id ? ' is-over' : ''}`}
                role="listitem"
                aria-label={st.label}
                onDragOver={(e) => { e.preventDefault(); setOverStage(st.id); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverStage(null); }}
                onDrop={(e) => { e.preventDefault(); setOverStage(null); const id = Number(e.dataTransfer.getData('text/plain')); if (id) move(id, st.id); }}
              >
                <header className="column-head">
                  <span className={`dot stage-dot-${st.id}`} />
                  <h2>{st.label}</h2>
                  <span className="count">{items.length}</span>
                </header>
                <div className="column-body">
                  {items.slice(0, limit).map((d) => (
                    <DealCard key={d.id} deal={d} dragging={dragId === d.id}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(d.id)); e.dataTransfer.effectAllowed = 'move'; setDragId(d.id); }}
                      onDragEnd={() => { setDragId(null); setOverStage(null); }}
                      onMove={(stage) => move(d.id, stage)} />
                  ))}
                  {items.length > limit && (
                    <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={() => setLimits((l) => ({ ...l, [st.id]: limit + PAGE }))}>
                      Mostrar {Math.min(PAGE, items.length - limit)} más
                    </button>
                  )}
                  {!items.length && <p className="column-empty">Sin negociaciones</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {creating && <NewCompanyModal onClose={() => setCreating(false)} onCreated={(c) => navigate(`/empresas/${c.id}`)} />}
    </div>
  );
}

function DealCard({ deal: d, dragging, onDragStart, onDragEnd, onMove }) {
  const { meta } = useApp();
  const overdue = isOverdue(d.next_followup, d.stage);
  return (
    <article className={`card${dragging ? ' is-dragging' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <a className="card-link" href={`#/empresas/${d.company_id}`}>
        <div className="card-top">
          <PriorityBadge p={d.priority} />
          <h3>{d.company_name}</h3>
        </div>
        <p className="card-meta">{[d.rubro, d.ciudad].filter(Boolean).join(' · ')}</p>
        <div className="card-tags">
          {d.value ? <span className="tag">{money(d.value)}</span> : null}
          {d.next_followup && <span className={`tag${overdue ? ' tag-alert' : ''}`} title="Próximo seguimiento">↻ {fmtDate(parseLocal(d.next_followup))}</span>}
          {d.comment_count > 0 && <span className="tag" title="Comentarios">{d.comment_count} {d.comment_count === 1 ? 'comentario' : 'comentarios'}</span>}
        </div>
      </a>
      <footer className="card-foot">
        <a className="btn btn-wa btn-sm" href={`#/empresas/${d.company_id}/contactar/${d.id}`}>Contactar</a>
        <span className="owner">{d.owner_name || <em>Sin responsable</em>}</span>
        <select className="mini-select" value={d.stage} onChange={(e) => onMove(e.target.value)} aria-label={`Mover ${d.company_name}`}>
          {meta.stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </footer>
    </article>
  );
}
