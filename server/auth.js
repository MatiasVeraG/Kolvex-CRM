// Contraseñas (scrypt) y sesiones firmadas (HMAC), con módulos incluidos en Node.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, users } from './db.js';

const TOKEN_DAYS = Number(process.env.SESSION_DAYS || 14);

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Si no se define SESSION_SECRET, se genera uno y se guarda junto a la base de datos.
  const file = path.join(DATA_DIR, '.session-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

export function createToken(user) {
  const payload = b64(JSON.stringify({ uid: user.id, exp: Date.now() + TOKEN_DAYS * 86400e3 }));
  return `${payload}.${sign(payload)}`;
}

export function userFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!data.exp || data.exp < Date.now()) return null;
  const user = users.get(data.uid);
  if (!user || !user.active) return null;
  return user;
}

export function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  return null;
}

// Recuperar acceso: con RESET_ADMIN=true, ADMIN_EMAIL y ADMIN_PASSWORD, al arrancar se crea
// ese usuario (o se le pone esa contraseña) como administrador activo.
// Después de entrar, borra RESET_ADMIN para que no se vuelva a aplicar.
function resetAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || validatePassword(password)) {
    console.error('RESET_ADMIN necesita ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 8 caracteres). No se cambió nada.');
    return;
  }
  const existing = users.getWithHash(email);
  if (existing) {
    users.update(existing.id, { password_hash: hashPassword(password), role: 'admin', active: 1 });
  } else {
    users.create({ name: process.env.ADMIN_NAME || 'Administrador', email, password_hash: hashPassword(password), role: 'admin' });
  }
  console.log(`\nAcceso de administrador restablecido para ${email}. Borra la variable RESET_ADMIN.\n`);
}

// Primer arranque: si no hay usuarios, se crea un administrador.
export function ensureAdmin() {
  if (process.env.RESET_ADMIN === 'true') resetAdmin();
  if (users.count() > 0) return;
  const email = process.env.ADMIN_EMAIL || 'admin@crm.local';
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  users.create({ name: process.env.ADMIN_NAME || 'Administrador', email, password_hash: hashPassword(password), role: 'admin' });
  console.log('\n────────────────────────────────────────────');
  console.log(' Usuario administrador creado');
  console.log(`   Email:      ${email}`);
  console.log(`   Contraseña: ${generated ? password : '(la de ADMIN_PASSWORD)'}`);
  console.log(' Cámbiala desde "Mi cuenta" al entrar.');
  console.log('────────────────────────────────────────────\n');
}
