export async function sendTicketMail(payload) {
  // If an explicit URL is provided via env, use it directly. This avoids forcing a relative
  // '/sendMail' which returns 404 in local dev when Hosting rewrites are not active.
  // Fallback to '/sendMail' when no env var is provided.
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