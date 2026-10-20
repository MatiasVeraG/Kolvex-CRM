// Importación de empresas (desde la interfaz o desde la terminal).
// Entiende las columnas de Outscraper y las de la planilla de prospectos.
import { db, companies, deals, tx } from './db.js';
import { ALIASES } from './csv.js';


// Rubros de Google Maps (en inglés) a español
const RUBROS = {
  restaurant: 'Restaurante', 'fast food restaurant': 'Restaurante', 'hamburger restaurant': 'Restaurante', 'pizza restaurant': 'Restaurante',
  cafe: 'Cafetería', 'coffee shop': 'Cafetería', bakery: 'Panadería', bar: 'Bar',
  'hardware store': 'Ferretería', 'building materials store': 'Ferretería', 'tool store': 'Ferretería',
  dentist: 'Odontología', 'cosmetic dentist': 'Odontología', 'dental clinic': 'Odontología',
  'hair salon': 'Peluquería', 'beauty salon': 'Peluquería', barber_shop: 'Barbería', 'barber shop': 'Barbería', 'nail salon': 'Manicura',
  'car repair': 'Taller mecánico', 'auto repair shop': 'Taller mecánico', 'car repair and maintenance service': 'Taller mecánico',
  veterinarian: 'Veterinaria', 'veterinary care': 'Veterinaria', 'pet store': 'Pet shop',
  gym: 'Gimnasio', 'fitness center': 'Gimnasio', accountant: 'Contabilidad', lawyer: 'Abogados', 'law firm': 'Abogados',
  'language school': 'Escuela de idiomas', pharmacy: 'Farmacia', 'real estate agency': 'Inmobiliaria', 'clothing store': 'Tienda de ropa',
  'furniture store': 'Mueblería', 'florist': 'Florería', 'optician': 'Óptica', 'car dealer': 'Concesionaria', 'insurance agency': 'Seguros',
  'medical clinic': 'Clínica', doctor: 'Médicos', 'physiotherapist': 'Fisioterapia', 'psychologist': 'Psicología', 'spa': 'Spa',
};
const rubroEs = (s) => {
  if (!s) return null;
  const k = String(s).trim().toLowerCase();
  return RUBROS[k] || String(s).trim().replace(/^./, (c) => c.toUpperCase());
};

const SOCIAL = /(facebook\.com|fb\.com|instagram\.com|linktr\.ee|wa\.me|whatsapp|pedidosya|ola\.click|tiktok\.com|bit\.ly)/i;
export function presenciaDe(web) {
  const u = String(web || '').trim().toLowerCase();
  if (!u) return 'Nada';
  if (u.includes('facebook') || u.includes('fb.com')) return 'Solo Facebook';
  if (u.includes('instagram')) return 'Solo Instagram';
  if (u.includes('linktr')) return 'Solo Linktree';
  if (SOCIAL.test(u)) return 'Solo app de delivery/link';
  return 'Web propia';
}

function prioridadDe(r) {
  const digits = String(r.telefono || '').replace(/\D/g, '');
  const mobile = /^5959\d{8}$/.test(digits) || /^09\d{8}$/.test(digits);
  if (!digits) return 'C';
  if (mobile && (r.reviews || 0) >= 30 && (r.rating || 0) >= 4) return 'A';
  if ((r.reviews || 0) >= 10) return 'B';
  return 'C';
}

export function normalize(rec) {
  const lower = Object.fromEntries(Object.entries(rec || {}).map(([k, v]) => [String(k).toLowerCase().trim(), v]));
  const out = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const n = names.find((a) => lower[a] !== undefined && lower[a] !== null && String(lower[a]).trim() !== '');
    if (n) out[key] = typeof lower[n] === 'string' ? lower[n].trim() : lower[n];
  }
  if (out.external_id && String(out.external_id).startsWith('http')) {
    const m = String(out.external_id).match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    out.external_id = m ? m[1] : out.external_id;
  }
  if (!out.external_id && out.maps_url) {
    const m = String(out.maps_url).match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    if (m) out.external_id = m[1];
  }
  if (out.rating !== undefined) out.rating = Number(String(out.rating).replace(',', '.')) || null;
  if (out.reviews !== undefined) {
    // "1703", "1703.0" o "1.703" → 1703
    const v = String(out.reviews).trim();
    out.reviews = /^\d+([.,]0+)?$/.test(v) ? parseInt(v, 10) : parseInt(v.replace(/\D/g, ''), 10) || 0;
  }
  if (!out.rubro) out.rubro = rubroEs(out.query ? String(out.query).split(',')[0] : out.type);
  else out.rubro = rubroEs(out.rubro);
  if (!out.presencia) out.presencia = presenciaDe(out.web);
  if (!['A', 'B', 'C'].includes(out.prioridad)) out.prioridad = prioridadDe(out);
  return out;
}

// records: lista de objetos (filas). Devuelve un resumen de lo que pasó.
export function importRecords(records, { onlyWithoutWeb = true, skipClosed = true, ownerId = null } = {}) {
  const byExternal = db.prepare('SELECT id FROM companies WHERE external_id = ?');
  const byNamePhone = db.prepare("SELECT id FROM companies WHERE name = ? COLLATE NOCASE AND COALESCE(telefono, '') = ?");
  const setExternal = db.prepare('UPDATE companies SET external_id = ? WHERE id = ?');
  const result = { total: records.length, created: 0, existing: 0, withWeb: 0, closed: 0, invalid: 0 };
  const seen = new Set();

  tx(() => {
    for (const raw of records) {
      const r = normalize(raw);
      if (!r.name) { result.invalid++; continue; }
      if (skipClosed && r.status && !/^operational$/i.test(String(r.status))) { result.closed++; continue; }
      if (onlyWithoutWeb && r.presencia === 'Web propia') { result.withWeb++; continue; }
      const key = r.external_id || `${r.name.toLowerCase()}|${r.telefono || ''}`;
      if (seen.has(key) || (r.external_id && byExternal.get(String(r.external_id))) || byNamePhone.get(r.name, r.telefono || '')) {
        result.existing++;
        continue;
      }
      seen.add(key);
      const { prioridad, external_id, query: _q, type: _t, status: _s, ...fields } = r;
      const c = companies.create(fields);
      if (external_id) setExternal.run(String(external_id), c.id);
      deals.create({ company_id: c.id, title: 'Página web', stage: 'prospecto', priority: prioridad, owner_id: ownerId || null });
      result.created++;
    }
  });
  return result;
}
