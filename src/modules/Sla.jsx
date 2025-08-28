import React, { useEffect, useState } from 'react';
import { Box, Typography, Paper, Grid, Table, TableHead, TableRow, TableCell, TableBody, TableContainer, Button, TextField, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Chip, Alert } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import { ref, get, set } from 'firebase/database';
import { useDb } from '../context/DbContext';
import { getDbForRecinto } from '../firebase/multiDb';

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
  const [scanResult, setScanResult] = useState({ total: 0, within: 0, breaches: [] });
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
        if (!dbInstance) return setLoading(false);
        const [depSnap, ticketsSnap, slaSnap, tiposSnap, subSnap, slaSubSnap] = await Promise.all([
          get(ref(dbInstance, 'departamentos')),
          get(ref(dbInstance, 'tickets')),
          get(ref(dbInstance, 'sla/configs')),
          get(ref(dbInstance, 'tiposTickets')),
          get(ref(dbInstance, 'subcategoriasTickets')),
          get(ref(dbInstance, 'sla/subcategorias')),
        ]);
        const deps = depSnap.exists() ? Object.entries(depSnap.val()).map(([id, nombre]) => ({ id, nombre })) : [];
        setDepartamentos(deps);
        const t = ticketsSnap.exists() ? Object.entries(ticketsSnap.val()).map(([id, ticket]) => ({ id, ...ticket })) : [];
        setTickets(t);
  setConfigs(slaSnap.exists() ? slaSnap.val() : {});
  setTipos(tiposSnap.exists() ? tiposSnap.val() : {});
  setSubcats(subSnap.exists() ? subSnap.val() : {});
  setSlaSubcats(slaSubSnap.exists() ? slaSubSnap.val() : {});
      } catch (e) {
        console.error('Error cargando datos SLA', e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [ctxDb, recinto]);

  // NOTE: no early return here to preserve hook call order; loading UI is handled in JSX below

  useEffect(() => {
    // recalcular scan cada vez que tickets o configs cambian
    const runScan = () => {
      const breaches = [];
      let within = 0;
      let total = 0;
      tickets.forEach(t => {
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
      setScanResult({ total, within, breaches: breaches.sort((a,b) => b.elapsed - a.elapsed) });
    };
    runScan();
  }, [tickets, configs, tipos, subcats, slaSubcats]);

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
    <Box sx={{ p: { xs: 1, sm: 3 }, width: '100%', maxWidth: '100vw', boxSizing: 'border-box' }}>
      {loading ? (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6">Cargando SLA...</Typography>
        </Paper>
      ) : (
        <>
          <Typography variant="h5" sx={{ mb: 3, fontWeight: 700 }}>SLA - Gestión</Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: { xs: 1, sm: 2 }, borderRadius: 2 }} elevation={3}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Configuración de SLA (por Subcategoría)</Typography>
                <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Departamento</TableCell>
                      <TableCell>Tipo</TableCell>
                      <TableCell>Subcategoría</TableCell>
                      <TableCell>Alta (h)</TableCell>
                      <TableCell>Media (h)</TableCell>
                      <TableCell>Baja (h)</TableCell>
                      <TableCell align="right">Acciones</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {subcatRows.length === 0 && (
                      <TableRow><TableCell colSpan={7}>No hay subcategorías</TableCell></TableRow>
                    )}
                    {subcatRows.map(row => {
                      const { depId, tipoId, subId, nombre } = row;
                      const slaObj = (slaSubcats && slaSubcats[depId] && slaSubcats[depId][tipoId] && slaSubcats[depId][tipoId][subId]);
                      const getVal = (p) => {
                        if (!slaObj) return '';
                        if (typeof slaObj === 'object') return slaObj[p] ?? '';
                        return p === 'Media' ? slaObj : '';
                      };
                      const [alta, media, baja] = [getVal('Alta'), getVal('Media'), getVal('Baja')];
                        return (
                          <TableRow key={`${depId}-${tipoId}-${subId}`}>
                            <TableCell>{departamentos.find(d=>d.id===depId)?.nombre || depId}</TableCell>
                            <TableCell>{(tipos && tipos[depId] && tipos[depId][tipoId]) || tipoId}</TableCell>
                            <TableCell>{nombre}</TableCell>
                            <TableCell><TextField size="small" type="number" defaultValue={alta} inputProps={{ min:0 }} sx={{ width: 100 }} id={`alta-${depId}-${tipoId}-${subId}`} /></TableCell>
                            <TableCell><TextField size="small" type="number" defaultValue={media} inputProps={{ min:0 }} sx={{ width: 100 }} id={`media-${depId}-${tipoId}-${subId}`} /></TableCell>
                            <TableCell><TextField size="small" type="number" defaultValue={baja} inputProps={{ min:0 }} sx={{ width: 100 }} id={`baja-${depId}-${tipoId}-${subId}`} /></TableCell>
                            <TableCell align="right">
                              <Button size="small" variant="contained" onClick={async () => {
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
                  {subcatRows.length === 0 ? (
                    <Typography variant="body2">No hay subcategorías</Typography>
                  ) : subcatRows.map(row => {
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
                      <Paper key={`${depId}-${tipoId}-${subId}-card`} sx={{ p: 2, mb: 1 }} elevation={1}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{departamentos.find(d=>d.id===depId)?.nombre || depId} • {(tipos && tipos[depId] && tipos[depId][tipoId]) || tipoId}</Typography>
                        <Typography variant="body2" sx={{ mb: 1 }}>{nombre}</Typography>
                        <Box sx={{ display: 'flex', gap: 1, flexDirection: 'column' }}>
                          <TextField size="small" type="number" defaultValue={alta} inputProps={{ min:0 }} sx={{ width: '100%' }} id={`alta-${depId}-${tipoId}-${subId}-mobile`} label={`Alta (h)`} />
                          <TextField size="small" type="number" defaultValue={media} inputProps={{ min:0 }} sx={{ width: '100%' }} id={`media-${depId}-${tipoId}-${subId}-mobile`} label={`Media (h)`} />
                          <TextField size="small" type="number" defaultValue={baja} inputProps={{ min:0 }} sx={{ width: '100%' }} id={`baja-${depId}-${tipoId}-${subId}-mobile`} label={`Baja (h)`} />
                          <Button variant="contained" fullWidth sx={{ mt: 1 }} onClick={async () => {
                            const a = Number(document.getElementById(`alta-${depId}-${tipoId}-${subId}-mobile` )?.value) || null;
                            const m = Number(document.getElementById(`media-${depId}-${tipoId}-${subId}-mobile` )?.value) || null;
                            const b = Number(document.getElementById(`baja-${depId}-${tipoId}-${subId}-mobile` )?.value) || null;
                            await saveSubcatAll(depId, tipoId, subId, { Alta: a, Media: m, Baja: b });
                          }}>Guardar</Button>
                        </Box>
                      </Paper>
                    );
                  })}
                </Box>
              </Paper>
            </Grid>

            <Grid item xs={12} md={6}>
              <Paper sx={{ p: { xs: 1, sm: 2 }, borderRadius: 2 }} elevation={3}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Resumen y cumplimiento</Typography>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexDirection: { xs: 'column', sm: 'row' } }}>
                  <Chip label={`Total evaluables: ${scanResult.total}`} />
                  <Chip label={`Dentro SLA: ${scanResult.within}`} color="success" />
                  <Chip label={`Incumplidos: ${scanResult.breaches.length}`} color="error" />
                </Box>

                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2">Incumplimientos (más recientes primero)</Typography>
                  <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Ticket</TableCell>
                        <TableCell>Dept</TableCell>
                        <TableCell>Prioridad</TableCell>
                        <TableCell>Horas</TableCell>
                        <TableCell>Objetivo (h)</TableCell>
                        <TableCell>Estado</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {scanResult.breaches.length === 0 && (
                        <TableRow><TableCell colSpan={6}>Sin incumplimientos detectados</TableCell></TableRow>
                      )}
                      {scanResult.breaches.map(b => (
                        <TableRow key={b.ticket.id}>
                          <TableCell>{b.ticket.tipo} #{b.ticket.id}</TableCell>
                          <TableCell>{departamentos.find(d => d.id === b.ticket.departamento)?.nombre || b.ticket.departamento}</TableCell>
                          <TableCell>{b.ticket.prioridad || 'Media'}</TableCell>
                          <TableCell>{Math.round(b.elapsed)}</TableCell>
                          <TableCell>{b.slaHours}</TableCell>
                          <TableCell>{b.closed ? 'Cerrado (incumplimiento)' : 'Abierto (en retraso)'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </TableContainer>
                </Box>
              </Paper>
            </Grid>
            <Grid item xs={12}>
              <Paper sx={{ p: { xs: 1, sm: 2 }, borderRadius: 2 }} elevation={3}>
                <Typography variant="h6" sx={{ mb: 2 }}>SLA por Subcategoría</Typography>
                <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Departamento</TableCell>
                      <TableCell>Tipo</TableCell>
                      <TableCell>Subcategoría</TableCell>
                      <TableCell>Objetivos (h) [Alta/Media/Baja]</TableCell>
                      <TableCell>Acciones</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(subcats || {}).length === 0 && (
                      <TableRow><TableCell colSpan={5}>No hay subcategorías</TableCell></TableRow>
                    )}
                    {subcatRows.length === 0 ? (
                      <TableRow><TableCell colSpan={5}>No hay subcategorías</TableCell></TableRow>
                    ) : (
                      subcatRows.map(row => {
                        const { depId, tipoId, subId, nombre } = row;
                        const slaObj = (slaSubcats && slaSubcats[depId] && slaSubcats[depId][tipoId] && slaSubcats[depId][tipoId][subId]);
                        const display = (p) => {
                          if (slaObj == null) return '-';
                          if (typeof slaObj === 'object') return slaObj[p] ?? '-';
                          return p === 'Media' ? slaObj : '-';
                        };
                        const altaVal = (slaSubcats && slaSubcats[depId] && slaSubcats[depId][tipoId] && slaSubcats[depId][tipoId][subId] && (typeof slaSubcats[depId][tipoId][subId] === 'object' ? (slaSubcats[depId][tipoId][subId]['Alta']||'') : (slaSubcats[depId][tipoId][subId]||''))) || '';
                        return (
                          <TableRow key={`${depId}-${tipoId}-${subId}`}>
                            <TableCell>{departamentos.find(d=>d.id===depId)?.nombre || depId}</TableCell>
                            <TableCell>{(tipos && tipos[depId] && tipos[depId][tipoId]) || tipoId}</TableCell>
                            <TableCell>{nombre}</TableCell>
                            <TableCell>{`${display('Alta') || '-'} / ${display('Media') || '-'} / ${display('Baja') || '-'}`}</TableCell>
                            <TableCell>
                              <Button size="small" variant="outlined" onClick={() => setSubcatDialog({ open: true, depId, tipoId, subId, prioridad: 'Alta', value: String(altaVal) })}>Editar SLA</Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                </TableContainer>
              </Paper>
            </Grid>
          </Grid>
        </>
      )}

      <Dialog open={editDialog.open} onClose={() => setEditDialog({ open: false, departamento: null, prioridad: 'Alta', value: '' })}>
        <DialogTitle>Editar objetivo SLA</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <TextField select label="Prioridad" value={editDialog.prioridad} onChange={e => setEditDialog(d => ({ ...d, prioridad: e.target.value }))}>
              {PRIORITIES.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
            <TextField label="Horas" value={editDialog.value} onChange={e => setEditDialog(d => ({ ...d, value: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog({ open: false, departamento: null, prioridad: 'Alta', value: '' })} variant="contained" color="error">Cancelar</Button>
          <Button variant="contained" onClick={saveConfig}>Guardar</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={subcatDialog.open} onClose={() => setSubcatDialog({ open: false, depId: null, tipoId: null, subId: null, prioridad: 'Alta', value: '' })}>
        <DialogTitle>Editar SLA - Subcategoría</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <TextField select label="Prioridad" value={subcatDialog.prioridad} onChange={e => setSubcatDialog(d => ({ ...d, prioridad: e.target.value }))}>
              {PRIORITIES.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
            <TextField label="Horas" value={subcatDialog.value} onChange={e => setSubcatDialog(d => ({ ...d, value: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubcatDialog({ open: false, depId: null, tipoId: null, subId: null, prioridad: 'Alta', value: '' })} variant="contained" color="error">Cancelar</Button>
          <Button variant="contained" onClick={saveSubcatSla}>Guardar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
