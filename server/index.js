// Servidor HTTP del CRM: API en /api y la app React compilada en client/dist.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, HttpError } from './routes.js';
import { userFromToken, ensureAdmin } from './auth.js';
import { DB_PATH } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const STATIC_DIR = path.resolve(__dirname, '../client/dist');
const MAX_BODY = 1024 * 1024;

// Convierte '/api/companies/:id' en una expresión regular con parámetros
const compiled = routes.map(([method, pattern, opts, handler]) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { method, re, keys, opts, handler };
});

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'El contenido es demasiado grande.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch { reject(new HttpError(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const methodMatches = compiled.filter((r) => r.re.test(url.pathname));
  const route = methodMatches.find((r) => r.method === req.method);
  if (!route) return send(res, methodMatches.length ? 405 : 404, { error: 'Ruta no encontrada.' });

  let user = null;
  if (!route.opts.public) {
    const auth = req.headers.authorization || '';
    user = userFromToken(auth.startsWith('Bearer ') ? auth.slice(7) : null);
    if (!user) return send(res, 401, { error: 'Sesión vencida. Vuelve a entrar.' });
  }
  const m = url.pathname.match(route.re);
  const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const query = Object.fromEntries(url.searchParams);
  const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
  const result = await route.handler({ req, user, params, query, body });
  send(res, req.method === 'POST' && !route.opts.public ? 201 : 200, result ?? { ok: true });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.map': 'application/json',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, url) {
  if (!fs.existsSync(STATIC_DIR)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Falta compilar la interfaz. Ejecuta: npm run build');
  }
  let rel = decodeURIComponent(url.pathname);
  let file = path.join(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html'); // SPA
  const ext = path.extname(file);
  const isAsset = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método no permitido.' });
    serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    if (String(err?.message).includes('UNIQUE constraint')) return send(res, 400, { error: 'Ya existe un registro con esos datos.' });
    console.error(err);
    send(res, 500, { error: 'Error interno del servidor.' });
  }
});

ensureAdmin();
server.listen(PORT, HOST, () => {
  console.log(`CRM en http://localhost:${PORT}  (base de datos: ${DB_PATH})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
