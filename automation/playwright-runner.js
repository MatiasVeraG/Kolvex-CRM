import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { enterCRM, simulateThroughUI, sendNextThroughUI, DEFAULT_SELECTORS } from './browser-flow.js';

const url = (process.env.CRM_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const parsed = new URL(url);
if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
    (parsed.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))) throw new Error('CRM_URL debe usar HTTPS o HTTP en localhost.');
if (!process.env.CRM_EMAIL || !process.env.CRM_PASSWORD) throw new Error('Configura CRM_EMAIL y CRM_PASSWORD en automation/.env.');
const root = path.dirname(fileURLToPath(import.meta.url));
const profile = path.resolve(root, process.env.WA_SESSION_DIR || '.session', 'playwright');
const receipts = path.join(profile, 'receipts');
await fs.mkdir(receipts, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  ...(process.env.WA_CHROME_PATH ? { executablePath: process.env.WA_CHROME_PATH } : { channel: process.env.WA_BROWSER_CHANNEL || 'chrome' }),
  locale: 'es-PY', timezoneId: process.env.TZ || 'America/Asuncion', viewport: { width: 1366, height: 900 },
});
const crm = context.pages()[0] || await context.newPage();
const selectors = { ...DEFAULT_SELECTORS,
  ...(process.env.WA_COMPOSER_SELECTOR ? { composer: process.env.WA_COMPOSER_SELECTOR } : {}),
  ...(process.env.WA_SEND_SELECTOR ? { send: process.env.WA_SEND_SELECTOR } : {}),
};
let running = true;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { running = false; void context.close().catch(() => {}); });
try {
  await enterCRM(crm, { url, email: process.env.CRM_EMAIL, password: process.env.CRM_PASSWORD });
  if (process.argv.includes('--simulate')) {
    console.log(await simulateThroughUI(crm));
  } else {
    console.log('Robot iniciado: CRM → Contactar → WhatsApp Web → Registrar. Escanea el QR en WhatsApp Web si aparece.');
    while (running) {
      // Un recibo pendiente indica que hubo un envío cuyo registro debe revisarse.
      const pending = (await fs.readdir(receipts)).filter((name) => name.endsWith('.json'));
      if (pending.length) throw new Error('Hay recibos pendientes en .session/playwright/receipts. Revisa esos envíos en el CRM antes de continuar.');
      const result = await sendNextThroughUI({ crm, selectors, persist: async (receipt) => {
        const file = path.join(receipts, `${receipt.id}.json`);
        await fs.writeFile(`${file}.tmp`, JSON.stringify(receipt), { mode: 0o600 });
        await fs.rename(`${file}.tmp`, file);
      } });
      if (result.state === 'sent') await fs.unlink(path.join(receipts, `${result.id}.json`));
      console.log(result.state === 'idle' ? 'Sin mensajes disponibles. Esperando…' : `Trabajo ${result.id}: ${result.state}`);
      if (process.argv.includes('--once')) break;
      await delay(5000);
    }
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
