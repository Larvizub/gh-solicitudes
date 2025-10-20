// Prueba manual ESM: enviar un correo con un ticket en estado 'Pausado' usando la plantilla local.
// Ejecutar: node tests/mailTest.mjs
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const envPath = path.join(repoRoot, '.env');
let envText = '';
if (fsSync.existsSync(envPath)) envText = await fs.readFile(envPath, 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  if (!line || line.trim().startsWith('#')) continue;
  const idx = line.indexOf('=');
  if (idx === -1) continue;
  env[line.slice(0, idx).trim()] = line.slice(idx+1).trim();
}
const url = env.VITE_SENDMAIL_URL;
const apiKey = env.VITE_SENDMAIL_API_KEY;
if (!url) {
  console.error('.env no tiene VITE_SENDMAIL_URL');
  process.exit(1);
}

// Importar la plantilla ESM (usar URL file:// para compatibilidad en Windows)
const tplPath = path.join(repoRoot, 'src', 'utils', 'ticketEmailTemplate.js');
const tpl = await import('file://' + tplPath.replace(/\\/g, '/'));
const { generateTicketEmailHTML, buildSendMailPayload } = tpl;

const ticket = {
  ticketId: 'TEST-PAUSADO-001',
  codigo: 'TEST-PAU-001',
  departamento: 'CCCR',
  departamentoNombre: 'Gestión de la Protección',
  tipo: 'Solicitud de Acceso',
  estado: 'Pausado',
  subcategoria: 'Retención temporal',
  descripcion: 'Este es un cuerpo de prueba para un ticket pausado. Debe mostrar el cuadro con fondo distinto.',
  usuarioEmail: 'luis.arvizu@costaricacc.com',
  usuario: 'Luis C. Arvizu',
  latestComment: { authorName: 'Soporte', text: 'Ticket pausado por falta de información. Comentario de prueba.' },
  to: ['luis.arvizu@costaricacc.com']
};

const baseUrl = env.VITE_APP_BASE_URL || 'https://gh-solicitudes.example';
const html = generateTicketEmailHTML({ ticket, baseUrl, branding: { pausedMessageBg: '#fff8e1', pausedMessageBorder: '#ffecb3' }, extraMessage: 'Prueba automática: ticket en Pausado' });

const payload = buildSendMailPayload({ ticket, departamento: ticket.departamento, departamentoNombre: ticket.departamentoNombre, htmlOverride: html, subject: `[Ticket ${ticket.estado}] ${ticket.tipo} #${ticket.codigo}`, actionMsg: 'Prueba', cc: [] });
payload.html = html;

console.log('Enviando prueba a:', payload.to || payload.usuarioEmail);
try {
  const resp = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type':'application/json' }, apiKey ? { 'x-api-key': apiKey } : {}), body: JSON.stringify(payload) });
  const txt = await resp.text();
  console.log('HTTP', resp.status, resp.statusText);
  console.log('Body:', txt);
} catch (e) {
  console.error('Error enviando:', e);
}
