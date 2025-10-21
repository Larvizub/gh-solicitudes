// Generador de HTML para correos de tickets.
// Se usa en el frontend y se pasa como campo `html` al endpoint sendMail.
// Así puedes iterar el diseño sin redeploy de la Cloud Function.

/**
 * @param {Object} options
 * @param {Object} options.ticket - Datos del ticket
 * @param {string} options.baseUrl - URL base de la app (ej: https://gh-solicitudes.web.app)
 * @param {Object} [options.branding] - Overrides de branding
 * @param {string} [options.extraMessage] - Texto adicional
 * @returns {string} HTML listo para enviar
 */
export function generateTicketEmailHTML({ ticket, baseUrl, branding = {}, extraMessage }) {
  const {
    ticketId,
    departamento,
    departamentoNombre,
    tipo,
    estado,
    subcategoria,
  // prioridad (no mostrado; sustituido por Vencimiento)
    descripcion,
    usuarioEmail,
    usuario,
    asignadoA,
  } = ticket;

  const primary = branding.primaryColor || '#273c2a';
  const bg = branding.background || '#f5f6f8';
  const surface = '#ffffff';
  const divider = branding.divider || '#e3e7eb';
  const textMain = branding.textMain || '#1f2933';
  const textMuted = branding.textMuted || '#5d6b76';
  // color para mensajes cuando el ticket está pausado
  const pausedMessageBg = branding.pausedMessageBg || '#fff3e0';
  const pausedMessageBorder = branding.pausedMessageBorder || '#ffd7a8';
  const logo = branding.logoUrl || 'https://costaricacc.com/cccr/Logoheroica.png';
  const company = branding.company || 'GH Solicitudes';
  const footerNote = branding.footerNote || 'Mensaje automático generado por GH Solicitudes';
  const headerColor = branding.headerColor || 'rgb(244, 191, 127)';

  // helper simple para calcular si un color hex es claro
  const isLightHex = (hex) => {
    try {
      const h = hex.replace('#','');
      const r = parseInt(h.substring(0,2),16);
      const g = parseInt(h.substring(2,4),16);
      const b = parseInt(h.substring(4,6),16);
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      return brightness > 155;
    } catch { return false; }
  };

  const stateColor = (s => ({ Nuevo: primary, 'En Proceso':'#1565c0', Cerrado:'#2e7d32', Resuelto:'#2e7d32', Finalizado:'#2e7d32' }[s] || primary))(estado);

  // calcular texto de vencimiento (horas hábiles) a partir de campos comunes en ticket
  const computeVencimientoText = () => {
    // Prioridad: slaHoursExplicit (valor original configurado) > slaHours (derivado) > otras variantes históricas
    const candidates = [
      ticket.slaHoursExplicit,
      ticket.slaHoursOriginal,
      ticket.slaHours,
      ticket.slaHoras,
      ticket.subcategoriaHoras,
      ticket.subcategoriaTiempo,
      ticket.subcategoriaSlaHours
    ];
    const found = candidates.find(v => v !== undefined && v !== null && String(v).trim() !== '');
    if (found === undefined) return 'El Ticket tiene un tiempo de -- horas habiles asignadas';
    // si es numérico (aceptar 0 como válido aunque sea raro)
    const n = Number(found);
    if (!isNaN(n)) return `El Ticket tiene un tiempo de ${n} horas habiles asignadas`;
    return `El Ticket tiene un tiempo de ${String(found)} horas habiles asignadas`;
  };
  const vencimientoText = computeVencimientoText();

  const sanitize = (str='') => String(str).replace(/</g,'&lt;');

  return `<!DOCTYPE html><!-- gh-solicitudes-email-v2 -->\n<html lang='es'><head><meta charset='utf-8'/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="x-gh-template-version" content="v2" />
  <title>Actualización de ticket</title>
  <style>@media (max-width:640px){.container{width:100%!important;border-radius:0!important;} .pad{padding:20px!important;}}</style>
  </head>
  <body style="margin:0;padding:0;background:${bg};font-family:Segoe UI,Roboto,Arial,sans-serif;color:${textMain};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" class="container" width="640" style="width:640px;max-width:640px;background:${surface};border:1px solid ${divider};border-radius:10px;overflow:hidden;">
          <tr><td style="padding:14px 20px;background:${headerColor};display:flex;align-items:center;gap:16px;">
            <img src="${logo}" alt="${company}" style="height:38px;display:block;max-width:200px;" />
            <span style="margin-left:auto;background:${stateColor};color:${isLightHex(headerColor)?'#000':'#fff'};font-size:12px;font-weight:600;padding:6px 12px;border-radius:16px;">${sanitize(estado)}</span>
          </td></tr>
          <tr><td class="pad" style="padding:26px 32px 24px;">
            <h1 style="margin:0 0 6px;font-size:18px;font-weight:600;">${sanitize(tipo)}</h1>
            <p style="margin:0 0 20px;font-size:13px;color:${textMuted};">Actualización del ticket (${sanitize(estado)}).</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${divider};border-radius:6px;border-collapse:collapse;margin:0 0 18px;">
              ${row('Departamento', departamentoNombre || departamento)}
              ${row('Subcategoría', subcategoria)}
              ${row('Vencimiento', vencimientoText)}
              ${row('Estado', estado, stateColor)}
              ${asignadoA ? row('Asignado a', asignadoA) : ''}
            </table>
            ${(() => {
              // Si el ticket está pausado, usar colores distintos para el cuadro de mensaje
              const isPaused = String(estado || '').toLowerCase() === 'pausado';
              // (nota: solo el bloque de comentario cambia cuando está pausado)
              return `
              <div style="border:1px solid ${divider};background:${bg};padding:14px 16px;border-radius:6px;font-size:13px;line-height:1.5;white-space:pre-wrap;">${sanitize(descripcion)}</div>

              ${ticket && ticket.latestComment ? (() => {
                try {
                  const c = ticket.latestComment || {};
                  const author = c.authorName || c.author || c.authorEmail || 'Usuario';
                  const commentText = c.text || c.comment || c.body || '';
                  // El bloque de comentario usa el estilo pausado cuando corresponde
                  const commentBorder = isPaused ? pausedMessageBorder : divider;
                  const commentBg = isPaused ? pausedMessageBg : bg;
                  return `
                  <div style="margin-top:12px;font-size:13px;color:${textMuted};font-weight:600;">Nuevo comentario por ${sanitize(author)}</div>
                  <div style="border:1px solid ${commentBorder};background:${commentBg};padding:14px 16px;border-radius:6px;font-size:13px;line-height:1.5;white-space:pre-wrap;margin-top:8px;">${sanitize(commentText)}</div>
                  `;
                } catch { return ''; }
              })() : ''}
              `;
            })()}

            ${extraMessage ? `<div style="margin:16px 0 0;font-size:12px;color:${textMuted};">${sanitize(extraMessage)}</div>`:''}
            <p style="margin:18px 0 0;font-size:12px;color:${textMuted};">Creado por: ${sanitize(usuario||usuarioEmail||'Usuario')}</p>
            <p style="margin:22px 0 4px;"><a href="${baseUrl}/tickets/${encodeURIComponent(ticketId)}" style="background:${primary};color:#fff;text-decoration:none;font-size:13px;padding:10px 20px;border-radius:6px;font-weight:600;display:inline-block;">Ver Ticket</a></p>
            <p style="margin:18px 0 0;font-size:10px;color:${textMuted};">${sanitize(footerNote)}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;

  function row(label, value, badgeColor) {
    if (!value) value = '';
  const content = badgeColor ? `<span style="background:${badgeColor};color:#fff;font-size:11px;font-weight:600;padding:3px 10px;border-radius:14px;">${sanitize(value)}</span>` : sanitize(value);
    return `<tr>
  <td style="padding:6px 12px;font-size:12px;font-weight:600;color:${textMuted};width:120px;border-bottom:1px solid ${divider};">${sanitize(label)}</td>
  <td style="padding:6px 12px;font-size:12px;color:${textMain};border-bottom:1px solid ${divider};">${content}</td>
    </tr>`;
  }
}

export function buildSendMailPayload({ ticket, departamento, departamentoNombre, htmlOverride, subject, actionMsg, cc }) {
  // Resolver nombre amigable de departamento si no se proporcionó explícitamente
  let resolvedDepName = departamentoNombre || ticket.departamentoNombre;
  const depId = departamento || ticket.departamento;
  if (!resolvedDepName && depId) {
    // Heurística: si hay un mapa en ticket.departamentosMap
    if (ticket.departamentosMap && ticket.departamentosMap[depId]) {
      resolvedDepName = ticket.departamentosMap[depId].nombre || ticket.departamentosMap[depId].name || ticket.departamentosMap[depId];
    }
    // O si hay un array ticket.departamentos
    if (!resolvedDepName && Array.isArray(ticket.departamentos)) {
      const found = ticket.departamentos.find(d => d.id === depId || d.key === depId);
      if (found) resolvedDepName = found.nombre || found.name || found.label || depId;
    }
    // Quitar prefijos tipo '/departamentos/' si aparecen
    if (!resolvedDepName && typeof depId === 'string') {
      const parts = depId.split('/').filter(Boolean);
      const last = parts[parts.length - 1];
      resolvedDepName = last || depId;
    }
  }
  return {
    ticketId: ticket.ticketId,
    departamento: depId,
    departamentoNombre: resolvedDepName || depId,
    tipo: ticket.tipo,
    estado: ticket.estado,
    descripcion: ticket.descripcion,
    usuarioEmail: ticket.usuarioEmail,
    subject,
    actionMsg,
    html: htmlOverride,
    to: ticket.to || [],
    cc: cc || []
  };
}

/**
 * Genera un bloque html extra para motivos/comentarios (pausa/reanudación)
 * type: 'pause' | 'resume'
 */
export function generateTicketExtraBlock({ type = 'pause', motivo = '', comentario = '', duracion = '', branding = {} }) {
  const pausedBg = branding.pausedMessageBg || '#fff7e6';
  const pausedBorder = branding.pausedMessageBorder || '#ff9800';
  // Forzar que la reanudación use el mismo diseño que la pausa para mantener coherencia visual.
  // Si en el futuro se desea diferenciar, se puede usar branding.resumeMessageBg / resumeMessageBorder.
  // Usar el estilo de pausa tanto para 'pause' como para 'resume' (coherencia solicitada)
  const bg = pausedBg;
  const border = pausedBorder;
  const sanitize = (s='') => String(s).replace(/</g,'&lt;');
  const motivoHtml = motivo ? `<strong>Motivo:</strong> ${sanitize(motivo)}<br/>` : '';
  const durHtml = duracion ? `<strong>Duración de la pausa:</strong> ${sanitize(duracion)}<br/>` : '';
  const comentarioHtml = comentario ? `<strong>Comentario${type==='resume'?' de pausa':''}:</strong><p style="white-space:pre-wrap">${sanitize(comentario)}</p>` : '';
  return `\n<div style="margin-top:16px;padding:12px;border-left:4px solid ${border};background:${bg}">` +
    `${motivoHtml}${comentarioHtml}${durHtml}` +
    `</div>`;
}
