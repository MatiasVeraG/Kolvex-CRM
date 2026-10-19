// Compila la interfaz React con esbuild.
//   node client/build.js          → compila una vez (producción)
//   node client/build.js --watch  → recompila al guardar (desarrollo)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });

function writeHtml(result) {
  const outputs = Object.keys(result.metafile.outputs).map((f) => path.relative(dist, f).split(path.sep).join('/'));
  const js = outputs.find((f) => f.endsWith('.js'));
  const css = outputs.find((f) => f.endsWith('.css'));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('<!--CSS-->', css ? `<link rel="stylesheet" href="/${css}">` : '')
    .replace('<!--JS-->', `<script type="module" src="/${js}"></script>`);
  fs.writeFileSync(path.join(dist, 'index.html'), html);
  fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
}

const options = {
  entryPoints: [path.join(root, 'src/main.jsx')],
  bundle: true,
  outdir: path.join(dist, 'assets'),
  entryNames: watch ? 'app' : 'app-[hash]',
  format: 'esm',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch,
  target: ['es2020'],
  metafile: true,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
  plugins: [{
    name: 'html',
    setup(build) {
      build.onEnd((result) => { if (!result.errors.length) writeHtml(result); });
    },
  }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Interfaz en modo desarrollo: se recompila al guardar.');
} else {
  await esbuild.build(options);
}
