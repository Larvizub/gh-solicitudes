export async function sendTicketMail(payload) {
  // Si se proporciona una URL explícita vía env, usarla directamente. Esto evita forzar una ruta
  // relativa '/sendMail' que devuelve 404 en desarrollo local cuando las reescrituras del Hosting
  // no están activas. Usar '/sendMail' como fallback cuando no se provee la variable de entorno.
  const configured = import.meta.env.VITE_SENDMAIL_URL;
  const url = configured ? configured : '/sendMail';
  const apiKey = import.meta.env.VITE_SENDMAIL_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Error sendMail ${resp.status} ${text}`);
  }
  return resp.json();
}