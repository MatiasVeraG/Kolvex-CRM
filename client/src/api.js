// Cliente de la API y utilidades de formato compartidas.
const TOKEN_KEY = 'crm_token';

export const auth = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* sin almacenamiento */ } },
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, query } = {}) {
  let url = `/api${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([...qs].length) url += `?${qs}`;
  }
  const headers = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('No hay conexión con el servidor.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') onUnauthorized();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ---------- Formatos ----------
const gs = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 });
export const money = (v) => (v === null || v === undefined || v === '' ? '—' : `₲ ${gs.format(v)}`);
export const number = (v) => (v === null || v === undefined ? '—' : gs.format(v));

// La base guarda las marcas de tiempo en UTC ("2026-10-19 22:56:06")
export const parseUtc = (s) => (s ? new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`) : null);
// Las fechas que carga el usuario ("2026-10-20" o "2026-10-20T15:00") son hora local
export const parseLocal = (s) => (s ? new Date(s.length === 10 ? `${s}T00:00` : s) : null);

const dFmt = new Intl.DateTimeFormat('es-PY', { day: '2-digit', month: 'short', year: 'numeric' });
const dtFmt = new Intl.DateTimeFormat('es-PY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (d) => (d ? dFmt.format(d) : '—');
export const fmtDateTime = (d) => (d ? dtFmt.format(d) : '—');

export function relative(d) {
  if (!d) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'recién';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`;
  return fmtDate(d);
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const isOverdue = (dateStr, stage) => !!dateStr && dateStr <= todayIso() && stage !== 'ganado' && stage !== 'perdido';

export { whatsappUrl } from '../../shared/whatsapp.js';

// Link para llamar (tel:) con el número en formato internacional
export function telUrl(phone) {
  let digits = String(phone || '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('0')) digits = `+595${digits.slice(1)}`;
  else if (!digits.startsWith('+')) digits = `+${digits}`;
  return `tel:${digits}`;
}

// Agrega https:// si falta
export function webUrl(web) {
  const s = String(web || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('@')) return `https://instagram.com/${s.slice(1)}`;
  return `https://${s}`;
}

export function webLabel(web) {
  const s = String(web || '').toLowerCase();
  if (s.includes('instagram')) return 'Instagram';
  if (s.includes('facebook')) return 'Facebook';
  if (s.includes('tiktok')) return 'TikTok';
  if (s.includes('linktr')) return 'Linktree';
  return 'Sitio web';
}

export const mapsSearchUrl = (c) => {
  if (c.maps_url) return c.maps_url;
  const q = [c.name, c.direccion, c.ciudad, 'Paraguay'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};
export const directionsUrl = (c) => {
  // Si el link de Maps trae coordenadas, se usan (es más preciso que la dirección)
  const m = String(c.maps_url || '').match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || String(c.maps_url || '').match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return `https://www.google.com/maps/dir/?api=1&destination=${m[1]},${m[2]}`;
  const q = [c.direccion || c.name, c.ciudad, 'Paraguay'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
};
export const googleSearchUrl = (c) => `https://www.google.com/search?q=${encodeURIComponent([c.name, c.ciudad].filter(Boolean).join(' '))}`;
export const instagramSearchUrl = (c) => `https://www.google.com/search?q=${encodeURIComponent(`${c.name} ${c.ciudad || ''} site:instagram.com`)}`;

export const COMMENT_LABELS = { reunion: 'Reunión', llamada: 'Llamada', whatsapp: 'WhatsApp', email: 'Email', nota: 'Nota' };
