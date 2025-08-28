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
import workingMsBetween from '../utils/businessHours';
import { msToHoursMinutes } from '../utils/formatDuration';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function Reportes() {
  // Refs para los gráficos
  const pieRef = useRef();
  const barRef = useRef();
  const { db: ctxDb, recinto } = useDb();
  const [tickets, setTickets] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  // SLA configuration states
  const [tipos, setTipos] = useState({});
  const [subcats, setSubcats] = useState({});
  const [slaConfigs, setSlaConfigs] = useState({});
  const [slaSubcats, setSlaSubcats] = useState({});
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
          setTickets(Object.entries(ticketsSnap.val()).map(([id, t]) => ({ id, ...t })));
        } else {
          setTickets([]);
        }

        // SLA configurations
        try {
          const [tiposSnap, subcatsSnap, slaConfigSnap, slaSubcatsSnap] = await Promise.all([
            get(ref(dbInstance, 'tiposTickets')),
            get(ref(dbInstance, 'subcategoriasTickets')),
            get(ref(dbInstance, 'sla/configs')),
            get(ref(dbInstance, 'sla/subcategorias'))
          ]);
          setTipos(tiposSnap.exists() ? tiposSnap.val() : {});
          setSubcats(subcatsSnap.exists() ? subcatsSnap.val() : {});
          setSlaConfigs(slaConfigSnap.exists() ? slaConfigSnap.val() : {});
          setSlaSubcats(slaSubcatsSnap.exists() ? slaSubcatsSnap.val() : {});
        } catch (e) {
          console.warn('No se pudo cargar configuración SLA', e);
          setTipos({});
          setSubcats({});
          setSlaConfigs({});
          setSlaSubcats({});
        }
      } catch {
        setError("Error al cargar los datos. Intenta de nuevo más tarde.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [ctxDb, recinto]);

  // Función para calcular el tiempo restante del SLA
  const calculateSlaRemaining = (ticket) => {
    try {
      // Si el ticket está cerrado, no mostrar tiempo restante
      if (ticket.estado === 'Cerrado') return null;

      // Obtener tiempo de creación
      const parseTimestamp = (val) => {
        if (!val) return null;
        if (typeof val === 'number') return val < 1e12 ? val * 1000 : val;
        if (typeof val === 'string') {
          const n = parseInt(val, 10);
          if (!isNaN(n)) return n < 1e12 ? n * 1000 : n;
          const d = new Date(val);
          return isNaN(d.getTime()) ? null : d.getTime();
        }
        if (typeof val === 'object' && val.seconds) return Number(val.seconds) * 1000;
        return null;
      };

      const createdMs = parseTimestamp(ticket.createdAt || ticket.fecha || ticket.timestamp);
      if (!createdMs) return null;

      // Determinar SLA aplicable
      let slaHours = null;
      
      // Intentar SLA por subcategoría
      try {
        const tiposForDept = tipos[ticket.departamento] || {};
        const tipoEntry = Object.entries(tiposForDept).find(([, nombre]) => nombre === ticket.tipo);
        const tipoId = tipoEntry ? tipoEntry[0] : null;
        
        if (tipoId && subcats[ticket.departamento] && subcats[ticket.departamento][tipoId]) {
          const subEntries = Object.entries(subcats[ticket.departamento][tipoId]);
          const found = subEntries.find(([, nombre]) => nombre === ticket.subcategoria);
          const subId = found ? found[0] : null;
          
          if (subId && slaSubcats[ticket.departamento] && slaSubcats[ticket.departamento][tipoId] && slaSubcats[ticket.departamento][tipoId][subId]) {
            const slaConfig = slaSubcats[ticket.departamento][tipoId][subId];
            const priority = ticket.prioridad || 'Media';
            slaHours = typeof slaConfig === 'object' ? slaConfig[priority] : (priority === 'Media' ? slaConfig : null);
          }
        }
      } catch {
        // Continuar con SLA por departamento
      }

      // Si no hay SLA por subcategoría, usar SLA por departamento
      if (slaHours == null) {
        const deptConfig = slaConfigs[ticket.departamento] || {};
        const priority = ticket.prioridad || 'Media';
        const DEFAULT_SLA = { Alta: 24, Media: 72, Baja: 168 };
        slaHours = deptConfig[priority] ?? DEFAULT_SLA[priority] ?? 72;
      }

      // Calcular tiempo transcurrido en horas
      const now = Date.now();
      const elapsedMs = now - createdMs;
      const elapsedHours = elapsedMs / (1000 * 60 * 60);
      
      // Calcular tiempo restante
      const remainingHours = slaHours - elapsedHours;
      
      return {
        remainingHours,
        slaHours,
        isExpired: remainingHours <= 0
      };
    } catch (e) {
      console.warn('Error calculando SLA restante:', e);
      return null;
    }
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
    { field: 'descripcion', headerName: 'Descripción', flex: 1, minWidth: 180 },
    { field: 'departamento', headerName: 'Departamento', width: 160, renderCell: (params) => {
      return <span>{resolveDepartmentName(params?.row?.departamento)}</span>;
    } },
    { field: 'tiempoLaboralMs', headerName: 'Tiempo (laboral)', width: 160, renderCell: (params) => {
      const ms = params.row && computeTicketResolutionMs(params.row);
      return <span>{ms !== null ? msToHoursMinutes(ms) : ''}</span>;
    } },
    { field: 'tipo', headerName: 'Categoría', width: 120 },
    { field: 'estado', headerName: 'Estado', width: 120, renderCell: (params) => (
      <Chip label={params.value} size="small" color={params.value === 'Abierto' ? 'warning' : params.value === 'En Proceso' ? 'info' : 'success'} />
    ) },
    { field: 'slaRestante', headerName: 'SLA Restante', width: 140, renderCell: (params) => {
      const slaInfo = calculateSlaRemaining(params.row);
      if (!slaInfo) return <span>-</span>;
      
      const { remainingHours, isExpired } = slaInfo;
      
      if (isExpired) {
        const overdue = Math.abs(remainingHours);
        const days = Math.floor(overdue / 24);
        const hours = Math.floor(overdue % 24);
        return (
          <Chip 
            label={`Vencido: ${days > 0 ? `${days}d ` : ''}${hours}h`} 
            color="error" 
            size="small" 
            variant="filled"
          />
        );
      } else {
        const days = Math.floor(remainingHours / 24);
        const hours = Math.floor(remainingHours % 24);
        const isUrgent = remainingHours <= 12;
        return (
          <Chip 
            label={`${days > 0 ? `${days}d ` : ''}${hours}h`} 
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
  ];

  // Exportar a Excel
  const handleExportExcel = () => {
    try {
      const data = ticketsFiltrados.map(t => {
        const slaInfo = calculateSlaRemaining(t);
        let slaText = '-';
        if (slaInfo) {
          const { remainingHours, isExpired } = slaInfo;
          if (isExpired) {
            const overdue = Math.abs(remainingHours);
            const days = Math.floor(overdue / 24);
            const hours = Math.floor(overdue % 24);
            slaText = `Vencido: ${days > 0 ? `${days}d ` : ''}${hours}h`;
          } else {
            const days = Math.floor(remainingHours / 24);
            const hours = Math.floor(remainingHours % 24);
            slaText = `${days > 0 ? `${days}d ` : ''}${hours}h`;
          }
        }
        
        return {
          descripcion: t.descripcion || '',
          departamento: resolveDepartmentName(t.departamento),
          tipo: t.tipo || '',
          estado: t.estado || '',
          slaRestante: slaText,
          usuario: t.usuario || '',
          fecha: resolveDateFromRow(t),
          adjunto: (t.adjuntoUrl || t.adjunto?.url || (Array.isArray(t.adjuntos) && t.adjuntos[0]?.url) || t.adjunto) || '',
        };
      });
      const ws = XLSX.utils.json_to_sheet(data);
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
      // Carga dinámica de html2canvas (evita problemas de SSR / tree-shaking)
      const { default: dynamicHtml2canvas } = await import('html2canvas');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(16);
      doc.text('Reporte de Tickets', 40, 40);

      let chartsY = 60;
      const chartHeight = 160; // altura destino por gráfico
      const gap = 20;

      // Helper para capturar y añadir un gráfico
      const addChart = async (refEl, x) => {
        if (!refEl?.current) return false;
        try {
          const canvas = await dynamicHtml2canvas(refEl.current, {
            scale: 2, // mayor resolución
            backgroundColor: '#ffffff',
            useCORS: true,
          });
            const img = canvas.toDataURL('image/png');
            const w = (pageWidth - 80 - gap) / 2; // dejar márgenes
            doc.addImage(img, 'PNG', x, chartsY, w, chartHeight);
          return true;
        } catch (e) {
          console.warn('No se pudo capturar un gráfico:', e);
          return false;
        }
      };

      // Añadir gráficos lado a lado si ambos existen, si no ocupan toda la fila
      const pieOk = await addChart(pieRef, 40);
      const barOk = await addChart(barRef, pieOk ? (pageWidth / 2) : 40);
      if (!pieOk && !barOk) {
        doc.setFontSize(10);
        doc.text('No se pudieron capturar los gráficos (ver consola).', 40, chartsY);
      }
      chartsY += chartHeight + 30;

      // Preparar datos tabla (sin ID, coincidente con la vista)
      const bodyData = ticketsFiltrados.map(t => {
        const slaInfo = calculateSlaRemaining(t);
        let slaText = '-';
        if (slaInfo) {
          const { remainingHours, isExpired } = slaInfo;
          if (isExpired) {
            const overdue = Math.abs(remainingHours);
            const days = Math.floor(overdue / 24);
            const hours = Math.floor(overdue % 24);
            slaText = `Vencido: ${days > 0 ? `${days}d ` : ''}${hours}h`;
          } else {
            const days = Math.floor(remainingHours / 24);
            const hours = Math.floor(remainingHours % 24);
            slaText = `${days > 0 ? `${days}d ` : ''}${hours}h`;
          }
        }
        
        return [
          t.descripcion || '',
          resolveDepartmentName(t.departamento),
          t.tipo || '',
          t.estado || '',
          slaText,
          t.usuario || '',
          resolveDateFromRow(t),
        ];
      });

      if (typeof autoTable !== 'function') {
        throw new Error('AutoTable plugin no disponible');
      }
      autoTable(doc, {
        head: [['Descripción', 'Departamento', 'Tipo', 'Estado', 'SLA Restante', 'Usuario', 'Fecha']],
        body: bodyData,
        startY: chartsY,
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
              rows={ticketsFiltrados}
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
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tickets por Tipo</Typography>
          <ReportesBarChart data={ticketsPorTipo} title="Tickets por Tipo" xKey="name" yKey="value" />
        </Paper>
        <Paper elevation={2} sx={{ p: 2, borderRadius: 3, flex: 1 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Top Usuarios (tickets totales)</Typography>
          <ReportesHorizontalBarChart data={topUsuarios} title="Top Usuarios (tickets totales)" xKey="name" yKey="value" />
        </Paper>
      </Box>

      <Box sx={{ mt: 3 }}>
        <Paper elevation={2} sx={{ p: 2, borderRadius: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tiempo promedio de cierre de Tickets por Departamento (horas)</Typography>
          <ReportesBarChart data={avgByDept} title="Tiempo promedio (horas)" xKey="name" yKey="value" />
        </Paper>
        <Paper elevation={2} sx={{ p: 2, borderRadius: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Tickets mensuales (acumulado)</Typography>
          <ReportesAreaChart data={acumuladoMensual} title="Tickets mensuales (acumulado)" xKey="month" areas={[{ dataKey: 'total', color: '#1976d2' }]} />
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
