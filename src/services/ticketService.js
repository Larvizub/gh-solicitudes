import { ref as dbRef, runTransaction, get } from 'firebase/database';
import { getDbForRecinto } from '../firebase/multiDb';
import { getSlaHours } from '../utils/slaCalculator';
import { sendTicketMail } from './mailService';
import { generateTicketEmailHTML, buildSendMailPayload } from '../utils/ticketEmailTemplate';

export async function markTicketAsInProcess({ recinto, ticketId, actorUser }) {
  if (!ticketId) throw new Error('ticketId requerido');
  const db = await getDbForRecinto(recinto || (typeof localStorage !== 'undefined' && localStorage.getItem('selectedRecinto')) || 'GRUPO_HEROICA');
  const ticketRef = dbRef(db, `tickets/${ticketId}`);

  const res = await runTransaction(ticketRef, (current) => {
    if (!current) return current;
    const estadoActual = (current.estado || 'Abierto');
    if (estadoActual === 'En Proceso' || estadoActual === 'Cerrado') return current;

    current.estado = 'En Proceso';
    current.startedAt = Date.now();
    current.startedBy = actorUser?.uid || actorUser?.email || 'unknown';
    return current;
  }, { applyLocally: false });

  if (!res.committed) {
    return { changed: false };
  }

  const newVal = res.snapshot.val();

  try {
    const originalDept = newVal.departamento || null;
    let departamento = originalDept;
    let departamentoNombre = newVal.departamentoNombre || null;
    let departamentoIdForLookup = null;
    if (typeof originalDept === 'string' && originalDept) {
      const parts = originalDept.split('/').filter(Boolean);
      departamentoIdForLookup = parts.length ? parts[parts.length - 1] : originalDept;
    } else {
      departamentoIdForLookup = originalDept;
    }
    if (!departamentoNombre && departamentoIdForLookup) {
      try {
        const depSnap = await get(dbRef(db, `departamentos/${departamentoIdForLookup}`));
        if (depSnap && depSnap.exists()) {
          const depVal = depSnap.val();
          departamentoNombre = (typeof depVal === 'string') ? depVal : (depVal.nombre || depVal.name || departamentoIdForLookup);
        }
      } catch { /* ignore */ }
    }

    const ticketForHtml = {
      ...newVal,
      ticketId,
      _departamentoId: departamentoIdForLookup,
      departamento: departamentoNombre || departamentoIdForLookup || departamento,
      departamentoNombre: departamentoNombre || departamentoIdForLookup || departamento
    };

    try {
      const dbSlaConfigs = await get(dbRef(db, 'sla/configs')).then(s => s.exists() ? s.val() : {}).catch(() => ({}));
      const dbSlaSubcats = await get(dbRef(db, 'sla/subcategorias')).then(s => s.exists() ? s.val() : {}).catch(() => ({}));
      const dbTipos = await get(dbRef(db, 'tiposTickets')).then(s => s.exists() ? s.val() : {}).catch(() => ({}));
      const dbSubcats = await get(dbRef(db, 'subcategoriasTickets')).then(s => s.exists() ? s.val() : {}).catch(() => ({}));
      const slaHours = getSlaHours(ticketForHtml, dbSlaConfigs, dbSlaSubcats, dbTipos, dbSubcats);
      if (slaHours != null) ticketForHtml.slaHours = slaHours;
    } catch { /* ignore sla fetch errors */ }
    const baseUrl = (typeof window !== 'undefined' && window.location ? window.location.origin : '');
    const html = generateTicketEmailHTML({ ticket: ticketForHtml, baseUrl, extraMessage: `El ticket ha sido iniciado por ${actorUser?.email || actorUser?.uid || 'un usuario'}` });

    const toSet = new Set();
    if (newVal.usuarioEmail) toSet.add(String(newVal.usuarioEmail).toLowerCase());
    if (Array.isArray(newVal.to)) {
      newVal.to.forEach(t => { if (t && String(t).includes('@')) toSet.add(String(t).toLowerCase()); });
    }
    if (Array.isArray(newVal.asignadoEmails)) newVal.asignadoEmails.forEach(e => e && e.includes('@') && toSet.add(String(e).toLowerCase()));
    if (newVal.asignadoEmail && String(newVal.asignadoEmail).includes('@')) toSet.add(String(newVal.asignadoEmail).toLowerCase());
    if (newVal.asignadoA && typeof newVal.asignadoA === 'string' && !newVal.asignadoA.includes('@')) {
      try {
        const snap = await get(dbRef(db, `usuarios/${newVal.asignadoA}`));
        if (snap && snap.exists()) {
          const u = snap.val(); if (u && u.email) toSet.add(String(u.email).toLowerCase());
        }
      } catch { /* ignore */ }
    } else if (newVal.asignadoA && String(newVal.asignadoA).includes('@')) {
      toSet.add(String(newVal.asignadoA).toLowerCase());
    }
    if (newVal.asignado && Array.isArray(newVal.asignado)) newVal.asignado.forEach(a => a && String(a).includes('@') && toSet.add(String(a).toLowerCase()));
    if (newVal.asignado && typeof newVal.asignado === 'string' && newVal.asignado.includes('@')) toSet.add(String(newVal.asignado).toLowerCase());

    if (Array.isArray(newVal.asignados) && newVal.asignados.length) {
      const lookups = newVal.asignados.map(async (a) => {
        if (!a) return null;
        if (typeof a === 'string') {
          if (a.includes('@')) return String(a).toLowerCase();
          try {
            const snap = await get(dbRef(db, `usuarios/${a}`));
            if (snap && snap.exists()) {
              const u = snap.val();
              if (u && u.email) return String(u.email).toLowerCase();
            }
          } catch { /* ignore */ }
          return null;
        }
        if (typeof a === 'object') {
          if (a.email && /@/.test(a.email)) return String(a.email).toLowerCase();
          if (a.id) {
            try {
              const snap = await get(dbRef(db, `usuarios/${a.id}`));
              if (snap && snap.exists()) {
                const u = snap.val();
                if (u && u.email) return String(u.email).toLowerCase();
              }
            } catch { /* ignore */ }
          }
        }
        return null;
      });
      const resolved = await Promise.all(lookups);
      resolved.forEach(r => { if (r) toSet.add(r); });
    }

    const explicitTo = Array.from(toSet);

    try {
      console.warn('markTicketAsInProcess: destinatarios resueltos ->', { explicitTo, usuarioEmail: newVal.usuarioEmail, toField: newVal.to, asignadosField: newVal.asignados, asignadoEmails: newVal.asignadoEmails, asignadoEmail: newVal.asignadoEmail, asignado: newVal.asignado, asignadoA: newVal.asignadoA });
    } catch { /* ignore */ }

    let tipoDisplay = ticketForHtml.tipo || '';
    try {
      const tiposMap = await get(dbRef(db, 'tiposTickets')).then(s => s.exists() ? s.val() : {}).catch(() => ({}));
      if (tiposMap && typeof tiposMap === 'object') {
        if (typeof tiposMap[tipoDisplay] === 'string') {
          tipoDisplay = tiposMap[tipoDisplay];
        } else {
          for (const k of Object.keys(tiposMap)) {
            const v = tiposMap[k];
            if (!v) continue;
            if (typeof v === 'string') {
              if (k === ticketForHtml.tipo) { tipoDisplay = v; break; }
            } else if (typeof v === 'object') {
              if (v[ticketForHtml.tipo]) { tipoDisplay = v[ticketForHtml.tipo]; break; }
            }
          }
        }
      }
    } catch { /* ignore */ }

    let ticketLabel = ticketForHtml.codigo || null;
    if (!ticketLabel && typeof ticketId === 'string') {
      ticketLabel = ticketId.length > 8 ? `#${ticketId.slice(-6)}` : `#${ticketId}`;
    }
    const subject = `[Ticket ${ticketForHtml.estado || 'En Proceso'}] ${tipoDisplay} ${ticketLabel ? ` ${ticketLabel}` : ''}`;

    const payload = buildSendMailPayload({
      ticket: { ...ticketForHtml, to: explicitTo, asignados: newVal.asignados || [] },
      departamento,
      departamentoNombre,
      htmlOverride: html,
      subject,
      actionMsg: `El ticket ha sido iniciado por ${actorUser?.email || actorUser?.uid || 'un usuario'}`
    });

    sendTicketMail(payload).catch(err => console.warn('markTicketAsInProcess: fallo enviando mail', err));
  } catch (e) {
    console.warn('markTicketAsInProcess: fallo preparando payload', e);
  }

  return { changed: true, ticket: newVal };
}

export default { markTicketAsInProcess };