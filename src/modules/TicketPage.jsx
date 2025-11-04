import React, { useEffect, useState } from 'react';
import useNotification from '../context/useNotification';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Typography, Button, TextField, MenuItem, Alert, Paper, Chip, Autocomplete, Snackbar, Tooltip, IconButton, Divider, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress } from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import UpdateIcon from '@mui/icons-material/Update';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { ref as dbRef, get, set, update, push, runTransaction, remove } from 'firebase/database';
import { storage } from '../firebase/firebaseConfig';
import { getDbForRecinto } from '../firebase/multiDb';
import { useDb } from '../context/DbContext';
import { useAuth } from '../context/useAuth';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import workingMsBetween from '../utils/businessHours';
import { msToHoursMinutes } from '../utils/formatDuration';
import { generateTicketEmailHTML, buildSendMailPayload } from '../utils/ticketEmailTemplate';
import { sendTicketMail } from '../services/mailService';
import { markTicketAsInProcess } from '../services/ticketService';
import { calculateSlaRemaining, getSlaHours, computeResolutionHoursForTicket } from '../utils/slaCalculator';

function padNum(n, len = 4) {
  return String(n).padStart(len, '0');
}

export default function TicketPage() {
  const { id } = useParams();
  const isNew = id === 'new' || !id;
  const navigate = useNavigate();
  const { user, userData } = useAuth();
  const { db: ctxDb, recinto, loading: dbLoading, tiposTickets: tiposFromCtx, subcategoriasTickets: subcatsFromCtx } = useDb();

  const [departamentos, setDepartamentos] = useState([]);
  const notify = useNotification();
  const [tipos, setTipos] = useState({});
  const [subcats, setSubcats] = useState({});
  const [usuarios, setUsuarios] = useState([]);
  const [error, setError] = useState('');
  // Propagar errores locales al sistema de notificaciones global y limpiar
  React.useEffect(() => {
    if (error) {
      try { notify(error, 'error', { mode: 'toast', persist: true }); } catch { /* ignore */ }
      setError('');
    }
  }, [error, notify]);
  // Legacy: un solo adjunto (se mantiene para compatibilidad con tickets antiguos)
  // Eliminado estado legacy adjunto único; se usa attachments
  // Nuevo: múltiples adjuntos (nuevos seleccionados aún no subidos)
  const [newAdjuntos, setNewAdjuntos] = useState([]); // File[]
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
  const [originalEstado, setOriginalEstado] = useState(null);
  const [pauseReasonId, setPauseReasonId] = useState('');
  const [pauseComment, setPauseComment] = useState('');
  const [pauseLoading, setPauseLoading] = useState(false);
  const [pauseReasons, setPauseReasons] = useState([]);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  // guardar información de la última notificación que falló para reintento
  const [failedNotification, setFailedNotification] = useState(null);
  const [notifRetryLoading, setNotifRetryLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Flag para recordar si el usuario estaba originalmente asignado al cargar el ticket
  const [wasOriginallyAssigned, setWasOriginallyAssigned] = useState(false);
  const [autoInitiatedForKey, setAutoInitiatedForKey] = useState(null);
  // Estados para configuraciones SLA
  const [slaConfigs, setSlaConfigs] = useState({});
  const [slaSubcats, setSlaSubcats] = useState({});

  const isAdmin = (userData?.isSuperAdmin || userData?.rol === 'admin');
  const canDelete = !isNew && (isAdmin || (user?.email && form?.usuarioEmail && String(form.usuarioEmail).toLowerCase() === String(user.email).toLowerCase()));
  // el creador del ticket (usuario que lo abrió) puede cerrar su propio ticket
  const isCreator = !!(form?.usuarioEmail && user?.email && String(form.usuarioEmail).toLowerCase() === String(user.email).toLowerCase());

  // determinar el departamento del usuario actual (intentar userData, fallback a lista de usuarios)
  const userDepartamento = React.useMemo(() => {
    if (userData?.departamento) return String(userData.departamento);
    const me = usuarios.find(u => (u.id && u.id === (user?.uid || '')) || ((u.email || '').toLowerCase() === (user?.email || '').toLowerCase()));
    if (me) return me.departamento || me.departamentoNombre || '';
    return '';
  }, [userData, usuarios, user]);

  const isSameDepartment = React.useMemo(() => {
    try {
      const deptFormRaw = form?.departamento || '';
      if (!deptFormRaw) return false;
      const normalize = (s) => String(s || '').toLowerCase().trim();
      // Resolve form department: could be id or name
      const depObj = departamentos.find(d => String(d.id) === String(deptFormRaw));
      const formDepId = depObj ? String(depObj.id) : String(deptFormRaw);
      const formDepName = depObj ? String(depObj.nombre || '') : String(deptFormRaw);

      // Resolve user department: userData.departamento may be id or name; fallback to usuarios list
      let uDeptId = userData?.departamento || null;
      let uDeptName = '';
      if (uDeptId) {
        const udep = departamentos.find(d => String(d.id) === String(uDeptId));
        uDeptName = udep ? String(udep.nombre || '') : String(uDeptId);
      } else {
        const me = usuarios.find(u => (u.id && u.id === (user?.uid || '')) || ((u.email || '').toLowerCase() === (user?.email || '').toLowerCase()));
        if (me) {
          uDeptId = me.departamento || me.departamentoId || null;
          uDeptName = me.departamentoNombre || me.departamento || '';
        }
      }

      // Compare by id or by name (normalized)
      if (uDeptId && String(uDeptId) === String(formDepId)) return true;
      if (normalize(uDeptName) && normalize(formDepName) && normalize(uDeptName) === normalize(formDepName)) return true;
      // Also handle case where both are just the same raw string
      if (normalize(userDepartamento) && normalize(deptFormRaw) && normalize(userDepartamento) === normalize(deptFormRaw)) return true;
      return false;
    } catch {
      return false;
    }
  }, [form?.departamento, departamentos, usuarios, userDepartamento, userData, user]);

  // Helper: puede iniciar si está asignado o es del mismo departamento
  const canInitiate = React.useMemo(() => {
    try {
      if (!form) return false;
      if (!user) return false;
      if (matchesAssignToUser(form, user)) return true;
      return isSameDepartment;
    } catch { return false; }
  }, [form, user, isSameDepartment]);

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

  // Helper para calcular SLA usando la función utilitaria
  const calculateSlaForTicket = (ticket) => {
    return calculateSlaRemaining(ticket, slaConfigs, slaSubcats, tipos, subcats);
  };

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

        // SLA configurations
        try {
          const [slaConfigSnap, slaSubcatsSnap] = await Promise.all([
            get(dbRef(dbInstance, 'sla/configs')),
            get(dbRef(dbInstance, 'sla/subcategorias'))
          ]);
          setSlaConfigs(slaConfigSnap.exists() ? slaConfigSnap.val() : {});
          setSlaSubcats(slaSubcatsSnap.exists() ? slaSubcatsSnap.val() : {});
        } catch (e) {
          console.warn('No se pudo cargar configuración SLA', e);
          setSlaConfigs({});
          setSlaSubcats({});
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
              departamento: t.departamento || '',
              tipo: t.tipo || '',
              subcategoria: t.subcategoria || '',
              descripcion: t.descripcion || '',
              estado: t.estado || 'Abierto',
              usuario: t.usuario || '',
              usuarioEmail: t.usuarioEmail || '',
              adjuntoUrl: t.adjuntoUrl || '',
              adjuntoNombre: t.adjuntoNombre || '',
              asignados: t.asignados || [],
              codigo: t.codigo || '',
              // Migrar adjunto antiguo a arreglo attachments si no existe
              attachments: Array.isArray(t.attachments)
                ? t.attachments
                : (t.adjuntoUrl ? [{ url: t.adjuntoUrl, nombre: t.adjuntoNombre || 'Adjunto' }] : []),
            });
            setOriginalEstado(t.estado || 'Abierto');
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
          setOriginalEstado(null);
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


  // Handler para iniciar ticket (marcar 'En Proceso') usando servicio transaccional
  const handleInitiate = React.useCallback(async () => {
    if (isNew) return;
    if (!canInitiate) { setError('No tienes permisos para iniciar este ticket'); return; }
    setSaving(true);
    try {
      const dbTicketId = ticketKey || id;
      const res = await markTicketAsInProcess({ recinto: recinto || (typeof localStorage !== 'undefined' && localStorage.getItem('selectedRecinto')) || 'GRUPO_HEROICA', ticketId: dbTicketId, actorUser: { uid: user?.uid, email: user?.email } });
      if (res && res.changed) {
        setForm(f => ({ ...f, estado: 'En Proceso' }));
        setSnackbar({ open: true, message: 'Ticket marcado como En Proceso', severity: 'success' });
      } else {
        setSnackbar({ open: true, message: 'El ticket ya se encuentra en proceso o no pudo marcarse', severity: 'info' });
      }
    } catch (e) {
      console.error('Error iniciando ticket', e);
      setError('Error iniciando el ticket');
    } finally {
      setSaving(false);
    }
  }, [isNew, canInitiate, ticketKey, id, recinto, user]);

  // Auto-iniciar ticket la primera vez que se abre si es 'Abierto' y el usuario puede iniciarlo
  useEffect(() => {
    try {
      if (isNew) return;
      if (!ticketKey) return;
      if (!form) return;
      if (form.estado !== 'Abierto') return;
      if (!canInitiate) return;
      if (autoInitiatedForKey === ticketKey) return; // ya intentado
      // Marcar como iniciado (no bloquear render): usamos handler existente
      (async () => {
        try {
          await handleInitiate();
          setAutoInitiatedForKey(ticketKey);
        } catch {
          // log y no romper flujo
          console.warn('Auto-init failed');
        }
      })();
  } catch { /* ignore */ }
  }, [ticketKey, form, canInitiate, isNew, autoInitiatedForKey, handleInitiate]);


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
  const canControlPause = isAdmin || matchesAssignToUser(form, user) || isSameDepartment;
  const canComment = () => {
    // Permitir comentarios a usuarios autenticados.
    // Reglas:
    // - Admin siempre puede comentar.
    // - El creador siempre puede comentar.
    // - Cualquier miembro del mismo departamento puede comentar, incluso si el ticket fue reasignado a otra persona del departamento.
    // - Los asignados también pueden comentar.
    if (!user) return false;
    if (isAdmin) return true;
    const myEmail = (user?.email || '').toLowerCase();
    if (form.usuarioEmail && String(form.usuarioEmail).toLowerCase() === myEmail) return true;
    if (isSameDepartment) return true; // permite comentar incluso si el ticket está 'Cerrado' o 'En Proceso'
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
  // Enviar notificación por correo sobre la pausa (incluye motivo y comentario)
  let payload = null; // declarado aquí para que el catch pueda acceder a él
  try {
        const ticketSnap = await get(dbRef(dbInstance, `tickets/${dbTicketId}`));
        const ticketObj = ticketSnap.exists() ? ticketSnap.val() : {};
        const depObj = departamentos.find(d => d.id === ticketObj.departamento);
        const departamentoNombre = depObj ? depObj.nombre : ticketObj.departamento;
        const baseUrl = window.location.origin;
        const ticketForHtml = { ...ticketObj, ticketId: ticketObj.codigo || dbTicketId, departamentoNombre };
        
        // Calcular SLA para incluir en el correo
        const slaInfo = calculateSlaForTicket(ticketForHtml);
        if (slaInfo && slaInfo.slaHours != null) {
          ticketForHtml.slaHours = slaInfo.slaHours;
          ticketForHtml.slaHoursOriginal = slaInfo.slaHours;
          ticketForHtml.slaHoursExplicit = slaInfo.slaHours;
        }
        
        const motivoNombre = (pauseReasons.find(r => r.id === (pauseReasonId || '')) || {}).nombre || pauseReasonId || 'Sin motivo';
        const resumenCambios = `Ticket puesto en pausa: ${motivoNombre}`;
        
        // Generar HTML con información de pausa integrada
        let html = generateTicketEmailHTML({ 
          ticket: ticketForHtml, 
          baseUrl, 
          extraMessage: resumenCambios,
          pauseInfo: {
            type: 'pause',
            motivo: motivoNombre,
            comentario: pauseComment || '',
            duracion: ''
          }
        });
        
        // destinatarios: asignados -> emails; incluir creador
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
        const creatorEmail = ticketObj.usuarioEmail ? String(ticketObj.usuarioEmail).toLowerCase() : null;
        const normalized = (toList || []).map(e => String(e || '').toLowerCase()).filter(Boolean);
        if (creatorEmail) normalized.push(creatorEmail);
  const unique = Array.from(new Set(normalized));
  payload = buildSendMailPayload({
          ticket: { ...ticketForHtml, to: unique },
          departamento: ticketObj.departamento,
          departamentoNombre,
          subject: `[Ticket pausado] ${ticketObj.tipo || ''} #${ticketObj.codigo || dbTicketId}`,
          actionMsg: resumenCambios,
          htmlOverride: html,
          cc: []
        });
  if (!ensurePayloadHasRecipients(payload)) {
    setFailedNotification({ payload, type: 'pause', dbTicketId, message: 'Notificación de Ticket Pausado' });
    setSnackbar({ open: true, message: 'No hay destinatarios configurados para la notificación (guardada para reintento)', severity: 'warning' });
  } else {
    await sendTicketMail(payload);
    setSnackbar({ open: true, message: 'Notificación de Ticket Pausado enviada', severity: 'success' });
  }
      } catch (e) {
        console.error('Error enviando notificación de pausa', e);
        // Guardar payload para reintento
        try { setFailedNotification({ payload, type: 'pause', dbTicketId, message: 'Notificación de Ticket Pausado' }); } catch (err) { console.warn('No se pudo guardar failedNotification', err); }
        setSnackbar({ open: true, message: 'Falló envío de notificación (ver consola)', severity: 'warning' });
      }
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
    // capture key early because we'll clear lastPauseKey later
    const pauseKey = lastPauseKey;
    try {
      const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      const endTs = Date.now();
      const dbTicketId = ticketKey || id;
      // update pause and ticket
      await update(dbRef(dbInstance, `tickets/${dbTicketId}/pauses/${pauseKey}`), { end: endTs });
      await update(dbRef(dbInstance, `tickets/${dbTicketId}`), { isPaused: false, pauseEnd: endTs });
      setPausesArr(a => a.map(p => p.key === pauseKey ? { ...p, end: endTs } : p));
      setIsPausedState(false);
      setLastPauseKey(null);
      setSnackbar({ open: true, message: 'Ticket reanudado', severity: 'success' });

      // Enviar notificación por correo sobre la reanudación (incluye motivo, comentario y duración de la pausa)
      try {
        const pauseSnap = await get(dbRef(dbInstance, `tickets/${dbTicketId}/pauses/${pauseKey}`));
        const pauseObj = pauseSnap.exists() ? pauseSnap.val() : null;
        const ticketSnap = await get(dbRef(dbInstance, `tickets/${dbTicketId}`));
        const ticketObj = ticketSnap.exists() ? ticketSnap.val() : {};
        const depObj = departamentos.find(d => d.id === ticketObj.departamento);
        const departamentoNombre = depObj ? depObj.nombre : ticketObj.departamento;
        const baseUrl = window.location.origin;
        const ticketForHtml = { ...ticketObj, ticketId: ticketObj.codigo || dbTicketId, departamentoNombre };
        
        // Calcular SLA para incluir en el correo
        const slaInfo = calculateSlaForTicket(ticketForHtml);
        if (slaInfo && slaInfo.slaHours != null) {
          ticketForHtml.slaHours = slaInfo.slaHours;
          ticketForHtml.slaHoursOriginal = slaInfo.slaHours;
          ticketForHtml.slaHoursExplicit = slaInfo.slaHours;
        }
        
        const motivoNombre = pauseObj && pauseObj.reasonId ? ((pauseReasons.find(r => r.id === pauseObj.reasonId) || {}).nombre || pauseObj.reasonId) : 'Sin motivo';
        const pausaInicio = pauseObj && pauseObj.start ? Number(pauseObj.start) : null;
        const pausaFin = endTs;
        const durMs = (pausaInicio ? (pausaFin - pausaInicio) : null);
        const durText = durMs ? msToHoursMinutes(durMs) : 'N/A';
        const resumenCambios = `Ticket reanudado (duración de pausa: ${durText})`;
        
        // Generar HTML con información de reanudación integrada
        let html = generateTicketEmailHTML({ 
          ticket: ticketForHtml, 
          baseUrl, 
          extraMessage: resumenCambios,
          pauseInfo: {
            type: 'resume',
            motivo: motivoNombre,
            comentario: (pauseObj && pauseObj.comment) || pauseComment || '',
            duracion: durText
          }
        });

        // destinatarios como en pausa
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
        const creatorEmail = ticketObj.usuarioEmail ? String(ticketObj.usuarioEmail).toLowerCase() : null;
        const normalized = (toList || []).map(e => String(e || '').toLowerCase()).filter(Boolean);
        if (creatorEmail) normalized.push(creatorEmail);
  const unique = Array.from(new Set(normalized));
  let payload = null; // declarar antes del try/catch siguiente
        
  payload = buildSendMailPayload({
          ticket: { ...ticketForHtml, to: unique },
          departamento: ticketObj.departamento,
          departamentoNombre,
          subject: `[Ticket reanudado] ${ticketObj.tipo || ''} #${ticketObj.codigo || dbTicketId}`,
          actionMsg: resumenCambios,
          htmlOverride: html,
          cc: []
        });

        try {
          if (!ensurePayloadHasRecipients(payload)) {
            try { setFailedNotification({ payload, type: 'resume', dbTicketId, message: 'Notificación de Ticket Reanudado' }); } catch (err) { console.warn('No se pudo guardar failedNotification', err); }
            setSnackbar({ open: true, message: 'No hay destinatarios configurados para la notificación de reanudación (guardada para reintento)', severity: 'warning' });
          } else {
            await sendTicketMail(payload);
            setSnackbar({ open: true, message: 'Notificación de Ticket Reanudado enviada', severity: 'success' });
          }
        } catch (e) {
          console.error('Error enviando notificación de reanudación', e);
          try { setFailedNotification({ payload, type: 'resume', dbTicketId, message: 'Notificación de Ticket Reanudado' }); } catch (err) { console.warn('No se pudo guardar failedNotification', err); }
          setSnackbar({ open: true, message: 'Falló envío de notificación (ver consola)', severity: 'warning' });
        }
      } catch (e) {
        console.error('Error construyendo/enviando notificación de reanudación', e);
        // don't override main error handler; just show warning
        setSnackbar({ open: true, message: 'No se pudo enviar notificación de reanudación', severity: 'warning' });
      }
    } catch (e) {
      console.error('Error reanudando ticket', e);
      setError('Error al reanudar el ticket');
    } finally {
      setPauseLoading(false);
    }
  };

  
  // Reintentar envío de notificación fallida
  const resendNotification = async () => {
    setNotifRetryLoading(true);
    try {
      if (failedNotification && failedNotification.payload) {
        const { payload } = failedNotification;
        try {
          // intentar garantizar destinatarios: creador + asignados
          const dbTicketId = failedNotification.dbTicketId || ticketKey || id || (payload?.ticket?.ticketId);
          const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
          if (dbTicketId) {
            const ticketSnap = await get(dbRef(dbInstance, `tickets/${dbTicketId}`));
            if (ticketSnap.exists()) {
              const ticketObj = ticketSnap.val();
              let toList = [];
              if (ticketObj.asignadoEmails && ticketObj.asignadoEmails.length) toList = ticketObj.asignadoEmails.slice();
              else if (ticketObj.asignados && ticketObj.asignados.length) {
                const resolved = ticketObj.asignados.map(idu => { const u = usuarios.find(x => x.id === idu); return u ? u.email : null; }).filter(Boolean);
                toList = resolved;
              } else if (ticketObj.asignadoEmail) toList = [ticketObj.asignadoEmail];
              const creatorEmail = ticketObj.usuarioEmail ? String(ticketObj.usuarioEmail).toLowerCase() : null;
              const normalized = (toList || []).map(e => String(e || '').toLowerCase()).filter(Boolean);
              if (creatorEmail) normalized.push(creatorEmail);
              const unique = Array.from(new Set(normalized));
              // aplicar al payload
              if (payload && payload.ticket) payload.ticket.to = unique;
            }
          }
        } catch (e) {
          console.warn('No se pudo reconstruir destinatarios desde DB, usando payload original', e);
        }
        if (!ensurePayloadHasRecipients(payload)) {
          setSnackbar({ open: true, message: 'No se encontraron destinatarios al reconstruir la notificación', severity: 'error' });
        } else {
          await sendTicketMail(payload);
          setSnackbar({ open: true, message: `${failedNotification.message} reenviada`, severity: 'success' });
          setFailedNotification(null);
        }
        setFailedNotification(null);
        return;
      }
      // Si no hay payload guardado, permitir admin reconstruir con los datos actuales del ticket
      if (!isAdmin) {
        setSnackbar({ open: true, message: 'No hay notificación fallida para reintentar', severity: 'info' });
        return;
      }
      // Reconstruir payload mínimo a partir del ticket actual
      const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      const dbTicketId = ticketKey || id;
      const ticketSnap = await get(dbRef(dbInstance, `tickets/${dbTicketId}`));
      if (!ticketSnap.exists()) { setSnackbar({ open: true, message: 'Ticket no encontrado para reintento', severity: 'error' }); return; }
      const ticketObj = ticketSnap.val();
      const depObj = departamentos.find(d => d.id === ticketObj.departamento);
      const departamentoNombre = depObj ? depObj.nombre : ticketObj.departamento;
      const baseUrl = window.location.origin;
      const ticketForHtml = { ...ticketObj, ticketId: ticketObj.codigo || dbTicketId, departamentoNombre };
      // destinatarios simplificados
      let toList = [];
      if (ticketObj.asignadoEmails && ticketObj.asignadoEmails.length) toList = ticketObj.asignadoEmails.slice();
      else if (ticketObj.asignados && ticketObj.asignados.length) {
        const resolved = ticketObj.asignados.map(idu => { const u = usuarios.find(x => x.id === idu); return u ? u.email : null; }).filter(Boolean);
        toList = resolved;
      } else if (ticketObj.asignadoEmail) toList = [ticketObj.asignadoEmail];
      const creatorEmail = ticketObj.usuarioEmail ? String(ticketObj.usuarioEmail).toLowerCase() : null;
      const normalized = (toList || []).map(e => String(e || '').toLowerCase()).filter(Boolean);
      if (creatorEmail) normalized.push(creatorEmail);
      const unique = Array.from(new Set(normalized));
      const payload = buildSendMailPayload({
        ticket: { ...ticketForHtml, to: unique },
        departamento: ticketObj.departamento,
        departamentoNombre,
        subject: `[Reenvío manual] ${ticketObj.tipo || ''} #${ticketObj.codigo || dbTicketId}`,
        actionMsg: `Reintento manual de notificación por administrador`,
        htmlOverride: generateTicketEmailHTML({ ticket: ticketForHtml, baseUrl }),
        cc: []
      });
      if (!ensurePayloadHasRecipients(payload)) {
        setSnackbar({ open: true, message: 'No hay destinatarios para la notificación reconstruida', severity: 'error' });
      } else {
        await sendTicketMail(payload);
        setSnackbar({ open: true, message: 'Notificación reenviada (reconstruida por admin)', severity: 'success' });
      }
    } catch (err) {
      console.error('Reintento de notificación falló', err);
      setSnackbar({ open: true, message: 'Reintento falló (ver consola)', severity: 'error' });
    } finally {
      setNotifRetryLoading(false);
    }
  };

  // Helper: asegurar que el payload contiene destinatarios antes de intentar enviar
  function ensurePayloadHasRecipients(payload) {
    try {
      const t = payload && payload.ticket ? payload.ticket : {};
      const toArr = Array.isArray(payload?.to) ? payload.to : (Array.isArray(t?.to) ? t.to : []);
      const normalized = (toArr || []).map(x => String(x || '').toLowerCase()).filter(Boolean).filter(s => /@/.test(s));
      return normalized.length > 0;
    } catch {
      return false;
    }
  }

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
        
        // Calcular SLA para incluir en el correo
        const slaInfo = calculateSlaForTicket(ticketForHtml);
        if (slaInfo && slaInfo.slaHours != null) {
          ticketForHtml.slaHours = slaInfo.slaHours;
          ticketForHtml.slaHoursOriginal = slaInfo.slaHours;
          ticketForHtml.slaHoursExplicit = slaInfo.slaHours;
        }
        
        const resumenCambios = `Nuevo comentario por ${commentData.authorName || commentData.authorEmail}`;
        
        // Incluir el comentario en el objeto ticket para que la plantilla lo muestre automáticamente
        const ticketForHtmlWithComment = {
          ...ticketForHtml,
          latestComment: {
            authorName: commentData.authorName,
            author: commentData.authorName,
            authorEmail: commentData.authorEmail,
            text: commentData.text,
            comment: commentData.text,
            body: commentData.text,
            attachmentUrl: commentData.attachmentUrl,
            attachmentName: commentData.attachmentName
          }
        };
        
        // Generar el HTML usando la plantilla con el comentario incluido
        let html = generateTicketEmailHTML({ ticket: ticketForHtmlWithComment, baseUrl, extraMessage: resumenCambios });
        
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
        // Usar ticketForHtmlWithComment que ya incluye latestComment
        const ticketForHtmlWithTo = { ...ticketForHtmlWithComment, to: unique, comment: commentData };
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
      try { notify('Todos los campos son obligatorios', 'error', { mode: 'toast', persist: true }); } catch { setError('Todos los campos son obligatorios'); }
      return;
    }
    setError('');
  setSaving(true);
  setJustSaved(false);
    try {
      const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');

      let adjUrl = form.adjuntoUrl;
      let adjNombre = form.adjuntoNombre;
  // eliminados campos y subida de archivos de resolución; las conversaciones reemplazan este flujo

      // Procesamiento de múltiples adjuntos
      let existingAttachments = Array.isArray(form.attachments) ? [...form.attachments] : [];
      if (!existingAttachments.length && (adjUrl || form.adjuntoUrl)) {
        // migrar legacy single si todavía no está
        existingAttachments.push({ url: adjUrl || form.adjuntoUrl, nombre: adjNombre || form.adjuntoNombre || 'Adjunto' });
      }
      const uploadedNew = [];
      if (newAdjuntos && newAdjuntos.length) {
        for (const file of newAdjuntos) {
          try {
            const upRef = storageRef(storage, `tickets/attachments/${Date.now()}_${file.name}`);
            const snap = await uploadBytes(upRef, file);
            const url = await getDownloadURL(snap.ref);
            uploadedNew.push({ url, nombre: file.name });
          } catch (e) {
            console.warn('Error subiendo adjunto', file.name, e);
          }
        }
      }
      const allAttachments = [...existingAttachments, ...uploadedNew];
      // Asegurar que adjuntoUrl/Nombre legacy apunten al primero (retrocompatibilidad)
      if (!adjUrl && allAttachments[0]) {
        adjUrl = allAttachments[0].url;
        adjNombre = allAttachments[0].nombre;
      }
      const ticketData = {
        ...form,
        attachments: allAttachments,
        usuario: form.usuario || (userData?.nombre ? `${userData.nombre} ${userData.apellido || ''}`.trim() : (user?.email || '')),
        usuarioEmail: user?.email || '',
        estado: form.estado || 'Abierto',
        adjuntoUrl: adjUrl || '',
        adjuntoNombre: adjNombre || '',
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
          // Construir código por recinto; para CORPORATIVO usamos prefijo CORP
          const buildTicketCode = (recKey, sequence) => {
            if (!recKey) return `T-${newRef.key.substring(0,6)}`;
            // Si el recinto es CORPORATIVO (o mapeado), usar CORP-0001
            if (recKey === 'CORPORATIVO' || recKey === 'CORPORATIVO'.toString()) {
              return `CORP-${padNum(sequence, 4)}`;
            }
            // por defecto mantener formato RECINTO-0001
            return `${recKey}-${padNum(sequence, 4)}`;
          };
          ticketData.codigo = buildTicketCode(recintoKey, seq);
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
          // Si el ticket ya estaba cerrado, solo admin o el creador pueden reabrirlo
          if (prev && String(prev.estado) === 'Cerrado' && ticketData && ticketData.estado && ticketData.estado !== 'Cerrado' && !(isAdmin || isCreator)) {
            setError('Ticket cerrado: solo un administrador o el creador puede reabrirlo');
            return;
          }
          const isAssignedPrev = matchesAssignToUser(prev, user);
          // permisos: admin, usuario asignado, creador o usuario del mismo departamento pueden modificar
          if (!isAdmin && !isAssignedPrev && !(reassignMode && wasOriginallyAssigned) && !isCreator && !isSameDepartment) {
            setError('No tienes permisos para modificar este ticket');
            return;
          }
          // si es usuario asignado o del mismo departamento (no admin) (o estaba asignado originalmente y está en modo reasignación), permitir estado y (en modo reasignación) asignados/subcategoría
          if (!isAdmin && (isAssignedPrev || isSameDepartment || (reassignMode && wasOriginallyAssigned))) {
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
                      // Añadir horas SLA y tiempo de resolución (si aplica) para que aparezca en el email
                      try {
                        const slaVal = getSlaHours(ticketForHtml, slaConfigs, slaSubcats, tipos, subcats);
                        if (slaVal != null) ticketForHtml.slaHours = slaVal;
                        const tiempo = computeResolutionHoursForTicket(ticketForHtml);
                        if (tiempo != null) ticketForHtml.tiempoLaboral = tiempo;
                      } catch { /* ignore */ }
                      const resumenCambios = 'Ticket reasignado';
                      let html = generateTicketEmailHTML({ ticket: ticketForHtml, baseUrl, extraMessage: resumenCambios });
                      // Asegurar incluir al creador del ticket en los destinatarios
                      const creatorEmail = (prev && prev.usuarioEmail) ? String(prev.usuarioEmail).toLowerCase() : null;
                      const toWithCreator = Array.from(new Set([...(resolvedEmails || []), ...(creatorEmail ? [creatorEmail] : [])]));
                      const payload = buildSendMailPayload({
                        ticket: { ...ticketForHtml, to: toWithCreator },
                        departamento: prev.departamento,
                        departamentoNombre,
                        subject: `[Reasignado] ${prev.tipo || ''} #${prev.codigo || dbTicketId}`,
                        actionMsg: resumenCambios,
                        htmlOverride: html,
                        cc: [user?.email].filter(Boolean)
                      });
                      try { console.debug && console.debug('Enviar reasignación', { to: resolvedEmails, subject: payload.subject }); } catch (err) { console.warn('Debug log failed', err); }
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
          } else if (!isAdmin && isCreator) {
            // permiso especial: el creador puede CERRAR su propio ticket y también REABRIRLO, pero no cambiar otros campos
            if (ticketData.estado && ticketData.estado !== prev.estado) {
              if (ticketData.estado === 'Cerrado') {
                const closeUpdate = {
                  estado: 'Cerrado',
                  resueltoPorUid: user?.uid || '',
                  resueltoPorEmail: user?.email || '',
                  resueltoPorNombre: userData?.nombre ? `${userData.nombre} ${userData.apellido || ''}`.trim() : (user?.email || ''),
                  resueltoEn: new Date().toISOString(),
                };
                await update(dbRef(dbInstance, `tickets/${dbTicketId}`), closeUpdate);
                shouldNotify = true;
                setSnackbar({ open: true, message: 'Ticket cerrado', severity: 'success' });
                ticketIdFinal = ticketData.codigo || dbTicketId;
              } else if (prev && String(prev.estado) === 'Cerrado' && ticketData.estado !== 'Cerrado') {
                // Reapertura por el creador: limpiar campos de resolución y actualizar estado
                const reopenUpdate = {
                  estado: ticketData.estado,
                  resueltoPorUid: null,
                  resueltoPorEmail: null,
                  resueltoPorNombre: null,
                  resueltoEn: null,
                  // opcional: reiniciar SLA
                  lastSlaStartAt: Date.now(),
                };
                await update(dbRef(dbInstance, `tickets/${dbTicketId}`), reopenUpdate);
                shouldNotify = true;
                setSnackbar({ open: true, message: 'Ticket reabierto', severity: 'success' });
                ticketIdFinal = ticketData.codigo || dbTicketId;
              } else {
                setError('No tienes permisos para modificar este ticket');
                return;
              }
            } else {
              setError('No se detectaron cambios permitidos');
              return;
            }
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
                      // Añadir horas SLA y tiempo de resolución para admin emails
                      try {
                        const slaVal = getSlaHours(ticketForHtml, slaConfigs, slaSubcats, tipos, subcats);
                        if (slaVal != null) ticketForHtml.slaHours = slaVal;
                        const tiempo = computeResolutionHoursForTicket(ticketForHtml);
                        if (tiempo != null) ticketForHtml.tiempoLaboral = tiempo;
                      } catch { /* ignore */ }
                      const resumenCambios = 'Ticket reasignado';
                      let html = generateTicketEmailHTML({ ticket: ticketForHtml, baseUrl, extraMessage: resumenCambios });
                      // Incluir creador del ticket en destinatarios
                      const creatorEmailAdmin = (prev && prev.usuarioEmail) ? String(prev.usuarioEmail).toLowerCase() : null;
                      const toWithCreatorAdmin = Array.from(new Set([...(resolvedEmails || []), ...(creatorEmailAdmin ? [creatorEmailAdmin] : [])]));
                      const payload = buildSendMailPayload({
                        ticket: { ...ticketForHtml, to: toWithCreatorAdmin },
                        departamento: prev.departamento,
                        departamentoNombre,
                        subject: `[Reasignado] ${prev.tipo || ''} #${prev.codigo || dbTicketId2}`,
                        actionMsg: resumenCambios,
                        htmlOverride: html,
                        cc: [user?.email].filter(Boolean)
                      });
                      try { console.debug && console.debug('Enviar reasignación (admin)', { to: resolvedEmails, subject: payload.subject }); } catch (err) { console.warn('Debug log failed', err); }
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
          // obtener versión actual desde la DB (asegura que usamos el estado guardado)
          const dbTicketIdFinal = ticketKey || id;
          const latestSnap = await get(dbRef(dbInstance, `tickets/${dbTicketIdFinal}`));
          const latestTicket = latestSnap.exists() ? latestSnap.val() : ticketData;
          const baseUrl = window.location.origin;
          const depObj = departamentos.find(d => d.id === latestTicket.departamento);
          const departamentoNombre = depObj ? depObj.nombre : latestTicket.departamento;
          const ticketForHtml = { ...latestTicket, ticketId: latestTicket.codigo || ticketIdFinal, departamentoNombre };
          
          // Calcular SLA para incluir en el correo
          const slaInfo = calculateSlaForTicket(ticketForHtml);
          if (slaInfo && slaInfo.slaHours != null) {
            ticketForHtml.slaHours = slaInfo.slaHours;
            ticketForHtml.slaHoursOriginal = slaInfo.slaHours;
            ticketForHtml.slaHoursExplicit = slaInfo.slaHours;
          }
          // Asegurar que incluso si el ticket está cerrado, los emails de admin muestren slaHours y tiempo de resolución
          try {
            if (!ticketForHtml.slaHours) {
              const slaVal = getSlaHours(ticketForHtml, slaConfigs, slaSubcats, tipos, subcats);
              if (slaVal != null) ticketForHtml.slaHours = slaVal;
            }
            const tiempo = computeResolutionHoursForTicket(ticketForHtml);
            if (tiempo != null) ticketForHtml.tiempoLaboral = tiempo;
          } catch { /* ignore */ }
          
          const resumenCambios = isNew ? 'Creación de ticket' : `Cambio de estado a ${ticketForHtml.estado}`;
          const html = generateTicketEmailHTML({ ticket: ticketForHtml, baseUrl, extraMessage: resumenCambios });
          const ticketLabel = ticketForHtml.codigo || ticketIdFinal;
          const subject = `[Ticket ${ticketForHtml.estado}] ${ticketForHtml.tipo || ''} #${ticketLabel}`;
          // destinatarios: resolver asignados y asegurarse de incluir al creador
          let toList = [];
          if (ticketForHtml.asignadoEmails && ticketForHtml.asignadoEmails.length) {
            toList = ticketForHtml.asignadoEmails.slice();
          } else if (ticketForHtml.asignados && ticketForHtml.asignados.length) {
            const resolved = ticketForHtml.asignados.map(idu => {
              const u = usuarios.find(x => x.id === idu);
              return u ? u.email : null;
            }).filter(Boolean);
            toList = resolved;
          } else if (ticketForHtml.asignadoEmail) {
            toList = [ticketForHtml.asignadoEmail];
          }
          // incluir siempre al creador (usuarioEmail) para cambios de estado/creación
          const creatorEmail = ticketForHtml.usuarioEmail ? String(ticketForHtml.usuarioEmail).toLowerCase() : null;
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
          // DEBUG: confirmar que entramos al flujo de notificación y cuál es el payload
          try { console.debug && console.debug('Enviando notificación ticket', { subject, to: ticketForHtmlWithTo.to, departamento: ticketData.departamento }); } catch (err) { console.warn('Debug log failed', err); }
          try { console.debug && console.debug('Enviando notificación ticket', { subject, to: ticketForHtmlWithTo.to, departamento: ticketData.departamento }); } catch (err) { console.warn('Debug log failed', err); }
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
  setNewAdjuntos([]); // limpiar selección de nuevos
  setTimeout(() => navigate(`/tickets/${ticketData.codigo || ticketIdFinal}`), 900);
    } catch (e) {
      console.error(e);
      setError('Error al guardar ticket');
      setSaving(false);
    }
  };

  // Eliminar ticket (solo creador o admin)
  const handleConfirmDelete = async () => {
    if (!canDelete) { setDeleteDialogOpen(false); return; }
    setDeleting(true);
    try {
      const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      const dbTicketId = ticketKey || id;
      await remove(dbRef(dbInstance, `tickets/${dbTicketId}`));
      setSnackbar({ open: true, message: 'Ticket eliminado', severity: 'success' });
      setDeleteDialogOpen(false);
      // navegar atrás a listado
      navigate('/tickets');
    } catch (e) {
      console.error('Error eliminando ticket', e);
      setSnackbar({ open: true, message: 'Error eliminando ticket', severity: 'error' });
      setDeleteDialogOpen(false);
    } finally {
      setDeleting(false);
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
      <Paper
        sx={{
          p: 3,
          borderRadius: 3,
          boxShadow: theme => theme.shadows[2],
          backgroundColor: theme => theme.palette.background.paper,
          '&:hover': {
            boxShadow: theme => theme.shadows[4],
          }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 900 }}>{isNew ? 'Nuevo Ticket' : `Ticket ${form.codigo || id}`}</Typography>
            {!isNew && (
              <Typography variant="caption" color="text.secondary">Tiempo trabajado: {msToHoursMinutes(computeWorkedMsForTicket(form))}</Typography>
            )}
          </Box>
          {!isNew && canDelete && (
            <Tooltip title="Eliminar ticket" placement="left">
              <span>
                <IconButton color="error" onClick={() => setDeleteDialogOpen(true)} disabled={saving || deleting} size="small" sx={{ bgcolor: 'error.light', '&:hover': { bgcolor: 'error.main', color: 'error.contrastText' } }}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
  {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
  {/* Alert de éxito removido; se usa Snackbar inferior */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
          <TextField
            select
            label="Solicitud para"
            value={form.departamento}
            onChange={e => setForm(f => ({ ...f, departamento: e.target.value, tipo: '' }))}
            disabled={saving || (!isNew && !isAdmin)}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                backgroundColor: theme => theme.palette.background.paper,
                '&:hover': {
                  backgroundColor: theme => theme.palette.action.hover,
                },
                '&.Mui-focused': {
                  backgroundColor: theme => theme.palette.background.paper,
                }
              }
            }}
          >
            <MenuItem value="" disabled>Selecciona un departamento</MenuItem>
            {departamentos.map(d => <MenuItem key={d.id} value={d.id}>{d.nombre}</MenuItem>)}
          </TextField>
          <TextField
            select
            label="Categoría"
            value={form.tipo}
            onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
            disabled={saving || (!isNew && !isAdmin)}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                backgroundColor: theme => theme.palette.background.paper,
                '&:hover': {
                  backgroundColor: theme => theme.palette.action.hover,
                },
                '&.Mui-focused': {
                  backgroundColor: theme => theme.palette.background.paper,
                }
              }
            }}
          >
            <MenuItem value="" disabled>Selecciona una categoría</MenuItem>
            {form.departamento && tipos[form.departamento] && Object.entries(tipos[form.departamento]).map(([id, nombre]) => (
              <MenuItem key={id} value={nombre}>{nombre}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Subcategoría"
            value={form.subcategoria}
            onChange={e => setForm({...form, subcategoria: e.target.value})}
            disabled={saving || (!isNew && !isAdmin && !reassignMode)}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                backgroundColor: theme => theme.palette.background.paper,
                '&:hover': {
                  backgroundColor: theme => theme.palette.action.hover,
                },
                '&.Mui-focused': {
                  backgroundColor: theme => theme.palette.background.paper,
                }
              }
            }}
          >
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
            renderInput={(params) => (
              <TextField
                {...params}
                label="Asignar solicitud a: (múltiple)"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    backgroundColor: theme => theme.palette.background.paper,
                    '&:hover': {
                      backgroundColor: theme => theme.palette.action.hover,
                    },
                    '&.Mui-focused': {
                      backgroundColor: theme => theme.palette.background.paper,
                    }
                  }
                }}
              />
            )}
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
          <TextField
            label="Descripción"
            multiline
            minRows={3}
            value={form.descripcion}
            onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
            disabled={saving || (!isNew && !isAdmin)}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                backgroundColor: theme => theme.palette.background.paper,
                '&:hover': {
                  backgroundColor: theme => theme.palette.action.hover,
                },
                '&.Mui-focused': {
                  backgroundColor: theme => theme.palette.background.paper,
                }
              }
            }}
          />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button
                variant="outlined"
                component="label"
                disabled={saving || (!isNew && !isAdmin)}
                sx={{
                  textTransform: 'none',
                  borderRadius: 2,
                  fontWeight: 600,
                  px: 3,
                  '&:hover': {
                    backgroundColor: theme => theme.palette.primary.main,
                    color: theme => theme.palette.primary.contrastText,
                  }
                }}
              >
                {newAdjuntos.length ? `${newAdjuntos.length} archivo(s) seleccionados` : 'Seleccionar adjuntos'}
                <input
                  type="file"
                  hidden
                  multiple
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    setNewAdjuntos(prev => [...prev, ...files]);
                  }}
                />
              </Button>
              {newAdjuntos.length > 0 && (
                <Button
                  variant="text"
                  color="error"
                  disabled={saving}
                  onClick={() => setNewAdjuntos([])}
                  sx={{
                    textTransform: 'none',
                    borderRadius: 2,
                    fontWeight: 600,
                    '&:hover': {
                      backgroundColor: theme => theme.palette.error.main,
                      color: theme => theme.palette.error.contrastText,
                    }
                  }}
                >
                  Limpiar selección
                </Button>
              )}
            </Box>
            {/* Lista de adjuntos ya guardados (form.attachments) */}
            {Array.isArray(form.attachments) && form.attachments.length > 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>Adjuntos:</Typography>
                {form.attachments.map((a, idx) => (
                  <Button
                    key={idx}
                    href={a.url}
                    target="_blank"
                    size="small"
                    variant="text"
                    sx={(theme) => ({
                      justifyContent: 'flex-start',
                      textTransform: 'none',
                      fontSize: 12,
                      maxWidth: 320,
                      fontWeight: 600,
                      color: theme.palette.mode === 'dark' ? theme.palette.primary.light : 'inherit',
                      backgroundColor: theme.palette.mode === 'dark' ? theme.palette.action.hover : 'transparent',
                      borderRadius: 2,
                      '&:hover': {
                        backgroundColor: theme.palette.mode === 'dark' ? theme.palette.primary.dark : theme.palette.action.hover,
                        color: theme.palette.mode === 'dark' ? theme.palette.primary.contrastText : 'inherit'
                      }
                    })}
                  >
                    📎 {a.nombre || `Adjunto ${idx+1}`}
                  </Button>
                ))}
              </Box>
            )}
            {/* Soporte legacy: mostrar si no hay attachments pero sí adjuntoUrl */}
            {(!Array.isArray(form.attachments) || !form.attachments.length) && form.adjuntoUrl && (
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>Adjunto:</Typography><br />
                <Button
                  href={form.adjuntoUrl}
                  target="_blank"
                  size="small"
                  variant="text"
                  sx={(theme) => ({
                    textTransform: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    color: theme.palette.mode === 'dark' ? theme.palette.primary.light : 'inherit',
                    backgroundColor: theme.palette.mode === 'dark' ? theme.palette.action.hover : 'transparent',
                    borderRadius: 2,
                    '&:hover': {
                      backgroundColor: theme.palette.mode === 'dark' ? theme.palette.primary.dark : theme.palette.action.hover,
                      color: theme.palette.mode === 'dark' ? theme.palette.primary.contrastText : 'inherit'
                    }
                  })}
                >
                  📎 {form.adjuntoNombre || 'Adjunto'}
                </Button>
              </Box>
            )}
            {/* Mostrar selección nueva previa a guardar */}
            {newAdjuntos.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>Nuevos a subir:</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  {newAdjuntos.map((f, i) => (
                    <Typography variant="caption" key={i} sx={{ opacity: 0.85 }}>{f.name}</Typography>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
          <TextField
            select
            label="Estado"
            value={form.estado}
            onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}
            disabled={
              saving || isNew || (!isAdmin && !matchesAssignToUser(form, user) && !isCreator && !isSameDepartment) ||
              (originalEstado === 'Cerrado' && !isAdmin)
            }
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                backgroundColor: theme => theme.palette.background.paper,
                '&:hover': {
                  backgroundColor: theme => theme.palette.action.hover,
                },
                '&.Mui-focused': {
                  backgroundColor: theme => theme.palette.background.paper,
                }
              }
            }}
          >
            <MenuItem value="Abierto">Abierto</MenuItem>
            <MenuItem value="En Proceso">En Proceso</MenuItem>
            <MenuItem value="Cerrado">Cerrado</MenuItem>
          </TextField>
          {/* Botón explícito para iniciar ticket (transaccional) */}
          {(!isNew && form.estado === 'Abierto' && canInitiate) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button variant="contained" color="primary" onClick={handleInitiate} disabled={saving} sx={{ textTransform: 'none', fontWeight: 700 }}>
                Iniciar
              </Button>
            </Box>
          )}
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
            <Paper
              sx={{
                p: 3,
                mt: 2,
                borderRadius: 3,
                backgroundColor: theme => theme.palette.background.default,
                border: theme => `1px solid ${theme.palette.divider}`
              }}
              elevation={0}
            >
              <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700 }}>Control de Pausa</Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  select
                  size="small"
                  label="Motivo"
                  value={pauseReasonId}
                  onChange={e => setPauseReasonId(e.target.value)}
                  sx={{
                    minWidth: 220,
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      backgroundColor: theme => theme.palette.background.paper,
                    }
                  }}
                  disabled={saving}
                >
                  <MenuItem value="">(Sin seleccionar)</MenuItem>
                  {pauseReasons.map(r => <MenuItem key={r.id} value={r.id}>{r.nombre}</MenuItem>)}
                </TextField>
                <TextField
                  size="small"
                  label="Comentario"
                  value={pauseComment}
                  onChange={e => setPauseComment(e.target.value)}
                  sx={{
                    minWidth: 200,
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      backgroundColor: theme => theme.palette.background.paper,
                    }
                  }}
                  disabled={saving}
                />
                {!isPausedState ? (
                  <>
                    <Button
                      disabled={saving || !canControlPause || pauseLoading}
                      variant="contained"
                      color="warning"
                      onClick={handlePause}
                      sx={{
                        borderRadius: 2,
                        textTransform: 'none',
                        fontWeight: 600,
                        px: 3,
                        '&:hover': {
                          backgroundColor: theme => theme.palette.warning.dark,
                        }
                      }}
                    >
                      Pausar
                    </Button>
                    {failedNotification && (
                      <Button
                        disabled={notifRetryLoading}
                        variant="outlined"
                        color="secondary"
                        onClick={resendNotification}
                        startIcon={notifRetryLoading ? <CircularProgress size={16} /> : null}
                        sx={{
                          borderRadius: 2,
                          textTransform: 'none',
                          fontWeight: 600,
                          px: 3,
                          py: 1.5,
                          minHeight: 40,
                        }}
                      >
                        Reintentar notificación
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button
                      disabled={saving || !canControlPause || pauseLoading}
                      variant="contained"
                      color="success"
                      onClick={handleResume}
                      sx={{
                        borderRadius: 2,
                        textTransform: 'none',
                        fontWeight: 600,
                        px: 3,
                        '&:hover': {
                          backgroundColor: theme => theme.palette.success.dark,
                        }
                      }}
                    >
                      Reanudar
                    </Button>
                    {failedNotification && (
                      <Button
                        disabled={notifRetryLoading}
                        variant="outlined"
                        color="secondary"
                        onClick={resendNotification}
                        startIcon={notifRetryLoading ? <CircularProgress size={16} /> : null}
                        sx={{
                          borderRadius: 2,
                          textTransform: 'none',
                          fontWeight: 600,
                        }}
                      >
                        Reintentar notificación
                      </Button>
                    )}
                  </>
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
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
            <Button
              variant="outlined"
              onClick={() => navigate('/tickets')}
              color="inherit"
              disabled={saving && !justSaved}
              sx={{
                borderRadius: 2,
                textTransform: 'none',
                fontWeight: 600,
                px: 3,
                '&:hover': {
                  backgroundColor: theme => theme.palette.action.hover,
                }
              }}
            >
              Volver
            </Button>
            <Tooltip title={failedNotification ? (failedNotification.message || 'Reintentar notificación') : 'Reintentar notificación (reconstruye desde ticket actual)'}>
              <span>
                <Button
                  variant="outlined"
                  color="inherit"
                  onClick={resendNotification}
                  disabled={notifRetryLoading}
                  sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    px: 3,
                    py: 1.5,
                    minHeight: 40,
                    '&:hover': {
                      backgroundColor: theme => theme.palette.action.hover,
                    }
                  }}
                >
                  {notifRetryLoading ? <CircularProgress size={16} /> : 'Reintentar notificación'}
                </Button>
              </span>
            </Tooltip>
            <Tooltip placement="bottom" title={saving ? 'Guardando ticket...' : (isNew ? 'Crear ticket' : 'Actualizar ticket')}>
              <span>
                <Button
                  variant="contained"
                  onClick={handleSave}
                  disabled={
                    (saving && !justSaved) ||
                    (!isNew && !isAdmin && !(matchesAssignToUser(form, user) || isCreator || (reassignMode && wasOriginallyAssigned) || isSameDepartment)) ||
                    (originalEstado === 'Cerrado' && !isAdmin)
                  }
                  startIcon={isNew ? <AddIcon /> : <UpdateIcon />}
                  sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 700,
                    px: 3,
                    py: 1.5,
                    boxShadow: theme => theme.shadows[4],
                    '&:hover': {
                      boxShadow: theme => theme.shadows[6],
                    }
                  }}
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
      <Dialog open={deleteDialogOpen} onClose={() => (!deleting && setDeleteDialogOpen(false))} maxWidth="xs" fullWidth>
        <DialogTitle>Confirmar eliminación</DialogTitle>
        <DialogContent>
          <Typography variant="body2">¿Seguro que deseas eliminar este ticket? Esta acción no se puede deshacer.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>Cancelar</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" disabled={deleting}>{deleting ? 'Eliminando...' : 'Eliminar'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
