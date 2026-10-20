// El adaptador devuelve aceptación por WhatsApp Web, no entrega ni lectura.
// El resultado se persiste antes de confirmarlo al CRM. Nunca reenvía al reintentar un recibo.
export async function processJob({ job, adapter, api, persist }) {
  let invoked = false;
  let receipt;
  try {
    const reply = await adapter.recentReply(job);
    if (reply) {
      await api('/reply', reply);
      receipt = { result: 'cancelled' };
    } else {
      const { allowed } = await api(`/jobs/${job.id}/check`, { claim_token: job.claim_token });
      if (!allowed) receipt = { result: 'cancelled' };
      else {
        invoked = true;
        const providerId = await adapter.send(job);
        if (!providerId) throw new Error('WhatsApp no devolvió identificador.');
        receipt = { result: 'sent', provider_id: providerId };
      }
    }
  } catch {
    // Un error de lectura previo al envío no permite enviar a ciegas.
    // También se retiene para revisión, evitando bucles de reintentos.
    receipt = { result: 'uncertain', detail: invoked ? 'Fallo después de invocar envío' : 'No se pudo verificar el chat' };
  }
  const body = { ...receipt, claim_token: job.claim_token };
  await persist({ id: job.id, body });
  await api(`/jobs/${job.id}/result`, body);
  return body;
}
