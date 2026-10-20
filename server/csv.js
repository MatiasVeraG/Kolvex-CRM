// Columnas que entiende la importación (Outscraper, planilla de prospectos o archivos propios).
// Este archivo también lo usa la interfaz, por eso no importa nada del servidor.
export const ALIASES = {
  name: ['name', 'nombre', 'negocio', 'empresa'],
  rubro: ['rubro'],
  query: ['query'],
  type: ['type', 'category', 'categoria', 'categoría'],
  ciudad: ['ciudad', 'city'],
  direccion: ['direccion', 'dirección', 'full_address', 'address'],
  telefono: ['telefono', 'teléfono', 'phone'],
  email: ['email', 'correo', 'email_1'],
  web: ['web', 'website', 'site'],
  presencia: ['presencia', 'presencia online'],
  rating: ['rating', 'calificación', 'calificacion'],
  reviews: ['reviews', 'reseñas', 'resenas'],
  maps_url: ['maps_url', 'location_link', 'ver en google maps'],
  contacto_nombre: ['contacto_nombre', 'contacto'],
  notas: ['notas', 'notes'],
  prioridad: ['prioridad', 'priority'],
  external_id: ['external_id', 'place_id', 'google_id'],
  status: ['business_status', 'estado_negocio'],
};
export const KNOWN_COLUMNS = [...new Set(Object.values(ALIASES).flat())];

// Lector de CSV simple: comillas, saltos de línea dentro de comillas, separador "," o ";".
export function parseCsv(input) {
  const text = String(input).replace(/^\uFEFF/, '');
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(field); field = ''; } else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; } else field += ch;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!clean.length) return [];
  const [header, ...data] = clean;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}
