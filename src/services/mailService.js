export async function sendTicketMail(payload) {
  let url = import.meta.env.VITE_SENDMAIL_URL || '/sendMail';
  try {
    if (url && url !== '/sendMail') {
      const configured = new URL(url);
      const currentOrigin = typeof window !== 'undefined' ? window.location.origin : null;
      if (currentOrigin && configured.origin !== currentOrigin) {
        // Different origin -> force relative path to go through Hosting proxy
        url = '/sendMail';
      }
    }
  } catch {
    // If URL parsing fails, fallback to relative path
    url = '/sendMail';
  }
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