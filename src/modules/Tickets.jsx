// Import principal de MUI (un solo bloque para evitar duplicados)
import React, { useEffect, useState } from "react";
import { useNavigate } from 'react-router-dom';
import { generateTicketEmailHTML, buildSendMailPayload } from '../utils/ticketEmailTemplate';
import { sendTicketMail } from '../services/mailService';
import { calculateSlaRemaining } from '../utils/slaCalculator';
import { 
  Box,
  Typography,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Alert,
  CircularProgress,
  Paper,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Pagination,
  Tabs,
  Tab,
  Badge,
  Autocomplete
} from '@mui/material';
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import UpdateIcon from "@mui/icons-material/Update";
import SaveIcon from "@mui/icons-material/Save";
import { ref, get, set, update, remove, push, query, orderByChild } from "firebase/database";
import { storage } from "../firebase/firebaseConfig";
import { getDbForRecinto } from '../firebase/multiDb';
import { useDb } from '../context/DbContext';
import { useAuth } from "../context/useAuth";
import useNotification from '../context/useNotification';
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

export default function Tickets() {
  const { user, userData } = useAuth();
  const notify = useNotification();
  const { db: ctxDb, recinto, loading: dbLoading, tiposTickets: tiposFromCtx, subcategoriasTickets: subcatsFromCtx } = useDb();
  const [departamentos, setDepartamentos] = useState([]);
  const [tipos, setTipos] = useState({});
  const [subcats, setSubcats] = useState({});
  const [usuarios, setUsuarios] = useState([]);
  // SLA configuration states
  const [slaConfigs, setSlaConfigs] = useState({});
  const [slaSubcats, setSlaSubcats] = useState({});
  // const [tickets, setTickets] = useState([]); // ya no usamos el estado general
  const [assignedTickets, setAssignedTickets] = useState([]);
  const [createdTickets, setCreatedTickets] = useState([]);
  const [deptTickets, setDeptTickets] = useState([]);
  const [deptCreatedTickets, setDeptCreatedTickets] = useState([]);
  // tickets holds a superset (used for admin/all view)
  const [allTickets, setAllTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [viewTab, setViewTab] = useState('assigned');
  // archivo de resolución
  const [resAdjuntoFile, setResAdjuntoFile] = useState(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editTicket] = useState(null);
  const navigate = useNavigate();
  const [form, setForm] = useState({
    departamento: "",
    tipo: "",
    subcategoria: "",
    descripcion: "",
    estado: "Abierto",
    usuario: "",
    adjuntoUrl: "",
    adjuntoNombre: "",
  resolucionComentario: "",
  resolucionAdjuntoUrl: "",
  resolucionAdjuntoNombre: "",
  asignados: [], // array de user ids
  });
  const [adjunto, setAdjunto] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deleteDialog, setDeleteDialog] = useState({ open: false, ticketId: null });
  const [deleting, setDeleting] = useState(false);
  
  const isAdmin = (userData?.isSuperAdmin || userData?.rol === 'admin');

  // Ajustar vista inicial cuando cambie role
  useEffect(() => {
    if (isAdmin) setViewTab('all');
    else setViewTab('assigned');
  }, [isAdmin]);

  // Helper para determinar si un ticket está asignado al usuario
  const matchesAssignToUser = (ticket, userObj) => {
    if (!ticket || !userObj) return false;
    const uid = userObj.uid || '';
    const email = (userObj.email || '').toLowerCase();
    // backward compatibility single-assignee
    if (ticket.asignadoA && ticket.asignadoA === uid) return true;
    if (ticket.asignadoEmail && (ticket.asignadoEmail || '').toLowerCase() === email) return true;
    // new shape: ticket.asignados can be array of ids or array of objects {id,email,nombre}
    if (Array.isArray(ticket.asignados)) {
      // array of uids
      if (ticket.asignados.includes(uid)) return true;
      // array of objects
      if (ticket.asignados.some(a => (a?.id === uid) || ((a?.email || '').toLowerCase() === email))) return true;
      // array of emails or strings
      if (ticket.asignados.map(a => (typeof a === 'string' ? a.toLowerCase() : (a?.email || '').toLowerCase())).includes(email)) return true;
    }
    // compatibilidad con antiguo campo 'asignado'
    if (Array.isArray(ticket.asignado)) return ticket.asignado.includes(uid) || ticket.asignado.map(a => (a || '').toLowerCase()).includes(email);
    if (typeof ticket.asignado === 'string') return (ticket.asignado === uid) || ((ticket.asignado || '').toLowerCase() === email);
    return false;
  };

  // Helper para calcular SLA usando la función utilitaria
  const calculateSlaForTicket = (ticket) => {
    return calculateSlaRemaining(ticket, slaConfigs, slaSubcats, tipos, subcats);
  };

  // Construir lista plana de tickets para la tabla (debe ir después de definir tickets a renderizar)
  const ticketsToRender = viewTab === 'assigned' ? assignedTickets
    : viewTab === 'created' ? createdTickets
    : viewTab === 'dept' ? deptTickets
    : viewTab === 'deptCreated' ? deptCreatedTickets
    : allTickets;

  const [nowTick, setNowTick] = useState(Date.now());
  // Intervalo para refrescar SLA cada 60s
  useEffect(() => {
    const int = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(int);
  }, []);

  const ticketsTabla = (ticketsToRender || []).map(t => ({
    ...t,
    _departamentoId: t.departamento,
    departamento: (departamentos.find(d => d.id === t.departamento)?.nombre) || t.departamento,
    _createdAt: t.createdAt || t.fecha || t.timestamp || null,
    _forceSlaRecalcAt: nowTick, // campo fantasma para re-render de SLA
  }));

  // Ordenar ticketsTabla por fecha de creación descendente (más recientes primero)
  const ticketsTablaSorted = React.useMemo(() => {
    try {
      const copy = Array.isArray(ticketsTabla) ? [...ticketsTabla] : [];
      copy.sort((a, b) => {
        const aTs = a?._createdAt ? (typeof a._createdAt === 'number' ? a._createdAt : Date.parse(String(a._createdAt))) : 0;
        const bTs = b?._createdAt ? (typeof b._createdAt === 'number' ? b._createdAt : Date.parse(String(b._createdAt))) : 0;
        return (bTs || 0) - (aTs || 0);
      });
      return copy;
    } catch {
      return ticketsTabla;
    }
  }, [ticketsTabla]);

  // Estado y utilidades para la vista de tabla (filtro, búsqueda y contador de cerrados)
  const [tableFilter, setTableFilter] = useState('Todos'); // 'Todos'|'Abierto'|'En Proceso'|'Cerrado'
  const [searchQuery, setSearchQuery] = useState(''); // texto de búsqueda para filtrar tickets
  const closedCount = ticketsTablaSorted.filter(t => t.estado === 'Cerrado').length;

  // helper para comprobar coincidencia de búsqueda (case-insensitive)
  const matchesSearch = (ticket, q) => {
    if (!q) return true;
    const s = String(q).trim().toLowerCase();
    if (!s) return true;
    const fields = [ticket.id, ticket.codigo, ticket.tipo, ticket.departamento, ticket.descripcion, ticket.usuario, ticket.subcategoria];
    return fields.some(f => (f || '').toString().toLowerCase().includes(s));
  };

  // aplicar filtro por estado y luego búsqueda por texto
  const stateFiltered = tableFilter === 'Todos' ? ticketsTablaSorted : ticketsTablaSorted.filter(t => t.estado === tableFilter);
  const filteredTickets = searchQuery ? stateFiltered.filter(t => matchesSearch(t, searchQuery)) : stateFiltered;
  // Paginación simple
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const pageCount = Math.max(1, Math.ceil(filteredTickets.length / PAGE_SIZE));
  // asegurarse de que la página esté en rango usando useEffect
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const pageTickets = filteredTickets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // loader UI will be rendered inside the main JSX to avoid conditional hooks

  // Cargar departamentos, tipos y tickets
  useEffect(() => {
    const fetchData = async () => {
      // Si el contexto aún está inicializando y no tenemos db, esperar al siguiente ciclo
      if (dbLoading && !ctxDb) return;
      setTicketsLoading(true);
      const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');

      // Departamentos
      const depSnap = await get(ref(dbInstance, "departamentos"));
      let localDepartamentos = [];
      if (depSnap.exists()) {
        const deps = Object.entries(depSnap.val()).map(([id, nombre]) => ({ id, nombre }));
        deps.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));
        setDepartamentos(deps);
        localDepartamentos = deps;
      } else {
        setDepartamentos([]);
        localDepartamentos = [];
      }

      // Tipos y subcategorias: preferir datos del contexto si estan disponibles (onValue global)
      if (tiposFromCtx && Object.keys(tiposFromCtx).length) setTipos(tiposFromCtx);
      else {
        const tiposSnap = await get(ref(dbInstance, "tiposTickets"));
        setTipos(tiposSnap.exists() ? tiposSnap.val() : {});
      }
      if (subcatsFromCtx && Object.keys(subcatsFromCtx).length) setSubcats(subcatsFromCtx);
      else {
        const subSnap = await get(ref(dbInstance, 'subcategoriasTickets'));
        setSubcats(subSnap.exists() ? subSnap.val() : {});
      }

      // SLA configurations
      try {
        const [slaConfigSnap, slaSubcatsSnap] = await Promise.all([
          get(ref(dbInstance, 'sla/configs')),
          get(ref(dbInstance, 'sla/subcategorias'))
        ]);
        setSlaConfigs(slaConfigSnap.exists() ? slaConfigSnap.val() : {});
        setSlaSubcats(slaSubcatsSnap.exists() ? slaSubcatsSnap.val() : {});
      } catch (e) {
        console.warn('No se pudo cargar configuración SLA', e);
        setSlaConfigs({});
        setSlaSubcats({});
      }

      // Usuarios
      let allUsers = [];
      try {
        const usersSnap = await get(ref(dbInstance, 'usuarios'));
        if (usersSnap.exists()) {
          allUsers = Object.entries(usersSnap.val()).map(([id, u]) => ({ id, ...u }));
          setUsuarios(allUsers);
        } else {
          setUsuarios([]);
        }
      } catch (e) {
        console.warn('No se pudo cargar usuarios', e);
        setUsuarios([]);
      }

      // Preparar candidatos de departamento del usuario (puede ser nombre en userData)
      const userDeptRaw = (userData?.departamento || '').trim();
      const matchedDep = userDeptRaw ? localDepartamentos?.find(d => String(d.nombre).toLowerCase() === String(userDeptRaw).toLowerCase() || String(d.id) === String(userDeptRaw)) : null;
      const userDeptCandidates = new Set([userDeptRaw, matchedDep?.id, matchedDep?.nombre].filter(Boolean));
      const matchesUserDept = (ticketDept) => {
        if (!userDeptCandidates.size) return false;
        if (!ticketDept) return false;
        if (userDeptCandidates.has(ticketDept)) return true;
        if (typeof ticketDept === 'string') {
          if (ticketDept.includes('/')) {
            const last = ticketDept.split('/').filter(Boolean).pop();
            if (last && userDeptCandidates.has(last)) return true;
          }
          const depByName = localDepartamentos.find(d => d.nombre === ticketDept);
          if (depByName && (userDeptCandidates.has(depByName.id) || userDeptCandidates.has(depByName.nombre))) return true;
        }
        if (typeof ticketDept === 'object') {
          const candId = ticketDept.id || ticketDept.key || ticketDept.value;
          if (candId && userDeptCandidates.has(candId)) return true;
          const candName = ticketDept.nombre || ticketDept.name || ticketDept.label;
          if (candName && userDeptCandidates.has(candName)) return true;
          if (candName) {
            const depByName = localDepartamentos.find(d => d.nombre === candName);
            if (depByName && userDeptCandidates.has(depByName.id)) return true;
          }
        }
        return false;
      };

      // Helper para determinar si un ticket fue creado por alguien del departamento del usuario
      const matchesDeptCreator = (ticket, allUsers) => {
        if (!ticket.usuarioEmail || !allUsers || !userDeptCandidates.size) return false;
        // Buscar el usuario que creó el ticket basándose en su email
        const creator = allUsers.find(u => (u.email || '').toLowerCase() === (ticket.usuarioEmail || '').toLowerCase());
        if (!creator) return false;
        // Verificar si el creador pertenece al mismo departamento
        const creatorDeptRaw = (creator.departamento || '').trim();
        if (userDeptCandidates.has(creatorDeptRaw)) return true;
        // También verificar por ID de departamento
        const creatorDept = localDepartamentos.find(d => d.nombre === creatorDeptRaw);
        return creatorDept && userDeptCandidates.has(creatorDept.id);
      };

      // Tickets: para rendimiento, hacer consultas por índices cuando sea posible
      try {
        if (isAdmin) {
          const ticketsSnap = await get(ref(dbInstance, "tickets"));
          const all = ticketsSnap.exists() ? Object.entries(ticketsSnap.val()).map(([id, t]) => ({ id, ...t })) : [];
          // normalize asignados field
          all.forEach(t => {
            if (!t.asignados && (t.asignadoA || t.asignadoEmail || t.asignado)) {
              const arr = [];
              if (t.asignadoA) arr.push(t.asignadoA);
              if (t.asignadoEmail) arr.push(t.asignadoEmail);
              if (t.asignado && Array.isArray(t.asignado)) arr.push(...t.asignado);
              t.asignados = arr;
            }
          });
          setAllTickets(all);
          setAssignedTickets(all.filter(t => matchesAssignToUser(t, user)));
          setCreatedTickets(all.filter(t => (t.usuarioEmail || '').toLowerCase() === (user?.email || '').toLowerCase()));
          setDeptTickets(all.filter(t => matchesUserDept(t.departamento)));
          setDeptCreatedTickets(all.filter(t => matchesDeptCreator(t, allUsers)));
        } else {
          // Ejecutar consultas específicas para minimizar lectura completa
          const uid = user?.uid || '';
          const email = (user?.email || '').toLowerCase();
          const assignedQuery = query(ref(dbInstance, 'tickets'), orderByChild('asignadoA'));
          const createdQuery = query(ref(dbInstance, 'tickets'), orderByChild('usuarioEmail'));
          const deptQuery = query(ref(dbInstance, 'tickets'), orderByChild('departamento'));

          // Nota: Realtime Database no permite múltiples equalTo en una sola llamada; hacemos gets separados y filtramos localmente
          const [assignedSnap, createdSnap, deptSnapTickets] = await Promise.all([
            get(assignedQuery),
            get(createdQuery),
            get(deptQuery),
          ]);

          // Asignados a mí (filtrar por campo asignadoA o asignadoEmail)
          let assigned = [];
          if (assignedSnap.exists()) {
            assigned = Object.entries(assignedSnap.val()).map(([id, t]) => ({ id, ...t })).filter(t => (t.asignadoA === uid) || ((t.asignadoEmail || '').toLowerCase() === email));
          }

          // Creados por mí
          let created = [];
          if (createdSnap.exists()) {
            created = Object.entries(createdSnap.val()).map(([id, t]) => ({ id, ...t })).filter(t => (t.usuarioEmail || '').toLowerCase() === email);
          }

          // Por departamento
          let depts = [];
          if (deptSnapTickets.exists()) {
            depts = Object.entries(deptSnapTickets.val()).map(([id, t]) => ({ id, ...t })).filter(t => matchesUserDept(t.departamento));
          }

          // Creados por mi departamento
          let deptCreated = [];
          if (deptSnapTickets.exists()) {
            deptCreated = Object.entries(deptSnapTickets.val()).map(([id, t]) => ({ id, ...t })).filter(t => matchesDeptCreator(t, allUsers));
          }

          // Unir resultados para la vista "allTickets" reducida (solo los relevantes para el usuario)
          // Nota: incluir tickets creados por el usuario también en assignedTickets para que no desaparezcan de su board
          const mergedById = {};
          [...assigned, ...created, ...depts, ...deptCreated].forEach(t => { mergedById[t.id] = t; });
          const merged = Object.values(mergedById);
          // normalize asignados
          merged.forEach(t => {
            if (!t.asignados && (t.asignadoA || t.asignadoEmail || t.asignado)) {
              const arr = [];
              if (t.asignadoA) arr.push(t.asignadoA);
              if (t.asignadoEmail) arr.push(t.asignadoEmail);
              if (t.asignado && Array.isArray(t.asignado)) arr.push(...t.asignado);
              t.asignados = arr;
            }
          });
          setAllTickets(merged);
          // assigned: unir asignados y creados (deduplicando por id) para que el creador siempre vea sus tickets
          const assignedIds = new Set(assigned.map(t => t.id));
          const assignedPlusCreated = assigned.slice();
          created.forEach(t => { if (!assignedIds.has(t.id)) assignedPlusCreated.push(t); });
          setAssignedTickets(assignedPlusCreated);
          setCreatedTickets(created);
          setDeptTickets(depts);
          setDeptCreatedTickets(deptCreated);
        }
  } catch (e) {
        // Algunos errores provienen de reglas de Realtime DB que requieren índices (.indexOn).
        // Detectarlos y no elevar como error crítico; en su lugar hacemos un fallback a cargar todo.
        const msg = (e && e.message) ? e.message : String(e);
        if (msg.includes('Index not defined') || msg.includes('.indexOn') || msg.toLowerCase().includes('index')) {
          console.warn('Consultas optimizadas no disponibles (faltan índices en Realtime DB). Cargando todos los tickets como fallback. Para optimizar, añade ".indexOn": ["asignadoA","usuarioEmail","departamento"] en las reglas para /tickets', e);
        } else {
          console.error('Error cargando tickets con consultas optimizadas', e);
        }
        // fallback: cargar todo
        const ticketsSnap2 = await get(ref(dbInstance, 'tickets'));
        const all = ticketsSnap2.exists() ? Object.entries(ticketsSnap2.val()).map(([id, t]) => ({ id, ...t })) : [];
        setAllTickets(all);
        setAssignedTickets(all.filter(t => matchesAssignToUser(t, user)));
        setCreatedTickets(all.filter(t => (t.usuarioEmail || '').toLowerCase() === (user?.email || '').toLowerCase()));
        setDeptTickets(all.filter(t => {
          try { return matchesUserDept(t.departamento); } catch { return false; }
        }));
        setDeptCreatedTickets(all.filter(t => {
          try { return matchesDeptCreator(t, allUsers); } catch { return false; }
        }));
      } finally {
        setTicketsLoading(false);
      }
    };
    fetchData();
  }, [success, ctxDb, recinto, userData, isAdmin, dbLoading, user, tiposFromCtx, subcatsFromCtx]);

  React.useEffect(() => {
    if (error) {
      try { notify(error, 'error', { mode: 'toast', persist: true }); } catch { /* ignore */ }
      setError('');
    }
    if (success) {
      try { notify(success, 'success', { mode: 'toast' }); } catch { /* ignore */ }
      setSuccess('');
    }
  }, [error, success, notify]);



  // Abrir diálogo para agregar/editar ticket
  const handleOpenDialog = (ticket = null) => {
  // ahora usamos página completa para crear/editar
  setError("");
  setSuccess("");
  setAdjunto(null);
  setResAdjuntoFile(null);
  if (ticket && ticket.id) navigate(`/tickets/${ticket.id}`);
  else navigate('/tickets/new');
  };

  // Guardar ticket
  const handleSaveTicket = async () => {
    if (!form.departamento || !form.tipo || !form.subcategoria || !form.descripcion.trim()) {
      try { notify('Todos los campos son obligatorios', 'error', { mode: 'toast', persist: true }); } catch { setError('Todos los campos son obligatorios'); }
      return;
    }
    try {
      let adjuntoUrl = form.adjuntoUrl;
      let adjuntoNombre = form.adjuntoNombre;
      if (adjunto) {
        const fileRef = storageRef(storage, `tickets/${Date.now()}_${adjunto.name}`);
        await uploadBytes(fileRef, adjunto);
        adjuntoUrl = await getDownloadURL(fileRef);
        adjuntoNombre = adjunto.name;
      }
      // subir adjunto de resolución si existe
      let resolucionAdjuntoUrl = form.resolucionAdjuntoUrl;
      let resolucionAdjuntoNombre = form.resolucionAdjuntoNombre;
      if (resAdjuntoFile) {
        const fileRefR = storageRef(storage, `tickets/resolution_${Date.now()}_${resAdjuntoFile.name}`);
        await uploadBytes(fileRefR, resAdjuntoFile);
        resolucionAdjuntoUrl = await getDownloadURL(fileRefR);
        resolucionAdjuntoNombre = resAdjuntoFile.name;
      }
      const ticketData = {
        ...form,
        usuario: form.usuario || (userData?.nombre ? `${userData.nombre} ${userData.apellido || ''}`.trim() : (user?.email || "")),
        usuarioEmail: user?.email || '',
  estado: form.estado || "Abierto",
        adjuntoUrl,
        adjuntoNombre,
        resolucionComentario: form.resolucionComentario || '',
        resolucionAdjuntoUrl: resolucionAdjuntoUrl || '',
        resolucionAdjuntoNombre: resolucionAdjuntoNombre || '',
  asignados: form.asignados || [],
      };
      // Determinar si se debe enviar correo: creación o cambio en campos clave.
      const isUpdate = !!editTicket;
      const prevTicket = editTicket || {};
      const watchFields = ['estado','prioridad','asignadoA'];
      const changes = [];
      if (isUpdate) {
        watchFields.forEach(f => {
          if (prevTicket[f] !== ticketData[f]) {
            changes.push({ field: f, before: prevTicket[f], after: ticketData[f] });
          }
        });
      }
      const debeEnviar = !isUpdate || changes.length > 0; // creación o hubo cambios relevantes
      let ticketIdFinal = editTicket?.id;
      if (editTicket) {
        // evitar que usuario estándar modifique campos bloqueados
        if (!isAdmin) {
          ticketData.departamento = prevTicket.departamento;
          ticketData.tipo = prevTicket.tipo;
          ticketData.subcategoria = prevTicket.subcategoria;
          ticketData.descripcion = prevTicket.descripcion;
        }
        // además, solo admin o usuario asignado pueden cambiar estado o campos de resolución
        const canProcess = isAdmin || matchesAssignToUser(prevTicket, user);
        if (!canProcess) {
          ticketData.estado = prevTicket.estado;
          // preservar asignación y campos de resolución
          ticketData.asignadoA = prevTicket.asignadoA;
          ticketData.asignadoEmail = prevTicket.asignadoEmail;
          ticketData.resolucionComentario = prevTicket.resolucionComentario || '';
          ticketData.resolucionAdjuntoUrl = prevTicket.resolucionAdjuntoUrl || '';
          ticketData.resolucionAdjuntoNombre = prevTicket.resolucionAdjuntoNombre || '';
        }
        // Si quien procesa puede cambiar estado, registrar quién cerró y cuándo
        if (canProcess) {
          // Si se cerró ahora y antes no estaba cerrado -> registrar metadata de resolución
          if (ticketData.estado === 'Cerrado' && prevTicket.estado !== 'Cerrado') {
            ticketData.resueltoPorUid = user?.uid || '';
            ticketData.resueltoPorEmail = user?.email || '';
            ticketData.resueltoPorNombre = userData?.nombre ? `${userData.nombre} ${userData.apellido || ''}`.trim() : (user?.email || '');
            ticketData.resueltoEn = new Date().toISOString();
          }
          // Si se reabrió (antes cerrado, ahora no) -> limpiar metadata
          if (ticketData.estado !== 'Cerrado' && prevTicket.estado === 'Cerrado') {
            ticketData.resueltoPorUid = '';
            ticketData.resueltoPorEmail = '';
            ticketData.resueltoPorNombre = '';
            ticketData.resueltoEn = '';
          }
        }
        const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
        await update(ref(dbToUse, `tickets/${editTicket.id}`), ticketData);
        setSuccess("Ticket actualizado");
      } else {
        const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
        const newRef = push(ref(dbToUse, "tickets"));
        // Forzar estado Abierto en creación independientemente del formulario
        ticketData.estado = 'Abierto';
        await set(newRef, ticketData);
        setSuccess("Ticket creado");
        ticketIdFinal = newRef.key;
      }
      if (!ticketIdFinal) ticketIdFinal = editTicket?.id; // fallback

      // Enviar notificación si corresponde
      if (debeEnviar) {
        try {
          const baseUrl = window.location.origin;
          // buscar nombre del departamento para que el correo muestre el nombre legible
          const depObj = departamentos.find(d => d.id === ticketData.departamento);
          const departamentoNombre = depObj ? depObj.nombre : ticketData.departamento;
          const ticketForHtml = { ...ticketData, ticketId: ticketIdFinal, departamentoNombre };
          // Construir resumen de cambios
          let resumenCambios = '';
          if (!isUpdate) {
            resumenCambios = 'Creación de ticket';
          } else if (changes.length) {
            resumenCambios = 'Actualización: ' + changes.map(c => `${c.field}: ${c.before ?? '—'} -> ${c.after ?? '—'}`).join('; ');
          }
          // ensure ticketId shown in HTML uses ticket.codigo when available
          const ticketForHtmlFinal = { ...ticketForHtml, ticketId: ticketData.codigo || ticketIdFinal };
          
          // Calcular SLA para incluir en el correo
          const slaInfo = calculateSlaForTicket(ticketForHtmlFinal);
          if (slaInfo && slaInfo.slaHours) {
            ticketForHtmlFinal.slaHours = slaInfo.slaHours;
          }
          
          const html = generateTicketEmailHTML({ ticket: ticketForHtmlFinal, baseUrl, extraMessage: resumenCambios });
          // Subject: si cambió estado usarlo, si no, genérico
          const cambioEstado = changes.find(c => c.field === 'estado');
          const ticketLabel = ticketData.codigo || ticketIdFinal;
          const subject = !isUpdate
            ? `[Ticket ${ticketData.estado}] ${ticketData.tipo} #${ticketLabel}`
            : (cambioEstado
                ? `[Ticket ${ticketData.estado}] ${ticketData.tipo} #${ticketLabel}`
                : `[Ticket] Actualización ${ticketData.tipo} #${ticketLabel}`);
          const actionMsg = resumenCambios;
          // preparar lista de destinatarios: priorizar asignadoEmails, sino resolver desde asignados ids
          let toList = [];
          if (ticketData.asignadoEmails && ticketData.asignadoEmails.length) {
            toList = ticketData.asignadoEmails;
          } else if (ticketData.asignados && ticketData.asignados.length) {
            // resolver ids a correos desde usuarios state
            const resolved = ticketData.asignados.map(id => {
              const u = usuarios.find(x => x.id === id);
              return u ? u.email : null;
            }).filter(Boolean);
            toList = resolved;
          } else if (ticketData.asignadoEmail) {
            toList = [ticketData.asignadoEmail];
          }
          const ticketForHtmlWithTo = { ...ticketForHtmlFinal, to: toList };
          const payload = buildSendMailPayload({
            ticket: ticketForHtmlWithTo,
            departamento: ticketData.departamento,
            departamentoNombre,
            subject,
            actionMsg,
            htmlOverride: html,
            cc: ticketData.usuarioEmail ? [ticketData.usuarioEmail] : []
          });
          sendTicketMail(payload)
            .then(() => {
              setSuccess(prev => (prev ? `${prev} (Notificación enviada)` : 'Notificación enviada'));
            })
            .catch(err => {
              console.error('Error enviando notificación', err);
              const msg = err && err.message ? err.message : String(err);
              if (msg.includes('No se han encontrado destinatarios')) {
                setError('Ticket guardado, pero no hay destinatarios configurados para enviar correo. Añade asignados o un pool de correo en la configuración.');
              } else {
                setError(`Ticket guardado pero falló envío de correo: ${msg}`);
              }
            });
        } catch (e) {
          console.error('Error preparando notificación', e);
          setError(`No se pudo preparar correo: ${e.message}`);
        }
      }
      setOpenDialog(false);
    } catch {
      setError("Error al guardar");
    }
  };

  // Eliminar ticket (solo creador o admin) con confirmación
  const confirmDelete = (ticket) => {
    const isCreator = (ticket.usuarioEmail || '').toLowerCase() === (user?.email || '').toLowerCase();
    if (!(isAdmin || isCreator)) return;
    setDeleteDialog({ open: true, ticketId: ticket.id });
  };

  const handleDeleteTicket = async () => {
    if (!deleteDialog.ticketId) return;
    setDeleting(true);
    try {
      const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      await remove(ref(dbToUse, `tickets/${deleteDialog.ticketId}`));
      setSuccess('Ticket eliminado');
    } catch (e) {
      console.error('Error eliminando ticket', e);
      setError('Error al eliminar');
    } finally {
      setDeleteDialog({ open: false, ticketId: null });
      setDeleting(false);
    }
  };

  // Agrupar tickets por estado para vista Kanban
  const estados = [
  { key: 'Abierto', label: 'Abierto', color: 'warning.main' },
  { key: 'En Proceso', label: 'En Proceso', color: 'info.main' },
  ];
  const ticketsPorEstado = estados.map(est => ({
    ...est,
    tickets: (ticketsToRender || []).filter(t => t.estado === est.key),
  }));

  // Para mapear nombre de tipo a su ID y obtener subcategorías
  const tipoKey = form.departamento && form.tipo && tipos[form.departamento]
    ? Object.entries(tipos[form.departamento]).find(([, tipoName]) => tipoName === form.tipo)?.[0]
    : null;
  const opcionesSubcat = form.departamento && tipoKey && subcats[form.departamento]
    ? subcats[form.departamento][tipoKey]
    : null;

  return (
    <Box
      sx={{
        p: { xs: 1, sm: 2 },
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        minHeight: "90vh",
        width: "100%",
        maxWidth: "100vw",
        margin: "0 auto",
        boxSizing: "border-box",
        background: theme => theme.palette.background.default,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 900, letterSpacing: 1, color: 'text.primary' }}>
          Tickets
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
          sx={{
            fontWeight: 700,
            boxShadow: 2,
            width: { xs: '100%', sm: 'auto' },
            bgcolor: theme => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined,
            color: theme => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : undefined,
            '& .MuiSvgIcon-root': { color: theme => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : 'inherit' },
          }}
        >
          Nuevo Ticket
        </Button>
      </Box>
      {/* Tabs para vistas: asignados, creados por mi, mi departamento, todos (admin) */}
      <Paper sx={{ mb: 2, p: 1 }} elevation={1}>
        <Tabs
          value={viewTab}
          onChange={(e, val) => setViewTab(val)}
          variant="scrollable"
          scrollButtons="auto"
          sx={(theme) => ({
            // indicador y texto seleccionado en modo oscuro: usar variante clara tipo dorado
            '& .MuiTabs-indicator': {
              backgroundColor: theme.palette.mode === 'dark' ? theme.palette.warning.light : undefined,
            },
            '& .MuiTab-root.Mui-selected': {
              color: theme.palette.mode === 'dark' ? theme.palette.warning.light : undefined,
            },
            // asegurar contraste en el hover/selected para dark
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 700,
            }
          })}
        >
          <Tab label={<Badge color="primary" badgeContent={assignedTickets.length}>Asignados a mí</Badge>} value="assigned" />
          <Tab label={<Badge color="secondary" badgeContent={createdTickets.length}>Creados por mí</Badge>} value="created" />
          <Tab label={<Badge color="info" badgeContent={deptTickets.length}>Asignados a mi departamento</Badge>} value="dept" />
          <Tab label={<Badge color="warning" badgeContent={deptCreatedTickets.length}>Creados por mi departamento</Badge>} value="deptCreated" />
          {isAdmin && <Tab label={<Badge color="primary" badgeContent={allTickets.length}>Todos</Badge>} value="all" />}
        </Tabs>
      </Paper>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}
      <Box sx={{ flex: '0 0 auto', width: '100%', maxWidth: '100vw' }}>
        {ticketsLoading ? (
          <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', width: '100%' }}>
            <Paper elevation={3} sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, borderRadius: 3 }}>
              <CircularProgress />
              <Typography variant="body1">Cargando tickets, por favor espera...</Typography>
            </Paper>
          </Box>
        ) : (
          <>
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              gap: { xs: 2, sm: 3 },
              width: '100%',
              justifyContent: { xs: 'flex-start', sm: 'space-between' },
              alignItems: { xs: 'flex-start', sm: 'stretch' },
              mb: 3,
              overflowX: 'visible',
              WebkitOverflowScrolling: 'touch',
            }}
          >
          {ticketsPorEstado.map(col => (
            <Box
              key={col.key}
              sx={{
                flex: { xs: '1 1 auto', sm: '1 1 0' },
                minWidth: 0,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Paper elevation={6} sx={{ p: { xs: 2, sm: 3 }, bgcolor: col.color, minHeight: { xs: 120, sm: 140 }, display: 'flex', flexDirection: 'column', gap: 2, borderRadius: 4, boxShadow: 8 }}>
                <Typography variant="h6" sx={{ mb: 1, color: 'text.primary', fontWeight: 900, letterSpacing: 1, textAlign: 'center', textShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>{col.label}</Typography>
                {col.tickets.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ opacity: 0.85, textAlign: 'center' }}>Sin tickets</Typography>
                ) : (
                  col.tickets.map(ticket => (
                    <Paper key={ticket.id} elevation={3} sx={{ p: 2, mb: 1.5, borderRadius: 3, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 1, boxShadow: 4, transition: 'box-shadow 0.2s', '&:hover': { boxShadow: 10 } }}>
                      <Box
                        sx={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'flex-start',
                          gap: 0.5,
                          mb: 0.5,
                          width: '100%',
                        }}
                      >
                        <Chip
                          label={ticket.tipo}
                          color="primary"
                          size="small"
                          sx={{ fontWeight: 700, maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.1 } }}
                        />
                        {ticket.subcategoria && (
                          <Box
                            sx={{
                              bgcolor: 'secondary.light',
                              color: 'secondary.contrastText',
                              fontSize: 12,
                              fontWeight: 600,
                              px: 1.2,
                              py: 0.5,
                              borderRadius: 2,
                              maxWidth: '100%',
                              lineHeight: 1.2,
                              overflow: 'hidden',
                              overflowWrap: 'anywhere',
                              boxShadow: 1,
                            }}
                          >
                            {ticket.subcategoria}
                          </Box>
                        )}
                        <Typography
                          variant="subtitle2"
                          sx={{
                            flexBasis: '100%',
                            fontWeight: 700,
                            color: 'text.primary',
                            display: 'block',
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                            mt: 0.5,
                          }}
                        >
                          {ticket.descripcion}
                        </Typography>
                        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <IconButton size="small" onClick={() => handleOpenDialog(ticket)} sx={{ '& .MuiSvgIcon-root': { color: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.primary.main } }}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          {(() => { const isCreator = (ticket.usuarioEmail || '').toLowerCase() === (user?.email || '').toLowerCase(); return (isAdmin || isCreator); })() && (
                            <IconButton size="small" color="error" onClick={() => confirmDelete(ticket)} sx={{ '& .MuiSvgIcon-root': { color: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined } }}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          )}
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {ticket.adjuntoUrl && (
                          <Button href={ticket.adjuntoUrl} target="_blank" size="small" sx={{ textTransform: 'none', minWidth: 0, p: 0.5 }}>
                            <Chip label="Adjunto" color="info" size="small" />
                          </Button>
                        )}
                        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1, fontWeight: 500 }}>
                          {ticket.usuario} {ticket.codigo ? ` • ${ticket.codigo}` : ''}
                        </Typography>
                      </Box>
                    </Paper>
                  ))
                )}
              </Paper>
            </Box>
          ))}
        </Box>
        {/* Tabla de tickets justo debajo de las tarjetas */}
        <Paper elevation={1} sx={{ mt: 2, width: '100%', maxWidth: '100vw', p: { xs: 1.5, sm: 2 }, borderRadius: 4, boxShadow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: 1, color: theme => theme.palette.mode === 'dark' ? theme.palette.common.white : 'primary.main' }}>
              Tickets (vista tabla)
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: { xs: 'flex-start', sm: 'flex-end' } }}>
              <Chip label={`Cerrados: ${closedCount}`} color="success" size="small" />
              <TextField
                size="small"
                placeholder="Buscar tickets..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                sx={{ minWidth: { xs: '100%', sm: 240 }, width: { xs: '100%', sm: 'auto' }, mt: { xs: 1, sm: 0 } }}
                InputProps={{
                  sx: { borderRadius: 1 },
                }}
              />
              <TextField
                size="small"
                select
                value={tableFilter}
                onChange={e => setTableFilter(e.target.value)}
                sx={(theme) => ({
                  minWidth: { xs: '100%', sm: 160 },
                  width: { xs: '100%', sm: 'auto' },
                  mt: { xs: 1, sm: 0 },
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 1,
                    bgcolor: (theme.palette.mode === 'dark' && tableFilter !== 'Todos') ? theme.palette.warning.light : undefined,
                    color: (theme.palette.mode === 'dark' && tableFilter !== 'Todos') ? theme.palette.getContrastText(theme.palette.warning.light) : undefined,
                  },
                  '& .MuiSelect-select, & .MuiOutlinedInput-input': {
                    color: (theme.palette.mode === 'dark' && tableFilter !== 'Todos') ? theme.palette.getContrastText(theme.palette.warning.light) : undefined,
                  },
                  '& .MuiSvgIcon-root': {
                    color: (theme.palette.mode === 'dark' && tableFilter !== 'Todos') ? theme.palette.getContrastText(theme.palette.warning.light) : undefined,
                  }
                })}
              >
                <MenuItem value="Todos">Todos</MenuItem>
                <MenuItem value="Abierto">Abierto</MenuItem>
                <MenuItem value="En Proceso">En Proceso</MenuItem>
                <MenuItem value="Cerrado">Cerrado</MenuItem>
              </TextField>
            </Box>
          </Box>
          <TableContainer sx={{ width: '100%', maxWidth: '100vw', overflowX: 'auto', bgcolor: 'background.paper', borderRadius: 2 }}>
            <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: theme => theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[100] }}>
                    <TableCell sx={{ fontWeight: 700 }}>Departamento</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Código</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Creado</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Categoría</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Subcategoría</TableCell>
                    {/* Columna Descripción eliminada para evitar textos largos que rompan el layout */}
                  <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', md: 'table-cell' } }}>Vencimiento</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', sm: 'table-cell' } }}>Usuario</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', sm: 'table-cell' } }}>Adjunto</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
  {filteredTickets.length === 0 ? (
      <TableRow>
    <TableCell colSpan={10} align="center">Sin tickets registrados</TableCell>
      </TableRow>
    ) : (
                  pageTickets.map(ticket => (
                    <TableRow key={ticket.id} hover sx={{ transition: 'background 0.2s' }}>
                      <TableCell>{ticket.departamento}</TableCell>
                      <TableCell>{ticket.codigo || ticket.id}</TableCell>
                      <TableCell>{(() => {
                        const val = ticket._createdAt;
                        if (!val) return '';
                        let ms = null;
                        if (typeof val === 'number') ms = val < 1e12 ? val * 1000 : val;
                        else if (typeof val === 'string') { const n = parseInt(val,10); if (!isNaN(n)) ms = n < 1e12 ? n*1000 : n; else { const d = new Date(val); ms = isNaN(d.getTime()) ? null : d.getTime(); } }
                        else if (val && typeof val === 'object') { if (val.seconds) ms = Number(val.seconds) * 1000; else if (val.toMillis) { try { ms = val.toMillis(); } catch { /* ignore */ } } }
                        if (!ms) return '';
                        return new Date(ms).toLocaleString();
                      })()}</TableCell>
                      <TableCell>{ticket.tipo}</TableCell>
                      <TableCell>{ticket.subcategoria || '-'}</TableCell>
                      {/* Celda de Descripción eliminada */}
                      <TableCell>
                        <Chip label={ticket.estado} color={ticket.estado === 'Abierto' ? 'warning' : ticket.estado === 'En Proceso' ? 'info' : 'success'} size="small" />
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                        {(() => {
                          const slaInfo = calculateSlaForTicket(ticket);
                          if (!slaInfo) return '-';
                          
                          const { remainingHours, isExpired, overdueHours } = slaInfo;
                          
                          if (isExpired) {
                            const totalHours = Math.round(((overdueHours !== undefined ? overdueHours : Math.abs(remainingHours))) * 10) / 10; // Redondear a 1 decimal
                            return (
                              <Chip 
                                label={`Vencido: ${totalHours}h`} 
                                color="error" 
                                size="small" 
                                variant="filled"
                              />
                            );
                          } else {
                            const safeRemaining = remainingHours < 0 ? 0 : remainingHours;
                            const totalHours = Math.round(safeRemaining * 10) / 10; // Redondear a 1 decimal
                            const isUrgent = safeRemaining <= 12;
                            return (
                              <Chip 
                                label={`${totalHours}h`} 
                                color={isUrgent ? 'warning' : 'success'} 
                                size="small" 
                                variant={isUrgent ? 'filled' : 'outlined'}
                              />
                            );
                          }
                        })()}
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{ticket.usuario}</TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        {ticket.adjuntoUrl && (
                          <Button href={ticket.adjuntoUrl} target="_blank" size="small" color="info" sx={{ fontWeight: 700 }}>Ver</Button>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => handleOpenDialog(ticket)} sx={{ color: theme => theme.palette.mode === 'dark' ? theme.palette.common.white : 'primary.main' }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        {(() => { const isCreator = (ticket.usuarioEmail || '').toLowerCase() === (user?.email || '').toLowerCase(); return (isAdmin || isCreator); })() && (
                          <IconButton size="small" color="error" onClick={() => confirmDelete(ticket)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 2 }}>
            <Typography variant="caption" color="text.secondary">Mostrando {Math.min(filteredTickets.length, PAGE_SIZE)} de {filteredTickets.length} resultados</Typography>
            <Pagination count={pageCount} page={page} onChange={(e, val) => setPage(val)} color="primary" />
          </Box>
        </Paper>
          </>
        )}
      </Box>

  <Dialog open={openDialog} onClose={() => setOpenDialog(false)} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 4, boxShadow: 8 } }}>
        <DialogTitle sx={{ bgcolor: form.estado === 'Cerrado' ? 'success.main' : form.estado === 'En Proceso' ? 'info.main' : 'warning.main', color: '#fff', fontWeight: 900, letterSpacing: 1, textAlign: 'center', borderTopLeftRadius: 16, borderTopRightRadius: 16, boxShadow: 2 }}>
          {editTicket ? "Editar Ticket" : "Nuevo Ticket"}
        </DialogTitle>
        <DialogContent sx={{ p: 3, bgcolor: 'background.default' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              select
              label="Departamento"
              fullWidth
              margin="normal"
              value={form.departamento}
              onChange={e => setForm(f => ({ ...f, departamento: e.target.value, tipo: "" }))}
              disabled={!!editTicket && !isAdmin}
              sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
            >
              <MenuItem value="" disabled>Selecciona un departamento</MenuItem>
              {departamentos.map(dep => (
                <MenuItem key={dep.id} value={dep.id}>{dep.nombre}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Tipo de Ticket"
              fullWidth
              margin="normal"
              value={form.tipo}
              onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
              disabled={!form.departamento || (!!editTicket && !isAdmin)}
              sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
            >
              <MenuItem value="" disabled>Selecciona un tipo</MenuItem>
              {form.departamento && tipos[form.departamento] && Object.entries(tipos[form.departamento]).map(([id, nombre]) => (
                <MenuItem key={id} value={nombre}>{nombre}</MenuItem>
              ))}
            </TextField>
            {/* Campo Subcategoría */}
            <TextField
              select
              label="Subcategoría"
              fullWidth
              margin="normal"
              value={form.subcategoria}
              onChange={e => setForm({ ...form, subcategoria: e.target.value })}
              disabled={!form.departamento || !form.tipo || (!!editTicket && !isAdmin)}
              sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
            >
              <MenuItem value="" disabled>Selecciona una subcategoría</MenuItem>
              {opcionesSubcat 
                ? Object.entries(opcionesSubcat).map(([id, nombre]) => (
                    <MenuItem key={id} value={nombre}>{nombre}</MenuItem>
                  ))
                : <MenuItem disabled>No hay subcategorías</MenuItem>
              }
            </TextField>
            {/* Selector de usuarios asignados (múltiples) */}
            <Autocomplete
              multiple
              options={(() => {
                const depName = (departamentos.find(d => String(d.id) === String(form.departamento)) || {}).nombre;
                return usuarios.filter(u => u.departamento && (String(u.departamento) === String(form.departamento) || String(u.departamento) === String(depName)));
              })()}
              getOptionLabel={(opt) => `${opt.nombre || ''} ${opt.apellido || ''}`.trim() || opt.email}
              value={usuarios.filter(u => (form.asignados || []).includes(u.id))}
              onChange={(_, newVal) => {
                // newVal es array de user objects
                const ids = newVal.map(u => u.id);
                const emails = newVal.map(u => u.email || '').filter(Boolean);
                const nombres = newVal.map(u => `${u.nombre || ''} ${u.apellido || ''}`.trim());
                setForm(f => ({ ...f, asignados: ids, asignadoEmails: emails, asignadoNombres: nombres }));
              }}
              disabled={!form.departamento || (!!editTicket && !isAdmin)}
              renderInput={(params) => (
                <TextField {...params} label="Asignar a (múltiple)" margin="normal" sx={{ bgcolor: 'background.paper', borderRadius: 2 }} />
              )}
            />
            <TextField
              label="Descripción"
              fullWidth
              margin="normal"
              multiline
              minRows={2}
              value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
              disabled={!!editTicket && !isAdmin}
            />
            <Box>
              <Button variant="outlined" component="label" fullWidth sx={{ borderRadius: 2, fontWeight: 700 }}>
                {adjunto ? adjunto.name : (form.adjuntoNombre || "Adjuntar archivo")}
                <input
                  type="file"
                  hidden
                  onChange={e => setAdjunto(e.target.files[0])}
                />
              </Button>
              {(form.adjuntoUrl || adjunto) && (
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                    {(adjunto && adjunto.name) || form.adjuntoNombre}
                  </Typography>
                  <Button color="error" size="small" onClick={() => {
                    setForm(f => ({ ...f, adjuntoUrl: "", adjuntoNombre: "" }));
                    setAdjunto(null);
                  }}>Eliminar</Button>
                </Box>
              )}
            </Box>
            <TextField
              select
              label="Estado"
              fullWidth
              margin="normal"
              value={form.estado}
              onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}
              sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
            >
              <MenuItem value="Abierto">Abierto</MenuItem>
              <MenuItem value="En Proceso">En Proceso</MenuItem>
              <MenuItem value="Cerrado">Cerrado</MenuItem>
            </TextField>
            <TextField
              label="Usuario"
              fullWidth
              margin="normal"
              value={form.usuario}
              InputProps={{ readOnly: true }}
              sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
            />
            {/* Comentario de resolución y adjunto: solo visible para admin o usuarios asignados */}
            {(isAdmin || matchesAssignToUser(editTicket || form, user)) && (
              <>
                <TextField
                  label="Comentario de resolución"
                  fullWidth
                  margin="normal"
                  multiline
                  minRows={2}
                  value={form.resolucionComentario}
                  onChange={e => setForm(f => ({ ...f, resolucionComentario: e.target.value }))}
                  sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
                />
                <Box>
                  <Button variant="outlined" component="label" fullWidth sx={{ borderRadius: 2, fontWeight: 700 }}>
                    {resAdjuntoFile ? resAdjuntoFile.name : (form.resolucionAdjuntoNombre || "Adjuntar archivo de resolución")}
                    <input
                      type="file"
                      hidden
                      onChange={e => setResAdjuntoFile(e.target.files[0])}
                    />
                  </Button>
                  {(form.resolucionAdjuntoUrl || resAdjuntoFile) && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                        {(resAdjuntoFile && resAdjuntoFile.name) || form.resolucionAdjuntoNombre}
                      </Typography>
                      {/* Mostrar botón de descarga para cualquier usuario que vea el ticket */}
                      {form.resolucionAdjuntoUrl ? (
                        <Button href={form.resolucionAdjuntoUrl} target="_blank" size="small">Descargar</Button>
                      ) : null}
                      <Button color="error" size="small" onClick={() => {
                        setForm(f => ({ ...f, resolucionAdjuntoUrl: "", resolucionAdjuntoNombre: "" }));
                        setResAdjuntoFile(null);
                      }}>Eliminar</Button>
                    </Box>
                  )}
                </Box>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, bgcolor: 'background.default', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}>
          <Button onClick={() => setOpenDialog(false)} variant="contained" color="error" sx={{ fontWeight: 700 }}>Cancelar</Button>
          <Button 
            onClick={handleSaveTicket} 
            variant="contained" 
            sx={{ fontWeight: 700 }}
            startIcon={editTicket ? <UpdateIcon /> : <SaveIcon />}
          >
            {editTicket ? "Actualizar" : "Guardar"}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Dialogo confirmación eliminación */}
      <Dialog open={deleteDialog.open} onClose={() => (!deleting && setDeleteDialog({ open: false, ticketId: null }))} maxWidth="xs" fullWidth>
      <DialogTitle>Eliminar ticket</DialogTitle>
      <DialogContent>
        <Typography variant="body2">¿Confirmas que deseas eliminar este ticket? Esta acción no se puede deshacer.</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDeleteDialog({ open: false, ticketId: null })} disabled={deleting}>Cancelar</Button>
        <Button onClick={handleDeleteTicket} color="error" variant="contained" disabled={deleting}>{deleting ? 'Eliminando...' : 'Eliminar'}</Button>
      </DialogActions>
    </Dialog>
    </Box>
  );
}
