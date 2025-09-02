import React, { useEffect, useState, useRef } from 'react';
import { ReportesPieChart, ReportesBarChart, ReportesLineChart, ReportesAreaChart, ReportesHorizontalBarChart } from './ReportesCharts';

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


  // Filtros y datos para los gráficos
  const estados = ['Abierto', 'En Proceso', 'Cerrado'];
  const ticketsFiltrados = tickets.filter(t =>
    (!filtroDep || t.departamento === filtroDep) &&
    (!filtroEstado || t.estado === filtroEstado)
  );
  // Calcular duración de resolución por ticket (considerando pausas si existen)
  const computeTicketResolutionMs = (t) => {
    try {
      // obtener timestamps de creado y cerrado
      const createdCandidates = t.createdAt || t.fecha || t.timestamp || t.createdAtTimestamp || t.createdAtMillis;
      const closedCandidates = t.closedAt || t.closedAtTimestamp || t.cerradoAt || t.fechaCierre || t.updatedAt || t.closedAtMillis;
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
      const createdMs = parseAny(createdCandidates) || parseAny(t.created) || null;
      const closedMs = parseAny(closedCandidates) || null;
      const endMs = closedMs || Date.now();
      if (!createdMs) return null;
      // compute business-hours duration between createdMs and endMs
      let duration = workingMsBetween(createdMs, endMs);
      // subtract pauses but only counting their overlap with business hours
      if (t.pauses) {
        const pausesObj = t.pauses;
        for (const k of Object.keys(pausesObj)) {
          const p = pausesObj[k];
          const s = parseAny(p.start) || p.start || null;
          const e = parseAny(p.end) || p.end || null;
          if (!s) continue;
          const ps = Number(s);
          const pe = e ? Number(e) : endMs; // if active, use endMs
          if (pe > ps) {
            const overlapMs = workingMsBetween(Math.max(ps, createdMs), Math.min(pe, endMs));
            duration -= overlapMs;
          }
        }
      }
      return Math.max(0, duration);
    } catch (e) {
      console.warn('Error computing duration for ticket', e);
      return null;
    }
  };

  // Helper para parsear timestamps variados (reutilizable)
  const parseAnyTimestamp = (v) => {
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

  // Tiempo transcurrido real entre creación y cierre (ms). Si no está cerrado devuelve null.
  const computeTicketElapsedMs = (t) => {
    try {
      const createdCandidates = t.createdAt || t.fecha || t.timestamp || t.createdAtTimestamp || t.createdAtMillis || t.created;
      const closedCandidates = t.closedAt || t.closedAtTimestamp || t.cerradoAt || t.fechaCierre || t.updatedAt || t.closedAtMillis;
      const createdMs = parseAnyTimestamp(createdCandidates) || null;
      const closedMs = parseAnyTimestamp(closedCandidates) || null;
      if (!createdMs || !closedMs) return null;
      const diff = Number(closedMs) - Number(createdMs);
      return diff >= 0 ? diff : null;
    } catch {
      return null;
    }
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
    { field: 'tiempoLaboralMs', headerName: 'Horas cierre (h)', width: 160, renderCell: (params) => {
      const ms = params.row && computeTicketElapsedMs(params.row);
      const hours = (ms !== null && ms !== undefined) ? Math.round((ms / (1000 * 60 * 60)) * 10) / 10 : null;
      return <span>{hours !== null ? `${hours}h` : ''}</span>;
    } },
    { field: 'tipo', headerName: 'Categoría', width: 120 },
    { field: 'estado', headerName: 'Estado', width: 120, renderCell: (params) => (
      <Chip label={params.value} size="small" color={params.value === 'Abierto' ? 'warning' : params.value === 'En Proceso' ? 'info' : 'success'} />
    ) },
    { field: 'slaRestante', headerName: 'SLA Restante', width: 140, renderCell: (params) => {
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
    { field: 'fecha', headerName: 'Fecha', width: 180, renderCell: (params) => {
      return <span>{resolveDateFromRow(params?.row)}</span>;
    } },
    { field: 'adjuntoUrl', headerName: 'Adjunto', width: 120, renderCell: (params) => {
      const row = params?.row || {};
      const url = params.value || row.adjuntoUrl || row.adjunto?.url || (Array.isArray(row.adjuntos) && row.adjuntos[0]?.url) || row.adjunto;
      return url ? <Button href={url} target="_blank" size="small" color="info" sx={{ fontWeight: 700 }}>Ver</Button> : '';
    } },
    { field: 'asignadosTexto', headerName: 'Asignados', width: 220, renderCell: (params) => <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{params.row?.asignadosTexto || ''}</span> },
    { field: 'lastReassignAt', headerName: 'Última Reasignación', width: 180 },
  ];

  // Pre-calcular campos derivados para evitar errores en valueGetter cuando params es indefinido
  const enrichedTickets = React.useMemo(() => {
    return ticketsFiltrados.map(t => {
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
      return { ...t, asignadosTexto, lastReassignAt };
    });
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
  const ms = computeTicketElapsedMs(t);
  const tiempoLaboral = (ms !== null && ms !== undefined) ? `${Math.round((ms / (1000 * 60 * 60)) * 10) / 10}h` : '';
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

        return {
          'Departamento': resolveDepartmentName(t.departamento),
          'Horas cierre (h)': tiempoLaboral,
          'Categoría': t.tipo || '',
          'Estado': t.estado || '',
          'SLA Restante': slaText,
          'Usuario': t.usuario || '',
          'Fecha': resolveDateFromRow(t),
          'Adjunto': (t.adjuntoUrl || t.adjunto?.url || (Array.isArray(t.adjuntos) && t.adjuntos[0]?.url) || t.adjunto) || '',
          'Asignados': asignadosTexto,
          'Última Reasignación': lastReassignAt,
        };
      });
      const ws = XLSX.utils.json_to_sheet(data, { skipHeader: false });
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
  const ms = computeTicketElapsedMs(t);
  const tiempoLaboral = (ms !== null && ms !== undefined) ? `${Math.round((ms / (1000 * 60 * 60)) * 10) / 10}h` : '';
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
        const hasAdj = (t.adjuntoUrl || t.adjunto?.url || (Array.isArray(t.adjuntos) && t.adjuntos[0]?.url) || t.adjunto) ? 'Sí' : '';
        return [
          resolveDepartmentName(t.departamento),
          tiempoLaboral,
          t.tipo || '',
          t.estado || '',
          slaText,
          t.usuario || '',
          resolveDateFromRow(t),
          hasAdj,
          asignadosTexto,
          lastReassignAt,
        ];
      });

      if (typeof autoTable !== 'function') {
        throw new Error('AutoTable plugin no disponible');
      }
    autoTable(doc, {
  head: [['Departamento', 'Horas cierre (h)', 'Categoría', 'Estado', 'SLA Restante', 'Usuario', 'Fecha', 'Adjunto', 'Asignados', 'Última Reasignación']],
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
    <Box sx={{ p: { xs: 1, sm: 3 }, width: '100%', maxWidth: '100vw', minHeight: '90vh', boxSizing: 'border-box', background: theme => theme.palette.background.default }}>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 700, letterSpacing: 1 }}>Reportes</Typography>
      <Paper elevation={1} sx={{ p: 3, borderRadius: 4, mb: 3, boxShadow: 1 }}>
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
               <Button variant="contained" color="primary" onClick={handleExportExcel} sx={{ minWidth: 140, bgcolor: theme => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined, color: theme => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : undefined }}>
              Exportar a Excel
            </Button>
               <Button variant="contained" color="secondary" onClick={handleExportPDF} disabled={exportandoPdf} sx={{ minWidth: 140, bgcolor: theme => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined, color: theme => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : undefined }}>
              {exportandoPdf ? 'Generando...' : 'Exportar a PDF'}
            </Button>
          </Grid>
        </Grid>
      </Paper>
  <Paper elevation={1} sx={{ p: 2, borderRadius: 4, minHeight: 400, boxShadow: 1, background: 'background.paper' }}>
  <Typography variant="h6" sx={{ mb: 2, fontWeight: 700, letterSpacing: 1, color: theme => theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.primary.main }}>
          Tickets (vista tabla)
        </Typography>
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
                background: 'background.paper',
                borderRadius: 2,
                '& .MuiDataGrid-columnHeaders': {
                  bgcolor: theme => theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[100],
                  fontWeight: 700,
                  fontSize: 16,
                  letterSpacing: 1,
                },
                '& .MuiDataGrid-row:hover': {
                  background: theme => theme.palette.action.hover,
                },
                '& .MuiDataGrid-cell': {
                  fontSize: 15,
                },
                '& .MuiDataGrid-footerContainer': {
                  bgcolor: theme => theme.palette.mode === 'dark' ? theme.palette.background.default : theme.palette.grey[50],
                },
              }}
              disableSelectionOnClick
              getRowId={row => row.id}
              localeText={{ noRowsLabel: 'No hay tickets para mostrar' }}
            />
          </DataGridErrorBoundary>
        )}
      </Paper>
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
        <Paper
          elevation={2}
          sx={{
            p: 2,
            borderRadius: 3,
            flex: 1,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}
        >
          <Box ref={pieRef} sx={{ width: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tickets por Estado</Typography>
            <ReportesPieChart data={ticketsPorEstado} title="Tickets por Estado" />
          </Box>
        </Paper>
        <Paper
          elevation={2}
          sx={{
            p: 2,
            borderRadius: 3,
            flex: 1,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}
        >
          <Box ref={barRef} sx={{ width: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tickets por Departamento</Typography>
            <ReportesBarChart data={ticketsPorDepartamento} title="Tickets por Departamento" xKey="name" yKey="value" />
          </Box>
        </Paper>
      </Box>
      {/* Nuevos gráficos adicionales */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3, mt: 3, width: '100%' }}>
        <Paper elevation={2} sx={{ p: 2, borderRadius: 3, flex: 1 }}>
          <Box ref={tipoRef} sx={{ width: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tickets por Tipo</Typography>
            <ReportesBarChart data={ticketsPorTipo} title="Tickets por Tipo" xKey="name" yKey="value" />
          </Box>
        </Paper>
        <Paper elevation={2} sx={{ p: 2, borderRadius: 3, flex: 1 }}>
          <Box ref={topUsersRef} sx={{ width: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Top Usuarios (tickets totales)</Typography>
            <ReportesHorizontalBarChart data={topUsuarios} title="Top Usuarios (tickets totales)" xKey="name" yKey="value" />
          </Box>
        </Paper>
      </Box>

      <Box sx={{ mt: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3, mb: 3 }}>
          <Paper elevation={2} sx={{ p: 2, borderRadius: 3, flex: 1 }}>
            <Box ref={avgDeptRef} sx={{ width: '100%' }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tiempo promedio de cierre de Tickets por Departamento (horas)</Typography>
              <ReportesBarChart data={avgByDept} title="Tiempo promedio (horas)" xKey="name" yKey="value" />
            </Box>
          </Paper>
          <Paper elevation={2} sx={{ p: 2, borderRadius: 3, flex: 1 }}>
            <Box ref={avgUserRef} sx={{ width: '100%' }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tiempo promedio de cierre de Tickets por Usuario (horas)</Typography>
              <ReportesBarChart data={avgByUser} title="Tiempo promedio (horas)" xKey="name" yKey="value" />
            </Box>
          </Paper>
        </Box>
        <Paper elevation={2} sx={{ p: 2, borderRadius: 3 }}>
          <Box ref={monthlyRef} sx={{ width: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tickets mensuales (acumulado)</Typography>
            <ReportesAreaChart data={acumuladoMensual} title="Tickets mensuales (acumulado)" xKey="month" areas={[{ dataKey: 'total', color: '#1976d2' }]} />
          </Box>
        </Paper>
      </Box>
  {/* avgByDept chart moved above replacing the monthly series chart */}
      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar(s => ({ ...s, open: false }))} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
