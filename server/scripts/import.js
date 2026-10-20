// Importa empresas desde un archivo JSON o CSV (también se puede hacer desde la interfaz:
// Empresas → Importar).
// Uso:  npm run import -- data/prospectos.json
//       npm run import -- lista-outscraper.csv
//       npm run import -- lista.csv --con-web     (incluye empresas que ya tienen página web)
// Las empresas que ya existen se saltean, así que se puede correr varias veces.
import fs from 'node:fs';
import path from 'node:path';
import { importRecords } from '../importer.js';
import { parseCsv } from '../csv.js';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run import -- <archivo.json|archivo.csv>');
  process.exit(1);
}
const text = fs.readFileSync(path.resolve(file), 'utf8');
const records = file.toLowerCase().endsWith('.csv') ? parseCsv(text) : JSON.parse(text);
const r = importRecords(records, { onlyWithoutWeb: !process.argv.includes('--con-web') });

console.log(`Importación terminada: ${r.created} empresas nuevas, ${r.existing} ya existían, ` +
  `${r.withWeb} con web propia (omitidas), ${r.closed} cerradas (omitidas), ${r.invalid} sin nombre.`);
