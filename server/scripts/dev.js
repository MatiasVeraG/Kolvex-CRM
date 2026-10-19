// Modo desarrollo: recompila la interfaz y reinicia el servidor al guardar.
// Funciona igual en Windows, macOS y Linux.
import { spawn } from 'node:child_process';

const run = (args) => spawn(process.execPath, args, { stdio: 'inherit' });
const procs = [
  run(['client/build.js', '--watch']),
  run(['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', '--watch', 'server/index.js']),
];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
