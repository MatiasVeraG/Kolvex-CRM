import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, auth, setUnauthorizedHandler } from './api.js';
import { AppContext, useHashRoute, navigate, Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Board from './pages/Board.jsx';
import Companies from './pages/Companies.jsx';
import CompanyDetail from './pages/CompanyDetail.jsx';
import Team from './pages/Team.jsx';
import Account from './pages/Account.jsx';
import Logo from './components/Logo.jsx';
import WhatsAppFlows from './pages/WhatsAppFlows.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [meta, setMeta] = useState(null);
  const [team, setTeam] = useState([]);
  const [booting, setBooting] = useState(!!auth.token);
  const route = useHashRoute();

  const logout = useCallback(() => { auth.token = null; setUser(null); setMeta(null); }, []);
  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);

  const loadMeta = useCallback(async () => {
    const [m, u] = await Promise.all([api('/meta'), api('/users')]);
    setMeta(m);
    setTeam(u);
  }, []);

  useEffect(() => {
    if (!auth.token) return;
    (async () => {
      try {
        setUser(await api('/me'));
        await loadMeta();
      } catch { logout(); } finally { setBooting(false); }
    })();
  }, [loadMeta, logout]);

  const onLogin = async (token, u) => {
    auth.token = token;
    setUser(u);
    await loadMeta();
  };

  const ctx = useMemo(() => meta && ({
    user, meta, team, reloadMeta: loadMeta,
    activeTeam: team.filter((t) => t.active),
    stageLabel: (id) => meta.stages.find((s) => s.id === id)?.label || id,
  }), [user, meta, team, loadMeta]);

  if (booting) return <div className="center-page"><Spinner /></div>;
  if (!user) return <Login onLogin={onLogin} />;
  if (!ctx) return <div className="center-page"><Spinner /></div>;

  const [, section, id, action, contactDealId] = route.split('/');
  let page;
  if (section === 'empresas' && id) page = <CompanyDetail id={Number(id)} key={id} autoContact={action === 'contactar'} contactDealId={Number(contactDealId) || null} />;
  else if (section === 'empresas') page = <Companies />;
  else if (section === 'equipo') page = <Team />;
  else if (section === 'cuenta') page = <Account />;
  else if (section === 'flujos') page = <WhatsAppFlows />;
  else page = <Board />;

  const nav = [
    ['tablero', 'Negociaciones'],
    ['empresas', 'Empresas'],
    ['flujos', 'Flujos WhatsApp'],
    ['equipo', 'Equipo'],
  ];
  const current = section || 'tablero';

  return (
    <AppContext.Provider value={ctx}>
      <div className="shell">
        <header className="topbar">
          <div className="topbar-inner">
            <a className="brand" href="#/tablero">
              <Logo size={26} />
              <span>Kolvex <span className="brand-sub">CRM</span></span>
            </a>
            <nav className="mainnav" aria-label="Secciones">
              {nav.map(([k, label]) => (
                <a key={k} href={`#/${k}`} className={current === k ? 'active' : ''} aria-current={current === k ? 'page' : undefined}>{label}</a>
              ))}
            </nav>
            <div className="userbox">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/cuenta')} title="Mi cuenta">
                <span className="avatar">{initials(user.name)}</span>
                <span className="hide-sm">{user.name}</span>
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>Salir</button>
            </div>
          </div>
        </header>
        <main className="content">{page}</main>
      </div>
    </AppContext.Provider>
  );
}

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
