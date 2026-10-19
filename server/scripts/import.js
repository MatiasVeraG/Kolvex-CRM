// Importa empresas desde un archivo JSON o CSV.
// Uso:  npm run import -- data/prospectos.json
//       npm run import -- mi-lista.csv
// Columnas reconocidas: name (o Negocio), rubro, ciudad, direccion, telefono, email, web,
// presencia, rating, reviews, maps_url, contacto_nombre, notas, prioridad, external_id.
// Las empresas que ya existen (mismo external_id o mismo nombre+teléfono) se saltean.
import fs from 'node:fs';
import path from 'node:path';
import { db, companies, deals, tx } from '../db.js';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run import -- <archivo.json|archivo.csv>');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const sep = text.split('\n')[0].includes(';') && !text.split('\n')[0].includes(',') ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i]])));
}

const ALIASES = {
  name: ['name', 'nombre', 'negocio', 'empresa'], rubro: ['rubro', 'categoria', 'category'], ciudad: ['ciudad', 'city'],
  direccion: ['direccion', 'dirección', 'address'], telefono: ['telefono', 'teléfono', 'phone'], email: ['email', 'correo'],
  web: ['web', 'website', 'site'], presencia: ['presencia', 'presencia online'], rating: ['rating', 'calificación', 'calificacion'],
  reviews: ['reviews', 'reseñas', 'resenas'], maps_url: ['maps_url', 'location_link', 'ver en google maps'],
  contacto_nombre: ['contacto_nombre', 'contacto'], notas: ['notas', 'notes'], prioridad: ['prioridad', 'priority'],
  external_id: ['external_id', 'place_id'],
};
function normalize(rec) {
  const lower = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k.toLowerCase().trim(), v]));
  const out = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const n = names.find((a) => lower[a] !== undefined && lower[a] !== null && String(lower[a]).trim() !== '');
    if (n) out[key] = typeof lower[n] === 'string' ? lower[n].trim() : lower[n];
  }
  if (out.external_id && String(out.external_id).startsWith('http')) {
    const m = String(out.external_id).match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    out.external_id = m ? m[1] : out.external_id;
  }
  if (out.rating !== undefined) out.rating = Number(String(out.rating).replace(',', '.')) || null;
  if (out.reviews !== undefined) out.reviews = parseInt(out.reviews, 10) || 0;
  return out;
}

const text = fs.readFileSync(path.resolve(file), 'utf8');
const records = (file.toLowerCase().endsWith('.csv') ? parseCsv(text) : JSON.parse(text)).map(normalize);

const byExternal = db.prepare('SELECT id FROM companies WHERE external_id = ?');
const byNamePhone = db.prepare('SELECT id FROM companies WHERE name = ? COLLATE NOCASE AND COALESCE(telefono, \'\') = ?');
const setExternal = db.prepare('UPDATE companies SET external_id = ? WHERE id = ?');

let created = 0, skipped = 0, invalid = 0;
tx(() => {
  for (const r of records) {
    if (!r.name) { invalid++; continue; }
    const exists = (r.external_id && byExternal.get(r.external_id)) || byNamePhone.get(r.name, r.telefono || '');
    if (exists) { skipped++; continue; }
    const { prioridad, external_id, ...fields } = r;
    const c = companies.create(fields);
    if (external_id) setExternal.run(String(external_id), c.id);
    deals.create({
      company_id: c.id, title: 'Página web', stage: 'prospecto',
      priority: ['A', 'B', 'C'].includes(prioridad) ? prioridad : null,
    });
    created++;
  }
});

console.log(`Importación terminada: ${created} empresas nuevas, ${skipped} ya existían, ${invalid} sin nombre.`);
