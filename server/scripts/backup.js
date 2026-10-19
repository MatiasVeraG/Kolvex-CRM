// Copia de seguridad de la base de datos, sin detener el servidor.
// Uso: npm run backup            → data/backups/crm-AAAA-MM-DD-HHMM.db
//      npm run backup -- /ruta/archivo.db
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from '../db.js';

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
const target = path.resolve(process.argv[2] || path.join(DATA_DIR, 'backups', `crm-${stamp}.db`));
fs.mkdirSync(path.dirname(target), { recursive: true });
if (fs.existsSync(target)) { console.error(`Ya existe ${target}`); process.exit(1); }
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
console.log(`Copia guardada en ${target}`);
