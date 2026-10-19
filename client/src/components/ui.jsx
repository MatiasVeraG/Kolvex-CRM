import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ---------- Contexto de la app (usuario, equipo, estados) ----------
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

// ---------- Navegación por hash (#/empresas/12) ----------
export function useHashRoute() {
  const get = () => (window.location.hash.replace(/^#/, '') || '/tablero');
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const navigate = (to) => { window.location.hash = to; };

// ---------- Avisos ----------
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- Ventana modal ----------
export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, select, textarea')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// Confirmación dentro de la página (sin window.confirm)
export function ConfirmButton({ children, confirmText = '¿Seguro?', onConfirm, className = 'btn btn-ghost btn-sm danger' }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className={className} onClick={() => setAsking(true)}>{children}</button>;
  return (
    <span className="confirm-inline">
      <span>{confirmText}</span>
      <button type="button" className="btn btn-danger btn-sm" onClick={() => { setAsking(false); onConfirm(); }}>Sí, borrar</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)}>Cancelar</button>
    </span>
  );
}

export function Field({ label, children, hint, full }) {
  return (
    <label className={`field${full ? ' field-full' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export const PriorityBadge = ({ p }) => (p ? <span className={`prio prio-${p}`} title={`Prioridad ${p}`}>{p}</span> : null);

export function StageBadge({ stage }) {
  const { stageLabel } = useApp();
  return <span className={`stage stage-${stage}`}>{stageLabel(stage)}</span>;
}

export function Spinner() { return <div className="spinner" aria-label="Cargando" />; }

export function EmptyState({ title, children }) {
  return <div className="empty"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

// Pide datos y los vuelve a pedir cuando cambian las dependencias
export function useFetch(fn, deps, { interval } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const load = useCallback(async (silent) => {
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fnRef.current();
      setState({ data, error: null, loading: false });
    } catch (e) {
      setState((s) => ({ ...s, error: e.message, loading: false }));
    }
  }, []);
  useEffect(() => { load(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!interval) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, interval);
    return () => clearInterval(t);
  }, [interval, load]);
  return { ...state, reload: load, setData: (fnOrValue) => setState((s) => ({ ...s, data: typeof fnOrValue === 'function' ? fnOrValue(s.data) : fnOrValue })) };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
