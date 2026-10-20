export function whatsappUrl(phone, message = '') {
  let digits = String(phone || '').replace(/\D/g, '');
  if (/^09\d{8}$/.test(digits)) digits = `595${digits.slice(1)}`;
  if (!/^5959\d{8}$/.test(digits)) return null;
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

export const FLOW_VARIABLES = ['empresa', 'contacto', 'rubro', 'ciudad', 'vendedor'];
export function renderMessage(template, company, user) {
  const values = {
    empresa: company.name, contacto: company.contacto_nombre || company.name,
    rubro: company.rubro || 'tu negocio', ciudad: company.ciudad || '', vendedor: user.name,
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => values[key] ?? match);
}

export const RUN_LABELS = {
  active: 'En seguimiento', paused: 'Pausado', responded: 'Respondió',
  stopped: 'Detenido', completed: 'Completado',
};
