import React, { useEffect, useState, useCallback } from 'react';
import { 
  Box, 
  Typography, 
  Grid, 
  Table, 
  TableHead, 
  TableRow, 
  TableCell, 
  TableBody, 
  TableContainer, 
  Button, 
  TextField, 
  MenuItem, 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  Chip,
  CircularProgress,
  alpha,
  useTheme,
  Avatar,
} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { ref, get, set } from 'firebase/database';
import { useDb } from '../context/DbContext';
import { getDbForRecinto } from '../firebase/multiDb';
import { 
  PageHeader, 
  GlassCard, 
  StatCard,
  ModuleContainer, 
  SectionContainer,
  EmptyState 
} from '../components/ui/SharedStyles';
import { dialogStyles } from '../components/ui/sharedStyles.constants';
import useNotification from '../context/useNotification';

// Módulo SLA - productivo y práctico
// - Permite definir objetivos SLA (horas) por departamento y prioridad
// - Escanea tickets para mostrar cumplimiento y lista de incumplimientos
// - Persiste configuraciones en Realtime DB en `sla/configs/{departamento}/{prioridad}`

const DEFAULT_SLA = { Alta: 24, Media: 72, Baja: 168 };
const PRIORITIES = ['Alta', 'Media', 'Baja'];

function parseTimestampCandidate(ticket) {
  // intentar varios campos para createdAt
  if (ticket.createdAt) return new Date(ticket.createdAt);
  if (ticket.fecha) return new Date(ticket.fecha);
  // si el id es numérico y parece timestamp en ms
  if (!isNaN(Number(ticket.id)) && Number(ticket.id) > 1000000000000) return new Date(Number(ticket.id));
  return null;
}

function parseClosedTimestamp(ticket) {
  // intentos razonables para closedAt
  if (ticket.closedAt) return new Date(ticket.closedAt);
  if (ticket.updatedAt && (ticket.estado === 'Cerrado' || ticket.estado === 'Resuelto' || ticket.estado === 'Finalizado')) return new Date(ticket.updatedAt);
  return null;
}

function hoursBetween(a, b) {
  if (!a || !b) return null;
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60);
}

export default function Sla() {
  const { db: ctxDb, recinto } = useDb();
  const [tickets, setTickets] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [configs, setConfigs] = useState({}); // { departamentoId: { Alta: 24, ... } }
  const [slaSubcats, setSlaSubcats] = useState({}); // { depId: { tipoId: { subId: hours } } }
  const [tipos, setTipos] = useState({});
  const [subcats, setSubcats] = useState({});
  const [loading, setLoading] = useState(true);
  const [editDialog, setEditDialog] = useState({ open: false, departamento: null, prioridad: 'Alta', value: '' });
  const [subcatDialog, setSubcatDialog] = useState({ open: false, depId: null, tipoId: null, subId: null, prioridad: 'Alta', value: '' });
  const [scanResult, setScanResult] = useState({ total: 0, within: 0, breaches: [], scanned: false });
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [selectedDept, setSelectedDept] = useState('');
  const notify = useNotification();
  const theme = useTheme();

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

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
        if (!dbInstance) return setLoading(false);
        const [depSnap, slaSnap] = await Promise.all([
          get(ref(dbInstance, 'departamentos')),
          get(ref(dbInstance, 'sla/configs')),
        ]);
        const deps = depSnap.exists() ? Object.entries(depSnap.val()).map(([id, nombre]) => ({ id, nombre })) : [];
        setDepartamentos(deps);
        // No cargar tickets inicialmente
        setTickets([]);
  setConfigs(slaSnap.exists() ? slaSnap.val() : {});
  // No cargar tipos, subcats, slaSubcats inicialmente
  setTipos({});
  setSubcats({});
  setSlaSubcats({});
      } catch (e) {
        console.error('Error cargando datos SLA', e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [ctxDb, recinto]);

  // Función para cargar datos de un departamento
  const loadDeptData = useCallback(async (depId) => {
    if (!depId || tipos[depId]) return; // ya cargado
    try {
      const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
      if (!dbInstance) return;
      const [tiposSnap, subSnap, slaSubSnap] = await Promise.all([
        get(ref(dbInstance, `tiposTickets/${depId}`)),
        get(ref(dbInstance, `subcategoriasTickets/${depId}`)),
        get(ref(dbInstance, `sla/subcategorias/${depId}`)),
      ]);
      setTipos(prev => ({ ...prev, [depId]: tiposSnap.exists() ? tiposSnap.val() : {} }));
      setSubcats(prev => ({ ...prev, [depId]: subSnap.exists() ? subSnap.val() : {} }));
      setSlaSubcats(prev => ({ ...prev, [depId]: slaSubSnap.exists() ? slaSubSnap.val() : {} }));
    } catch (e) {
      console.error('Error cargando datos del departamento', e);
    }
  }, [ctxDb, recinto, tipos]);

  // Cargar datos cuando cambie selectedDept
  useEffect(() => {
    if (selectedDept) {
      loadDeptData(selectedDept);
    }
  }, [selectedDept, loadDeptData]);

  // Función para escanear cumplimiento SLA
  const runScan = async () => {
    setScanning(true);
    try {
      let currentTickets = tickets;
      if (!ticketsLoaded) {
        // Cargar tickets solo cuando se necesiten
        const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
        if (dbInstance) {
          const ticketsSnap = await get(ref(dbInstance, 'tickets'));
          currentTickets = ticketsSnap.exists() ? Object.entries(ticketsSnap.val()).map(([id, ticket]) => ({ id, ...ticket })) : [];
          setTickets(currentTickets);
          setTicketsLoaded(true);
        }
      }

      const breaches = [];
      let within = 0;
      let total = 0;
      currentTickets.forEach(t => {
        const created = parseTimestampCandidate(t);
        if (!created) return; // no podemos evaluar
        const closed = parseClosedTimestamp(t);
        const now = new Date();
        const end = closed || now;
        const elapsed = hoursBetween(created, end);
        if (elapsed == null) return;
        total += 1;
        const deptId = t.departamento;
        const priority = t.prioridad || 'Media';
        // intentar SLA por subcategoría: necesitamos tipoId y subId
        let slaHours = null;
        try {
          const tiposForDept = (tipos && tipos[deptId]) || {};
          const tipoEntry = Object.entries(tiposForDept).find(([, nombre]) => nombre === t.tipo);
          const tipoId = tipoEntry ? tipoEntry[0] : null;
          if (tipoId && subcats && subcats[deptId] && subcats[deptId][tipoId]) {
            const subEntries = Object.entries(subcats[deptId][tipoId]); // [id, nombre]
            const found = subEntries.find(([, nombre]) => nombre === t.subcategoria);
            const subId = found ? found[0] : null;
            if (subId && slaSubcats && slaSubcats[deptId] && slaSubcats[deptId][tipoId] && slaSubcats[deptId][tipoId][subId] != null) {
              slaHours = Number(slaSubcats[deptId][tipoId][subId]) || null;
            }
          }
        } catch {
          // ignore and fallback
        }
        if (slaHours == null) {
          const deptConfig = (configs && configs[deptId]) || {};
          slaHours = deptConfig[priority] ?? DEFAULT_SLA[priority] ?? 72;
        }
        const ok = elapsed <= slaHours;
        if (!ok) {
          breaches.push({ ticket: t, elapsed, slaHours, closed: !!closed });
        } else {
          within += 1;
        }
      });
      setScanResult({ total, within, breaches: breaches.sort((a,b) => b.elapsed - a.elapsed), scanned: true });
    } catch (e) {
      console.error('Error en scan SLA', e);
      setError('Error al escanear cumplimiento SLA');
    } finally {
      setScanning(false);
    }
  };

  // ...existing code...

  const saveConfig = async () => {
    const { departamento, prioridad, value } = editDialog;
    const hours = Number(value) || 0;
    if (!departamento) return setEditDialog({ open: false, departamento: null, prioridad: 'Alta', value: '' });
    // write to DB
    setError('');
    setSuccess('');
    try {
      const path = `sla/configs/${departamento}`;
      const existing = (configs && configs[departamento]) || {};
      const next = { ...existing, [prioridad]: hours };
  const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
  if (!dbInstance) throw new Error('No DB');
  await set(ref(dbInstance, path), next);
      // actualizar local
      setConfigs(prev => ({ ...prev, [departamento]: next }));
      setSuccess('Configuración SLA guardada exitosamente');
    } catch (e) {
      console.error('Error guardando SLA', e);
      setError('Error al guardar la configuración SLA');
    } finally {
      setEditDialog({ open: false, departamento: null, prioridad: 'Alta', value: '' });
    }
  };

  const saveSubcatAll = async (depId, tipoId, subId, obj) => {
    setError('');
    setSuccess('');
    try {
      const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
      if (!dbInstance) throw new Error('No DB');
      // escribir las tres prioridades bajo el nodo de la subcategoría
      const basePath = `sla/subcategorias/${depId}/${tipoId}/${subId}`;
      // normalize: si obj values are null -> set null to clear
      const updates = {};
      Object.entries(obj || {}).forEach(([k,v]) => { updates[`${basePath}/${k}`] = (v == null || Number.isNaN(Number(v))) ? null : Number(v); });
      // apply writes
      const promises = Object.entries(updates).map(([path, val]) => set(ref(dbInstance, path), val));
      await Promise.all(promises);
      // actualizar local
      setSlaSubcats(prev => {
        const copy = { ...prev };
        if (!copy[depId]) copy[depId] = {};
        if (!copy[depId][tipoId]) copy[depId][tipoId] = {};
        copy[depId][tipoId][subId] = { ...(copy[depId][tipoId][subId] || {}), ...(obj || {}) };
        return copy;
      });
      setSuccess('SLA de subcategoría guardado exitosamente');
    } catch (e) {
      console.error('Error guardando SLA subcategoria (all)', e);
      setError('Error al guardar el SLA de subcategoría');
    }
  };

  // preparar filas planas de subcategorías para render
  const subcatRows = [];
  try {
    Object.entries(subcats || {}).forEach(([depId, tiposMap]) => {
      Object.entries(tiposMap || {}).forEach(([tipoId, subs]) => {
        Object.entries(subs || {}).forEach(([subId, nombre]) => {
          subcatRows.push({ depId, tipoId, subId, nombre });
        });
      });
    });
  } catch {
    // ignore
  }

  const saveSubcatSla = async () => {
    const { depId, tipoId, subId, prioridad, value } = subcatDialog;
    const hours = Number(value) || 0;
    setError('');
    setSuccess('');
    try {
      const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
      if (!dbInstance) throw new Error('No DB');
      const path = `sla/subcategorias/${depId}/${tipoId}/${subId}/${prioridad}`;
      await set(ref(dbInstance, path), hours || null);
      // actualizar local
      setSlaSubcats(prev => {
        const copy = { ...prev };
        if (!copy[depId]) copy[depId] = {};
        if (!copy[depId][tipoId]) copy[depId][tipoId] = {};
        copy[depId][tipoId][subId] = copy[depId][tipoId][subId] || {};
        // si era número y no objeto, convertir a objeto
        if (typeof copy[depId][tipoId][subId] !== 'object') copy[depId][tipoId][subId] = { Alta: copy[depId][tipoId][subId] };
        copy[depId][tipoId][subId][prioridad] = hours || null;
        return copy;
      });
      setSuccess('SLA editado exitosamente');
    } catch (e) {
      console.error('Error guardando SLA subcategoría', e);
      setError('Error al guardar el SLA');
    } finally {
      setSubcatDialog({ open: false, depId: null, tipoId: null, subId: null, prioridad: 'Alta', value: '' });
    }
  };

  return (
    <ModuleContainer>
      {loading ? (
        <GlassCard sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <CircularProgress />
          <Typography variant="h6" sx={{ ml: 2 }}>Cargando SLA...</Typography>
        </GlassCard>
      ) : (
        <>
          <PageHeader
            title="Gestión de SLA"
            subtitle="Configura objetivos y monitorea cumplimiento"
            icon={AccessTimeIcon}
            gradient="purple"
          />

          {/* KPIs de escaneo */}
          {scanResult.scanned && (
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title="Total Evaluados"
                  value={scanResult.total}
                  icon={AccessTimeIcon}
                  gradient="info"
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title="Dentro de SLA"
                  value={scanResult.within}
                  subtitle={scanResult.total > 0 ? `${Math.round((scanResult.within / scanResult.total) * 100)}% cumplimiento` : ''}
                  icon={CheckCircleIcon}
                  gradient="success"
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title="Incumplidos"
                  value={scanResult.breaches.length}
                  icon={WarningIcon}
                  gradient="error"
                />
              </Grid>
            </Grid>
          )}

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <SectionContainer title="Configuración SLA por Subcategoría" icon={AccessTimeIcon}>
                <Box sx={{ mb: 2 }}>
                  <TextField 
                    select 
                    fullWidth 
                    label="Filtrar por Departamento" 
                    value={selectedDept} 
                    onChange={e => setSelectedDept(e.target.value)} 
                    size="small"
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                  >
                    <MenuItem value="">Todos los departamentos</MenuItem>
                    {departamentos.map(dep => (
                      <MenuItem key={dep.id} value={dep.id}>{dep.nombre}</MenuItem>
                    ))}
                  </TextField>
                </Box>
                <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, borderRadius: 2, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                      <TableCell sx={{ fontWeight: 700 }}>Departamento</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Categoría</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Subcategoría</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Alta (h)</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Media (h)</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Baja (h)</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>Acciones</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {subcatRows.filter(row => !selectedDept || row.depId === selectedDept).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <EmptyState 
                            icon={AccessTimeIcon} 
                            title="Sin subcategorías" 
                            subtitle={selectedDept ? 'No hay subcategorías para este departamento' : 'Configura subcategorías primero'}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                    {subcatRows.filter(row => !selectedDept || row.depId === selectedDept).map(row => {
                      const { depId, tipoId, subId, nombre } = row;
                      const slaObj = (slaSubcats && slaSubcats[depId] && slaSubcats[depId][tipoId] && slaSubcats[depId][tipoId][subId]);
                      const getVal = (p) => {
                        if (!slaObj) return '';
                        if (typeof slaObj === 'object') return slaObj[p] ?? '';
                        return p === 'Media' ? slaObj : '';
                      };
                      const [alta, media, baja] = [getVal('Alta'), getVal('Media'), getVal('Baja')];
                        return (
                          <TableRow key={`${depId}-${tipoId}-${subId}`} sx={{ '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.02) } }}>
                            <TableCell>
                              <Chip label={departamentos.find(d=>d.id===depId)?.nombre || depId} size="small" />
                            </TableCell>
                            <TableCell sx={{ fontWeight: 500 }}>{(tipos && tipos[depId] && tipos[depId][tipoId]) || tipoId}</TableCell>
                            <TableCell>{nombre}</TableCell>
                            <TableCell><TextField size="small" type="number" defaultValue={alta} inputProps={{ min:0 }} sx={{ width: 80 }} id={`alta-${depId}-${tipoId}-${subId}`} /></TableCell>
                            <TableCell><TextField size="small" type="number" defaultValue={media} inputProps={{ min:0 }} sx={{ width: 80 }} id={`media-${depId}-${tipoId}-${subId}`} /></TableCell>
                            <TableCell><TextField size="small" type="number" defaultValue={baja} inputProps={{ min:0 }} sx={{ width: 80 }} id={`baja-${depId}-${tipoId}-${subId}`} /></TableCell>
                            <TableCell align="right">
                              <Button size="small" variant="contained" sx={{ fontWeight: 600 }} onClick={async () => {
                                const a = Number(document.getElementById(`alta-${depId}-${tipoId}-${subId}`)?.value) || null;
                                const m = Number(document.getElementById(`media-${depId}-${tipoId}-${subId}`)?.value) || null;
                                const b = Number(document.getElementById(`baja-${depId}-${tipoId}-${subId}`)?.value) || null;
                                await saveSubcatAll(depId, tipoId, subId, { Alta: a, Media: m, Baja: b });
                              }}>Guardar</Button>
                            </TableCell>
                          </TableRow>
                        );
                    })}
                  </TableBody>
                </Table>
                </TableContainer>

                {/* Mobile: render cards */}
                <Box sx={{ display: { xs: 'block', sm: 'none' }, mt: 1 }}>
                  {subcatRows.filter(row => !selectedDept || row.depId === selectedDept).length === 0 ? (
                    <Typography variant="body2" color="text.secondary">No hay subcategorías {selectedDept ? 'para este departamento' : ''}</Typography>
                  ) : subcatRows.filter(row => !selectedDept || row.depId === selectedDept).map(row => {
                    const { depId, tipoId, subId, nombre } = row;
                    const slaObj = (slaSubcats && slaSubcats[depId] && slaSubcats[depId][tipoId] && slaSubcats[depId][tipoId][subId]);
                    const getVal = (p) => {
                      if (slaObj == null) return '';
                      if (typeof slaObj === 'object') return slaObj[p] ?? '';
                      return p === 'Media' ? slaObj : '';
                    };
                    const alta = getVal('Alta');
                    const media = getVal('Media');
                    const baja = getVal('Baja');
                    return (
                      <GlassCard key={`${depId}-${tipoId}-${subId}-card`} sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: theme.palette.primary.main }}>{departamentos.find(d=>d.id===depId)?.nombre || depId}</Typography>
                        <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>{(tipos && tipos[depId] && tipos[depId][tipoId]) || tipoId} • {nombre}</Typography>
                        <Box sx={{ display: 'flex', gap: 1, flexDirection: 'column' }}>
                          <TextField size="small" type="number" defaultValue={alta} inputProps={{ min:0 }} sx={{ width: '100%' }} id={`alta-${depId}-${tipoId}-${subId}-mobile`} label="Alta (h)" />
                          <TextField size="small" type="number" defaultValue={media} inputProps={{ min:0 }} sx={{ width: '100%' }} id={`media-${depId}-${tipoId}-${subId}-mobile`} label="Media (h)" />
                          <TextField size="small" type="number" defaultValue={baja} inputProps={{ min:0 }} sx={{ width: '100%' }} id={`baja-${depId}-${tipoId}-${subId}-mobile`} label="Baja (h)" />
                          <Button variant="contained" fullWidth sx={{ mt: 1, fontWeight: 600 }} onClick={async () => {
                            const a = Number(document.getElementById(`alta-${depId}-${tipoId}-${subId}-mobile` )?.value) || null;
                            const m = Number(document.getElementById(`media-${depId}-${tipoId}-${subId}-mobile` )?.value) || null;
                            const b = Number(document.getElementById(`baja-${depId}-${tipoId}-${subId}-mobile` )?.value) || null;
                            await saveSubcatAll(depId, tipoId, subId, { Alta: a, Media: m, Baja: b });
                          }}>Guardar</Button>
                        </Box>
                      </GlassCard>
                    );
                  })}
                </Box>
              </SectionContainer>
            </Grid>

            <Grid item xs={12} md={6}>
              <SectionContainer title="Escaneo de Cumplimiento" icon={CheckCircleIcon}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 3, flexWrap: 'wrap' }}>
                  <Button 
                    variant="contained" 
                    onClick={runScan} 
                    disabled={loading || scanning}
                    startIcon={scanning ? <CircularProgress size={18} /> : <PlayArrowIcon />}
                    sx={{ fontWeight: 700 }}
                  >
                    {scanning ? 'Escaneando...' : 'Escanear Cumplimiento'}
                  </Button>
                </Box>

                {scanResult.scanned && scanResult.breaches.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                      Incumplimientos ({scanResult.breaches.length})
                    </Typography>
                    <TableContainer sx={{ borderRadius: 2, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: alpha(theme.palette.error.main, 0.05) }}>
                          <TableCell sx={{ fontWeight: 700 }}>Ticket</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Dept</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Horas</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Objetivo</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {scanResult.breaches.map(b => (
                          <TableRow key={b.ticket.id} sx={{ '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.02) } }}>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>{b.ticket.tipo}</Typography>
                              <Typography variant="caption" color="text.secondary">#{b.ticket.id}</Typography>
                            </TableCell>
                            <TableCell>{departamentos.find(d => d.id === b.ticket.departamento)?.nombre || b.ticket.departamento}</TableCell>
                            <TableCell>
                              <Chip label={`${Math.round(b.elapsed)}h`} size="small" color="error" />
                            </TableCell>
                            <TableCell>{b.slaHours}h</TableCell>
                            <TableCell>
                              <Chip 
                                label={b.closed ? 'Cerrado' : 'Abierto'} 
                                size="small" 
                                color={b.closed ? 'default' : 'warning'}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </TableContainer>
                  </Box>
                )}

                {scanResult.scanned && scanResult.breaches.length === 0 && (
                  <EmptyState 
                    icon={CheckCircleIcon} 
                    title="¡Excelente!" 
                    subtitle="No hay incumplimientos de SLA"
                  />
                )}

                {!scanResult.scanned && (
                  <EmptyState 
                    icon={PlayArrowIcon} 
                    title="Ejecuta un escaneo" 
                    subtitle="Presiona el botón para analizar el cumplimiento SLA"
                  />
                )}
              </SectionContainer>
            </Grid>
          </Grid>
        </>
      )}

      <Dialog 
        open={editDialog.open} 
        onClose={() => setEditDialog({ open: false, departamento: null, prioridad: 'Alta', value: '' })}
        PaperProps={{ sx: dialogStyles.paper }}
      >
        <DialogTitle sx={dialogStyles.title('purple')(theme)}>Editar objetivo SLA</DialogTitle>
        <DialogContent sx={dialogStyles.content}>
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <TextField select label="Prioridad" value={editDialog.prioridad} onChange={e => setEditDialog(d => ({ ...d, prioridad: e.target.value }))}>
              {PRIORITIES.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
            <TextField label="Horas" value={editDialog.value} onChange={e => setEditDialog(d => ({ ...d, value: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions sx={dialogStyles.actions}>
          <Button onClick={() => setEditDialog({ open: false, departamento: null, prioridad: 'Alta', value: '' })} variant="contained" color="error" sx={{ fontWeight: 600 }}>Cancelar</Button>
          <Button variant="contained" onClick={saveConfig} sx={{ fontWeight: 600 }}>Guardar</Button>
        </DialogActions>
      </Dialog>
      <Dialog 
        open={subcatDialog.open} 
        onClose={() => setSubcatDialog({ open: false, depId: null, tipoId: null, subId: null, prioridad: 'Alta', value: '' })}
        PaperProps={{ sx: dialogStyles.paper }}
      >
        <DialogTitle sx={dialogStyles.title('purple')(theme)}>Editar SLA - Subcategoría</DialogTitle>
        <DialogContent sx={dialogStyles.content}>
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <TextField select label="Prioridad" value={subcatDialog.prioridad} onChange={e => setSubcatDialog(d => ({ ...d, prioridad: e.target.value }))}>
              {PRIORITIES.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
            <TextField label="Horas" value={subcatDialog.value} onChange={e => setSubcatDialog(d => ({ ...d, value: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions sx={dialogStyles.actions}>
          <Button onClick={() => setSubcatDialog({ open: false, depId: null, tipoId: null, subId: null, prioridad: 'Alta', value: '' })} variant="contained" color="error" sx={{ fontWeight: 600 }}>Cancelar</Button>
          <Button variant="contained" onClick={saveSubcatSla} sx={{ fontWeight: 600 }}>Guardar</Button>
        </DialogActions>
      </Dialog>
    </ModuleContainer>
  );
}
