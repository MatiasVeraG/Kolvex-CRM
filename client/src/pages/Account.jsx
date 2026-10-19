import { useState } from 'react';
import { api } from '../api.js';
import { useApp, useToast, Field } from '../components/ui.jsx';

export default function Account() {
  const { user } = useApp();
  const toast = useToast();
  const [form, setForm] = useState({ current: '', password: '', repeat: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.repeat) { setError('Las contraseñas nuevas no coinciden.'); return; }
    setBusy(true);
    try {
      await api('/me/password', { method: 'POST', body: { current: form.current, password: form.password } });
      toast('Contraseña cambiada');
      setForm({ current: '', password: '', repeat: '' });
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>Mi cuenta</h1>
          <p className="muted">{user.name} · {user.email} · {user.role === 'admin' ? 'Administrador' : 'Miembro'}</p>
        </div>
      </div>
      <form className="panel stack form-narrow" onSubmit={submit}>
        <h2>Cambiar contraseña</h2>
        <Field label="Contraseña actual"><input id="a-current" type="password" autoComplete="current-password" required value={form.current} onChange={set('current')} /></Field>
        <Field label="Contraseña nueva" hint="Mínimo 8 caracteres."><input id="a-new" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} /></Field>
        <Field label="Repetir contraseña nueva"><input id="a-repeat" type="password" autoComplete="new-password" required value={form.repeat} onChange={set('repeat')} /></Field>
        {error && <div className="alert">{error}</div>}
        <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Cambiar contraseña'}</button></div>
      </form>
    </div>
  );
}
