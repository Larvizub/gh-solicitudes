function extractRecipientsFromPayload(payload) {
  if (!payload) return [];
  const recipients = new Set();
  try {
    const t = payload.ticket || {};
    if (Array.isArray(payload.to)) payload.to.forEach(x => x && recipients.add(String(x).toLowerCase()));
    if (Array.isArray(payload.cc)) payload.cc.forEach(x => x && recipients.add(String(x).toLowerCase()));
    if (Array.isArray(t.to)) t.to.forEach(x => x && recipients.add(String(x).toLowerCase()));
    if (Array.isArray(t.asignados)) t.asignados.forEach(x => x && recipients.add(String(x).toLowerCase()));
    if (t.usuarioEmail) recipients.add(String(t.usuarioEmail).toLowerCase());
  } catch { /* ignore */ }
  return Array.from(recipients).filter(Boolean).filter(s => /@/.test(s));
}

export async function sendTicketMail(payload) {
  const recs = extractRecipientsFromPayload(payload);
  if (!recs.length) throw new Error('No se han encontrado destinatarios válidos. Asegúrate de incluir al creador o asignados en el ticket.');

  // Si se proporciona una URL explícita vía env, usarla directamente. Esto evita forzar una ruta
  // relativa '/sendMail' que devuelve 404 en desarrollo local cuando las reescrituras del Hosting
  // no están activas. Usar '/sendMail' como fallback cuando no se provee la variable de entorno.
  const configured = import.meta.env.VITE_SENDMAIL_URL;
  const url = configured ? configured : '/sendMail';
  const apiKey = import.meta.env.VITE_SENDMAIL_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  // Asegurar campo html: algunos callers usan htmlOverride
  const bodyToSend = Object.assign({}, payload, { templateVersion: 'v2', html: payload.html || payload.htmlOverride || payload.html || '' });
  try {
    console.debug && console.debug('sendTicketMail -> sending templateVersion:', bodyToSend.templateVersion, 'html preview:', (typeof bodyToSend.html === 'string' ? bodyToSend.html.slice(0,200) : '<no-html>'));
  } catch { /* ignore */ }
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyToSend)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Error sendMail ${resp.status} ${text}`);
  }
  return resp.json();
}