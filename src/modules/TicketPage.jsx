import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Typography, Button, TextField, MenuItem, Alert, Paper, Chip, Autocomplete, Snackbar, Tooltip, IconButton, Divider } from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import UpdateIcon from '@mui/icons-material/Update';
import { ref as dbRef, get, set, update, push, runTransaction } from 'firebase/database';
import { storage } from '../firebase/firebaseConfig';
import { getDbForRecinto } from '../firebase/multiDb';
import { useDb } from '../context/DbContext';
import { useAuth } from '../context/useAuth';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import workingMsBetween from '../utils/businessHours';
import { msToHoursMinutes } from '../utils/formatDuration';
import { generateTicketEmailHTML, buildSendMailPayload } from '../utils/ticketEmailTemplate';
import { sendTicketMail } from '../services/mailService';

function padNum(n, len = 4) {
  return String(n).padStart(len, '0');
}

// escapar texto para incrustar en HTML
function escapeHtml(str) {
  if (!str && str !== '') return '';
  return String(str).replace(/[&<>"']/g, function (s) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s];
  });
}

export default function TicketPage() {
  const { id } = useParams();
  const isNew = id === 'new' || !id;
  const navigate = useNavigate();
  const { user, userData } = useAuth();
  const { db: ctxDb, recinto, loading: dbLoading, tiposTickets: tiposFromCtx, subcategoriasTickets: subcatsFromCtx } = useDb();

  const [departamentos, setDepartamentos] = useState([]);
  const [tipos, setTipos] = useState({});
  const [subcats, setSubcats] = useState({});
  const [usuarios, setUsuarios] = useState([]);
  const [error, setError] = useState('');
  const [adjunto, setAdjunto] = useState(null);
  const [commentsArr, setCommentsArr] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [newCommentFile, setNewCommentFile] = useState(null);
  const [commentLoading, setCommentLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  // Estado para bloquear edición y evitar duplicados durante guardado
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false); // para mostrar ENVIADO tras guardar
  // Modo de reasignación (permitir a usuario asignado cambiar asignados y subcategoría)
  const [reassignMode, setReassignMode] = useState(false);

  const [form, setForm] = useState({
  departamento: '', tipo: '', subcategoria: '', descripcion: '', estado: 'Abierto', usuario: '', usuarioEmail: '', adjuntoUrl: '', adjuntoNombre: '', asignados: [],
  });

  // Pausa / reanudar control
  const [pausesArr, setPausesArr] = useState([]); // array de las pausas
  const [lastPauseKey, setLastPauseKey] = useState(null);
  const [isPausedState, setIsPausedState] = useState(false);
  const [ticketKey, setTicketKey] = useState(null); // actual firebase key for the ticket (may differ from URL id)
  const [pauseReasonId, setPauseReasonId] = useState('');
  const [pauseComment, setPauseComment] = useState('');
  const [pauseLoading, setPauseLoading] = useState(false);
  const [pauseReasons, setPauseReasons] = useState([]);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  // Flag para recordar si el usuario estaba originalmente asignado al cargar el ticket
  const [wasOriginallyAssigned, setWasOriginallyAssigned] = useState(false);

  const isAdmin = (userData?.isSuperAdmin || userData?.rol === 'admin');

  // helper to check whether the current user is one of the assignees (compat across shapes)
  function matchesAssignToUser(ticket, userObj) {
    if (!ticket || !userObj) return false;
    const uid = userObj.uid || '';
    const email = (userObj.email || '').toLowerCase();
    if (ticket.asignadoA && ticket.asignadoA === uid) return true;
    if (ticket.asignadoEmail && (ticket.asignadoEmail || '').toLowerCase() === email) return true;
    if (Array.isArray(ticket.asignados)) {
      if (ticket.asignados.includes(uid)) return true;
      if (ticket.asignados.some(a => (a?.id === uid) || ((a?.email || '').toLowerCase() === email))) return true;
      if (ticket.asignados.map(a => (typeof a === 'string' ? a.toLowerCase() : (a?.email || '').toLowerCase())).includes(email)) return true;
    }
    if (Array.isArray(ticket.asignado)) return ticket.asignado.includes(uid) || ticket.asignado.map(a => (a || '').toLowerCase()).includes(email);
    if (typeof ticket.asignado === 'string') return (ticket.asignado === uid) || ((ticket.asignado || '').toLowerCase() === email);
    return false;
  }

  useEffect(() => {
    const load = async () => {
      if (dbLoading && !ctxDb) return;
      try {
        const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
        // departamentos
        const depSnap = await get(dbRef(dbInstance, 'departamentos'));
  const depsArr = depSnap.exists() ? Object.entries(depSnap.val()).map(([id, nombre]) => ({ id, nombre })) : [];
  depsArr.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));
  setDepartamentos(depsArr);
        // tipos y subcats: preferir contexto global si disponible
        if (tiposFromCtx && Object.keys(tiposFromCtx).length) setTipos(tiposFromCtx);
        else {
          const tiposSnap = await get(dbRef(dbInstance, 'tiposTickets'));
          setTipos(tiposSnap.exists() ? tiposSnap.val() : {});
        }
        if (subcatsFromCtx && Object.keys(subcatsFromCtx).length) setSubcats(subcatsFromCtx);
        else {
          const subSnap = await get(dbRef(dbInstance, 'subcategoriasTickets'));
          setSubcats(subSnap.exists() ? subSnap.val() : {});
        }
        // usuarios
        try {
          const usersSnap = await get(dbRef(dbInstance, 'usuarios'));
          setUsuarios(usersSnap.exists() ? Object.entries(usersSnap.val()).map(([id, u]) => ({ id, ...u })) : []);
        } catch (err) {
          console.warn('Error cargando usuarios', err);
          setUsuarios([]);
        }

        if (!isNew) {
          // Try to read by firebase key first
          let ticketSnap = await get(dbRef(dbInstance, `tickets/${id}`));
          let foundKey = id;
          if (!ticketSnap.exists()) {
            // fallback: search by codigo field
            const allTicketsSnap = await get(dbRef(dbInstance, 'tickets'));
            if (allTicketsSnap.exists()) {
              const all = allTicketsSnap.val();
              for (const k of Object.keys(all)) {
                const v = all[k];
                if (v && v.codigo && String(v.codigo) === String(id)) { foundKey = k; ticketSnap = { val: () => v, exists: () => true }; break; }
              }
            }
          }
          if (ticketSnap && ticketSnap.exists()) {
            setTicketKey(foundKey);
            const t = { id: foundKey, ...ticketSnap.val() };
            // normalize asignados
            if (!t.asignados && (t.asignadoA || t.asignadoEmail || t.asignado)) {
              const arr = [];
              if (t.asignadoA) arr.push(t.asignadoA);
              if (t.asignadoEmail) arr.push(t.asignadoEmail);
              if (t.asignado && Array.isArray(t.asignado)) arr.push(...t.asignado);
              t.asignados = arr;
            }
            // load pauses structure if any
            if (t.pauses) {
              const keys = Object.keys(t.pauses || {});
              const arr = keys.map(k => ({ key: k, ...t.pauses[k] }));
              setPausesArr(arr.sort((a,b) => (a.start || 0) - (b.start || 0)));
              const lastKey = keys.length ? keys[keys.length - 1] : null;
              setLastPauseKey(lastKey);
              const last = lastKey ? t.pauses[lastKey] : null;
              setIsPausedState(last && !last.end);
            } else {
              setPausesArr([]);
              setLastPauseKey(null);
              setIsPausedState(false);
            }

            setForm({
              departamento: t.departamento || '', tipo: t.tipo || '', subcategoria: t.subcategoria || '', descripcion: t.descripcion || '', estado: t.estado || 'Abierto', usuario: t.usuario || '', usuarioEmail: t.usuarioEmail || '', adjuntoUrl: t.adjuntoUrl || '', adjuntoNombre: t.adjuntoNombre || '', asignados: t.asignados || [], codigo: t.codigo || '',
            });
            // Guardar si el usuario estaba asignado originalmente (permite quitarse y aún guardar en la misma sesión de reasignación)
            try { setWasOriginallyAssigned(matchesAssignToUser(t, user)); } catch { /* ignore */ }
            // load comments if any (object -> array sorted asc)
            if (t.comments) {
              try {
                const cArr = Object.entries(t.comments).map(([k,v]) => ({ key: k, ...v }));
                cArr.sort((a,b) => (Number(a.createdAt || 0) - Number(b.createdAt || 0)));
                setCommentsArr(cArr);
              } catch { setCommentsArr([]); }
            } else {
              setCommentsArr([]);
            }
          } else {
            setError('Ticket no encontrado');
          }
        } else {
          setForm(f => ({ ...f, usuario: userData?.nombre ? `${userData.nombre} ${userData.apellido || ''}`.trim() : (user?.email || ''), usuarioEmail: user?.email || '' }));
          setCommentsArr([]);
        }
      } catch (e) {
        console.error(e);
        setError('Error cargando datos');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isNew, ctxDb, recinto, dbLoading, user, userData, tiposFromCtx, subcatsFromCtx]); // incluye user para recalcular wasOriginallyAssigned si cambia sesión

  // cargar motivos de pausa cuando cambia el departamento seleccionado (o cuando carga contexto DB)
  useEffect(() => {
    let mounted = true;
    const loadReasons = async () => {
      try {
        const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
        if (!form.departamento) { setPauseReasons([]); return; }
        const reasonsSnap = await get(dbRef(dbInstance, `pauseReasons/${form.departamento}`));
        if (!mounted) return;
        if (reasonsSnap.exists()) {
          const rv = reasonsSnap.val();
          const list = Object.entries(rv).map(([k,v]) => ({ id: k, ...v }));
          setPauseReasons(list);
        } else {
          setPauseReasons([]);
        }
      } catch (e) {
        console.warn('No se pudieron cargar motivos de pausa', e);
        setPauseReasons([]);
      }
    };
    loadReasons();
    return () => { mounted = false; };
  }, [form.departamento, ctxDb, recinto]);

  // Pause / Resume handlers
  const canControlPause = isAdmin || matchesAssignToUser(form, user);
  const canComment = () => {
    if (!user) return false;
    if (isAdmin) return true;
    const myEmail = (user?.email || '').toLowerCase();
    if (form.usuarioEmail && String(form.usuarioEmail).toLowerCase() === myEmail) return true;
    if (matchesAssignToUser(form, user)) return true;
    return false;
  };
  const handlePause = async () => {
    if (isNew) return;
    if (!canControlPause) { setError('No tienes permisos para pausar este ticket'); return; }
    if (!pauseReasonId && pauseReasons.length === 0) { setError('Selecciona un motivo de pausa o crea uno en configuración'); return; }
    setPauseLoading(true);
    try {
      const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      const newPause = { start: Date.now(), end: null, reasonId: pauseReasonId || null, by: user?.uid || null, comment: pauseComment || '' };
  const dbTicketId = ticketKey || id;
  const newRef = await push(dbRef(dbInstance, `tickets/${dbTicketId}/pauses`), newPause);
      // mark ticket as paused for convenience
  await update(dbRef(dbInstance, `tickets/${dbTicketId}`), { isPaused: true, pauseStart: Date.now() });
      setLastPauseKey(newRef.key);
      setPausesArr(a => ([...a, { key: newRef.key, ...newPause }]));
      setIsPausedState(true);
      setSnackbar({ open: true, message: 'Ticket pausado', severity: 'success' });
    } catch (e) {
      console.error('Error pausando ticket', e);
      setError('Error al pausar el ticket');
    } finally {
      setPauseLoading(false);
    }
  };

  const handleResume = async () => {
    if (isNew) return;
    if (!canControlPause) { setError('No tienes permisos para reanudar este ticket'); return; }
    if (!lastPauseKey) { setError('No hay pausa activa registrada'); return; }
    setPauseLoading(true);
    try {
      const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      const endTs = Date.now();
  const dbTicketId = ticketKey || id;
  await update(dbRef(dbInstance, `tickets/${dbTicketId}/pauses/${lastPauseKey}`), { end: endTs });
  await update(dbRef(dbInstance, `tickets/${dbTicketId}`), { isPaused: false, pauseEnd: endTs });
      setPausesArr(a => a.map(p => p.key === lastPauseKey ? { ...p, end: endTs } : p));
      setIsPausedState(false);
      setLastPauseKey(null);
      setSnackbar({ open: true, message: 'Ticket reanudado', severity: 'success' });
    } catch (e) {
      console.error('Error reanudando ticket', e);
      setError('Error al reanudar el ticket');
    } finally {
      setPauseLoading(false);
    }
  };

  // Add comment handler
  const handleAddComment = async () => {
    if (isNew) return;
    if (!canComment()) { setError('No tienes permisos para comentar este ticket'); return; }
    if (!newComment?.trim() && !newCommentFile) { setError('Escribe un comentario o adjunta un archivo'); return; }
    setCommentLoading(true);
    setError('');
    try {
      const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      const dbTicketId = ticketKey || id;
      let attachmentUrl = '';
      let attachmentName = '';
      if (newCommentFile) {
        const cref = storageRef(storage, `tickets/comments/${Date.now()}_${newCommentFile.name}`);
        await uploadBytes(cref, newCommentFile);
        attachmentUrl = await getDownloadURL(cref);
        attachmentName = newCommentFile.name;
      }
      const commentData = {
        text: newComment?.trim() || '',
        authorUid: user?.uid || '',
        authorEmail: user?.email || '',
        authorName: userData?.nombre ? `${userData.nombre} ${userData.apellido || ''}`.trim() : (user?.email || ''),
        createdAt: Date.now(),
        attachmentUrl: attachmentUrl || '',
        attachmentName: attachmentName || '',
      };
      const newRef = await push(dbRef(dbInstance, `tickets/${dbTicketId}/comments`), commentData);
      const added = { key: newRef.key, ...commentData };
      setCommentsArr(a => ([...a, added]));
      setNewComment('');
      setNewCommentFile(null);
      setSnackbar({ open: true, message: 'Comentario agregado', severity: 'success' });
      // Enviar notificación por correo a involucrados (asignados y creador)
      try {
        // re-obtener ticket breve para detalles (departamento, codigo, tipo)
        const ticketSnap = await get(dbRef(dbInstance, `tickets/${dbTicketId}`));
  const ticketObj = ticketSnap.exists() ? ticketSnap.val() : {};
        const depObj = departamentos.find(d => d.id === ticketObj.departamento);
        const departamentoNombre = depObj ? depObj.nombre : ticketObj.departamento;
        const baseUrl = window.location.origin;
  const ticketForHtml = { ...ticketObj, ticketId: ticketObj.codigo || dbTicketId, departamentoNombre };
        const resumenCambios = `Nuevo comentario por ${commentData.authorName || commentData.authorEmail}`;
        let html = generateTicketEmailHTML({ ticket: ticketForHtml, baseUrl, extraMessage: resumenCambios });
        // adjuntar el texto del comentario en el body HTML (escapado)
        try {
          const commentHtml = `\n<div style="margin-top:16px;padding:12px;border-left:4px solid #1976d2;background:#f7f9ff">` +
            `<strong>Comentario:</strong><p style="white-space:pre-wrap">${escapeHtml(commentData.text || '')}</p>` +
            (commentData.attachmentUrl ? `<p><a href="${escapeHtml(commentData.attachmentUrl)}">Ver adjunto</a></p>` : '') +
            `</div>`;
          // insertar al final del body
          html = `${html}${commentHtml}`;
  } catch { /* no crítico */ }
  const ticketLabel = ticketObj.codigo || dbTicketId;
        const subject = `[Comentario] ${ticketObj.tipo || ''} #${ticketLabel}`;
        // destinatarios: asignados -> emails; si no hay, usar asignadoEmail; incluir al creador
        let toList = [];
        if (ticketObj.asignadoEmails && ticketObj.asignadoEmails.length) {
          toList = ticketObj.asignadoEmails.slice();
        } else if (ticketObj.asignados && ticketObj.asignados.length) {
          const resolved = ticketObj.asignados.map(idu => {
            const u = usuarios.find(x => x.id === idu);
            return u ? u.email : null;
          }).filter(Boolean);
          toList = resolved;
        } else if (ticketObj.asignadoEmail) {
          toList = [ticketObj.asignadoEmail];
        }
        // incluir creador
        const creatorEmail = ticketObj.usuarioEmail ? String(ticketObj.usuarioEmail).toLowerCase() : null;
        const normalized = (toList || []).map(e => String(e || '').toLowerCase()).filter(Boolean);
        if (creatorEmail) normalized.push(creatorEmail);
        const unique = Array.from(new Set(normalized));
        const ticketForHtmlWithTo = { ...ticketForHtml, to: unique, comment: commentData };
        const payload = buildSendMailPayload({
          ticket: ticketForHtmlWithTo,
          departamento: ticketObj.departamento,
          departamentoNombre,
          subject,
          actionMsg: resumenCambios,
          htmlOverride: html,
          cc: []
        });
        await sendTicketMail(payload);
        setSnackbar({ open: true, message: 'Comentario agregado (Notificación enviada)', severity: 'success' });
      } catch (e) {
        console.error('Error enviando notificación de comentario', e);
        setSnackbar({ open: true, message: 'Comentario agregado (falló notificación)', severity: 'warning' });
      }
    } catch (e) {
      console.error('Error agregando comentario', e);
      setError('Error al agregar comentario');
    } finally {
      setCommentLoading(false);
    }
  };

  // Ensure pause-related state are referenced in render (avoid unused var lint) - will also display controls

  const handleSave = async () => {
    if (saving) return; // prevenir doble click
    if (!form.departamento || !form.tipo || !form.subcategoria || !form.descripcion.trim()) {
      setError('Todos los campos son obligatorios');
      return;
    }
    setError('');
  setSaving(true);
  setJustSaved(false);
    try {
      const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');

      let adjUrl = form.adjuntoUrl;
      let adjNombre = form.adjuntoNombre;
      if (adjunto) {
        const fref = storageRef(storage, `tickets/${Date.now()}_${adjunto.name}`);
        await uploadBytes(fref, adjunto);
        adjUrl = await getDownloadURL(fref);
        adjNombre = adjunto.name;
      }
  // eliminados campos y subida de archivos de resolución; las conversaciones reemplazan este flujo

      const ticketData = {
        ...form,
        usuario: form.usuario || (userData?.nombre ? `${userData.nombre} ${userData.apellido || ''}`.trim() : (user?.email || '')),
        usuarioEmail: user?.email || '',
        estado: form.estado || 'Abierto',
        adjuntoUrl: adjUrl || '',
        adjuntoNombre: adjNombre || '',
  // resolucion fields removed: use the Conversación para discutir la resolución
        asignados: form.asignados || [],
      };

      let ticketIdFinal = null;
      let shouldNotify = false;
      if (isNew) {
        // obtain sequential number per recinto
        const recintoKey = (recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA').toString().replace(/\s+/g, '_').toUpperCase();
        let seq = null;
        try {
          const counterRef = dbRef(dbInstance, `counters/tickets/${recintoKey}`);
          const result = await runTransaction(counterRef, (cur) => {
            return (cur || 0) + 1;
          });
          seq = result && result.snapshot ? result.snapshot.val() : null;
        } catch (err) {
          console.warn('No se pudo incrementar contador', err);
        }
  const newRef = push(dbRef(dbInstance, 'tickets'));
        if (seq) {
          ticketData.codigo = `${recintoKey}-${padNum(seq, 4)}`;
        } else {
          // fallback: usar parte de key
          ticketData.codigo = `T-${newRef.key.substring(0,6)}`;
        }
        // registrar fecha/hora de creación en ms
        ticketData.createdAt = Date.now();
    await set(newRef, ticketData);
  // éxito gestionado vía snackbar
  setSnackbar({ open: true, message: 'Ticket creado', severity: 'success' });
  ticketIdFinal = ticketData.codigo || newRef.key;
  // set ticketKey to the firebase key so subsequent ops use it
  setTicketKey(newRef.key);
    // ensure form shows codigo immediately in header
    setForm(f => ({ ...f, codigo: ticketData.codigo || '' }));
        shouldNotify = true; // creation -> notify
      } else {
        // update
        try {
          const dbTicketId = ticketKey || id;
          const existingSnap = await get(dbRef(dbInstance, `tickets/${dbTicketId}`));
          const prev = existingSnap.exists() ? existingSnap.val() : {};
          const isAssignedPrev = matchesAssignToUser(prev, user);
          // permisos: solo admin o usuario asignado puede modificar
          if (!isAdmin && !isAssignedPrev && !(reassignMode && wasOriginallyAssigned)) {
            setError('No tienes permisos para modificar este ticket');
            return;
          }
          // si es usuario asignado (no admin) (o estaba asignado originalmente y está en modo reasignación), permitir estado y (en modo reasignación) asignados/subcategoría
          if (!isAdmin && (isAssignedPrev || (reassignMode && wasOriginallyAssigned))) {
            const allowedUpdate = {};
            const changes = [];
            if (ticketData.estado && ticketData.estado !== prev.estado) {
              allowedUpdate.estado = ticketData.estado;
              changes.push('estado');
              if (ticketData.estado === 'Cerrado') {
                allowedUpdate.resueltoPorUid = user?.uid || '';
                allowedUpdate.resueltoPorEmail = user?.email || '';
                allowedUpdate.resueltoPorNombre = userData?.nombre ? `${userData.nombre} ${userData.apellido || ''}`.trim() : (user?.email || '');
                allowedUpdate.resueltoEn = new Date().toISOString();
              }
            }
            if (reassignMode) {
              const prevAsign = Array.isArray(prev.asignados) ? prev.asignados : [];
              const newAsign = Array.isArray(ticketData.asignados) ? ticketData.asignados : [];
              const asignChanged = JSON.stringify([...prevAsign].sort()) !== JSON.stringify([...newAsign].sort());
              if (asignChanged) {
                allowedUpdate.asignados = newAsign;
                changes.push('asignados');
              }
              if (ticketData.subcategoria && ticketData.subcategoria !== prev.subcategoria) {
                allowedUpdate.subcategoria = ticketData.subcategoria;
                // Reiniciar inicio de SLA
                allowedUpdate.lastSlaStartAt = Date.now();
                changes.push('subcategoria');
              }
            }
            if (Object.keys(allowedUpdate).length) {
              await update(dbRef(dbInstance, `tickets/${dbTicketId}`), allowedUpdate);
              shouldNotify = changes.length > 0;
              if (reassignMode && (changes.includes('asignados') || changes.includes('subcategoria'))) {
                try {
                  await push(dbRef(dbInstance, `tickets/${dbTicketId}/reassignments`), {
                    at: Date.now(),
                    byUid: user?.uid || '',
                    byEmail: user?.email || '',
                    oldAssignees: prev.asignados || [],
                    newAssignees: ticketData.asignados || [],
                    oldSubcat: prev.subcategoria || '',
                    newSubcat: ticketData.subcategoria || '',
                  });
                } catch (e) { console.warn('No se pudo registrar auditoría de reasignación', e); }
                // Enviar correo de reasignación a nuevos asignados
                try {
                  const nuevos = (ticketData.asignados || []).filter(a => !(prev.asignados || []).includes(a));
                  if (nuevos.length) {
                    const resolvedEmails = nuevos.map(idu => {
                      const u = usuarios.find(x => x.id === idu);
                      return u ? u.email : null;
                    }).filter(Boolean);
                    if (resolvedEmails.length) {
                      const depObj = departamentos.find(d => d.id === prev.departamento);
                      const departamentoNombre = depObj ? depObj.nombre : prev.departamento;
                      const baseUrl = window.location.origin;
                      const ticketForHtml = { ...prev, ...allowedUpdate, ticketId: prev.codigo || dbTicketId, departamentoNombre };
                      const resumenCambios = 'Ticket reasignado';
                      let html = generateTicketEmailHTML({ ticket: ticketForHtml, baseUrl, extraMessage: resumenCambios });
                      const payload = buildSendMailPayload({
                        ticket: { ...ticketForHtml, to: resolvedEmails },
                        departamento: prev.departamento,
                        departamentoNombre,
                        subject: `[Reasignado] ${prev.tipo || ''} #${prev.codigo || dbTicketId}`,
                        actionMsg: resumenCambios,
                        htmlOverride: html,
                        cc: [user?.email].filter(Boolean)
                      });
                      await sendTicketMail(payload);
                    }
                  }
                } catch (e) { console.warn('No se pudo enviar correo de reasignación', e); }
              }
            }
            // éxito gestionado vía snackbar
            setSnackbar({ open: true, message: 'Ticket actualizado', severity: 'success' });
            ticketIdFinal = ticketData.codigo || dbTicketId;
            if (reassignMode) setReassignMode(false);
          } else {
            // es admin -> puede actualizar cualquier campo
            const dbTicketId2 = ticketKey || id;
            const estadoChanged = (prev.estado !== ticketData.estado);
            const asignChanged = JSON.stringify([...(prev.asignados||[])].sort()) !== JSON.stringify([...(ticketData.asignados||[])].sort());
            const subcatChanged = ticketData.subcategoria !== prev.subcategoria;
            if (subcatChanged) {
              ticketData.lastSlaStartAt = Date.now();
            }
            shouldNotify = estadoChanged || asignChanged || subcatChanged;
            await update(dbRef(dbInstance, `tickets/${dbTicketId2}`), ticketData);
            if (asignChanged || subcatChanged) {
              try {
                await push(dbRef(dbInstance, `tickets/${dbTicketId2}/reassignments`), {
                  at: Date.now(),
                  byUid: user?.uid || '',
                  byEmail: user?.email || '',
                  oldAssignees: prev.asignados || [],
                  newAssignees: ticketData.asignados || [],
                  oldSubcat: prev.subcategoria || '',
                  newSubcat: ticketData.subcategoria || '',
                });
              } catch (e) { console.warn('No se pudo registrar auditoría de reasignación (admin)', e); }
              // correo para nuevos asignados
              try {
                if (asignChanged) {
                  const nuevos = (ticketData.asignados || []).filter(a => !(prev.asignados || []).includes(a));
                  if (nuevos.length) {
                    const resolvedEmails = nuevos.map(idu => {
                      const u = usuarios.find(x => x.id === idu);
                      return u ? u.email : null;
                    }).filter(Boolean);
                    if (resolvedEmails.length) {
                      const depObj = departamentos.find(d => d.id === prev.departamento);
                      const departamentoNombre = depObj ? depObj.nombre : prev.departamento;
                      const baseUrl = window.location.origin;
                      const ticketForHtml = { ...prev, ...ticketData, ticketId: prev.codigo || dbTicketId2, departamentoNombre };
                      const resumenCambios = 'Ticket reasignado';
                      let html = generateTicketEmailHTML({ ticket: ticketForHtml, baseUrl, extraMessage: resumenCambios });
                      const payload = buildSendMailPayload({
                        ticket: { ...ticketForHtml, to: resolvedEmails },
                        departamento: prev.departamento,
                        departamentoNombre,
                        subject: `[Reasignado] ${prev.tipo || ''} #${prev.codigo || dbTicketId2}`,
                        actionMsg: resumenCambios,
                        htmlOverride: html,
                        cc: [user?.email].filter(Boolean)
                      });
                      await sendTicketMail(payload);
                    }
                  }
                }
              } catch (e) { console.warn('No se pudo enviar correo de reasignación (admin)', e); }
            }
            // éxito gestionado vía snackbar
            setSnackbar({ open: true, message: 'Ticket actualizado', severity: 'success' });
            ticketIdFinal = ticketData.codigo || dbTicketId2;
            if (reassignMode) setReassignMode(false);
          }
        } catch (e) {
          console.warn('No se pudo leer ticket previo para chequeo de estado', e);
          setError('Error actualizando ticket');
          return;
        }
      }
      // Enviar notificación si corresponde (creación o cambio de estado)
      if (shouldNotify) {
        try {
          const baseUrl = window.location.origin;
          const depObj = departamentos.find(d => d.id === ticketData.departamento);
          const departamentoNombre = depObj ? depObj.nombre : ticketData.departamento;
          const ticketForHtml = { ...ticketData, ticketId: ticketData.codigo || ticketIdFinal, departamentoNombre };
          const resumenCambios = isNew ? 'Creación de ticket' : `Cambio de estado a ${ticketData.estado}`;
          const html = generateTicketEmailHTML({ ticket: ticketForHtml, baseUrl, extraMessage: resumenCambios });
          const ticketLabel = ticketData.codigo || ticketIdFinal;
          const subject = `[Ticket ${ticketData.estado}] ${ticketData.tipo || ''} #${ticketLabel}`;
          // destinatarios: resolver asignados y asegurarse de incluir al creador
          let toList = [];
          if (ticketData.asignadoEmails && ticketData.asignadoEmails.length) {
            toList = ticketData.asignadoEmails.slice();
          } else if (ticketData.asignados && ticketData.asignados.length) {
            const resolved = ticketData.asignados.map(idu => {
              const u = usuarios.find(x => x.id === idu);
              return u ? u.email : null;
            }).filter(Boolean);
            toList = resolved;
          } else if (ticketData.asignadoEmail) {
            toList = [ticketData.asignadoEmail];
          }
          // incluir siempre al creador (usuarioEmail) para cambios de estado/creación
          const creatorEmail = ticketData.usuarioEmail ? String(ticketData.usuarioEmail).toLowerCase() : null;
          const normalized = (toList || []).map(e => String(e || '').toLowerCase()).filter(Boolean);
          if (creatorEmail) normalized.push(creatorEmail);
          // deduplicar
          const unique = Array.from(new Set(normalized));
          const ticketForHtmlWithTo = { ...ticketForHtml, to: unique };
          const payload = buildSendMailPayload({
            ticket: ticketForHtmlWithTo,
            departamento: ticketData.departamento,
            departamentoNombre,
            subject,
            actionMsg: resumenCambios,
            htmlOverride: html,
            // mantener cc para compatibilidad (vacío si no hay)
            cc: []
          });
          await sendTicketMail(payload);
          const finalMsg = isNew ? 'Ticket creado (Notificación enviada)' : 'Ticket actualizado (Notificación enviada)';
          // éxito gestionado vía snackbar
          setSnackbar({ open: true, message: finalMsg, severity: 'success' });
        } catch (e) {
          console.error('Error enviando notificación', e);
          setError(prev => (prev ? `${prev} (Falló notificación)` : 'Falló notificación por correo'));
        }
      }

  // navegar al ticket creado/actualizado: preferir codigo en la URL
  setJustSaved(true);
  setSaving(false);
  setTimeout(() => navigate(`/tickets/${ticketData.codigo || ticketIdFinal}`), 900);
    } catch (e) {
      console.error(e);
      setError('Error al guardar ticket');
      setSaving(false);
    }
  };

  // compute worked time in ms for display (business hours minus pauses)
  const computeWorkedMsForTicket = (ticket) => {
    try {
      if (!ticket) return null;
      const parseAny = (v) => {
        if (v === undefined || v === null) return null;
        if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
        if (typeof v === 'string') { const n = parseInt(v,10); if (!isNaN(n)) return n < 1e12 ? n*1000 : n; const d = new Date(v); return isNaN(d.getTime()) ? null : d.getTime(); }
        if (typeof v === 'object') {
          if (v.seconds) return Number(v.seconds) * 1000;
          if (v._seconds) return Number(v._seconds) * 1000;
          if (v.toMillis) {
            try { return v.toMillis(); } catch { return null; }
          }
        }
        return null;
      };
      const createdMs = parseAny(ticket.createdAt) || parseAny(ticket.fecha) || parseAny(ticket.timestamp) || null;
      const closedMs = parseAny(ticket.closedAt) || parseAny(ticket.closedAtTimestamp) || null;
      const endMs = closedMs || Date.now();
      if (!createdMs) return null;
      let duration = workingMsBetween(createdMs, endMs);
      if (ticket.pauses) {
        for (const k of Object.keys(ticket.pauses)) {
          const p = ticket.pauses[k];
          const s = parseAny(p.start) || null;
          const e = parseAny(p.end) || null;
          if (!s) continue;
          const ps = Number(s);
          const pe = e ? Number(e) : endMs;
          if (pe > ps) {
            duration -= workingMsBetween(Math.max(ps, createdMs), Math.min(pe, endMs));
          }
        }
      }
      return Math.max(0, duration);
    } catch (e) { console.warn('Error computing worked ms', e); return null; }
  };

  if (loading) return (
    <Box sx={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Typography>Cargando...</Typography>
    </Box>
  );

  return (
    <Box sx={{ p: { xs: 1, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 900 }}>{isNew ? 'Nuevo Ticket' : `Ticket ${form.codigo || id}`}</Typography>
            {!isNew && (
              <Typography variant="caption" color="text.secondary">Tiempo trabajado: {msToHoursMinutes(computeWorkedMsForTicket(form))}</Typography>
            )}
          </Box>
        </Box>
  {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
  {/* Alert de éxito removido; se usa Snackbar inferior */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
          <TextField select label="Solicitud para" value={form.departamento} onChange={e => setForm(f => ({ ...f, departamento: e.target.value, tipo: '' }))} disabled={saving || (!isNew && !isAdmin)}>
            <MenuItem value="" disabled>Selecciona un departamento</MenuItem>
            {departamentos.map(d => <MenuItem key={d.id} value={d.id}>{d.nombre}</MenuItem>)}
          </TextField>
          <TextField select label="Categoría" value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))} disabled={saving || (!isNew && !isAdmin)}>
            <MenuItem value="" disabled>Selecciona una categoría</MenuItem>
            {form.departamento && tipos[form.departamento] && Object.entries(tipos[form.departamento]).map(([id, nombre]) => (
              <MenuItem key={id} value={nombre}>{nombre}</MenuItem>
            ))}
          </TextField>
          <TextField select label="Subcategoría" value={form.subcategoria} onChange={e => setForm({...form, subcategoria: e.target.value})} disabled={saving || (!isNew && !isAdmin && !reassignMode)}>
            <MenuItem value="" disabled>Selecciona una subcategoría</MenuItem>
            {form.departamento && tipos && subcats[form.departamento] && form.tipo && (() => {
              const tipoKey = Object.entries(tipos[form.departamento] || {}).find(([, nombre]) => nombre === form.tipo)?.[0];
              const opciones = tipoKey ? (subcats[form.departamento]?.[tipoKey] || {}) : {};
              return Object.entries(opciones).map(([id, nombre]) => <MenuItem key={id} value={nombre}>{nombre}</MenuItem>);
            })()}
          </TextField>
          <Autocomplete
            multiple
            options={(() => {
              const depName = (departamentos.find(d => String(d.id) === String(form.departamento)) || {}).nombre;
              return usuarios.filter(u => (u.departamento && (String(u.departamento) === String(form.departamento) || String(u.departamento) === String(depName))));
            })()}
            getOptionLabel={opt => `${opt.nombre || ''} ${opt.apellido || ''}`.trim() || opt.email}
            value={usuarios.filter(u => (form.asignados || []).includes(u.id))}
            onChange={(_, newVal) => setForm(f => ({ ...f, asignados: newVal.map(u => u.id) }))}
            disabled={saving || (!isNew && !isAdmin && !reassignMode)}
            renderInput={(params) => <TextField {...params} label="Asignar solicitud a: (múltiple)" />}
          />
          {!isNew && (isAdmin || matchesAssignToUser(form, user) || (reassignMode && wasOriginallyAssigned)) && form.estado !== 'Cerrado' && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: -1 }}>
              <Tooltip title={reassignMode ? 'Cancelar reasignación' : 'Reasignar ticket (cambiar asignados / subcategoría)'} placement="left">
                <span>
                  <Button
                    size="small"
                    variant={reassignMode ? 'outlined' : 'contained'}
                    color={reassignMode ? 'error' : 'secondary'}
                    onClick={() => setReassignMode(m => !m)}
                    startIcon={<SwapHorizIcon fontSize="small" />}
                    disabled={saving}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                  >
                    {reassignMode ? 'Cancelar Reasignación' : 'Reasignar Ticket'}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          )}
          <TextField label="Descripción" multiline minRows={3} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} disabled={saving || (!isNew && !isAdmin)} />
          <Box>
            <Button variant="outlined" component="label" disabled={saving || (!isNew && !isAdmin)}>{adjunto ? adjunto.name : (form.adjuntoNombre || 'Adjuntar archivo')}<input type="file" hidden onChange={e => setAdjunto(e.target.files[0])} /></Button>
            {(form.adjuntoUrl || adjunto) && <Box sx={{ mt: 1 }}><Typography variant="caption">{(adjunto && adjunto.name) || form.adjuntoNombre}</Typography></Box>}
          </Box>
          <TextField select label="Estado" value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} disabled={saving || isNew || (!isAdmin && !matchesAssignToUser(form, user))}>
            <MenuItem value="Abierto">Abierto</MenuItem>
            <MenuItem value="En Proceso">En Proceso</MenuItem>
            <MenuItem value="Cerrado">Cerrado</MenuItem>
          </TextField>
          <TextField label="Usuario" value={form.usuario} InputProps={{ readOnly: true }} />
  {/* Comentario de resolución eliminado: usar la sección "Conversación" para discutir/resolver el ticket */}
          {/* Pause controls moved below the conversation */}
          {/* Comentarios */}
          {!isNew && (
            <Paper sx={{ p: 2, mt: 1, borderRadius: 3 }} elevation={0}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>Conversación</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 360, overflowY: 'auto', pr: 1 }}>
                {commentsArr && commentsArr.length === 0 && <Typography variant="body2" color="text.secondary">Aún no hay comentarios.</Typography>}
                {commentsArr && commentsArr.map(c => {
                  const isMine = (user?.uid && c.authorUid === user.uid) || ((user?.email || '').toLowerCase() === (c.authorEmail || '').toLowerCase());
                  return (
                    <Box key={c.key} sx={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                      <Paper
                        elevation={0}
                        sx={{
                          maxWidth: '85%',
                          p: 1.2,
                          px: 1.6,
                          borderRadius: 3,
                          bgcolor: theme => isMine ? theme.palette.primary.main : (theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[200]),
                          color: theme => isMine ? theme.palette.primary.contrastText : theme.palette.text.primary,
                          boxShadow: 2,
                          position: 'relative'
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 600, opacity: 0.85 }}>
                          {c.authorName || c.authorEmail}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>{c.text}</Typography>
                        {c.attachmentUrl && (
                          <Button href={c.attachmentUrl} target="_blank" size="small" variant="text" sx={{ mt: 0.5, textTransform: 'none', fontSize: 12, fontWeight: 600, color: 'inherit', opacity: 0.9 }}>
                            📎 {c.attachmentName || 'Adjunto'}
                          </Button>
                        )}
                        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.6, textAlign: 'right' }}>
                          {c.createdAt ? new Date(Number(c.createdAt)).toLocaleString() : ''}
                        </Typography>
                      </Paper>
                    </Box>
                  );
                })}
              </Box>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ mt: 1 }}>
                <TextField
                  multiline
                  minRows={3}
                  maxRows={14}
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  placeholder="Escribe un comentario... (Ctrl+Enter para enviar)"
                  fullWidth
                  disabled={saving}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canComment() && (newComment.trim() || newCommentFile) && !commentLoading) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                  sx={{
                    '& .MuiInputBase-root': { borderRadius: 3 }
                  }}
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 0.5 }}>
                  <Tooltip title={newCommentFile ? newCommentFile.name : 'Adjuntar archivo'} placement="top">
                    <span>
                      <IconButton
                        component="label"
                        size="small"
                        color={newCommentFile ? 'primary' : 'default'}
                        disabled={saving}
                        sx={{ bgcolor: newCommentFile ? 'primary.main' : 'action.hover', color: newCommentFile ? 'primary.contrastText' : 'text.secondary', '&:hover': { bgcolor: newCommentFile ? 'primary.dark' : 'action.selected' } }}
                      >
                        <AttachFileIcon fontSize="small" />
                        <input type="file" hidden onChange={e => setNewCommentFile(e.target.files[0])} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Enviar comentario" placement="top">
                    <span>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={handleAddComment}
                        disabled={saving || commentLoading || !canComment() || (!newComment.trim() && !newCommentFile)}
                        sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } }}
                      >
                        <SendIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              </Box>
            </Paper>
          )}
          {/* Pause controls (moved) */}
          {!isNew && (
            <Paper sx={{ p: 2, mt: 1 }} elevation={0}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Control de Pausa</Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField select size="small" label="Motivo" value={pauseReasonId} onChange={e => setPauseReasonId(e.target.value)} sx={{ minWidth: 220 }} disabled={saving}>
                  <MenuItem value="">(Sin seleccionar)</MenuItem>
                  {pauseReasons.map(r => <MenuItem key={r.id} value={r.id}>{r.nombre}</MenuItem>)}
                </TextField>
                <TextField size="small" label="Comentario" value={pauseComment} onChange={e => setPauseComment(e.target.value)} disabled={saving} />
                {!isPausedState ? (
                  <Button disabled={saving || !canControlPause || pauseLoading} variant="contained" color="warning" onClick={handlePause}>Pausar</Button>
                ) : (
                  <Button disabled={saving || !canControlPause || pauseLoading} variant="contained" color="success" onClick={handleResume}>Reanudar</Button>
                )}
              </Box>
              {pausesArr && pausesArr.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption">Historial de pausas:</Typography>
                  <Box>
                    {pausesArr.map(p => (
                      <Box key={p.key} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Typography variant="body2">{new Date(p.start).toLocaleString()} → {p.end ? new Date(p.end).toLocaleString() : 'ACTIVA'}</Typography>
                        <Typography variant="caption" sx={{ ml: 1 }}>{p.reasonId || ''} {p.comment ? `- ${p.comment}` : ''}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
              {/* Historial de Reasignaciones */}
              {form.reassignments && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>Reasignaciones:</Typography>
                  <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {Object.values(form.reassignments).sort((a,b)=>(a.at||0)-(b.at||0)).map((r, idx) => (
                      <Typography key={idx} variant="caption" sx={{ opacity: 0.8 }}>
                        {r.at ? new Date(r.at).toLocaleString() : ''} | { (r.oldAssignees||[]).length } → { (r.newAssignees||[]).length } subcat: {r.oldSubcat || ''} ⇒ {r.newSubcat || ''}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              )}
            </Paper>
          )}
          {/* botones al final del formulario */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
            <Button variant="outlined" onClick={() => navigate('/tickets')} color="inherit" disabled={saving && !justSaved}>Volver</Button>
            <Tooltip placement="bottom" title={saving ? 'Guardando ticket...' : (isNew ? 'Crear ticket' : 'Actualizar ticket')}>
              <span>
                <Button 
                  variant="contained" 
                  onClick={handleSave} 
                  disabled={(saving && !justSaved) || (!isNew && !isAdmin && !(matchesAssignToUser(form, user) || (reassignMode && wasOriginallyAssigned)))}
                  startIcon={isNew ? <AddIcon /> : <UpdateIcon />}
                >
                  {saving && !justSaved ? (isNew ? 'CREANDO...' : 'GUARDANDO...') : (justSaved ? 'ENVIADO' : (isNew ? 'CREAR TICKET' : 'ACTUALIZAR TICKET'))}
                </Button>
              </span>
            </Tooltip>
          </Box>
        </Box>
      </Paper>
      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar(s => ({ ...s, open: false }))} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
