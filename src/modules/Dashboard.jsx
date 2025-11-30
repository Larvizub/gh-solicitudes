import React, { useEffect, useState, useMemo } from "react";
import {
  Box,
  Typography,
  Paper,
  Chip,
  useTheme,
  Avatar,
  LinearProgress,
  Fade,
  Grow,
  alpha,
} from "@mui/material";
import {
  AccessTime as AccessTimeIcon,
  Warning as WarningIcon,
  PersonOff as PersonOffIcon,
  Refresh as RefreshIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  EmojiEvents as TrophyIcon,
  Schedule as ScheduleIcon,
  Assignment as AssignmentIcon,
  CheckCircle as CheckCircleIcon,
  HourglassEmpty as HourglassIcon,
  FolderOpen as FolderOpenIcon,
  Inbox as InboxIcon,
} from "@mui/icons-material";
import { BarChart, PieChart, LineChart } from "@mui/x-charts";
import { ref, get } from "firebase/database";
import { useDb } from '../context/DbContext';
import { useAuth } from '../context/useAuth';
import { canViewAllTickets, isAdminRole } from '../utils/roles';

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES AUXILIARES REUTILIZABLES
// ═══════════════════════════════════════════════════════════════════════════════

// Tarjeta KPI con gradiente e icono
function KpiCard({ title, value, subtitle, icon: Icon, gradient, trend, trendLabel, delay = 0 }) {
  const theme = useTheme();
  return (
    <Grow in timeout={500 + delay}>
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          borderRadius: 3,
          background: gradient || `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
          minHeight: 140,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          transition: 'transform 0.2s, box-shadow 0.2s',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: theme.shadows[12],
          },
        }}
      >
        {/* Icono decorativo de fondo */}
        <Box
          sx={{
            position: 'absolute',
            right: -10,
            top: -10,
            opacity: 0.15,
            transform: 'rotate(-15deg)',
          }}
        >
          {Icon && <Icon sx={{ fontSize: 120 }} />}
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', zIndex: 1 }}>
          <Box>
            <Typography variant="body2" sx={{ opacity: 0.9, fontWeight: 500, mb: 0.5 }}>
              {title}
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
              {value}
            </Typography>
          </Box>
          {Icon && (
            <Avatar sx={{ bgcolor: alpha('#fff', 0.2), width: 44, height: 44 }}>
              <Icon sx={{ color: '#fff' }} />
            </Avatar>
          )}
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, zIndex: 1 }}>
          {trend !== undefined && (
            <Chip
              size="small"
              icon={trend >= 0 ? <TrendingUpIcon sx={{ fontSize: 16 }} /> : <TrendingDownIcon sx={{ fontSize: 16 }} />}
              label={`${trend >= 0 ? '+' : ''}${trend}%`}
              sx={{
                bgcolor: alpha('#fff', 0.25),
                color: '#fff',
                fontWeight: 600,
                '& .MuiChip-icon': { color: '#fff' },
              }}
            />
          )}
          {(subtitle || trendLabel) && (
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              {subtitle || trendLabel}
            </Typography>
          )}
        </Box>
      </Paper>
    </Grow>
  );
}

// Tarjeta de sección estándar
function SectionCard({ title, children, icon: Icon, action, delay = 0, sx = {} }) {
  const theme = useTheme();
  return (
    <Fade in timeout={400 + delay}>
      <Paper
        elevation={0}
        sx={{
          p: 3,
          borderRadius: 3,
          bgcolor: theme.palette.background.paper,
          border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          transition: 'box-shadow 0.2s',
          '&:hover': {
            boxShadow: theme.shadows[4],
          },
          ...sx,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {Icon && <Icon sx={{ color: theme.palette.primary.main, fontSize: 20 }} />}
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
          </Box>
          {action}
        </Box>
        <Box sx={{ flex: 1 }}>{children}</Box>
      </Paper>
    </Fade>
  );
}

// Item de ticket reciente
function RecentTicketItem({ ticket, departamentos }) {
  const theme = useTheme();
  const depName = departamentos.find(d => d.id === ticket.departamento)?.nombre || ticket.departamento;
  const estadoColor = ticket.estado === 'Abierto' ? 'warning' : ticket.estado === 'En Proceso' ? 'info' : 'success';
  
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: alpha(theme.palette.primary.main, 0.04),
        border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
        transition: 'all 0.2s',
        cursor: 'pointer',
        '&:hover': {
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          transform: 'translateX(4px)',
        },
      }}
    >
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          mb: 1,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {ticket.descripcion || 'Sin descripción'}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip label={ticket.estado} color={estadoColor} size="small" sx={{ fontWeight: 600, height: 22 }} />
        <Typography variant="caption" color="text.secondary">
          {ticket.usuario}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.6 }}>•</Typography>
        <Typography variant="caption" color="text.secondary">
          {depName}
        </Typography>
      </Box>
    </Box>
  );
}

// Item de ranking de usuario
function RankingItem({ rank, name, count, total }) {
  const theme = useTheme();
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
  const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
  
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>
      <Avatar
        sx={{
          width: 36,
          height: 36,
          bgcolor: rank <= 3 ? medalColors[rank - 1] : theme.palette.grey[400],
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        {rank <= 3 ? <TrophyIcon sx={{ fontSize: 18 }} /> : rank}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }} noWrap>
          {name}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={percentage}
          sx={{
            height: 6,
            borderRadius: 3,
            bgcolor: alpha(theme.palette.primary.main, 0.1),
            '& .MuiLinearProgress-bar': {
              borderRadius: 3,
              bgcolor: rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : theme.palette.primary.main,
            },
          }}
        />
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 50, textAlign: 'right' }}>
        {count}
      </Typography>
    </Box>
  );
}

// Alerta de ticket urgente
function UrgentTicketAlert({ ticket, slaRemaining }) {
  const theme = useTheme();
  const isOverdue = slaRemaining < 0;
  
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: isOverdue ? alpha(theme.palette.error.main, 0.1) : alpha(theme.palette.warning.main, 0.1),
        borderLeft: `4px solid ${isOverdue ? theme.palette.error.main : theme.palette.warning.main}`,
        mb: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningIcon sx={{ fontSize: 18, color: isOverdue ? 'error.main' : 'warning.main' }} />
        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }} noWrap>
          {ticket.codigo || ticket.id}
        </Typography>
        <Chip
          size="small"
          label={isOverdue ? 'Vencido' : `${Math.round(slaRemaining)}h restantes`}
          color={isOverdue ? 'error' : 'warning'}
          sx={{ height: 20, fontSize: 11 }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }} noWrap>
        {ticket.descripcion}
      </Typography>
    </Box>
  );
}

// Estado vacío con icono
function EmptyState({ icon: Icon, message }) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 4,
        opacity: 0.6,
      }}
    >
      {Icon && <Icon sx={{ fontSize: 48, color: theme.palette.text.disabled, mb: 1 }} />}
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function Dashboard() {
  const theme = useTheme();
  const chartColor = theme.palette.mode === 'dark' ? '#F2B05F' : theme.palette.primary.main;
  
  const [tickets, setTickets] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { db: ctxDb, recinto } = useDb();
  const { userData } = useAuth();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError("");
      try {
        const db = ctxDb;
        if (!db) await new Promise(res => setTimeout(res, 250));
        const dbFinal = db || ctxDb;
        if (!dbFinal) throw new Error('DB no inicializada');
        
        // Cargar datos en paralelo
        const [depSnap, ticketsSnap] = await Promise.all([
          get(ref(dbFinal, "departamentos")),
          get(ref(dbFinal, "tickets")),
        ]);
        
        if (depSnap.exists()) {
          setDepartamentos(Object.entries(depSnap.val()).map(([id, nombre]) => ({ id, nombre })));
        }
        if (ticketsSnap.exists()) {
          setTickets(Object.entries(ticketsSnap.val()).map(([id, t]) => ({ id, ...t })));
        }
      } catch {
        setError("Error al cargar los datos. Intenta de nuevo más tarde.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [ctxDb, recinto]);

  // ═══════════════════════════════════════════════════════════════════════════
  // LÓGICA DE PERMISOS Y FILTRADO
  // ═══════════════════════════════════════════════════════════════════════════
  
  const isAdmin = isAdminRole(userData);
  const canSeeAll = canViewAllTickets(userData);
  const userDeptName = userData?.departamento && String(userData.departamento).trim();
  const userDeptIdFromName = userDeptName ? departamentos.find(d => d.nombre === userDeptName)?.id : undefined;
  const userDeptCandidates = new Set([userDeptName, userDeptIdFromName].filter(Boolean));
  const userDeptId = userDeptIdFromName || userDeptName;

  const matchesUserDepartment = (ticketDept) => {
    if (!userDeptCandidates.size || !ticketDept) return false;
    if (userDeptCandidates.has(ticketDept)) return true;
    if (typeof ticketDept === 'string' && ticketDept.includes('/')) {
      const last = ticketDept.split('/').filter(Boolean).pop();
      if (last && userDeptCandidates.has(last)) return true;
    }
    return false;
  };

  const viewTickets = canSeeAll ? tickets : tickets.filter(t => matchesUserDepartment(t.departamento));
  const effectiveTickets = useMemo(() => ((!isAdmin && !userDeptId) ? [] : viewTickets), [isAdmin, userDeptId, viewTickets]);

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS DE TIEMPO
  // ═══════════════════════════════════════════════════════════════════════════
  
  const getTicketCreatedTs = (t) => {
    if (!t) return 0;
    if (t.createdAt) {
      const v = t.createdAt;
      if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
      const n = parseInt(v, 10);
      if (!isNaN(n)) return n < 1e12 ? n * 1000 : n;
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    if (t.fecha) {
      const d = new Date(t.fecha);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    if (t.timestamp) {
      const v = t.timestamp;
      if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    }
    if (t.id && !isNaN(Number(t.id)) && Number(t.id) > 1e12) return Number(t.id);
    return 0;
  };

  const getTicketClosedTs = (t) => {
    if (!t) return null;
    if (t.resueltoEn) {
      const d = new Date(t.resueltoEn);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    if (t.closedAt) {
      const v = t.closedAt;
      if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    return null;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CÁLCULOS DE MÉTRICAS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Estadísticas básicas
  const total = effectiveTickets.length;
  const estados = ["Abierto", "En Proceso", "Cerrado"];
  const ticketsPorEstado = estados.map(e => ({
    estado: e,
    count: effectiveTickets.filter(t => t.estado === e).length,
  }));

  const abiertos = ticketsPorEstado.find(e => e.estado === 'Abierto')?.count || 0;
  const enProceso = ticketsPorEstado.find(e => e.estado === 'En Proceso')?.count || 0;
  const cerrados = ticketsPorEstado.find(e => e.estado === 'Cerrado')?.count || 0;

  // Tickets sin asignar
  const sinAsignar = useMemo(() => {
    return effectiveTickets.filter(t => {
      if (t.estado === 'Cerrado') return false;
      const hasAsignados = t.asignados && Array.isArray(t.asignados) && t.asignados.length > 0;
      const hasAsignadoA = t.asignadoA;
      return !hasAsignados && !hasAsignadoA;
    }).length;
  }, [effectiveTickets]);

  // Tiempo promedio de resolución (en horas)
  const tiempoPromedioResolucion = useMemo(() => {
    const cerradosConTiempo = effectiveTickets.filter(t => {
      if (t.estado !== 'Cerrado') return false;
      const created = getTicketCreatedTs(t);
      const closed = getTicketClosedTs(t);
      return created && closed && closed > created;
    });
    
    if (cerradosConTiempo.length === 0) return null;
    
    const totalMs = cerradosConTiempo.reduce((acc, t) => {
      const created = getTicketCreatedTs(t);
      const closed = getTicketClosedTs(t);
      return acc + (closed - created);
    }, 0);
    
    const avgMs = totalMs / cerradosConTiempo.length;
    const avgHours = avgMs / (1000 * 60 * 60);
    return Math.round(avgHours * 10) / 10;
  }, [effectiveTickets]);

  // Tickets vencidos (SLA excedido)
  const ticketsVencidos = useMemo(() => {
    const now = Date.now();
    return effectiveTickets.filter(t => {
      if (t.estado === 'Cerrado') return false;
      try {
        const slaHours = t.slaHours || 24; // default 24h si no hay SLA configurado
        const created = getTicketCreatedTs(t);
        if (!created) return false;
        const deadline = created + (slaHours * 60 * 60 * 1000);
        return now > deadline;
      } catch {
        return false;
      }
    });
  }, [effectiveTickets]);

  // Tickets próximos a vencer (menos de 4 horas)
  const ticketsProximosVencer = useMemo(() => {
    const now = Date.now();
    const fourHoursMs = 4 * 60 * 60 * 1000;
    return effectiveTickets
      .filter(t => {
        if (t.estado === 'Cerrado') return false;
        try {
          const slaHours = t.slaHours || 24;
          const created = getTicketCreatedTs(t);
          if (!created) return false;
          const deadline = created + (slaHours * 60 * 60 * 1000);
          const remaining = deadline - now;
          return remaining > 0 && remaining <= fourHoursMs;
        } catch {
          return false;
        }
      })
      .map(t => {
        const slaHours = t.slaHours || 24;
        const created = getTicketCreatedTs(t);
        const deadline = created + (slaHours * 60 * 60 * 1000);
        const remainingHours = (deadline - Date.now()) / (1000 * 60 * 60);
        return { ...t, slaRemaining: remainingHours };
      })
      .sort((a, b) => a.slaRemaining - b.slaRemaining)
      .slice(0, 5);
  }, [effectiveTickets]);

  // Tasa de reapertura
  const tasaReapertura = useMemo(() => {
    const conReapertura = effectiveTickets.filter(t => {
      if (t.reassignments) {
        const entries = Object.values(t.reassignments);
        return entries.some(r => r.oldSubcat && r.newSubcat && r.oldSubcat !== r.newSubcat);
      }
      return false;
    }).length;
    
    return cerrados > 0 ? Math.round((conReapertura / cerrados) * 100) : 0;
  }, [effectiveTickets, cerrados]);

  // Top 5 usuarios que más resuelven
  const topResolvers = useMemo(() => {
    const resolverCount = {};
    effectiveTickets.forEach(t => {
      if (t.estado === 'Cerrado' && t.resueltoPorEmail) {
        const email = String(t.resueltoPorEmail).toLowerCase();
        const nombre = t.resueltoPorNombre || email;
        if (!resolverCount[email]) {
          resolverCount[email] = { email, nombre, count: 0 };
        }
        resolverCount[email].count++;
      }
    });
    
    return Object.values(resolverCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [effectiveTickets]);

  // Comparativo vs mes anterior
  const comparativoMes = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

    let thisMonthCount = 0;
    let lastMonthCount = 0;

    effectiveTickets.forEach(t => {
      const ts = getTicketCreatedTs(t);
      if (!ts) return;
      const d = new Date(ts);
      const m = d.getMonth();
      const y = d.getFullYear();
      if (m === thisMonth && y === thisYear) thisMonthCount++;
      if (m === lastMonth && y === lastMonthYear) lastMonthCount++;
    });

    const diff = lastMonthCount > 0 
      ? Math.round(((thisMonthCount - lastMonthCount) / lastMonthCount) * 100)
      : (thisMonthCount > 0 ? 100 : 0);

    return { thisMonth: thisMonthCount, lastMonth: lastMonthCount, diff };
  }, [effectiveTickets]);

  // Tickets recientes
  const recentTickets = useMemo(() => {
    const copy = [...effectiveTickets];
    copy.sort((a, b) => (getTicketCreatedTs(b) || 0) - (getTicketCreatedTs(a) || 0));
    return copy.slice(0, 4);
  }, [effectiveTickets]);

  // Datos para gráficos
  const ticketsPorDepartamento = useMemo(() => {
    return departamentos
      .map(dep => ({
        departamento: dep.nombre,
        count: effectiveTickets.filter(t => t.departamento === dep.id || t.departamento === dep.nombre).length,
      }))
      .filter(d => d.count > 0);
  }, [departamentos, effectiveTickets]);

  const dataBarrasApiladas = useMemo(() => {
    return departamentos
      .filter(dep => effectiveTickets.some(t => t.departamento === dep.id || t.departamento === dep.nombre))
      .map(dep => {
        const depTickets = effectiveTickets.filter(t => t.departamento === dep.id || t.departamento === dep.nombre);
        return {
          departamento: dep.nombre,
          Abierto: depTickets.filter(t => t.estado === "Abierto").length,
          "En Proceso": depTickets.filter(t => t.estado === "En Proceso").length,
          Cerrado: depTickets.filter(t => t.estado === "Cerrado").length,
        };
      });
  }, [departamentos, effectiveTickets]);

  const dataLinea = useMemo(() => {
    if (effectiveTickets.length === 0) return [];
    const meses = {};
    effectiveTickets.forEach(t => {
      const ts = getTicketCreatedTs(t);
      if (ts) {
        const d = new Date(ts);
        const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
        meses[key] = (meses[key] || 0) + 1;
      }
    });
    return Object.entries(meses).sort().map(([mes, count]) => ({ mes, count }));
  }, [effectiveTickets]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: theme.palette.background.default,
        }}
      >
        <Fade in>
          <Paper elevation={0} sx={{ p: 4, borderRadius: 4, textAlign: 'center' }}>
            <Box sx={{ width: 60, height: 60, mx: 'auto', mb: 2 }}>
              <svg viewBox="22 22 44 44" style={{ width: '100%', height: '100%', animation: 'spin 1s linear infinite' }}>
                <circle cx="44" cy="44" r="20" fill="none" stroke={theme.palette.primary.main} strokeWidth="4" strokeDasharray="80 200" strokeLinecap="round" />
              </svg>
            </Box>
            <Typography variant="h6">Cargando dashboard...</Typography>
            <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
          </Paper>
        </Fade>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ minHeight: '90vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Paper elevation={2} sx={{ p: 4, borderRadius: 4, textAlign: 'center' }}>
          <WarningIcon sx={{ fontSize: 48, color: 'error.main', mb: 2 }} />
          <Typography variant="h6" color="error">{error}</Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: { xs: 2, sm: 3 },
        minHeight: '100vh',
        background: theme.palette.background.default,
      }}
    >
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 800, mb: 0.5 }}>
          Dashboard
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Resumen de actividad y métricas clave
        </Typography>
      </Box>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* FILA 1: KPIs PRINCIPALES */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
        }}
      >
        <KpiCard
          title="Total de Tickets"
          value={total}
          icon={AssignmentIcon}
          gradient={`linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`}
          trend={comparativoMes.diff}
          trendLabel="vs mes anterior"
          delay={0}
        />
        <KpiCard
          title="Abiertos"
          value={abiertos}
          subtitle={`${enProceso} en proceso`}
          icon={FolderOpenIcon}
          gradient={`linear-gradient(135deg, ${theme.palette.warning.main} 0%, ${theme.palette.warning.dark} 100%)`}
          delay={100}
        />
        <KpiCard
          title="Resueltos"
          value={cerrados}
          subtitle={tiempoPromedioResolucion ? `~${tiempoPromedioResolucion}h promedio` : 'Sin datos'}
          icon={CheckCircleIcon}
          gradient={`linear-gradient(135deg, ${theme.palette.success.main} 0%, ${theme.palette.success.dark} 100%)`}
          delay={200}
        />
        <KpiCard
          title="Sin Asignar"
          value={sinAsignar}
          subtitle={ticketsVencidos.length > 0 ? `${ticketsVencidos.length} vencidos` : 'Todo al día'}
          icon={PersonOffIcon}
          gradient={sinAsignar > 0 
            ? `linear-gradient(135deg, ${theme.palette.error.main} 0%, ${theme.palette.error.dark} 100%)`
            : `linear-gradient(135deg, ${theme.palette.grey[600]} 0%, ${theme.palette.grey[800]} 100%)`
          }
          delay={300}
        />
      </Box>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* FILA 2: MÉTRICAS SECUNDARIAS */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
        }}
      >
        <Fade in timeout={500}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            }}
          >
            <Avatar sx={{ bgcolor: alpha(theme.palette.info.main, 0.15), width: 48, height: 48 }}>
              <AccessTimeIcon sx={{ color: 'info.main' }} />
            </Avatar>
            <Box>
              <Typography variant="body2" color="text.secondary">Tiempo Promedio</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {tiempoPromedioResolucion ? `${tiempoPromedioResolucion}h` : 'N/A'}
              </Typography>
            </Box>
          </Paper>
        </Fade>

        <Fade in timeout={600}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            }}
          >
            <Avatar sx={{ bgcolor: alpha(theme.palette.error.main, 0.15), width: 48, height: 48 }}>
              <WarningIcon sx={{ color: 'error.main' }} />
            </Avatar>
            <Box>
              <Typography variant="body2" color="text.secondary">Tickets Vencidos</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, color: ticketsVencidos.length > 0 ? 'error.main' : 'text.primary' }}>
                {ticketsVencidos.length}
              </Typography>
            </Box>
          </Paper>
        </Fade>

        <Fade in timeout={700}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            }}
          >
            <Avatar sx={{ bgcolor: alpha(theme.palette.secondary.main, 0.15), width: 48, height: 48 }}>
              <RefreshIcon sx={{ color: 'secondary.main' }} />
            </Avatar>
            <Box>
              <Typography variant="body2" color="text.secondary">Tasa Reapertura</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {tasaReapertura}%
              </Typography>
            </Box>
          </Paper>
        </Fade>
      </Box>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* FILA 3: GRÁFICOS Y ALERTAS */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: '1fr', md: 'repeat(12, 1fr)' },
        }}
      >
        {/* Distribución por Estado (Pie) */}
        <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 4' } }}>
          <SectionCard title="Distribución por Estado" icon={HourglassIcon} delay={100}>
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
              {total > 0 ? (
                <PieChart
                  series={[{
                    data: ticketsPorEstado.filter(e => e.count > 0).map(e => ({
                      id: e.estado,
                      value: e.count,
                      label: e.estado,
                    })),
                    innerRadius: 50,
                    outerRadius: 90,
                    paddingAngle: 3,
                    cornerRadius: 6,
                  }]}
                  width={280}
                  height={200}
                  slotProps={{ legend: { hidden: true } }}
                  colors={[theme.palette.warning.main, theme.palette.info.main, theme.palette.success.main]}
                />
              ) : (
                <EmptyState icon={InboxIcon} message="Sin tickets" />
              )}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mt: 2 }}>
              {ticketsPorEstado.map(e => (
                <Chip
                  key={e.estado}
                  label={`${e.estado}: ${e.count}`}
                  size="small"
                  color={e.estado === 'Abierto' ? 'warning' : e.estado === 'En Proceso' ? 'info' : 'success'}
                  sx={{ fontWeight: 600 }}
                />
              ))}
            </Box>
          </SectionCard>
        </Box>

        {/* Tickets por Departamento */}
        <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 4' } }}>
          <SectionCard title="Por Departamento" icon={AssignmentIcon} delay={200}>
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
              {ticketsPorDepartamento.length > 0 ? (
                <BarChart
                  xAxis={[{ scaleType: 'band', data: ticketsPorDepartamento.map(d => d.departamento) }]}
                  series={[{ data: ticketsPorDepartamento.map(d => d.count), label: 'Tickets' }]}
                  width={280}
                  height={200}
                  colors={[chartColor]}
                  slotProps={{ legend: { hidden: true } }}
                />
              ) : (
                <EmptyState icon={InboxIcon} message="Sin datos" />
              )}
            </Box>
          </SectionCard>
        </Box>

        {/* Alertas Urgentes */}
        <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 4' } }}>
          <SectionCard 
            title="Atención Requerida" 
            icon={WarningIcon} 
            delay={300}
            sx={{ 
              borderColor: ticketsProximosVencer.length > 0 || ticketsVencidos.length > 0 
                ? alpha(theme.palette.warning.main, 0.3) 
                : undefined 
            }}
          >
            <Box sx={{ minHeight: 200, overflowY: 'auto' }}>
              {ticketsVencidos.slice(0, 3).map(t => (
                <UrgentTicketAlert key={t.id} ticket={t} slaRemaining={-1} />
              ))}
              {ticketsProximosVencer.map(t => (
                <UrgentTicketAlert key={t.id} ticket={t} slaRemaining={t.slaRemaining} />
              ))}
              {ticketsVencidos.length === 0 && ticketsProximosVencer.length === 0 && (
                <EmptyState icon={CheckCircleIcon} message="Todo al día 🎉" />
              )}
            </Box>
          </SectionCard>
        </Box>
      </Box>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* FILA 4: RANKING, RECIENTES Y TENDENCIA */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: '1fr', md: 'repeat(12, 1fr)' },
        }}
      >
        {/* Top Resolvers */}
        <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 4' } }}>
          <SectionCard title="Top Resolvedores" icon={TrophyIcon} delay={400}>
            <Box sx={{ minHeight: 200 }}>
              {topResolvers.length > 0 ? (
                topResolvers.map((r, idx) => (
                  <RankingItem
                    key={r.email}
                    rank={idx + 1}
                    name={r.nombre}
                    count={r.count}
                    total={cerrados}
                  />
                ))
              ) : (
                <EmptyState icon={TrophyIcon} message="Sin datos de resolución" />
              )}
            </Box>
          </SectionCard>
        </Box>

        {/* Tickets Recientes */}
        <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 4' } }}>
          <SectionCard title="Tickets Recientes" icon={ScheduleIcon} delay={500}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 200 }}>
              {recentTickets.length > 0 ? (
                recentTickets.map(t => (
                  <RecentTicketItem key={t.id} ticket={t} departamentos={departamentos} />
                ))
              ) : (
                <EmptyState icon={InboxIcon} message="Sin tickets recientes" />
              )}
            </Box>
          </SectionCard>
        </Box>

        {/* Tendencia Mensual */}
        <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 4' } }}>
          <SectionCard title="Tendencia Mensual" icon={TrendingUpIcon} delay={600}>
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
              {dataLinea.length > 0 ? (
                <LineChart
                  xAxis={[{ data: dataLinea.map(d => d.mes), scaleType: 'band' }]}
                  series={[{ data: dataLinea.map(d => d.count), label: 'Tickets', color: chartColor, area: true }]}
                  width={280}
                  height={200}
                  slotProps={{ legend: { hidden: true } }}
                />
              ) : (
                <EmptyState icon={TrendingUpIcon} message="Sin datos de tendencia" />
              )}
            </Box>
          </SectionCard>
        </Box>
      </Box>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* FILA 5: GRÁFICO GRANDE - ESTADOS POR DEPARTAMENTO */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Box sx={{ mb: 3 }}>
        <SectionCard title="Estados por Departamento" icon={AssignmentIcon} delay={700}>
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 280, width: '100%' }}>
            {dataBarrasApiladas.length > 0 ? (
              <BarChart
                xAxis={[{ scaleType: 'band', data: dataBarrasApiladas.map(d => d.departamento), label: 'Departamento' }]}
                series={[
                  { data: dataBarrasApiladas.map(d => d.Abierto), label: 'Abierto', color: theme.palette.warning.main, stack: 'total' },
                  { data: dataBarrasApiladas.map(d => d['En Proceso']), label: 'En Proceso', color: theme.palette.info.main, stack: 'total' },
                  { data: dataBarrasApiladas.map(d => d.Cerrado), label: 'Cerrado', color: theme.palette.success.main, stack: 'total' },
                ]}
                width={Math.min(800, typeof window !== 'undefined' ? window.innerWidth - 100 : 600)}
                height={280}
              />
            ) : (
              <EmptyState icon={InboxIcon} message="Sin datos" />
            )}
          </Box>
        </SectionCard>
      </Box>
    </Box>
  );
}
