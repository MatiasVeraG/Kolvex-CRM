import { useState } from 'react';
import { api, parseUtc, fmtDate } from '../api.js';
import { useApp, useToast, Modal, Field } from '../components/ui.jsx';
import { initials } from '../App.jsx';

export default function Team() {
  const { team, user, reloadMeta } = useApp();
  const toast = useToast();
  const [modal, setModal] = useState(null); // { mode: 'new' } | { mode: 'edit', member }
  const isAdmin = user.role === 'admin';

  const toggleActive = async (m) => {
    try {
      await api(`/users/${m.id}`, { method: 'PATCH', body: { active: !m.active } });
      toast(m.active ? `${m.name} desactivado` : `${m.name} activado`);
      reloadMeta();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>Equipo</h1>
          <p className="muted">{isAdmin ? 'Crea un usuario para cada compañero. Desactivar a alguien le quita el acceso sin borrar su historial.' : 'Las personas que trabajan en el CRM.'}</p>
        </div>
        {isAdmin && <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'new' })}>+ Agregar compañero</button>}
      </div>
      <ul className="team">
        {team.map((m) => (
          <li key={m.id} className={m.active ? '' : 'inactive'}>
            <span className="avatar avatar-lg">{initials(m.name)}</span>
            <div className="team-info">
              <strong>{m.name}{m.id === user.id && ' (tú)'}</strong>
              <span className="muted small">{m.email} · {m.role === 'admin' ? 'Administrador' : 'Miembro'} · desde {fmtDate(parseUtc(m.created_at))}{!m.active && ' · Desactivado'}</span>
            </div>
            {isAdmin && (
              <div className="team-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ mode: 'edit', member: m })}>Editar</button>
                {m.id !== user.id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleActive(m)}>{m.active ? 'Desactivar' : 'Activar'}</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {modal && <MemberModal {...modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); reloadMeta(); }} />}
    </div>
  );
}

function MemberModal({ mode, member, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: member?.name || '', email: member?.email || '', role: member?.role || 'member', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'new') {
        await api('/users', { method: 'POST', body: form });
        toast(`${form.name} agregado. Pásale su email y contraseña.`);
      } else {
        const body = { name: form.name, role: form.role };
        if (form.password) body.password = form.password;
        await api(`/users/${member.id}`, { method: 'PATCH', body });
        toast('Usuario actualizado');
      }
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={mode === 'new' ? 'Agregar compañero' : `Editar a ${member.name}`} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" form="member-form" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </>}>
      <form id="member-form" onSubmit={submit} className="stack">
        <Field label="Nombre"><input id="m-name" required value={form.name} onChange={set('name')} /></Field>
        <Field label="Email"><input id="m-email" type="email" required disabled={mode !== 'new'} value={form.email} onChange={set('email')} /></Field>
        <Field label="Rol" hint="Los administradores pueden gestionar el equipo y eliminar registros.">
          <select id="m-role" value={form.role} onChange={set('role')}>
            <option value="member">Miembro</option>
            <option value="admin">Administrador</option>
          </select>
        </Field>
        <Field label={mode === 'new' ? 'Contraseña inicial' : 'Nueva contraseña (opcional)'} hint="Mínimo 8 caracteres. La persona puede cambiarla después en Mi cuenta.">
          <input id="m-password" type="text" autoComplete="new-password" required={mode === 'new'} minLength={8} value={form.password} onChange={set('password')} />
        </Field>
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}
