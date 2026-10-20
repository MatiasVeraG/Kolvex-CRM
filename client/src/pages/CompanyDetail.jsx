import { useEffect, useState } from 'react';
import { api, money, number, fmtDateTime, fmtDate, parseUtc, parseLocal, relative, whatsappUrl, telUrl, webUrl, webLabel, mapsSearchUrl, directionsUrl, googleSearchUrl, instagramSearchUrl, isOverdue, COMMENT_LABELS } from '../api.js';
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
      </div>
      <ContactBar c={c} onEdit={() => setEditing(true)} />

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

// Íconos simples en línea (sin librerías)
const ICONS = {
  whatsapp: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z',
  phone: 'M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z',
  mail: 'M20 4H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z',
  route: 'M21.7 11.3 12.7 2.3a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4ZM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5Z',
  web: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-3a15.6 15.6 0 0 0-1.3-3.6A8 8 0 0 1 18.9 8ZM12 4a14 14 0 0 1 1.9 4h-3.8A14 14 0 0 1 12 4ZM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3Zm.8 2h3a15.6 15.6 0 0 0 1.3 3.6A8 8 0 0 1 5.1 16Zm3-8h-3a8 8 0 0 1 4.3-3.6A15.6 15.6 0 0 0 8.1 8ZM12 20a14 14 0 0 1-1.9-4h3.8A14 14 0 0 1 12 20Zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4Zm.3 5.6a15.6 15.6 0 0 0 1.3-3.6h3a8 8 0 0 1-4.3 3.6Zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4Z',
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5Zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z',
};
const Icon = ({ name }) => <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} fill="currentColor" /></svg>;

function ContactBar({ c, onEdit }) {
  const toast = useToast();
  const wa = whatsappUrl(c.telefono);
  const tel = telUrl(c.telefono);
  const web = webUrl(c.web);
  const copy = async () => {
    try { await navigator.clipboard.writeText(c.telefono); toast('Número copiado'); } catch { toast('No se pudo copiar. Selecciona el número a mano.', 'error'); }
  };
  const ext = { target: '_blank', rel: 'noreferrer' };
  return (
    <div className="contact-bar">
      <div className="contact-phone">
        {c.telefono ? (
          <>
            <span className="phone">{c.telefono}</span>
            <button type="button" className="icon-btn icon-btn-sm" onClick={copy} title="Copiar número" aria-label="Copiar número"><Icon name="copy" /></button>
          </>
        ) : (
          <button type="button" className="link-btn" onClick={onEdit}>+ Agregar teléfono</button>
        )}
      </div>
      <div className="contact-actions">
        {wa && <a className="btn btn-wa btn-sm" href={wa} {...ext}><Icon name="whatsapp" />WhatsApp</a>}
        {tel && <a className="btn btn-ghost btn-sm" href={tel}><Icon name="phone" />Llamar</a>}
        {c.email && <a className="btn btn-ghost btn-sm" href={`mailto:${c.email}`}><Icon name="mail" />Email</a>}
        <a className="btn btn-ghost btn-sm" href={mapsSearchUrl(c)} {...ext}><Icon name="pin" />Google Maps</a>
        <a className="btn btn-ghost btn-sm" href={directionsUrl(c)} {...ext}><Icon name="route" />Cómo llegar</a>
        {web && <a className="btn btn-ghost btn-sm" href={web} {...ext}><Icon name="web" />{webLabel(c.web)}</a>}
        <a className="btn btn-ghost btn-sm" href={googleSearchUrl(c)} {...ext}><Icon name="search" />Buscar en Google</a>
        {!web && <a className="btn btn-ghost btn-sm" href={instagramSearchUrl(c)} {...ext}><Icon name="search" />Buscar Instagram</a>}
      </div>
      {c.telefono && !wa && <p className="muted small contact-note">Este número parece de línea fija, por eso no aparece el botón de WhatsApp.</p>}
    </div>
  );
}

function CompanyView({ c }) {
  const ext = { target: '_blank', rel: 'noreferrer' };
  const tel = telUrl(c.telefono);
  const web = webUrl(c.web);
  const rows = [
    ['Persona de contacto', [c.contacto_nombre, c.contacto_cargo].filter(Boolean).join(' · ')],
    ['Teléfono', c.telefono && (tel ? <a href={tel}>{c.telefono}</a> : c.telefono)],
    ['Email', c.email && <a href={`mailto:${c.email}`}>{c.email}</a>],
    ['Dirección', c.direccion && <a href={mapsSearchUrl(c)} {...ext}>{c.direccion}</a>],
    ['Web o red social', web && <a href={web} {...ext}>{c.web}</a>],
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
