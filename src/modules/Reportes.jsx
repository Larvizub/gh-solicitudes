import React, { useEffect, useState, useRef } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { ReportesPieChart, ReportesBarChart, ReportesLineChart, ReportesAreaChart, ReportesHorizontalBarChart } from './ReportesCharts';
import AssessmentIcon from '@mui/icons-material/Assessment';
import FilterListIcon from '@mui/icons-material/FilterList';
import TableChartIcon from '@mui/icons-material/TableChart';
import { ModuleContainer, PageHeader, GlassCard, SectionContainer } from '../components/ui/SharedStyles';
import { gradients } from '../components/ui/sharedStyles.constants';
import useNotification from '../context/useNotification';

// ErrorBoundary simple para DataGrid
class DataGridErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    // Puedes loguear el error si lo deseas
  }
  render() {
    if (this.state.hasError) {
      return <Alert severity="error">Ocurrió un error al mostrar la tabla. Intenta recargar la página o revisa los datos.</Alert>;
    }
    return this.props.children;
  }
}
import {
  Box, Typography, Paper, Button, Grid, TextField, MenuItem, CircularProgress, Snackbar, Alert, Chip, IconButton
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { ref, get } from 'firebase/database';
import { useDb } from '../context/DbContext';
import { getDbForRecinto } from '../firebase/multiDb';
import { useAuth } from '../context/useAuth';
import workingMsBetween from '../utils/businessHours';
import { calculateSlaRemaining } from '../utils/slaCalculator';
// (msToHoursMinutes removed — Reportes now shows decimal hours)
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function Reportes() {
  // Refs para los gráficos (todos los mostrados en UI)
  const pieRef = useRef();
  const barRef = useRef();
  const tipoRef = useRef();
  const topUsersRef = useRef();
  const avgDeptRef = useRef();
  const avgUserRef = useRef();
  const monthlyRef = useRef();
  const { db: ctxDb, recinto } = useDb();
  const { userData } = useAuth();
  const { notify } = useNotification();
  const [tickets, setTickets] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  // SLA configuration states
  const [tipos, setTipos] = useState({});
  const [subcats, setSubcats] = useState({});
  const [slaConfigs, setSlaConfigs] = useState({});
  const [slaSubcats, setSlaSubcats] = useState({});
  const [usuariosMap, setUsuariosMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtroDep, setFiltroDep] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const theme = useTheme();

  // Mostrar notificaciones
  useEffect(() => {
    if (snackbar.open) {
      notify(snackbar.message, snackbar.severity);
    }
  }, [snackbar, notify]);


  // Filtros y datos para los gráficos
  const estados = ['Abierto', 'En Proceso', 'Cerrado'];
  const ticketsFiltrados = tickets.filter(t =>
    (!filtroDep || t.departamento === filtroDep) &&
    (!filtroEstado || t.estado === filtroEstado)
  );
  // Calcular duración de resolución por ticket (considerando pausas si existen)
  const computeTicketResolutionMs = React.useCallback((t) => {
    try {
      // obtener timestamps de creado y cerrado
      const createdCandidates = t.createdAt || t.fecha || t.timestamp || t.createdAtTimestamp || t.createdAtMillis;
      // intentar múltiples aliases comunes para fecha de cierre/resolución
  const closedCandidates = t.closedAt || t.closedAtTimestamp || t.cerradoAt || t.fechaCierre || t.closedAtMillis || t.resolvedAt || t.resolvedAtTimestamp || t['closed_at'] || t.finishedAt || t.resolvedAt || t.resueltoEn || t.resueltoEnTimestamp || null;
      // Si no hay campo explícito pero el estado indica 'Cerrado', usar updatedAt como respaldo
      let closedFallback = null;
      if (!closedCandidates && (String(t.estado || '').toLowerCase() === 'cerrado' || String(t.estado || '').toLowerCase() === 'resuelto' || String(t.estado || '').toLowerCase() === 'finalizado')) {
        closedFallback = t.updatedAt || t.updated_at || null;
      }
      // Reuse shared timestamp parser to correctly handle ISO strings and numeric timestamps
      const parseAny = (v) => parseAnyTimestamp(v);
      const createdMs = parseAny(createdCandidates) || parseAny(t.created) || null;
      const closedMs = parseAny(closedCandidates) || parseAny(closedFallback) || null;
      try {
        console.debug('computeTicketResolutionMs parse', {
          id: t?.id || t?.key || t?.ticketId || null,
          createdCandidates, closedCandidates: closedCandidates || closedFallback,
          parsedCreatedMs: createdMs,
          parsedClosedMs: closedMs,
          createdIso: createdMs ? new Date(createdMs).toISOString() : null,
          closedIso: closedMs ? new Date(closedMs).toISOString() : null,
        });
  } catch { /* ignore parse logging errors */ }
      // Only compute resolution time for tickets that have a closing timestamp
      if (!createdMs || !closedMs) {
        try {
          console.debug('computeTicketResolutionMs missing timestamps:', {
            id: t?.id || t?.key || t?.ticketId || null,
            estado: t?.estado,
            createdCandidates: createdCandidates,
            closedCandidates: closedCandidates || closedFallback,
            parsedCreatedMs: createdMs,
            parsedClosedMs: closedMs,
          });
  } catch { /* ignore logging errors */ }
        return null;
      }
      // if created is after closed, swap to attempt recovering a duration
      let startMs = createdMs;
      let endMs = closedMs;
      if (startMs > endMs) {
        try { console.warn('computeTicketResolutionMs: createdMs > closedMs, swapping to compute positive duration', { id: t?.id, createdMs, closedMs }); } catch { /* ignore */ }
        const tmp = startMs; startMs = endMs; endMs = tmp;
      }
      // compute business-hours duration between startMs and endMs
      let duration = workingMsBetween(startMs, endMs);
      // subtract pauses but only counting their overlap with business hours
      if (t.pauses) {
        const pausesObj = t.pauses;
        for (const k of Object.keys(pausesObj)) {
          const p = pausesObj[k];
          const s = parseAny(p.start) || null;
          const e = parseAny(p.end) || null;
          if (!s) continue;
          const ps = Number(s);
          const pe = e ? Number(e) : closedMs;
          if (pe > ps) {
            const overlapMs = workingMsBetween(Math.max(ps, createdMs), Math.min(pe, closedMs));
            duration -= overlapMs;
          }
        }
      }
      if (!duration || duration <= 0) {
        try { console.debug('computeTicketResolutionMs zero duration details', { id: t?.id, startIso: startMs ? new Date(startMs).toISOString() : null, endIso: endMs ? new Date(endMs).toISOString() : null, duration }); } catch { /* ignore */ }
      }
      return Math.max(0, duration);
    } catch (e) {
      console.warn('Error computing duration for ticket', e);
      return null;
    }
  }, [/* no external deps; parse util and workingMsBetween are stable imports */]);

  // Debug helper: log resolution parsing for first few tickets to help diagnose missing values
  React.useEffect(() => {
    if (Array.isArray(tickets) && tickets.length) {
      try {
        tickets.slice(0, 5).forEach(t => {
          const ms = computeTicketResolutionMs(t);
          console.debug('computeTicketResolutionMs sample:', { id: t?.id || t?.key || t?.ticketId || null, estado: t?.estado, resultMs: ms, raw: t });
        });
  } catch { /* noop */ }
    }
  }, [tickets, computeTicketResolutionMs]);

  // Helper para parsear timestamps variados (reutilizable)
  const parseAnyTimestamp = (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    if (typeof v === 'string') {
      // Intentar parsear como fecha ISO primero (más robusto para strings con '-')
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.getTime();
      // Si no es una fecha, intentar parsear como número (segundos o ms)
      const n = parseInt(v, 10);
      if (!isNaN(n)) return n < 1e12 ? n * 1000 : n;
      return null;
    }
    if (typeof v === 'object') {
      if (v.seconds) return Number(v.seconds) * 1000;
      if (v._seconds) return Number(v._seconds) * 1000;
      if (v.toMillis) {
        try { return v.toMillis(); } catch { return null; }
      }
    }
    return null;
  };

  

  // Average resolution time per departamento (hours)
  const deptDurations = {};
  ticketsFiltrados.forEach(t => {
    const depId = (typeof t.departamento === 'string' && t.departamento.includes('/')) ? t.departamento.split('/').pop() : (t.departamento || 'SinDepartamento');
    const ms = computeTicketResolutionMs(t);
    if (ms !== null) {
      if (!deptDurations[depId]) deptDurations[depId] = { totalMs: 0, count: 0 };
      deptDurations[depId].totalMs += ms;
      deptDurations[depId].count += 1;
    }
  });
  const avgByDept = Object.entries(deptDurations).map(([depId, v]) => {
    const avgHours = v.count ? (v.totalMs / v.count) / (1000 * 60 * 60) : 0;
    const depName = (departamentos.find(d => d.id === depId) || {}).nombre || depId;
    return { name: depName, value: Math.round(avgHours * 100) / 100 };
  }).sort((a,b) => b.value - a.value);

  // Promedio de cierre por usuario asignado (responsable). Si hay múltiples asignados se acredita a cada uno.
  const userDurations = {};
  const resolveUserLabel = (u) => {
    if (!u) return '';
    if (typeof u === 'object') return u.displayName || u.nombre || u.name || u.email || u.id || '';
    if (typeof u === 'string') {
      // si es id presente en usuariosMap
      if (usuariosMap[u]) return usuariosMap[u].displayName || usuariosMap[u].nombre || usuariosMap[u].name || usuariosMap[u].email || u;
      // buscar por email
      if (u.includes('@')) {
        const lower = u.toLowerCase();
        for (const data of Object.values(usuariosMap)) {
          if ((data?.email || '').toLowerCase() === lower) return data.displayName || data.nombre || data.name || data.email || lower;
        }
      }
      return u;
    }
    return '';
  };
  const extractAssignedUsers = (t) => {
    if (Array.isArray(t?.asignados) && t.asignados.length) {
      return t.asignados.map(a => resolveUserLabel(a)).filter(Boolean);
    }
    return [];
  };
  ticketsFiltrados.forEach(t => {
    const ms = computeTicketResolutionMs(t);
    if (ms === null) return;
    const assigned = extractAssignedUsers(t);
    if (!assigned.length) return; // si no hay asignados, no se atribuye el tiempo
    assigned.forEach(u => {
      if (!userDurations[u]) userDurations[u] = { totalMs: 0, count: 0 };
      userDurations[u].totalMs += ms;
      userDurations[u].count += 1;
    });
  });
  const avgByUser = Object.entries(userDurations).map(([userKey, v]) => {
    const avgHours = v.count ? (v.totalMs / v.count) / (1000 * 60 * 60) : 0;
    const label = resolveUserLabel(userKey) || userKey;
    return { name: label, value: Math.round(avgHours * 100) / 100 };
  }).sort((a,b)=> b.value - a.value).slice(0, 15); // limitar top 15 para legibilidad

  const ticketsPorEstado = estados.map(e => ({ name: e, value: ticketsFiltrados.filter(t => t.estado === e).length }));
  const ticketsPorDepartamento = departamentos.map(dep => ({ name: dep.nombre, value: ticketsFiltrados.filter(t => t.departamento === dep.id).length }));

  // Nuevos datasets para gráficos adicionales
  const tiposUnicos = Array.from(new Set(tickets.map(t => t.tipo).filter(Boolean)));
  const ticketsPorTipo = tiposUnicos.map(tipo => ({ name: tipo, value: ticketsFiltrados.filter(t => t.tipo === tipo).length }));

  // Top usuarios por cantidad de tickets
  const usuariosCount = {};
  tickets.forEach(t => { const u = t.usuario || 'Desconocido'; usuariosCount[u] = (usuariosCount[u] || 0) + 1; });
  const topUsuarios = Object.entries(usuariosCount).map(([usuario, cnt]) => ({ name: usuario, value: cnt }))
    .sort((a,b) => b.value - a.value)
    .slice(0, 8);

  // Series mensuales por estado (últimos 12 meses)
  const monthKey = (date) => {
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return null;
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    } catch { return null; }
  };
  const monthsSet = new Set();
  tickets.forEach(t => { const k = monthKey(t.fecha || t.createdAt || t.timestamp); if (k) monthsSet.add(k); });
  // ensure last 12 months
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthsSet.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  const months = Array.from(monthsSet).sort();
  // seriesMensual removed; retained months for acumuladoMensual
  const acumuladoMensual = months.map(m => {
    // const [y, mm] = m.split('-').map(Number);
    let total = 0;
    tickets.forEach(t => { const k = monthKey(t.fecha || t.createdAt || t.timestamp); if (k === m) total++; });
    return { month: m, total };
  });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError("");
      try {
    const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
    // Departamentos (soportar dos formatos: { id: 'Nombre' } o { id: { nombre: 'Nombre' } })
  const depSnap = await get(ref(dbInstance, 'departamentos'));
        let deps = [];
        if (depSnap.exists()) {
          const depVal = depSnap.val();
          deps = Object.entries(depVal).map(([id, v]) => ({ id, nombre: typeof v === 'string' ? v : (v?.nombre || v?.name || id) }));
          setDepartamentos(deps);
        } else {
          setDepartamentos([]);
        }
        // Tickets
  const ticketsSnap = await get(ref(dbInstance, 'tickets'));
        if (ticketsSnap.exists()) {
          const all = Object.entries(ticketsSnap.val()).map(([id, t]) => ({ id, ...t }));
          // Si el usuario NO es admin, filtrar tickets a los del/los departamento(s) del usuario
          const isAdmin = (userData?.isSuperAdmin || userData?.rol === 'admin');
          if (!isAdmin) {
            const userDeptRaw = (userData?.departamento || '').toString().trim();
            const matchedDep = userDeptRaw ? deps.find(d => String(d.nombre).toLowerCase() === String(userDeptRaw).toLowerCase() || String(d.id) === String(userDeptRaw)) : null;
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
                const depByName = deps.find(d => d.nombre === ticketDept);
                if (depByName && (userDeptCandidates.has(depByName.id) || userDeptCandidates.has(depByName.nombre))) return true;
              }
              if (typeof ticketDept === 'object') {
                const candId = ticketDept.id || ticketDept.key || ticketDept.value;
                if (candId && userDeptCandidates.has(candId)) return true;
                const candName = ticketDept.nombre || ticketDept.name || ticketDept.label;
                if (candName && userDeptCandidates.has(candName)) return true;
                if (candName) {
                  const depByName = deps.find(d => d.nombre === candName);
                  if (depByName && userDeptCandidates.has(depByName.id)) return true;
                }
              }
              return false;
            };
            setTickets(all.filter(t => matchesUserDept(t.departamento)));
          } else {
            setTickets(all);
          }
        } else {
          setTickets([]);
        }

        // SLA configurations
        try {
          const [tiposSnap, subcatsSnap, slaConfigSnap, slaSubcatsSnap, usersSnap] = await Promise.all([
            get(ref(dbInstance, 'tiposTickets')),
            get(ref(dbInstance, 'subcategoriasTickets')),
            get(ref(dbInstance, 'sla/configs')),
            get(ref(dbInstance, 'sla/subcategorias')),
            get(ref(dbInstance, 'usuarios'))
          ]);
          setTipos(tiposSnap.exists() ? tiposSnap.val() : {});
          setSubcats(subcatsSnap.exists() ? subcatsSnap.val() : {});
          setSlaConfigs(slaConfigSnap.exists() ? slaConfigSnap.val() : {});
          setSlaSubcats(slaSubcatsSnap.exists() ? slaSubcatsSnap.val() : {});
          setUsuariosMap(usersSnap.exists() ? usersSnap.val() : {});
        } catch (e) {
          console.warn('No se pudo cargar configuración SLA', e);
          setTipos({});
          setSubcats({});
          setSlaConfigs({});
          setSlaSubcats({});
          setUsuariosMap({});
        }
      } catch {
        setError("Error al cargar los datos. Intenta de nuevo más tarde.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [ctxDb, recinto, userData]);

  // Helper para calcular SLA usando la función utilitaria
  const calculateSlaForTicket = (ticket) => {
    return calculateSlaRemaining(ticket, slaConfigs, slaSubcats, tipos, subcats);
  };

  // Obtener solo las horas de SLA aplicables a un ticket (usa la misma lógica de prioridad que slaCalculator)
  const computeSlaHoursForTicket = React.useCallback((ticket) => {
    try {
      const deptId = ticket._departamentoId || ticket.departamento;
      // intentar SLA por subcategoría
      try {
        const tiposForDept = tipos[deptId] || {};
        const tipoEntry = Object.entries(tiposForDept).find(([, nombre]) => nombre === ticket.tipo);
        const tipoId = tipoEntry ? tipoEntry[0] : null;
        if (tipoId && subcats[deptId] && subcats[deptId][tipoId]) {
          const subEntries = Object.entries(subcats[deptId][tipoId]);
          const found = subEntries.find(([, nombre]) => nombre === ticket.subcategoria);
          const subId = found ? found[0] : null;
          if (subId && slaSubcats[deptId] && slaSubcats[deptId][tipoId] && slaSubcats[deptId][tipoId][subId]) {
            const slaConfigItem = slaSubcats[deptId][tipoId][subId];
            const priority = ticket.prioridad || 'Media';
            return typeof slaConfigItem === 'object' ? slaConfigItem[priority] : (priority === 'Media' ? slaConfigItem : null);
          }
        }
      } catch { /* ignore and fallback */ }
      // fallback a SLA por departamento
      const deptConfig = slaConfigs[deptId] || {};
      const priority = ticket.prioridad || 'Media';
      const DEFAULT_SLA = { Alta: 24, Media: 72, Baja: 168 };
      return deptConfig[priority] ?? DEFAULT_SLA[priority] ?? 72;
    } catch { return null; }
  }, [slaConfigs, slaSubcats, tipos, subcats]);

  

  // Helpers para resolver datos heterogéneos
  const resolveDepartmentName = React.useCallback((depRaw) => {
    if (!depRaw) return '';
    // Si es objeto, probar campos comunes
    if (typeof depRaw === 'object') {
      if (!depRaw) return '';
      const candidates = [depRaw.nombre, depRaw.name, depRaw.id, depRaw.value, depRaw.departamento];
      for (const c of candidates) if (c) return c;
      // Firebase RTDB a veces guarda referencias tipo '/departamentos/ABC'
      if (depRaw?.ref && typeof depRaw.ref === 'string') {
        const parts = depRaw.ref.split('/').filter(Boolean);
        return parts[parts.length - 1] || '';
      }
      return '';
    }
    // Si es string con path '/departamentos/ID'
    if (typeof depRaw === 'string') {
      const s = depRaw;
      if (s.includes('/')) {
        const parts = s.split('/').filter(Boolean);
        const last = parts[parts.length - 1];
        // Buscar nombre en lista
        const found = departamentos.find(d => d.id === last);
        return found?.nombre || last;
      }
      const found = departamentos.find(d => d.id === s);
      return found?.nombre || s;
    }
    return '';
  }, [departamentos]);

  const resolveDateFromRow = React.useCallback((row) => {
    if (!row) return '';
    const candidates = [row.fecha, row.createdAt, row.createdAtTimestamp, row.timestamp, row.createdAtMillis];
    let val = undefined;
    for (const c of candidates) {
      if (c !== undefined && c !== null) { val = c; break; }
    }
    // Manejar timestamp firestore { seconds, nanoseconds }
    if (val && typeof val === 'object' && (val.seconds || val.nanoseconds)) {
      const secs = Number(val.seconds || 0);
      const ms = secs * 1000;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? '' : d.toLocaleString();
    }
    if (val === undefined) return '';
    // Si es número (ms o s)
    if (typeof val === 'number') {
      // Si parece estar en segundos (10 dígitos) convertir
      const asMs = val < 1e12 ? val * 1000 : val;
      const d = new Date(asMs);
      return isNaN(d.getTime()) ? '' : d.toLocaleString();
    }
    // Si es string, intentar parseInt o Date
    if (typeof val === 'string') {
      const n = parseInt(val, 10);
      if (!isNaN(n)) {
        const asMs = n < 1e12 ? n * 1000 : n;
        const d = new Date(asMs);
        if (!isNaN(d.getTime())) return d.toLocaleString();
      }
      const d2 = new Date(val);
      return isNaN(d2.getTime()) ? '' : d2.toLocaleString();
    }
    return '';
  }, []);

  // Resolver un elemento del array asignados (puede ser id, email, objeto parcial)
  const resolveAssignedEntry = React.useCallback((entry) => {
    if (!entry) return '';
    // Si es objeto con datos ya legibles
    if (typeof entry === 'object') {
      // Si trae id y podemos ampliar desde usuariosMap, usamos el registro completo
      const maybeId = entry.id || entry.uid || entry.key;
      if (maybeId && usuariosMap[maybeId]) {
        const u = usuariosMap[maybeId];
        const full = `${u.nombre || ''} ${u.apellido || ''}`.trim();
        return full || u.displayName || u.name || u.email || maybeId;
      }
      const full = `${entry.nombre || ''} ${entry.apellido || ''}`.trim();
      return full || entry.displayName || entry.name || entry.email || entry.id || '';
    }
    // Si es string: puede ser id, email o ya un nombre
    if (typeof entry === 'string') {
      const val = entry.trim();
      // Primero intentar id directo
      if (usuariosMap[val]) {
        const u = usuariosMap[val];
        const full = `${u.nombre || ''} ${u.apellido || ''}`.trim();
        return full || u.displayName || u.name || u.email || val;
      }
      // Si parece email, buscar por email
      if (val.includes('@')) {
        const lower = val.toLowerCase();
        for (const [id, u] of Object.entries(usuariosMap)) {
          if ((u.email || '').toLowerCase() === lower) {
            const full = `${u.nombre || ''} ${u.apellido || ''}`.trim();
            return full || u.displayName || u.name || u.email || id;
          }
        }
      }
      // Como fallback, devolver tal cual (podría ser un nombre ya)
      return val;
    }
    return '';
  }, [usuariosMap]);

  // Debug: mostrar el primer ticket y los valores resueltos en consola para diagnóstico UI
  React.useEffect(() => {
    if (tickets && tickets.length > 0) {
      console.log('Reportes debug - primer ticket raw:', tickets[0]);
      console.log('Reportes debug - departamento resuelto:', resolveDepartmentName(tickets[0].departamento));
      console.log('Reportes debug - fecha resuelta:', resolveDateFromRow(tickets[0]));
    }
  }, [tickets, departamentos, resolveDepartmentName, resolveDateFromRow]);



  // Columnas para DataGrid
  const columns = [
    { field: 'departamento', headerName: 'Departamento', width: 160, renderCell: (params) => {
      return <span>{resolveDepartmentName(params?.row?.departamento)}</span>;
    } },
    { field: 'tipo', headerName: 'Categoría', width: 120 },
    { field: 'estado', headerName: 'Estado', width: 120, renderCell: (params) => (
      <Chip label={params.value} size="small" color={params.value === 'Abierto' ? 'warning' : params.value === 'En Proceso' ? 'info' : 'success'} />
    ) },
  { field: 'slaRestante', headerName: 'Vencimiento', width: 140, renderCell: (params) => {
      const slaInfo = calculateSlaForTicket(params.row);
      if (!slaInfo) return <span>-</span>;
      
  const { remainingHours, isExpired, overdueHours } = slaInfo;
      
      if (isExpired) {
  const totalHours = Math.round((overdueHours || Math.abs(remainingHours)) * 10) / 10; // Redondear a 1 decimal
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
    } },
  { field: 'usuario', headerName: 'Usuario', width: 160 },
  { field: 'usuarioAsignado', headerName: 'Usuario Asignado', width: 180, renderCell: (params) => <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{params.row?.usuarioAsignado || ''}</span> },
    { field: 'fecha', headerName: 'Fecha', width: 180, renderCell: (params) => {
      return <span>{resolveDateFromRow(params?.row)}</span>;
    } },
    { field: 'tiempoLaboralMs', headerName: 'Horas cierre (h)', width: 160, renderCell: (params) => {
      // Usar duración de resolución en horas (horas laborales descontando pausas)
      const row = params.row || {};
      const ms = computeTicketResolutionMs(row);
      const hours = (ms !== null && ms !== undefined) ? Math.round((ms / (1000 * 60 * 60)) * 10) / 10 : null;
      // Calcular SLA de la subcategoría para decidir estilo (vencido = isExpired)
      const slaInfo = calculateSlaForTicket(row);
      let isExpired = slaInfo?.isExpired;
      // Si el ticket está cerrado, calculateSlaForTicket puede devolver null; en ese caso obtener slaHours y comparar con hours
      if (!isExpired) {
        try {
          const slaHours = slaInfo?.slaHours ?? computeSlaHoursForTicket(row);
          if (slaHours !== null && slaHours !== undefined && hours !== null) {
            if (hours > Number(slaHours)) isExpired = true;
          }
        } catch { /* noop */ }
      }
      if (hours === null) return <span />;
      return (
        <Chip
          label={`${hours}h`}
          size="small"
          color={isExpired ? undefined : (hours <= 12 ? 'warning' : 'success')}
          variant={isExpired ? 'filled' : (hours <= 12 ? 'filled' : 'outlined')}
          sx={isExpired ? { backgroundColor: theme.palette.error.main, color: '#fff', fontWeight: 700 } : undefined}
        />
      );
    } },
    { field: 'adjuntoUrl', headerName: 'Adjunto', width: 120, renderCell: (params) => {
      const row = params?.row || {};
      const url = params.value || row.adjuntoUrl || row.adjunto?.url || (Array.isArray(row.adjuntos) && row.adjuntos[0]?.url) || row.adjunto;
      return url ? <Button href={url} target="_blank" size="small" color="info" sx={{ fontWeight: 700 }}>Ver</Button> : '';
    } },
  { field: 'asignadosTexto', headerName: 'Reasignados', width: 220, renderCell: (params) => <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{params.row?.asignadosTexto || ''}</span> },
    { field: 'lastReassignAt', headerName: 'Última Reasignación', width: 180 },
  ];

  // Pre-calcular campos derivados para evitar errores en valueGetter cuando params es indefinido
  // Ordenar tickets por fecha de creación (más recientes primero)
  const enrichedTickets = React.useMemo(() => {
    try {
      const copy = Array.isArray(ticketsFiltrados) ? [...ticketsFiltrados] : [];
      copy.sort((a, b) => {
        const aTs = parseAnyTimestamp(a?.createdAt ?? a?.fecha ?? a?.timestamp ?? a?._createdAt) || 0;
        const bTs = parseAnyTimestamp(b?.createdAt ?? b?.fecha ?? b?.timestamp ?? b?._createdAt) || 0;
        return bTs - aTs; // descendente: más reciente primero
      });
      return copy.map(t => {
        let asignadosTexto = '';
        let lastReassignAt = '';
        // Determinar usuario(s) asignado(s) originalmente
        let usuarioAsignado = '';
        try {
          // Posibles campos que pueden contener info del asignado inicial
          if (t?.initialAssignees) {
            if (Array.isArray(t.initialAssignees) && t.initialAssignees.length) usuarioAsignado = resolveAssignedEntry(t.initialAssignees[0]);
            else usuarioAsignado = resolveAssignedEntry(t.initialAssignees);
          } else if (t?.asignadosIniciales) {
            if (Array.isArray(t.asignadosIniciales) && t.asignadosIniciales.length) usuarioAsignado = resolveAssignedEntry(t.asignadosIniciales[0]);
            else usuarioAsignado = resolveAssignedEntry(t.asignadosIniciales);
          } else if (t?.asignadoOriginal) {
            usuarioAsignado = resolveAssignedEntry(t.asignadoOriginal);
          } else if (Array.isArray(t.asignados) && t.asignados.length) {
            // Usar el primer asignado como asignado inicial por defecto
            usuarioAsignado = resolveAssignedEntry(t.asignados[0]);
          } else if (t.usuario) {
            usuarioAsignado = resolveAssignedEntry(t.usuario);
          }
  } catch { usuarioAsignado = '' }
        if (t?.reassignments) {
          try {
            const arr = Object.values(t.reassignments).filter(Boolean);
            if (arr.length) {
              const maxAt = arr.reduce((m,o)=> (o?.at && o.at>m?o.at:m),0);
              if (maxAt) lastReassignAt = new Date(maxAt).toLocaleString();
              if (Array.isArray(t.asignados)) {
                const list = t.asignados.map(a => resolveAssignedEntry(a)).filter(Boolean);
                const seen = new Set();
                const dedup = [];
                for (const v of list) { if (!seen.has(v)) { seen.add(v); dedup.push(v); } }
                asignadosTexto = dedup.join(', ');
              }
            }
          } catch { /* noop */ }
        }
        return { ...t, asignadosTexto, lastReassignAt, usuarioAsignado };
      });
    } catch {
      return ticketsFiltrados.map(t => ({ ...t }));
    }
  }, [ticketsFiltrados, resolveAssignedEntry]);

  // Exportar a Excel
  const handleExportExcel = () => {
    try {
  const data = ticketsFiltrados.map(t => {
        const slaInfo = calculateSlaForTicket(t);
        let slaText = '-';
        if (slaInfo) {
          const { remainingHours, isExpired, overdueHours } = slaInfo;
          if (isExpired) {
            const totalHours = Math.round(((overdueHours !== undefined ? overdueHours : Math.abs(remainingHours))) * 10) / 10;
            slaText = `Vencido: ${totalHours}h`;
          } else {
            const safeRemaining = remainingHours < 0 ? 0 : remainingHours;
            const totalHours = Math.round(safeRemaining * 10) / 10;
            slaText = `${totalHours}h`;
          }
        }
  // Tiempo hasta cierre en horas (decimal 1d) — consistente con la vista de la tabla
  const ms = computeTicketResolutionMs(t);
  const hours = (ms !== null && ms !== undefined) ? Math.round((ms / (1000 * 60 * 60)) * 10) / 10 : null;
  let tiempoLaboral = hours !== null ? `${hours}h` : '';
  // Determinar SLA de la subcategoría (si está disponible en el ticket)
  const slaCandidate = t?.subcategoriaHoras ?? t?.subcategoriaTiempo ?? t?.slaHours ?? null;
  if (hours !== null && slaCandidate !== null && slaCandidate !== undefined && !isNaN(Number(slaCandidate))) {
    if (hours > Number(slaCandidate)) tiempoLaboral = `${tiempoLaboral} (Excedido)`;
  }
  // Asignados solo si hay historial de reasignaciones con al menos 1 entrada
        let asignadosTexto = '';
        let lastReassignAt = '';
        if (t?.reassignments) {
          try {
            const arr = Object.values(t.reassignments).filter(Boolean);
            if (arr.length) {
              const maxAt = arr.reduce((m,o)=> (o?.at && o.at>m?o.at:m),0);
              if (maxAt) lastReassignAt = new Date(maxAt).toLocaleString();
              if (Array.isArray(t.asignados)) {
                const list = t.asignados.map(a => resolveAssignedEntry(a)).filter(Boolean);
                const seen = new Set();
                const dedup = [];
                for (const v of list) { if (!seen.has(v)) { seen.add(v); dedup.push(v); } }
                asignadosTexto = dedup.join(', ');
              }
            }
          } catch { /* noop */ }
        }
        // calcular usuarioAsignado para export
        let usuarioAsignado = '';
        try {
          if (t?.initialAssignees) {
            if (Array.isArray(t.initialAssignees) && t.initialAssignees.length) usuarioAsignado = resolveAssignedEntry(t.initialAssignees[0]);
            else usuarioAsignado = resolveAssignedEntry(t.initialAssignees);
          } else if (t?.asignadosIniciales) {
            if (Array.isArray(t.asignadosIniciales) && t.asignadosIniciales.length) usuarioAsignado = resolveAssignedEntry(t.asignadosIniciales[0]);
            else usuarioAsignado = resolveAssignedEntry(t.asignadosIniciales);
          } else if (t?.asignadoOriginal) {
            usuarioAsignado = resolveAssignedEntry(t.asignadoOriginal);
          } else if (Array.isArray(t.asignados) && t.asignados.length) {
            usuarioAsignado = resolveAssignedEntry(t.asignados[0]);
          } else if (t.usuario) {
            usuarioAsignado = resolveAssignedEntry(t.usuario);
          }
        } catch { usuarioAsignado = '' }

        // Return object (not relied on for column order). We'll build sheet with explicit column order below.
        return {
          'Departamento': resolveDepartmentName(t.departamento),
          'Categoría': t.tipo || '',
          'Estado': t.estado || '',
          'SLA Restante': slaText,
          'Usuario': t.usuario || '',
          'Usuario Asignado': usuarioAsignado || (t.usuario || ''),
          'Fecha': resolveDateFromRow(t),
          'Horas cierre (h)': tiempoLaboral,
          'Adjunto': (t.adjuntoUrl || t.adjunto?.url || (Array.isArray(t.adjuntos) && t.adjuntos[0]?.url) || t.adjunto) || '',
    'Reasignados': asignadosTexto,
          'Última Reasignación': lastReassignAt,
        };
      });
      // Build an array-of-arrays (AOA) to guarantee column order matches the DataGrid table
  const headers = ['Departamento', 'Categoría', 'Estado', 'SLA Restante', 'Usuario', 'Usuario Asignado', 'Fecha', 'Horas cierre (h)', 'Adjunto', 'Reasignados', 'Última Reasignación'];
  // Build rows explicitly to guarantee column order matches the DataGrid table
  const rows = [headers];
      data.forEach(d => {
        rows.push([
          d['Departamento'] || '',
          d['Categoría'] || '',
          d['Estado'] || '',
          d['SLA Restante'] || '',
          d['Usuario'] || '',
          d['Usuario Asignado'] || '',
          d['Fecha'] || '',
          d['Horas cierre (h)'] || '',
          d['Adjunto'] || '',
          d['Reasignados'] || '',
          d['Última Reasignación'] || ''
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], { type: 'application/octet-stream' });
      saveAs(blob, 'reporte_tickets.xlsx');
      setSnackbar({ open: true, message: 'Exportado a Excel', severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: 'Error al exportar a Excel', severity: 'error' });
    }
  };

  const [exportandoPdf, setExportandoPdf] = useState(false);

  // Exportar a PDF (versión robusta con diagnóstico y mejor resolución)
  const handleExportPDF = async () => {
    if (exportandoPdf) return;
    setExportandoPdf(true);
    try {
      // Carga dinámica de html2canvas
      const { default: dynamicHtml2canvas } = await import('html2canvas');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(16);
      doc.text('Reporte de Tickets', 40, 40);

      let cursorY = 60;
      const marginX = 40;
      const maxChartWidth = pageWidth - marginX * 2;
      const twoColWidth = (pageWidth - marginX * 2 - 20) / 2; // 20 gap
      const stdHeight = 160;

  const addChartSingle = async (refEl) => {
        if (!refEl?.current) return;
        try {
          const canvas = await dynamicHtml2canvas(refEl.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
          const img = canvas.toDataURL('image/png');
          const aspect = canvas.width / canvas.height;
          const w = maxChartWidth;
          const h = w / aspect;
          if (cursorY + h > pageHeight - 120) { // saltar página si no cabe
            doc.addPage();
            cursorY = 40;
          }
          doc.addImage(img, 'PNG', marginX, cursorY, w, h);
          cursorY += h + 25;
        } catch (e) { console.warn('Error capturando gráfico', e); }
      };

      const addChartPair = async (leftRef, rightRef) => {
        const refs = [leftRef, rightRef];
        // Si ambos nulos, nada
        if (!refs[0]?.current && !refs[1]?.current) return;
        // Calcular altura real de cada canvas y mantener proporción en dos columnas
        const canvases = [];
        for (const r of refs) {
          if (r?.current) {
            try {
              const c = await dynamicHtml2canvas(r.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
              canvases.push(c);
            } catch (e) { canvases.push(null); console.warn('Error canvas par', e); }
          } else canvases.push(null);
        }
        const targetH = stdHeight;
        const neededHeight = targetH; // uniform height
        if (cursorY + neededHeight > pageHeight - 120) {
          doc.addPage();
          cursorY = 40;
        }
        const positions = [marginX, marginX + twoColWidth + 20];
        canvases.forEach((c,i) => {
          if (!c) return;
            const img = c.toDataURL('image/png');
            doc.addImage(img, 'PNG', positions[i], cursorY, twoColWidth, targetH);
        });
        cursorY += targetH + 25;
      };

      // Pares: (pie, dept), (tipo, topUsers), (avgDept, avgUser)
      await addChartPair(pieRef, barRef);
      await addChartPair(tipoRef, topUsersRef);
      await addChartPair(avgDeptRef, avgUserRef);
      // Single: mensual
      await addChartSingle(monthlyRef);

    // Preparar datos tabla (sin ID, coincidente con la vista) + columnas de reasignaciones
    const bodyData = ticketsFiltrados.map(t => {
        const slaInfo = calculateSlaForTicket(t);
        let slaText = '-';
        if (slaInfo) {
          const { remainingHours, isExpired, overdueHours } = slaInfo;
          if (isExpired) {
            const totalHours = Math.round(((overdueHours !== undefined ? overdueHours : Math.abs(remainingHours))) * 10) / 10;
            slaText = `Vencido: ${totalHours}h`;
          } else {
            const safeRemaining = remainingHours < 0 ? 0 : remainingHours;
            const totalHours = Math.round(safeRemaining * 10) / 10;
            slaText = `${totalHours}h`;
          }
        }
  // Tiempo hasta cierre en horas (decimal 1d)
  const ms = computeTicketResolutionMs(t);
  const hours = (ms !== null && ms !== undefined) ? Math.round((ms / (1000 * 60 * 60)) * 10) / 10 : null;
  let tiempoLaboral = hours !== null ? `${hours}h` : '';
  const slaCandidatePdf = t?.subcategoriaHoras ?? t?.subcategoriaTiempo ?? t?.slaHours ?? null;
  if (hours !== null && slaCandidatePdf !== null && slaCandidatePdf !== undefined && !isNaN(Number(slaCandidatePdf))) {
    if (hours > Number(slaCandidatePdf)) tiempoLaboral = `${tiempoLaboral} (Excedido)`;
  }
  // Asignados y última reasignación (solo si hay historial)
        let asignadosTexto = '';
        let lastReassignAt = '';
        if (t?.reassignments) {
          try {
            const arr = Object.values(t.reassignments).filter(Boolean);
            if (arr.length) {
              const maxAt = arr.reduce((m,o)=> (o?.at && o.at>m?o.at:m),0);
              if (maxAt) lastReassignAt = new Date(maxAt).toLocaleString();
              if (Array.isArray(t.asignados)) {
                const list = t.asignados.map(a => resolveAssignedEntry(a)).filter(Boolean);
                const seen = new Set();
                const dedup = [];
                for (const v of list) { if (!seen.has(v)) { seen.add(v); dedup.push(v); } }
                asignadosTexto = dedup.join(', ');
              }
            }
          } catch { /* noop */ }
        }
        // calcular usuarioAsignado para PDF export
        let usuarioAsignado = '';
        try {
          if (t?.initialAssignees) {
            if (Array.isArray(t.initialAssignees) && t.initialAssignees.length) usuarioAsignado = resolveAssignedEntry(t.initialAssignees[0]);
            else usuarioAsignado = resolveAssignedEntry(t.initialAssignees);
          } else if (t?.asignadosIniciales) {
            if (Array.isArray(t.asignadosIniciales) && t.asignadosIniciales.length) usuarioAsignado = resolveAssignedEntry(t.asignadosIniciales[0]);
            else usuarioAsignado = resolveAssignedEntry(t.asignadosIniciales);
          } else if (t?.asignadoOriginal) {
            usuarioAsignado = resolveAssignedEntry(t.asignadoOriginal);
          } else if (Array.isArray(t.asignados) && t.asignados.length) {
            usuarioAsignado = resolveAssignedEntry(t.asignados[0]);
          } else if (t.usuario) {
            usuarioAsignado = resolveAssignedEntry(t.usuario);
          }
        } catch { usuarioAsignado = '' }
        const hasAdj = (t.adjuntoUrl || t.adjunto?.url || (Array.isArray(t.adjuntos) && t.adjuntos[0]?.url) || t.adjunto) ? 'Sí' : '';
  // Order must match DataGrid columns: Departamento, Categoría, Estado, Vencimiento, Usuario, Usuario Asignado, Fecha, Horas cierre (h), Adjunto, Asignados, Última Reasignación
        return [
          resolveDepartmentName(t.departamento),
          t.tipo || '',
          t.estado || '',
          slaText,
          t.usuario || '',
          usuarioAsignado || (t.usuario || ''),
          resolveDateFromRow(t),
          tiempoLaboral,
          hasAdj,
          asignadosTexto,
          lastReassignAt,
        ];
      });

      if (typeof autoTable !== 'function') {
        throw new Error('AutoTable plugin no disponible');
      }
    autoTable(doc, {
  head: [['Departamento', 'Categoría', 'Estado', 'SLA Restante', 'Usuario', 'Usuario Asignado', 'Fecha', 'Horas cierre (h)', 'Adjunto', 'Reasignados', 'Última Reasignación']],
        body: bodyData,
        startY: cursorY,
        margin: { left: 40, right: 40 },
        styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
        headStyles: { fillColor: [25, 118, 210], fontSize: 9 },
  didDrawPage: () => {
          // Footer con paginación
          const page = doc.internal.getNumberOfPages();
          doc.setFontSize(8);
          doc.text(`Página ${page}`, pageWidth - 80, doc.internal.pageSize.getHeight() - 20);
        },
      });

      doc.save('reporte_tickets.pdf');
      setSnackbar({ open: true, message: 'Exportado a PDF', severity: 'success' });
    } catch (e) {
      console.error('Error exportando PDF:', e);
      setSnackbar({ open: true, message: `Error al exportar a PDF: ${e.message || ''}`.trim(), severity: 'error' });
    } finally {
      setExportandoPdf(false);
    }
  };

  return (
    <ModuleContainer>
      <PageHeader 
        title="Reportes" 
        subtitle="Analiza y exporta información de tickets"
        icon={<AssessmentIcon />}
        gradient={gradients.dark}
      />
      
      <SectionContainer title="Filtros" icon={<FilterListIcon />}>
        <Grid container spacing={2} alignItems="center">
          <Grid gridColumn={{ xs: '1 / -1', sm: 'span 3', md: 'span 3' }} sx={{ minWidth: 220, maxWidth: 340, width: '100%' }}>
            <TextField
              select
              label="Departamento"
              value={filtroDep}
              onChange={e => setFiltroDep(e.target.value)}
              fullWidth
              size="small"
              sx={{ minWidth: 220, maxWidth: 340 }}
            >
              <MenuItem value="">Todos</MenuItem>
              {departamentos.map(dep => (
                <MenuItem key={dep.id} value={dep.id}>{dep.nombre}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid gridColumn={{ xs: '1 / -1', sm: 'span 3', md: 'span 3' }} sx={{ minWidth: 220, maxWidth: 340, width: '100%' }}>
            <TextField
              select
              label="Estado"
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value)}
              fullWidth
              size="small"
              sx={{ minWidth: 220, maxWidth: 340 }}
            >
              <MenuItem value="">Todos</MenuItem>
              {estados.map(e => (
                <MenuItem key={e} value={e}>{e}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid gridColumn={{ xs: '1 / -1', sm: 'span 6', md: 'span 6' }} sx={{ display: 'flex', justifyContent: { xs: 'flex-start', md: 'flex-end' }, gap: 2 }}>
            <Button 
              variant="contained" 
              onClick={handleExportExcel} 
              sx={{ 
                minWidth: 140, 
                background: gradients.success,
                fontWeight: 600,
                '&:hover': { opacity: 0.9 }
              }}
            >
              Exportar a Excel
            </Button>
            <Button 
              variant="contained" 
              onClick={handleExportPDF} 
              disabled={exportandoPdf} 
              sx={{ 
                minWidth: 140, 
                background: gradients.error,
                fontWeight: 600,
                '&:hover': { opacity: 0.9 }
              }}
            >
              {exportandoPdf ? 'Generando...' : 'Exportar a PDF'}
            </Button>
          </Grid>
        </Grid>
      </SectionContainer>
      
      <SectionContainer title="Tickets (vista tabla)" icon={<TableChartIcon />}>
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
            <CircularProgress size={60} color="primary" />
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : (
          <DataGridErrorBoundary>
            <DataGrid
              rows={enrichedTickets}
              columns={columns}
              autoHeight
              pageSize={10}
              rowsPerPageOptions={[10, 25, 50]}
              sx={{
                border: 0,
                fontSize: 15,
                background: 'transparent',
                borderRadius: 2,
                '& .MuiDataGrid-columnHeaders': {
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  fontWeight: 700,
                  fontSize: 14,
                  borderRadius: 2,
                },
                '& .MuiDataGrid-row': {
                  '&:hover': {
                    background: alpha(theme.palette.primary.main, 0.04),
                  },
                },
                '& .MuiDataGrid-cell': {
                  fontSize: 14,
                  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
                },
                '& .MuiDataGrid-footerContainer': {
                  bgcolor: alpha(theme.palette.background.paper, 0.5),
                  borderRadius: '0 0 8px 8px',
                },
              }}
              disableSelectionOnClick
              getRowId={row => row.id}
              localeText={{ noRowsLabel: 'No hay tickets para mostrar' }}
            />
          </DataGridErrorBoundary>
        )}
      </SectionContainer>
      {/* Gráficos debajo de la tabla */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          gap: 3,
          mt: 3,
          width: '100%',
        }}
      >
        <GlassCard sx={{ p: 2, flex: 1 }}>
          <Box ref={pieRef} sx={{ width: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tickets por Estado</Typography>
            <ReportesPieChart data={ticketsPorEstado} title="Tickets por Estado" />
          </Box>
        </GlassCard>
        <GlassCard sx={{ p: 2, flex: 1 }}>
          <Box ref={barRef} sx={{ width: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tickets por Departamento</Typography>
            <ReportesBarChart data={ticketsPorDepartamento} title="Tickets por Departamento" xKey="name" yKey="value" />
          </Box>
        </GlassCard>
      </Box>
      {/* Nuevos gráficos adicionales */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3, mt: 3, width: '100%' }}>
        <GlassCard sx={{ p: 2, flex: 1 }}>
          <Box ref={tipoRef} sx={{ width: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tickets por Tipo</Typography>
            <ReportesBarChart data={ticketsPorTipo} title="Tickets por Tipo" xKey="name" yKey="value" />
          </Box>
        </GlassCard>
        <GlassCard sx={{ p: 2, flex: 1 }}>
          <Box ref={topUsersRef} sx={{ width: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Top Usuarios (tickets totales)</Typography>
            <ReportesHorizontalBarChart data={topUsuarios} title="Top Usuarios (tickets totales)" xKey="name" yKey="value" />
          </Box>
        </GlassCard>
      </Box>

      <Box sx={{ mt: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3, mb: 3 }}>
          <GlassCard sx={{ p: 2, flex: 1 }}>
            <Box ref={avgDeptRef} sx={{ width: '100%' }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tiempo promedio de cierre de Tickets por Departamento (horas)</Typography>
              <ReportesBarChart data={avgByDept} title="Tiempo promedio (horas)" xKey="name" yKey="value" />
            </Box>
          </GlassCard>
          <GlassCard sx={{ p: 2, flex: 1 }}>
            <Box ref={avgUserRef} sx={{ width: '100%' }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tiempo promedio de cierre de Tickets por Usuario (horas)</Typography>
              <ReportesBarChart data={avgByUser} title="Tiempo promedio (horas)" xKey="name" yKey="value" />
            </Box>
          </GlassCard>
        </Box>
        <GlassCard sx={{ p: 2 }}>
          <Box ref={monthlyRef} sx={{ width: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tickets mensuales (acumulado)</Typography>
            <ReportesAreaChart data={acumuladoMensual} title="Tickets mensuales (acumulado)" xKey="month" areas={[{ dataKey: 'total', color: '#1976d2' }]} />
          </Box>
        </GlassCard>
      </Box>
  {/* avgByDept chart moved above replacing the monthly series chart */}
      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar(s => ({ ...s, open: false }))} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </ModuleContainer>
  );
}
