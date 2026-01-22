// Servicio mínimo dedicado a envío de correos con Microsoft Graph
import * as functions from 'firebase-functions';
import admin from 'firebase-admin';
import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch';

admin.initializeApp();
const db = admin.database();
const cfg = functions.config();
// URL base de la app (opcional) para construir enlaces a tickets
const BASE_URL = (cfg.app && cfg.app.base_url) || (cfg.frontend && cfg.frontend.base_url) || (cfg.base && cfg.base.url) || '';

// Defaults usados también por el panel SLA
const DEFAULT_SLA = { Alta: 24, Media: 72, Baja: 168 };

// Cache de token
let tokenCache = { token: null, exp: 0 };
async function getGraphToken() {
  const tenant = cfg.msgraph?.tenant_id || cfg.msgraph?.tenant;
  const clientId = cfg.msgraph?.client_id;
  const clientSecret = cfg.msgraph?.client_secret;
  if (!tenant || !clientId || !clientSecret) throw new Error('Credenciales MS Graph incompletas');
  const now = Math.floor(Date.now()/1000);
  if (tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;
  // Construir parámetros
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  params.set('scope', 'https://graph.microsoft.com/.default');
  params.set('grant_type', 'client_credentials');

  // Helper simple de reintentos para operaciones fetch/async
  async function retryAsync(fn, attempts = 3, delay = 500) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const isLast = i + 1 === attempts;
        const wait = delay * Math.pow(2, i);
        console.warn(`retryAsync attempt ${i + 1} failed: ${e && e.message ? e.message : e}`);
        if (isLast) break;
        await new Promise(r => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  const resp = await retryAsync(() => fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method:'POST', body: params }));
  if (!resp.ok) {
    const text = await resp.text().catch(()=>'<no-text>');
    throw new Error('Error token Graph ' + text);
  }
  const json = await resp.json();
  tokenCache = { token: json.access_token, exp: now + (json.expires_in||3600) };
  return tokenCache.token;
}

function graphClient(token) { return Client.init({ authProvider: done => done(null, token) }); }

/**
 * Envía una notificación push a una lista de correos electrónicos.
 * Busca el fcmToken en la rama /usuarios.
 */
async function sendPushToUsers(emails, title, body, data = {}) {
  if (!emails || !emails.length) return;
  try {
    const recipients = Array.isArray(emails) ? emails : [emails];
    const tokens = [];

    // Buscar tokens para los correos proporcionados
    for (const email of recipients) {
      if (!email) continue;
      try {
        const userSnap = await db.ref('usuarios').orderByChild('email').equalTo(email.toLowerCase()).once('value');
        if (userSnap.exists()) {
          const users = userSnap.val();
          Object.values(users).forEach(u => {
            if (u && u.fcmToken) tokens.push(u.fcmToken);
          });
        }
      } catch (err) {
        console.warn(`Error buscando token para ${email}:`, err.message);
      }
    }

    if (tokens.length === 0) {
      console.log('No se encontraron tokens FCM para los destinatarios.');
      return;
    }

    const uniqueTokens = [...new Set(tokens)];
    const message = {
      notification: {
        title: title || 'Notificación de GH Solicitudes',
        body: body || 'Tienes una nueva actualización en tus tickets.',
      },
      data: Object.assign({ click_action: '/tickets' }, data),
      tokens: uniqueTokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`Notificaciones push enviadas: ${response.successCount} exitosas, ${response.failureCount} fallidas.`);
  } catch (error) {
    console.error('Error enviando notificaciones push:', error);
  }
}

function parseTimestampCandidate(ticket) {
  if (ticket.createdAt) return new Date(ticket.createdAt);
  if (ticket.fecha) return new Date(ticket.fecha);
  if (!isNaN(Number(ticket.id)) && Number(ticket.id) > 1000000000000) return new Date(Number(ticket.id));
  return null;
}

function parseClosedTimestamp(ticket) {
  if (ticket.closedAt) return new Date(ticket.closedAt);
  if (ticket.updatedAt && (ticket.estado === 'Cerrado' || ticket.estado === 'Resuelto' || ticket.estado === 'Finalizado')) return new Date(ticket.updatedAt);
  return null;
}

function hoursBetween(a, b) { if (!a || !b) return null; return (b.getTime() - a.getTime()) / (1000 * 60 * 60); }

async function resolveUserId(client, sender) {
  const explicitId = cfg.msgraph?.senderid || cfg.msgraph?.sender_id || cfg.msgraph?.senderId;
  if (explicitId) return explicitId;
  console.log('Resolviendo remitente Graph para:', sender);
  // 1. Intento directo
  try {
    const u = await client.api(`/users/${encodeURIComponent(sender)}`).select('id,mail,userPrincipalName,mailNickname').get();
    if (u?.id) { console.log('Remitente resuelto directo'); return u.id; }
  } catch(e){ console.log('resolveUserId directo fallo', e.message); }
  // 2. mail eq
  try {
    const r = await client.api('/users').filter(`mail eq '${sender.replace(/'/g, "''")}'`).select('id,mail,userPrincipalName').get();
    if (r?.value?.length) { console.log('Remitente por mail eq'); return r.value[0].id; }
  } catch(e){ console.log('resolveUserId mail eq fallo', e.message); }
  // 3. userPrincipalName eq
  try {
    const r = await client.api('/users').filter(`userPrincipalName eq '${sender.replace(/'/g, "''")}'`).select('id,userPrincipalName').get();
    if (r?.value?.length) { console.log('Remitente por UPN eq'); return r.value[0].id; }
  } catch(e){ console.log('resolveUserId upn eq fallo', e.message); }
  // 4. startswith(userPrincipalName, ...)
  try {
    const prefix = sender.split('@')[0];
    const r = await client.api('/users').header('ConsistencyLevel','eventual').filter(`startsWith(userPrincipalName,'${prefix.replace(/'/g,"''")}')`).select('id,userPrincipalName').get();
    if (r?.value?.length) { console.log('Remitente por startsWith UPN'); return r.value[0].id; }
  } catch(e){ console.log('resolveUserId startsWith upn fallo', e.message); }
  // 5. startswith(mailNickname,...)
  try {
    const prefix = sender.split('@')[0];
    const r = await client.api('/users').header('ConsistencyLevel','eventual').filter(`startsWith(mailNickname,'${prefix.replace(/'/g,"''")}')`).select('id,mailNickname').get();
    if (r?.value?.length) { console.log('Remitente por startsWith mailNickname'); return r.value[0].id; }
  } catch(e){ console.log('resolveUserId startsWith mailNickname fallo', e.message); }
  console.error('No se pudo resolver remitente tras múltiples estrategias');
  throw new Error('No se resolvió el remitente');
}

// Eliminamos generación de plantilla: ahora el HTML debe venir siempre desde el frontend (body.html)

function buildGraphMail(subject, html, toRecipients = [], ccRecipients = []) {
  const msg = {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: Array.isArray(toRecipients) ? toRecipients.map(r => ({ emailAddress: { address: r } })) : [],
    }
  };
  if (Array.isArray(ccRecipients) && ccRecipients.length) {
    msg.message.ccRecipients = ccRecipients.map(r => ({ emailAddress: { address: r } }));
  }
  return msg;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowedRaw = (cfg.allowed?.origins || '').trim();
  const allowedList = allowedRaw ? allowedRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
  const allowAll = allowedList.length === 0;
  let isAllowed = allowAll || (origin && allowedList.includes(origin));
  let value = isAllowed ? (origin || '*') : (allowAll ? '*' : '');
  // Si hay una lista explícita y el origin viene pero NO está en la lista,
  // permitimos temporalmente el origin (se registra advertencia). Esto evita
  // bloqueos de preflight cuando el admin no ha configurado allowed.origins.
  if (!isAllowed && origin) {
    console.warn('CORS origen no listado pero se permitirá temporalmente:', origin);
    isAllowed = true;
    value = origin; // permitir el origin específico
  }
  if (value) res.set('Access-Control-Allow-Origin', value);
  res.set('Vary','Origin');
  // Permitir credenciales solo si no usamos '*'
  if (value !== '*') res.set('Access-Control-Allow-Credentials','true');
  const reqHeaders = req.headers['access-control-request-headers'];
  res.set('Access-Control-Allow-Headers', reqHeaders || 'Content-Type,x-api-key');
  res.set('Access-Control-Allow-Methods','POST,OPTIONS');
  res.set('Access-Control-Max-Age','86400');
  if (!isAllowed) {
    console.warn('CORS origen no permitido:', origin, 'Lista:', allowedList);
  }
  if (req.method === 'OPTIONS') { res.status(204).send(''); return true; }
  return false;
}

function validateApiKey(req) {
  const configured = cfg.api?.key; if (!configured) return true; // no key set => abierto
  return (req.headers['x-api-key'] === configured);
}

async function getDepartmentName(departmentId) {
  try {
    const snap = await db.ref(`departamentos/${departmentId}`).once('value');
    const dept = snap.val();
    if (!dept) return departmentId;
    if (typeof dept === 'string') return dept || departmentId;
    if (typeof dept === 'object') {
      return dept.nombre || dept.name || dept.label || departmentId;
    }
    return departmentId;
  } catch(e) {
    console.warn('Error getting department name:', e.message);
    return departmentId;
  }
}

async function collectRecipients(departamento, usuarioEmail, extraRecipients, asignados) {
  let recipients = [];
  try {
    const snap = await db.ref(`configCorreo/departamentos/${departamento}/pool`).once('value');
    const val = snap.val();
    if (Array.isArray(val)) recipients = val.filter(Boolean); else if (val && typeof val === 'object') recipients = Object.values(val).filter(Boolean);
  } catch(e){ console.log('Pool warn', e.message); }
  if (usuarioEmail) recipients.push(usuarioEmail);
  if (Array.isArray(extraRecipients)) recipients.push(...extraRecipients);
  
  // Agregar usuarios asignados al ticket
  if (Array.isArray(asignados)) {
    for (const asignado of asignados) {
      if (typeof asignado === 'string') {
        // Puede ser email o ID de usuario
        if (/@/.test(asignado)) {
          recipients.push(asignado);
        } else {
          // Es un ID de usuario, necesitamos obtener el email
          try {
            const userSnap = await db.ref(`usuarios/${asignado}`).once('value');
            const userData = userSnap.val();
            if (userData && userData.email) {
              recipients.push(userData.email);
            }
          } catch(e) {
            console.warn('Error getting assigned user email:', e.message);
          }
        }
      } else if (asignado && typeof asignado === 'object') {
        // Es un objeto {id, email, nombre}
        if (asignado.email && /@/.test(asignado.email)) {
          recipients.push(asignado.email);
        }
      }
    }
  }
  
  recipients = [...new Set(recipients.filter(r => typeof r === 'string' && /@/.test(r)))];
  return recipients;
}

async function sendTicketEmail(baseTicket, context) {
  const sender = cfg.msgraph?.sender; if (!sender) throw new Error('Falta msgraph.sender');
  // If caller provided explicit `to` list, prefer it; otherwise collect from config + usuarioEmail + extraRecipients
  let explicitTo = Array.isArray(context?.to) ? context.to.filter(Boolean) : null;
  let explicitCc = Array.isArray(context?.cc) ? context.cc.filter(Boolean) : [];
  let recipients = [];
  if (explicitTo && explicitTo.length) {
    recipients = [...new Set(explicitTo)];
  } else {
    // Normalizar asignados de todos los formatos posibles
    let asignados = [];
    if (Array.isArray(baseTicket.asignados)) {
      asignados = baseTicket.asignados;
    } else if (baseTicket.asignadoEmail) {
      asignados = [baseTicket.asignadoEmail];
    } else if (baseTicket.asignadoA) {
      asignados = [baseTicket.asignadoA];
    } else if (baseTicket.asignado) {
      if (Array.isArray(baseTicket.asignado)) {
        asignados = baseTicket.asignado;
      } else {
        asignados = [baseTicket.asignado];
      }
    }
    recipients = await collectRecipients(baseTicket.departamento, baseTicket.usuarioEmail, context?.extraRecipients, asignados);
  }
  if (!recipients.length && (!explicitCc || !explicitCc.length)) throw new Error('Sin destinatarios válidos');
  const token = await getGraphToken();
  const client = graphClient(token);
  const userId = await resolveUserId(client, cfg.msgraph?.sender);
  const subject = context?.subject || `Ticket ${baseTicket.estado}: ${baseTicket.tipo}`;
  if (!context?.rawHtml) throw new Error('Se requiere campo html (plantilla generada en frontend)');
  const html = context.rawHtml;
  const mail = buildGraphMail(subject, html, recipients, explicitCc);
  // Intentar enviar con reintentos para errores temporales
  async function postMailWithRetry(attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        await client.api(`/users/${userId}/sendMail`).post(mail);
        return;
      } catch (e) {
        lastErr = e;
        const msg = e && e.message ? e.message : String(e);
        // Log básico y decidir si reintentar (reintentar en errores de red o 5xx)
        console.warn(`sendMail attempt ${i + 1} failed for ticket ${baseTicket.id || baseTicket.ticketId || '<no-id>'}: ${msg}`);
        const isTransient = /5\d\d|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED/i.test(msg) || (e && e.statusCode && e.statusCode >= 500);
        if (i + 1 < attempts && isTransient) {
          const wait = 300 * Math.pow(2, i);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        break;
      }
    }
    throw lastErr;
  }

  await postMailWithRetry(3);
  return recipients;
}

export const sendMail = functions.https.onRequest(async (req, res) => {
  try {
    // Aplicar CORS lo antes posible para garantizar cabeceras en responses y en errores
    console.log('sendMail invoked (pre-CORS)', { method: req.method, url: req.url || req.path, origin: req.headers.origin, userAgent: req.headers['user-agent'] });
    if (applyCors(req, res)) return; // ya responde 204 para OPTIONS
    try {
      const bodyPreview = req.body ? (typeof req.body === 'object' ? Object.keys(req.body).slice(0,10) : String(req.body).slice(0,200)) : null;
      console.log('sendMail headers keys:', Object.keys(req.headers || {}).slice(0,20), 'bodyPreviewKeysOrText:', bodyPreview);
    } catch(e) { console.warn('sendMail preview failed', e && e.message); }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    if (!validateApiKey(req)) return res.status(401).json({ error: 'API Key inválida' });
    if (req.headers['content-type']?.indexOf('application/json') === -1) return res.status(415).json({ error: 'Content-Type application/json requerido' });

  const body = req.body || {};
    // Debug: log template version if present and a short preview of html (protected checks)
    if (body && (typeof body.templateVersion === 'string' || body.templateVersion)) {
      console.log('sendMail payload templateVersion:', body.templateVersion || '<none>');
    }
    if (body && typeof body.html === 'string' && body.html.length) {
      console.log('sendMail html preview:', body.html.slice(0,200));
    }
    const required = ['ticketId','departamento','tipo','estado'];
    const missing = required.filter(k => !body[k]);
    if (missing.length) return res.status(400).json({ error: 'Faltan campos', campos: missing });

    // Validaciones de configuración y payload
    const sender = cfg.msgraph?.sender;
    if (!sender) return res.status(500).json({ error: 'Configuración incompleta: falta msgraph.sender en funciones' });
    if (!body.html) return res.status(400).json({ error: 'Payload inválido: field html requerido (plantilla generada en frontend)' });

    // allow frontend to pass explicit to/cc arrays; pass them through to sendTicketEmail
    let recipients = [];
    try {
      recipients = await sendTicketEmail(body, { actionMsg: body.actionMsg, subject: body.subject, rawHtml: body.html, to: Array.isArray(body.to) ? body.to : null, cc: Array.isArray(body.cc) ? body.cc : null, extraRecipients: body.extraRecipients });
      
      // Enviar notificación push también
      const pushTitle = body.subject || `Ticket ${body.estado}: ${body.tipo}`;
      const pushBody = body.actionMsg || `El ticket "${body.tipo}" ha cambiado a estado: ${body.estado}`;
      const pushData = {
        ticketId: String(body.ticketId || ''),
        status: String(body.estado || ''),
        click_action: body.ticketId ? `/tickets/${body.ticketId}` : '/tickets'
      };
      
      // Combinar To y Cc para asegurar que todos reciban el push
      const allPushRecipients = [...new Set([
        ...recipients,
        ...(Array.isArray(body.cc) ? body.cc.filter(Boolean) : [])
      ])];
      
      // No bloqueamos la respuesta por el push
      sendPushToUsers(allPushRecipients, pushTitle, pushBody, pushData).catch(e => console.error('Error push async:', e));

      res.json({ ok: true, sent: recipients.length, recipients });
    } catch (innerErr) {
      console.error('sendMail -> sendTicketEmail error', innerErr && innerErr.stack ? innerErr.stack : innerErr);
      // Mapear errores comunes a códigos HTTP claros
      const msg = innerErr && innerErr.message ? innerErr.message : 'Error interno al enviar correo';
      if (/Sin destinatarios válidos|Sin destinatarios/i.test(msg)) return res.status(400).json({ error: msg });
      if (/No se resolvi[eó] el remitente|No se pudo resolver remitente/i.test(msg)) return res.status(500).json({ error: msg });
      if (/token Graph|Error token Graph/i.test(msg)) return res.status(502).json({ error: msg });
      return res.status(500).json({ error: msg });
    }
  } catch (err) {
    console.error('sendMail error (outer)', err && err.stack ? err.stack : err);
    // If the platform returns a 503, this block may not be reached; still return 500 to caller
    try { return res.status(500).json({ error: err.message || 'Error interno' }); } catch (e) { console.error('Failed to send error response', e); }
  }
});

// Callable function: devuelve perfil de usuario desde Microsoft Graph por correo
export const getGraphProfile = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  const email = (data && data.email) ? String(data.email) : null;
  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'Email requerido');
  }
  try {
    const token = await getGraphToken();
    const client = graphClient(token);
    // Consultar usuario por correo
    const u = await client.api(`/users/${encodeURIComponent(email)}`).select('displayName,givenName,surname,mail,department,mobilePhone,jobTitle').get();
    return { ok: true, profile: u };
  } catch (err) {
    console.error('getGraphProfile error', err && err.message ? err.message : err);
    throw new functions.https.HttpsError('not-found', 'No se encontró el usuario en Microsoft Graph');
  }
});

// Trigger: notifica cambios de estado (creación o modificaciones donde cambia estado)
// Trigger deshabilitado: ahora las notificaciones se deben enviar desde el frontend llamando a sendMail con html.
export const notifyTicketStatus = functions.database.ref('/tickets/{ticketId}')
  .onWrite(async () => { return null; });

// Scheduler: cada hora escanea tickets y envía advertencias cuando faltan <= 12 horas para incumplir SLA.
export const slaWarningScheduler = functions.pubsub.schedule('every 1 hours').onRun(async () => {
  console.log('SLA Warning scheduler started');
  try {
    const ticketsSnap = await db.ref('tickets').once('value');
    const ticketsObj = ticketsSnap.exists() ? ticketsSnap.val() : {};
    const [slaConfigsSnap, tiposSnap, subcatsSnap, slaSubcatsSnap] = await Promise.all([
      db.ref('sla/configs').once('value'),
      db.ref('tiposTickets').once('value'),
      db.ref('subcategoriasTickets').once('value'),
      db.ref('sla/subcategorias').once('value'),
    ]);
    const slaConfigs = slaConfigsSnap.exists() ? slaConfigsSnap.val() : {};
    const tiposTickets = tiposSnap.exists() ? tiposSnap.val() : {};
    const subcatsTickets = subcatsSnap.exists() ? subcatsSnap.val() : {};
    const slaSubcats = slaSubcatsSnap.exists() ? slaSubcatsSnap.val() : {};
    const now = new Date();
    const token = await getGraphToken();
    const client = graphClient(token);
    const senderId = await resolveUserId(client, cfg.msgraph?.sender);

    const sendPromises = [];
    for (const [id, t] of Object.entries(ticketsObj)) {
      try {
        const ticket = { id, ...t };
        // Saltar si ya cerrado
        if (ticket.estado === 'Cerrado' || ticket.estado === 'Resuelto' || ticket.estado === 'Finalizado') continue;
        // Saltar si ya se envió advertencia
        if (ticket.slaWarningSentAt) continue;
        const created = parseTimestampCandidate(ticket);
        if (!created) continue;
        const closed = parseClosedTimestamp(ticket);
        const end = closed || now;
        const elapsed = hoursBetween(created, end);
        if (elapsed == null) continue;
        const priority = ticket.prioridad || 'Media';
        // intentar SLA por subcategoría
        let slaHours = null;
        try {
          const tiposForDept = (tiposTickets && tiposTickets[ticket.departamento]) || {};
          const tipoEntry = Object.entries(tiposForDept).find(([, nombre]) => nombre === ticket.tipo);
          const tipoId = tipoEntry ? tipoEntry[0] : null;
          if (tipoId && subcatsTickets && subcatsTickets[ticket.departamento] && subcatsTickets[ticket.departamento][tipoId]) {
            const subEntries = Object.entries(subcatsTickets[ticket.departamento][tipoId]);
            const found = subEntries.find(([, nombre]) => nombre === ticket.subcategoria);
            const subId = found ? found[0] : null;
            if (subId && slaSubcats && slaSubcats[ticket.departamento] && slaSubcats[ticket.departamento][tipoId] && slaSubcats[ticket.departamento][tipoId][subId] != null) {
              slaHours = Number(slaSubcats[ticket.departamento][tipoId][subId]) || null;
            }
          }
        } catch {
          // ignore
        }
        if (slaHours == null) {
          const deptConfig = (slaConfigs && slaConfigs[ticket.departamento]) || {};
          slaHours = deptConfig[priority] ?? DEFAULT_SLA[priority] ?? 72;
        }
        const remaining = slaHours - elapsed;
        // Si quedan <=12h y >0 -> enviar advertencia
        if (remaining <= 12 && remaining > 0) {
          console.log(`Ticket ${id} tiene ${remaining.toFixed(2)}h restantes (SLA ${slaHours}h) — enviando advertencia`);
          // construir HTML con header y logo, no mostrar ID en el cuerpo ni en el subject
          const sanitize = s => String(s || '').replace(/</g,'&lt;');
          const subject = `Aviso: SLA en riesgo — ${sanitize(ticket.tipo)}`;
          const base = BASE_URL ? BASE_URL.replace(/\/$/, '') : '';
          const ticketUrl = base ? `${base}/tickets/${encodeURIComponent(id)}` : '';
          const headerColor = (cfg.branding && cfg.branding.header_color) || '#rgb(244, 191, 127)';
          const logoUrl = (cfg.branding && cfg.branding.logo_url) || 'https://costaricacc.com/cccr/Logoheroica.png';
          const isLightHex = (hex) => { try { const h = String(hex||'').replace('#',''); const r = parseInt(h.substring(0,2),16); const g = parseInt(h.substring(2,4),16); const b = parseInt(h.substring(4,6),16); const brightness = (r * 299 + g * 587 + b * 114) / 1000; return brightness > 155; } catch { return false; } };
          const stateColor = '#f39c12';
          
          // Obtener nombre del departamento
          const departmentName = await getDepartmentName(ticket.departamento);
          
          const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Aviso SLA</title></head><body style="margin:0;padding:0;font-family:Segoe UI,Roboto,Arial,sans-serif;background:#f6f7f9;color:#222"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:20px 0"><tr><td align="center"><table role="presentation" width="640" style="width:640px;max-width:640px;background:#fff;border:1px solid #e6e9ec;border-radius:10px;overflow:hidden"><tr><td style="padding:14px 20px;background:${headerColor};display:flex;align-items:center;gap:12px"><img src="${logoUrl}" alt="Corporativo" style="height:38px;display:block;max-width:220px"/><span style="margin-left:auto;background:${stateColor};color:${isLightHex(headerColor)?'#000':'#fff'};font-size:12px;font-weight:600;padding:6px 12px;border-radius:14px">${sanitize(ticket.estado)}</span></td></tr><tr><td style="padding:24px 28px"><h2 style="margin:0 0 8px;font-size:16px">Aviso: SLA en riesgo</h2><p style="margin:0 0 12px;color:#556">El ticket <strong>${sanitize(ticket.tipo)}</strong> del departamento <strong>${sanitize(departmentName)}</strong> tiene aproximadamente <strong>${Math.round(remaining)} horas</strong> restantes antes de incumplir el SLA (objetivo: ${slaHours} horas).</p><p style="margin:0 0 12px">Estado actual: ${sanitize(ticket.estado)} — Prioridad: ${sanitize(priority)}</p>${ticketUrl?`<p style="margin:12px 0"><a href="${ticketUrl}" style="background:#273c2a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Ver ticket</a></p>`:''}<p style="margin:14px 0 0;font-size:12px;color:#889">Este es un mensaje automático del sistema de notificaciones.</p></td></tr></table></td></tr></table></body></html>`;
          // recopilar destinatarios incluyendo usuarios asignados
          // Normalizar asignados de todos los formatos posibles
          let asignados = [];
          if (Array.isArray(ticket.asignados)) {
            asignados = ticket.asignados;
          } else if (ticket.asignadoEmail) {
            asignados = [ticket.asignadoEmail];
          } else if (ticket.asignadoA) {
            asignados = [ticket.asignadoA];
          } else if (ticket.asignado) {
            if (Array.isArray(ticket.asignado)) {
              asignados = ticket.asignado;
            } else {
              asignados = [ticket.asignado];
            }
          }
          const recipients = await collectRecipients(ticket.departamento, ticket.usuarioEmail, null, asignados);
          if (!recipients.length) {
            console.warn('No recipients for ticket', id);
            continue;
          }
          const mail = buildGraphMail(subject, html, recipients);
          // enviar
          sendPromises.push((async () => {
            await client.api(`/users/${senderId}/sendMail`).post(mail);

            // Enviar notificación push también
            const pushBody = `El ticket "${ticket.tipo}" tiene aproximadamente ${Math.round(remaining)} horas restantes antes de incumplir el SLA.`;
            const pushData = { ticketId: String(id), type: 'SLA_WARNING', click_action: `/tickets/${id}` };
            await sendPushToUsers(recipients, 'Aviso: SLA en riesgo', pushBody, pushData).catch(e => console.error('Error push sla:', e));

            // marcar ticket
            await db.ref(`tickets/${id}/slaWarningSentAt`).set(Date.now());
            console.log('Advertencia enviada para ticket', id);
          })());
        }
      } catch (e) {
        console.error('Error procesando ticket', id, e.message);
      }
    }
    await Promise.all(sendPromises);
    console.log('SLA Warning scheduler finished');
    return null;
  } catch (err) {
    console.error('slaWarningScheduler error', err);
    return null;
  }
});


export const skillApiProxy = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, idData, companyAuthId');
    return res.status(204).send('');
  }

  try {
    // El path viene después de /skill-api/ debido al rewrite en firebase.json
    // Por ejemplo: /skill-api/authenticate -> req.path será /authenticate
    const targetPath = req.path.replace(/^\/skill-api/, '') || '/';
    const SKILL_BASE_URL = 'https://grupoheroicaapi.skillsuite.net/app/wssuite/api';
    const targetUrl = `${SKILL_BASE_URL}${targetPath}`;

    const headers = {
      'Content-Type': 'application/json'
    };
    
    // Pasar headers específicos de Skill si vienen en la petición (normalizar a minúsculas para seguridad)
    const authHeader = req.headers['authorization'];
    const idDataHeader = req.headers['iddata'];
    const companyAuthIdHeader = req.headers['companyauthid'];

    if (authHeader) headers['Authorization'] = authHeader;
    if (idDataHeader) headers['idData'] = idDataHeader;
    if (companyAuthIdHeader) headers['companyAuthId'] = companyAuthIdHeader;

    console.log(`Proxying ${req.method} to ${targetUrl} with headersKeys:`, Object.keys(headers));

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
    });

    const contentType = response.headers.get('content-type');
    const status = response.status;

    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(status).json(data);
    } else {
      const text = await response.text();
      return res.status(status).send(text);
    }
  } catch (error) {
    console.error('SkillProxy Error:', error);
    return res.status(500).send(error.message);
  }
});



