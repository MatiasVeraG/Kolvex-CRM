import { useEffect, useState } from 'react';
import { api, money, number, fmtDateTime, fmtDate, parseUtc, parseLocal, relative, whatsappUrl, isOverdue, COMMENT_LABELS } from '../api.js';
import { useApp, useFetch, useToast, navigate, Spinner, EmptyState, ConfirmButton, PriorityBadge, StageBadge } from '../components/ui.jsx';
import CompanyFields from '../components/CompanyFields.jsx';

export default function CompanyDetail({ id }) {
  const { user } = useApp();
  const toast = useToast();
  const res = useFetch(() => api(`/companies/${id}`), [id]);
  const [editing, setEditing] = useState(false);

  if (res.loading && !res.data) return <div className="page"><Spinner /></div>;
  if (res.error && !res.data) return <div className="page"><a href="#/empresas" className="back">← Empresas</a><div className="alert">{res.error}</div></div>;
  const c = res.data;
  const wa = whatsappUrl(c.telefono);

  const addDeal = async () => {
    try {
      await api(`/companies/${id}/deals`, { method: 'POST', body: { title: 'Nueva negociación' } });
      res.reload(true);
    } catch (e) { toast(e.message, 'error'); }
  };
  const removeCompany = async () => {
    try {
      await api(`/companies/${id}`, { method: 'DELETE' });
      toast(`${c.name} eliminada`);
      navigate('/empresas');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="page page-detail">
      <a href="#/empresas" className="back" onClick={(e) => { if (window.history.length > 1) { e.preventDefault(); window.history.back(); } }}>← Volver</a>
      <div className="detail-head">
        <div className="detail-title">
          <h1>{c.name}</h1>
          <p className="muted">{[c.rubro, c.ciudad, c.presencia && `Presencia: ${c.presencia}`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="quick-actions">
          {c.telefono && <span className="phone" title="Teléfono">{c.telefono}</span>}
          {wa && <a className="btn btn-wa btn-sm" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
          {c.maps_url && <a className="btn btn-ghost btn-sm" href={c.maps_url} target="_blank" rel="noreferrer">Google Maps</a>}
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <header className="panel-head">
              <h2>{c.deals.length > 1 ? 'Negociaciones' : 'Negociación'}</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addDeal}>+ Otra negociación</button>
            </header>
            {c.deals.length === 0 && <EmptyState title="Sin negociaciones">Agrega una para seguir el estado de la venta.</EmptyState>}
            {c.deals.map((d) => <DealEditor key={`${d.id}-${d.updated_at}`} deal={d} onSaved={() => res.reload(true)} />)}
          </section>

          <Timeline company={c} onChange={() => res.reload(true)} />
        </div>

        <aside className="detail-side">
          <section className="panel">
            <header className="panel-head">
              <h2>Datos de la empresa</h2>
              {!editing && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Editar</button>}
            </header>
            {editing
              ? <CompanyEditor company={c} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); res.reload(true); }} />
              : <CompanyView c={c} />}
          </section>
          {user.role === 'admin' && !editing && (
            <div className="danger-zone">
              <ConfirmButton confirmText="Se borran también sus negociaciones y comentarios." onConfirm={removeCompany}>Eliminar empresa</ConfirmButton>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function CompanyView({ c }) {
  const rows = [
    ['Persona de contacto', [c.contacto_nombre, c.contacto_cargo].filter(Boolean).join(' · ')],
    ['Teléfono', c.telefono],
    ['Email', c.email],
    ['Dirección', c.direccion],
    ['Web o red social', c.web],
    ['Google', c.rating ? `${c.rating.toFixed(1)} ★ · ${number(c.reviews)} reseñas` : null],
    ['Agregada', fmtDate(parseUtc(c.created_at))],
  ];
  return (
    <>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v || <span className="muted">—</span>}</dd></div>
        ))}
      </dl>
      {c.notas && <div className="notes"><h3>Notas</h3><p>{c.notas}</p></div>}
    </>
  );
}

function CompanyEditor({ company, onCancel, onSaved }) {
  const toast = useToast();
  const { reloadMeta } = useApp();
  const [form, setForm] = useState(() => Object.fromEntries(Object.entries(company).map(([k, v]) => [k, v ?? ''])));
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { deals: _d, comments: _c, id: _i, created_at: _ca, updated_at: _ua, external_id: _e, ...body } = form;
      await api(`/companies/${company.id}`, { method: 'PATCH', body });
      toast('Datos guardados');
      reloadMeta();
      onSaved();
    } catch (err) { toast(err.message, 'error'); setBusy(false); }
  };
  return (
    <form onSubmit={save} className="company-editor">
      <CompanyFields value={form} onChange={setForm} idPrefix="edit" />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

function DealEditor({ deal, onSaved }) {
  const { meta, activeTeam, team, user } = useApp();
  const toast = useToast();
  const initial = {
    title: deal.title, priority: deal.priority || '', value: deal.value ?? '', owner_id: deal.owner_id ?? '',
    next_followup: deal.next_followup || '', lost_reason: deal.lost_reason || '',
  };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const patch = async (body, msg) => {
    setBusy(true);
    try {
      await api(`/deals/${deal.id}`, { method: 'PATCH', body });
      toast(msg);
      onSaved();
    } catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  const save = (e) => {
    e.preventDefault();
    patch({ ...form, owner_id: form.owner_id === '' ? null : Number(form.owner_id), value: form.value === '' ? null : form.value }, 'Negociación guardada');
  };
  const remove = async () => {
    try { await api(`/deals/${deal.id}`, { method: 'DELETE' }); toast('Negociación eliminada'); onSaved(); } catch (e) { toast(e.message, 'error'); }
  };
  // El responsable puede estar desactivado: igual se muestra
  const owners = deal.owner_id && !activeTeam.some((t) => t.id === deal.owner_id) ? [...activeTeam, team.find((t) => t.id === deal.owner_id)].filter(Boolean) : activeTeam;
  const overdue = isOverdue(deal.next_followup, deal.stage);

  return (
    <form className="deal" onSubmit={save}>
      <div className="deal-top">
        <input className="deal-title" id={`deal-title-${deal.id}`} value={form.title} onChange={set('title')} aria-label="Título de la negociación" maxLength={200} />
        <PriorityBadge p={deal.priority} />
        <StageBadge stage={deal.stage} />
      </div>
      <div className="stages" role="group" aria-label="Estado">
        {meta.stages.map((s, i) => {
          const idx = meta.stages.findIndex((x) => x.id === deal.stage);
          const state = s.id === deal.stage ? 'current' : (i < idx && deal.stage !== 'perdido' && s.id !== 'perdido' ? 'done' : '');
          return (
            <button key={s.id} type="button" disabled={busy} className={`stage-step step-${s.id} ${state}`}
              aria-pressed={s.id === deal.stage}
              onClick={() => s.id !== deal.stage && patch({ stage: s.id }, `Estado: ${s.label}`)}>
              {s.label}
            </button>
          );
        })}
      </div>
      <div className="grid-form grid-deal">
        <label className="field">
          <span className="field-label">Responsable</span>
          <select id={`deal-owner-${deal.id}`} value={form.owner_id} onChange={set('owner_id')}>
            <option value="">Sin responsable</option>
            {owners.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === user.id ? ' (yo)' : ''}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Prioridad</span>
          <select id={`deal-prio-${deal.id}`} value={form.priority} onChange={set('priority')}>
            <option value="">—</option>
            {meta.priorities.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Monto (₲)</span>
          <input id={`deal-value-${deal.id}`} inputMode="numeric" value={form.value === '' ? '' : number(Number(String(form.value).replace(/\D/g, '')))}
            onChange={(e) => setForm({ ...form, value: e.target.value.replace(/\D/g, '') })} placeholder="0" />
        </label>
        <label className="field">
          <span className="field-label">Próximo seguimiento</span>
          <input id={`deal-follow-${deal.id}`} type="date" value={form.next_followup} onChange={set('next_followup')} className={overdue ? 'is-overdue' : ''} />
        </label>
        {deal.stage === 'perdido' && (
          <label className="field field-full">
            <span className="field-label">Motivo de pérdida</span>
            <input id={`deal-lost-${deal.id}`} value={form.lost_reason} onChange={set('lost_reason')} placeholder="Precio, ya tiene proveedor, no responde…" />
          </label>
        )}
      </div>
      <div className="deal-foot">
        <span className="muted small">
          {overdue && <strong className="text-alert">Seguimiento vencido · </strong>}
          {deal.value ? `${money(deal.value)} · ` : ''}Actualizada {relative(parseUtc(deal.updated_at))}
          {deal.closed_at && ` · Cerrada el ${fmtDate(parseUtc(deal.closed_at))}`}
        </span>
        <span className="deal-actions">
          {user.role === 'admin' && <ConfirmButton onConfirm={remove}>Eliminar</ConfirmButton>}
          {dirty && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(initial)}>Descartar</button>}
          <button className="btn btn-primary btn-sm" disabled={!dirty || busy}>Guardar</button>
        </span>
      </div>
    </form>
  );
}

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

function Timeline({ company, onChange }) {
  const { user } = useApp();
  const toast = useToast();
  const [type, setType] = useState('reunion');
  const [when, setWhen] = useState(nowLocal);
  const [body, setBody] = useState('');
  const [dealId, setDealId] = useState(company.deals[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [showSystem, setShowSystem] = useState(true);

  useEffect(() => { if (!company.deals.some((d) => d.id === dealId)) setDealId(company.deals[0]?.id ?? ''); }, [company.deals, dealId]);

  const add = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api(`/companies/${company.id}/comments`, {
        method: 'POST',
        body: { type, body, meeting_date: type === 'nota' ? null : when, deal_id: dealId || null },
      });
      setBody('');
      setWhen(nowLocal());
      toast(type === 'reunion' ? 'Reunión registrada' : 'Comentario agregado');
      onChange();
    } catch (err) { toast(err.message, 'error'); }
    setBusy(false);
  };

  const list = company.comments.filter((c) => showSystem || !c.system);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Comentarios y reuniones</h2>
        <label className="check small">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} /> Mostrar cambios de estado
        </label>
      </header>
      <form className="composer" onSubmit={add}>
        <div className="seg" role="radiogroup" aria-label="Tipo">
          {Object.entries(COMMENT_LABELS).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={type === k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{label}</button>
          ))}
        </div>
        <textarea id="comment-body" rows={type === 'reunion' ? 4 : 3} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder={type === 'reunion' ? 'Quiénes participaron, qué se habló, qué necesitan, próximos pasos…' : 'Escribe un comentario…'} />
        <div className="composer-foot">
          {type !== 'nota' && (
            <label className="inline-field">
              <span>{type === 'reunion' ? 'Fecha de la reunión' : 'Fecha'}</span>
              <input id="comment-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
          )}
          {company.deals.length > 1 && (
            <label className="inline-field">
              <span>Negociación</span>
              <select id="comment-deal" value={dealId} onChange={(e) => setDealId(Number(e.target.value))}>
                {company.deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>
          )}
          <button className="btn btn-primary" disabled={busy || !body.trim()}>{busy ? 'Guardando…' : 'Agregar'}</button>
        </div>
      </form>

      {list.length === 0
        ? <EmptyState title="Todavía no hay comentarios">Registra aquí cada reunión, llamada o mensaje con la empresa.</EmptyState>
        : <ol className="timeline">{list.map((c) => <CommentItem key={c.id} c={c} canEdit={!c.system && (c.user_id === user.id || user.role === 'admin')} onChange={onChange} />)}</ol>}
    </section>
  );
}

function CommentItem({ c, canEdit, onChange }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body);
  const [when, setWhen] = useState(c.meeting_date || '');
  const save = async () => {
    try {
      await api(`/comments/${c.id}`, { method: 'PATCH', body: { body, meeting_date: c.type === 'nota' ? null : (when || null) } });
      setEditing(false);
      onChange();
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async () => {
    try { await api(`/comments/${c.id}`, { method: 'DELETE' }); onChange(); } catch (e) { toast(e.message, 'error'); }
  };

  if (c.system) {
    return (
      <li className="tl-item tl-system">
        <span className="tl-dot" />
        <p>{c.body} <span className="muted small">{relative(parseUtc(c.created_at))}</span></p>
      </li>
    );
  }
  const meeting = c.meeting_date ? parseLocal(c.meeting_date) : null;
  return (
    <li className={`tl-item tl-${c.type}`}>
      <span className="tl-dot" />
      <div className="tl-card">
        <header className="tl-head">
          <span className={`type type-${c.type}`}>{COMMENT_LABELS[c.type] || c.type}</span>
          {meeting && <strong className="tl-when">{fmtDateTime(meeting)}</strong>}
          <span className="muted small">{c.user_name || 'Usuario eliminado'} · {relative(parseUtc(c.created_at))}{c.updated_at ? ' · editado' : ''}</span>
        </header>
        {editing ? (
          <div className="tl-edit">
            <textarea id={`edit-comment-${c.id}`} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
            {c.type !== 'nota' && <input id={`edit-when-${c.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setBody(c.body); setWhen(c.meeting_date || ''); }}>Cancelar</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!body.trim()}>Guardar</button>
            </div>
          </div>
        ) : <p className="tl-body">{c.body}</p>}
        {canEdit && !editing && (
          <footer className="tl-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Editar</button>
            <ConfirmButton onConfirm={remove}>Borrar</ConfirmButton>
          </footer>
        )}
      </div>
    </li>
  );
}
