import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Grid,
  Paper,
  Chip,
  Divider,
  useTheme,
} from "@mui/material";
import { BarChart, PieChart, LineChart } from "@mui/x-charts";
import { ref, get } from "firebase/database";
import { useDb } from '../context/DbContext';
import { useAuth } from '../context/useAuth';

export default function Dashboard() {
  const theme = useTheme();
  useEffect(() => {
    try {
      const navEntries = (performance && performance.getEntriesByType) ? performance.getEntriesByType('navigation') : null;
      const navType = navEntries && navEntries[0] ? navEntries[0].type : (performance && performance.navigation ? performance.navigation.type : 'unknown');
      console.debug('Dashboard mount: navigation type ->', navType);
    } catch (e) {
      console.debug('Dashboard mount: could not read navigation type', e?.message || e);
    }
  }, []);
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
        if (!db) {
          // si el contexto aún no inicializó la DB, esperar un poco y reintentar
          await new Promise(res => setTimeout(res, 250));
        }
        const dbFinal = db || ctxDb;
        if (!dbFinal) throw new Error('DB no inicializada');
        // Departamentos
        const depSnap = await get(ref(dbFinal, "departamentos"));
        let deps = [];
        if (depSnap.exists()) {
          deps = Object.entries(depSnap.val()).map(([id, nombre]) => ({
            id,
            nombre,
          }));
          setDepartamentos(deps);
        } else {
          setDepartamentos([]);
        }
        // Tickets
        const ticketsSnap = await get(ref(dbFinal, "tickets"));
        if (ticketsSnap.exists()) {
          setTickets(
            Object.entries(ticketsSnap.val()).map(([id, t]) => ({ id, ...t }))
          );
        } else {
          setTickets([]);
        }
      } catch {
        setError("Error al cargar los datos. Intenta de nuevo más tarde.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [ctxDb, recinto]);

  // Determinar si es admin
  const isAdmin = (userData?.isSuperAdmin || userData?.rol === 'admin');
  // El valor guardado en userData suele ser el NOMBRE del departamento, no el id
  const userDeptName = userData?.departamento && String(userData.departamento).trim();
  const userDeptIdFromName = userDeptName ? (departamentos.find(d => d.nombre === userDeptName)?.id) : undefined;
  // Conjunto de candidatos (nombre e id) para comparar contra el campo departamento de los tickets
  const userDeptCandidates = new Set([userDeptName, userDeptIdFromName].filter(Boolean));
  // Para retrocompatibilidad si en algún momento userData.departamento era el id
  const userDeptId = userDeptIdFromName || userDeptName; // conservamos variable usada después (aunque sea nombre)
  // Helper para normalizar y comparar departamento del ticket con el del usuario
  const matchesUserDepartment = (ticketDept) => {
    if (!userDeptCandidates.size) return false;
    if (!ticketDept) return false;
    // Coincidencia directa (nombre o id)
    if (userDeptCandidates.has(ticketDept)) return true;
    // String con path '/departamentos/XYZ'
    if (typeof ticketDept === 'string') {
      if (ticketDept.includes('/')) {
        const last = ticketDept.split('/').filter(Boolean).pop();
        if (last && userDeptCandidates.has(last)) return true;
      }
      // Si es un nombre que apunta a un id de nuestros candidatos (por si ticket guarda nombre y userData tiene id)
      const depByName = departamentos.find(d => d.nombre === ticketDept);
      if (depByName && userDeptCandidates.has(depByName.id)) return true;
    }
    // Objeto { id, nombre }
    if (typeof ticketDept === 'object') {
      const candId = ticketDept.id || ticketDept.key || ticketDept.value;
      if (candId && userDeptCandidates.has(candId)) return true;
      const candName = ticketDept.nombre || ticketDept.name || ticketDept.label;
      if (candName && userDeptCandidates.has(candName)) return true;
      // Nombre que mapea a id
      if (candName) {
        const depByName = departamentos.find(d => d.nombre === candName);
        if (depByName && userDeptCandidates.has(depByName.id)) return true;
      }
    }
    return false;
  };

  // Tickets visibles según rol (admin ve todo, usuario solo los de su departamento)
  const viewTickets = isAdmin ? tickets : tickets.filter(t => matchesUserDepartment(t.departamento));
  // Si no admin y aún no conocemos su departamento, no mostrar datos (vista vacía segura)
  const effectiveTickets = (!isAdmin && !userDeptId) ? [] : viewTickets;

  // Estadísticas basadas en tickets visibles
  const total = effectiveTickets.length;
  const estados = ["Abierto", "En Proceso", "Cerrado"];
  const ticketsPorEstado = estados.map((e) => ({
    estado: e,
    count: effectiveTickets.filter((t) => t.estado === e).length,
  }));
  const ticketsPorDepartamento = departamentos
    .map((dep) => ({
      departamento: dep.nombre,
      count: effectiveTickets.filter((t) => {
        if (isAdmin) {
          if (t.departamento === dep.id || t.departamento === dep.nombre) return true;
          if (typeof t.departamento === 'string' && t.departamento.includes('/')) {
            const last = t.departamento.split('/').filter(Boolean).pop();
            if (last === dep.id) return true;
          }
          if (typeof t.departamento === 'object' && (t.departamento.id === dep.id || t.departamento.nombre === dep.nombre)) return true;
          return false;
        }
        // Usuario normal: contamos solo su propio departamento (ya filtrado effectiveTickets pero mantenemos robustez)
        return matchesUserDepartment(t.departamento);
      }).length,
    }))
    .filter((d) => d.count > 0)
    .filter(d => isAdmin || userDeptCandidates.has(d.departamento) || userDeptCandidates.has(departamentos.find(x => x.nombre === d.departamento)?.id));

  // Gráfico de barras apiladas: tickets por estado y departamento
  const departamentosConTickets = departamentos.filter((dep) =>
    effectiveTickets.some((t) => {
      if (isAdmin) {
        if (t.departamento === dep.id || t.departamento === dep.nombre) return true;
        if (typeof t.departamento === 'string' && t.departamento.includes('/')) {
          const last = t.departamento.split('/').filter(Boolean).pop();
          if (last === dep.id) return true;
        }
        if (typeof t.departamento === 'object' && (t.departamento.id === dep.id || t.departamento.nombre === dep.nombre)) return true;
        return false;
      }
      return matchesUserDepartment(t.departamento);
    })
  ).filter(dep => isAdmin || userDeptCandidates.has(dep.id) || userDeptCandidates.has(dep.nombre));
  const dataBarrasApiladas = departamentosConTickets.map((dep) => {
    const depTickets = effectiveTickets.filter(
      (t) => t.departamento === dep.id || t.departamento === dep.nombre
    );
    return {
      departamento: dep.nombre,
      Abierto: depTickets.filter((t) => t.estado === "Abierto").length,
      "En Proceso": depTickets.filter((t) => t.estado === "En Proceso").length,
      Cerrado: depTickets.filter((t) => t.estado === "Cerrado").length,
    };
  });

  // Gráfico de línea: tendencia mensual (siempre muestra datos aunque no haya campo fecha)
  let dataLinea = [];
  if (effectiveTickets.length > 0) {
    const meses = {};
    effectiveTickets.forEach((t) => {
      let d = null;
      if (t.fecha) {
        d = new Date(t.fecha);
      } else if (!isNaN(Number(t.id)) && Number(t.id) > 1000000000000) {
        d = new Date(Number(t.id));
      } else if (t.createdAt) {
        d = new Date(t.createdAt);
      }
      if (d && !isNaN(d.getTime())) {
        const key = `${d.getFullYear()}-${(d.getMonth() + 1)
          .toString()
          .padStart(2, "0")}`;
        meses[key] = (meses[key] || 0) + 1;
      } else {
        meses["Sin fecha"] = (meses["Sin fecha"] || 0) + 1;
      }
    });
    dataLinea = Object.entries(meses)
      .sort()
      .map(([mes, count]) => ({ mes, count }));
  }

  if (loading) {
    return (
      <Box
        sx={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          zIndex: 2000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: (theme) => theme.palette.background.default,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 4,
            borderRadius: 4,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            bgcolor: 'background.paper',
            color: 'text.primary'
          }}
        >
          <Typography variant="h6" sx={{ mb: 2 }}>
            Cargando información...
          </Typography>
          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <span
              className="MuiCircularProgress-root MuiCircularProgress-indeterminate"
              style={{
                width: 60,
                height: 60,
                color: theme.palette.primary.main,
                display: "inline-block",
                borderWidth: 6,
              }}
            >
              <svg viewBox="22 22 44 44" style={{ width: "100%", height: "100%" }}>
                <circle
                  cx="44"
                  cy="44"
                  r="20.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.6"
                  strokeDasharray="80,200"
                  strokeDashoffset="0"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </Box>
        </Paper>
      </Box>
    );
  }
  if (error) {
    return (
      <Box
        sx={{
          minHeight: "90vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: (theme) => theme.palette.background.default,
        }}
      >
        <Paper
          elevation={2}
          sx={{
            p: 4,
            borderRadius: 4,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
          }}
        >
          <Typography variant="h6" color="error" sx={{ mb: 2 }}>
            {error}
          </Typography>
        </Paper>
      </Box>
    );
  }

  // ...dashboard completo aquí...
  return (
    <Box
      sx={{
        p: { xs: 1, sm: 3 },
        width: "100%",
        maxWidth: "100vw",
        minHeight: "90vh",
        boxSizing: "border-box",
        background: (theme) => theme.palette.background.default,
      }}
    >
      <Typography
        variant="h5"
        sx={{ mb: 3, fontWeight: 700, letterSpacing: 1 }}
      >
        Dashboard
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: 3,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(12, 1fr)' },
        }}
      >
        {/* KPI / Tarjeta total */}
  <Box sx={{ gridColumn: { xs: '1 / -1', sm: '1 / -1', md: 'span 5' } }}>
          <Paper
            elevation={6}
            sx={{
              p: 3,
              borderRadius: 4,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              minHeight: { xs: 220, md: 300 },
            }}
          >
            <Box>
              <Typography
                variant="subtitle1"
                sx={{ opacity: 0.9, fontWeight: 700 }}
              >
                Total de Tickets
              </Typography>
              <Typography
                variant="h2"
                sx={{ fontWeight: 900, letterSpacing: 1, my: 1 }}
              >
                {total}
              </Typography>
              <Divider sx={{ my: 1.5, bgcolor: 'divider' }} />
            </Box>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {ticketsPorEstado.map((e) => (
                <Chip
                  key={e.estado}
                  label={`${e.estado}: ${e.count}`}
                  size="small"
                  color={
                    e.estado === "Abierto"
                      ? "warning"
                      : e.estado === "En Proceso"
                      ? "info"
                      : "success"
                  }
                  sx={{ color: "#fff", fontWeight: 600 }}
                />
              ))}
            </Box>
          </Paper>
  </Box>
  {/* Pie estados */}
  <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'span 1', md: 'span 3' } }}>
          <Paper
            elevation={6}
            sx={{
              p: 3,
              borderRadius: 4,
              display: "flex",
              flexDirection: "column",
              minHeight: 240,
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              Distribución por Estado
            </Typography>
            <Box
              sx={{
                flex: 1,
                position: "relative",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <PieChart
                series={[
                  {
                    data: ticketsPorEstado
                      .filter((e) => !isNaN(e.count))
                      .map((e) => ({
                        id: e.estado,
                        value: e.count,
                        label: e.estado,
                      })),
                    innerRadius: 40,
                    outerRadius: 80,
                    paddingAngle: 4,
                    cornerRadius: 6,
                  },
                ]}
                width={220}
                height={180}
                slotProps={{ legend: { hidden: true } }}
                colors={[
                  theme.palette.warning.main,
                  theme.palette.info.main,
                  theme.palette.success.main,
                ]}
              />
            </Box>
          </Paper>
  </Box>
  {/* Bar departamentos */}
  <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'span 1', md: 'span 4' } }}>
          <Paper
            elevation={6}
            sx={{
              p: 3,
              borderRadius: 4,
              display: "flex",
              flexDirection: "column",
              minHeight: 240,
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              Tickets por Departamento
            </Typography>
            <Box
              sx={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {ticketsPorDepartamento.length > 0 ? (
                <BarChart
                  xAxis={[
                    {
                      scaleType: "band",
                      data: ticketsPorDepartamento.map((d) => d.departamento),
                    },
                  ]}
                  series={[
                    {
                      data: ticketsPorDepartamento.map((d) =>
                        isNaN(d.count) ? 0 : d.count
                      ),
                      label: "Tickets",
                    },
                  ]}
                  width={240}
                  height={180}
                  colors={[theme.palette.primary.main]}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Sin datos
                </Typography>
              )}
            </Box>
          </Paper>
  </Box>
        {/* Resumen rápido eliminado: la información está cubierta por 'Detalle por Estado' */}
  {/* Tickets recientes */}
  <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' } }}>
          <Paper elevation={3} sx={{ p: 3, borderRadius: 4, height: "100%" }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
              Tickets recientes
            </Typography>
            {effectiveTickets
              .slice(-5)
              .reverse()
              .map((t) => (
                <Box
                  key={t.id}
                  sx={{
                    mb: 2,
                    p: 2,
                    borderRadius: 2,
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[100],
                    color: 'text.primary',
                    boxShadow: 1,
                  }}
                >
                  <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary' }}>
                    {t.descripcion}
                  </Typography>
                  <Box
                    sx={{
                      display: "flex",
                      gap: 1,
                      alignItems: "center",
                      mt: 0.5,
                    }}
                  >
                    <Chip
                      label={t.estado}
                      color={
                        t.estado === "Abierto"
                          ? "warning"
                          : t.estado === "En Proceso"
                          ? "info"
                          : "success"
                      }
                      size="small"
                    />
                    <Typography variant="caption" color="text.secondary">
                      {t.usuario}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {departamentos.find((d) => d.id === t.departamento)
                        ?.nombre || t.departamento}
                    </Typography>
                  </Box>
                </Box>
              ))}
            {effectiveTickets.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No hay tickets registrados
              </Typography>
            )}
          </Paper>
  </Box>
  {/* Barras apiladas */}
  <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' } }}>
          <Paper elevation={3} sx={{ p: 3, borderRadius: 4, height: "100%" }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
              Estados por Departamento
            </Typography>
            {dataBarrasApiladas.length > 0 ? (
              <BarChart
                xAxis={[
                  {
                    scaleType: "band",
                    data: dataBarrasApiladas.map((d) => d.departamento),
                    label: "Departamento",
                  },
                ]}
                series={[
                  {
                    data: dataBarrasApiladas.map((d) =>
                      Number.isFinite(Number(d.Abierto)) ? Number(d.Abierto) : 0
                    ),
                    label: "Abierto",
                    color: theme.palette.warning.main,
                    stack: "total",
                  },
                  {
                    data: dataBarrasApiladas.map((d) =>
                      Number.isFinite(Number(d["En Proceso"]))
                        ? Number(d["En Proceso"])
                        : 0
                    ),
                    label: "En Proceso",
                    color: theme.palette.info.main,
                    stack: "total",
                  },
                  {
                    data: dataBarrasApiladas.map((d) =>
                      Number.isFinite(Number(d.Cerrado)) ? Number(d.Cerrado) : 0
                    ),
                    label: "Cerrado",
                    color: theme.palette.success.main,
                    stack: "total",
                  },
                ]}
                width={360}
                height={220}
                legend={{ position: "top" }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                Sin datos
              </Typography>
            )}
          </Paper>
  </Box>
  {/* Detalle por estado */}
  <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' } }}>
          <Paper elevation={3} sx={{ p: 3, borderRadius: 4, height: "100%" }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
              Detalle por Estado
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {ticketsPorEstado.map((e) => (
                <Box
                  key={e.estado}
                  sx={{ display: "flex", alignItems: "center", gap: 2 }}
                >
                  <Chip
                    label={e.estado}
                    color={
                      e.estado === "Abierto"
                        ? "warning"
                        : e.estado === "En Proceso"
                        ? "info"
                        : "success"
                    }
                    sx={{ minWidth: 100 }}
                  />
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    {e.count} tickets
                  </Typography>
                </Box>
              ))}
            </Box>
          </Paper>
  </Box>
  {/* Tendencia */}
  <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' } }}>
          <Paper elevation={3} sx={{ p: 3, borderRadius: 4, height: "100%" }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
              Tendencia mensual
            </Typography>
            {dataLinea.length > 0 ? (
              <LineChart
                xAxis={[{ data: dataLinea.map((d) => d.mes), label: "Mes", scaleType: 'band' }]}
                series={[
                  {
                    data: dataLinea.map((d) => (isNaN(d.count) ? 0 : d.count)),
                    label: "Tickets",
                    color: theme.palette.primary.main,
                  },
                ]}
                width={260}
                height={220}
                legend={{ position: "top" }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                No hay datos de tendencia
              </Typography>
            )}
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}
