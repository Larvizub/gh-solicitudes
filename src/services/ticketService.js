import { ref as dbRef, runTransaction } from 'firebase/database';
import { getDbForRecinto } from '../firebase/multiDb';
import { sendTicketMail } from './mailService';

// Marcar ticket como 'En Proceso' de forma segura (transactional) y enviar notificación por correo
export async function markTicketAsInProcess({ recinto, ticketId, actorUser }) {
  if (!ticketId) throw new Error('ticketId requerido');
  const db = await getDbForRecinto(recinto || (typeof localStorage !== 'undefined' && localStorage.getItem('selectedRecinto')) || 'GRUPO_HEROICA');
  const ticketRef = dbRef(db, `tickets/${ticketId}`);

  // Usar runTransaction para evitar sobreescrituras/concurrencia
  const res = await runTransaction(ticketRef, (current) => {
    if (!current) return current; // si no existe, nada que hacer
    // Si ya está en Proceso o Cerrado, no cambiar
    const estadoActual = (current.estado || 'Abierto');
    if (estadoActual === 'En Proceso' || estadoActual === 'Cerrado') return current;

    // Setear campos de inicio
    current.estado = 'En Proceso';
    current.startedAt = Date.now();
    current.startedBy = actorUser?.uid || actorUser?.email || 'unknown';
    return current;
  }, { applyLocally: false });

  if (!res.committed) {
    // no se cambió (quizá ya estaba En Proceso)
    return { changed: false };
  }

  const newVal = res.snapshot.val();

  // Preparar payload de email
  try {
    const payload = {
      ticket: {
        ticketId: ticketId,
        tipo: newVal.tipo,
        estado: newVal.estado,
        descripcion: newVal.descripcion,
        usuarioEmail: newVal.usuarioEmail,
      },
      subject: `Ticket ${ticketId} - En Proceso`,
      actionMsg: `El ticket ha sido iniciado por ${actorUser?.email || actorUser?.uid || 'un usuario'}`,
    };
    // Llamada asíncrona, no bloquear si falla el mail
    sendTicketMail(payload).catch(err => console.warn('markTicketAsInProcess: fallo enviando mail', err));
  } catch (e) {
    console.warn('markTicketAsInProcess: fallo preparando payload', e);
  }

  return { changed: true, ticket: newVal };
}

export default { markTicketAsInProcess };