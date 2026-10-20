// Este recorrido usa solo controles y texto visibles. No llama a la API del CRM
// ni a APIs internas de WhatsApp: la propia interfaz registra el resultado.
const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();
async function settled(page) {
  await page.locator('[data-testid="browser-robot"]:not([data-status="busy"])').waitFor();
  const status = await page.getByTestId('browser-robot').getAttribute('data-status');
  if (status === 'error') throw new Error(await page.getByRole('alert').innerText());
  return status;
}
export async function enterCRM(page, { url, email, password }) {
  await page.goto(`${url.replace(/\/$/, '')}/#/robot`);
  await page.waitForFunction(() => document.querySelector('#login-email') || document.querySelector('[data-testid="browser-robot"]') || document.querySelector('[role="alert"]'));
  if (await page.locator('#login-email').isVisible()) {
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  }
  await page.getByTestId('robot-next').waitFor({ timeout: 30000 });
}

export async function simulateThroughUI(page) {
  await page.getByRole('link', { name: 'Configurar lotes y horarios', exact: true }).click();
  const button = page.getByRole('button', { name: 'Simular lote y revisar mensajes', exact: true });
  await button.waitFor();
  if (!await button.isEnabled()) throw new Error('Configura al menos una regla por rubro para simular.');
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Simulación del lote · Sin envíos' });
  await dialog.waitFor();
  return dialog.innerText();
}

export const DEFAULT_SELECTORS = {
  composer: 'footer [contenteditable="true"][role="textbox"]',
  send: 'button[aria-label="Enviar"], button[aria-label="Send"], [data-icon="send"]',
  incoming: '.message-in', outgoing: '.message-out',
};
export async function latestReply(wa, since, selectors = DEFAULT_SELECTORS) {
  const messages = await wa.locator(selectors.incoming).evaluateAll((nodes) => nodes.map((node) => {
    const meta = node.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text');
    const match = meta?.match(/^\[(\d{1,2}):(\d{2})(?::\d{2})?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]/);
    let timestamp = null;
    if (match) {
      const [, hour, minute, day, month, rawYear] = match;
      const year = Number(rawYear) < 100 ? 2000 + Number(rawYear) : Number(rawYear);
      timestamp = new Date(year, Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime();
    }
    const text = node.querySelector('.selectable-text')?.textContent || '[Respuesta sin texto]';
    return { timestamp, text };
  }));
  if (messages.some((m) => !Number.isFinite(m.timestamp))) throw new Error('No se pudo interpretar la fecha de un mensaje recibido. Revisa el chat.');
  return messages.filter((m) => m.timestamp >= Math.floor(since / 60000) * 60000).sort((a, b) => b.timestamp - a.timestamp)[0]?.text || null;
}

async function confirmOutgoing(wa, message, previousIds, selectors, timeout) {
  const handle = await wa.waitForFunction(({ selector, expected, previous }) => {
    const norm = (value) => String(value).replace(/\s+/g, ' ').trim();
    for (const node of document.querySelectorAll(selector)) {
      const id = node.closest('[data-id]')?.getAttribute('data-id');
      const text = node.querySelector('.selectable-text')?.textContent;
      const accepted = node.querySelector('[data-icon="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-dblcheck-ack"]');
      if (id && !previous.includes(id) && norm(text) === norm(expected) && accepted) return id;
    }
    return null;
  }, { selector: selectors.outgoing, expected: message, previous: previousIds }, { timeout });
  return handle.jsonValue();
}

export async function sendNextThroughUI({ crm, persist, selectors = DEFAULT_SELECTORS, timeout = 180000, confirmationTimeout = 30000 }) {
  await crm.getByTestId('robot-next').click();
  const status = await settled(crm);
  if (status === 'idle') return { state: 'idle' };
  const card = crm.getByTestId('robot-job');
  const id = Number(await card.getAttribute('data-job-id'));
  const since = Number(await card.getAttribute('data-since'));
  const message = await crm.getByTestId('robot-message').innerText();
  let wa;
  let confirmed = false;
  try {
    const popup = crm.waitForEvent('popup');
    await crm.getByTestId('robot-open').click();
    wa = await popup;
    const composer = wa.locator(selectors.composer);
    await composer.waitFor({ timeout }); // permite vincular con QR en la ventana
    const reply = await latestReply(wa, since, selectors);
    if (reply) {
      await crm.getByTestId('robot-reply').fill(reply.slice(0, 4000));
      await crm.getByTestId('robot-responded').click();
      await settled(crm);
      return { state: 'responded', id };
    }
    if (normalize(await composer.innerText()) !== normalize(message)) throw new Error('El texto preparado en WhatsApp no coincide con el CRM.');
    await crm.getByTestId('robot-check').click();
    if (await settled(crm) !== 'allowed') {
      await crm.getByTestId('robot-cancel').click(); await settled(crm);
      return { state: 'cancelled', id };
    }
    const previousIds = await wa.locator(selectors.outgoing).evaluateAll((nodes) => nodes.map((n) => n.closest('[data-id]')?.getAttribute('data-id')).filter(Boolean));
    await wa.locator(selectors.send).click(); // exactamente un clic; nunca reintentar el envío
    const providerId = await confirmOutgoing(wa, message, previousIds, selectors, confirmationTimeout);
    confirmed = true;
    await persist({ id, provider_id: providerId, message, confirmed_at: Date.now() });
    await crm.bringToFront();
    await crm.getByTestId('robot-provider-id').fill(providerId);
    await crm.getByTestId('robot-sent').click();
    await settled(crm);
    return { state: 'sent', id, provider_id: providerId };
  } catch (e) {
    if (!confirmed) {
      await crm.getByTestId('robot-uncertain').click().catch(() => {});
      await settled(crm).catch(() => {});
    }
    throw new Error(`Trabajo ${id}: ${e.message}. Robot detenido; no se repite el envío.`);
  } finally {
    await wa?.close().catch(() => {});
  }
}
