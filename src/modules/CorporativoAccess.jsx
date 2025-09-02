import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Grid, TextField, MenuItem, Button, CircularProgress,
  Table, TableBody, TableCell, TableHead, TableRow, Checkbox, Snackbar, Alert,
  TableContainer, Chip, Divider, Stack
} from '@mui/material';
import { ref, get, set, remove } from 'firebase/database';
import { getDbForRecinto } from '../firebase/multiDb';
import { useAuth } from '../context/useAuth';
import { useDb } from '../context/DbContext';

// Módulo para gestionar autorizaciones de usuarios de recintos a la base Corporate
export default function CorporativoAccess() {
  const { user, userData } = useAuth();
  const { recinto: currentRecinto } = useDb();
  // Determinar recinto del usuario: preferir userData.recinto si está disponible;
  // en caso contrario usar el recinto actual del contexto o el guardado en localStorage.
  const userRecinto = userData?.recinto || currentRecinto || localStorage.getItem('selectedRecinto') || 'CCCI';
  const [sourceRecinto] = useState(userRecinto);
  const [corporateRecinto] = useState('CORPORATIVO');
  const [usuariosOrigen, setUsuariosOrigen] = useState([]);
  const [loadingSource, setLoadingSource] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [authorized, setAuthorized] = useState({});
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const AUTH_PATH = 'corporativo_authorized_users';

  useEffect(() => {
    // cargar autorizados de la base corporativa al montar o cuando cambie el recinto
    const fetchAuthorized = async () => {
      setLoadingAuth(true);
      try {
        const dbCorp = await getDbForRecinto(corporateRecinto);
        const snap = await get(ref(dbCorp, AUTH_PATH));
        if (!snap.exists()) {
          setAuthorized({});
        } else {
          setAuthorized(snap.val() || {});
        }
      } catch (e) {
        console.error('Error cargando autorizados', e);
        setAuthorized({});
      } finally {
        setLoadingAuth(false);
      }
    };
    fetchAuthorized();
  }, [corporateRecinto]);

  const fetchSourceUsers = async () => {
    setLoadingSource(true);
    setUsuariosOrigen([]);
    try {
      const db = await getDbForRecinto(sourceRecinto);
      const snap = await get(ref(db, 'usuarios'));
      if (!snap.exists()) {
        setUsuariosOrigen([]);
      } else {
        const v = snap.val();
        const list = Object.entries(v).map(([id, u]) => ({ id, ...u }));
        setUsuariosOrigen(list.sort((a,b) => (a.nombre || a.displayName || '').localeCompare(b.nombre || b.displayName || '')));
      }
      setSnackbar({ open: true, message: 'Usuarios de origen cargados', severity: 'success' });
    } catch (e) {
      console.error('Error cargando usuarios origen', e);
      setSnackbar({ open: true, message: 'Error cargando usuarios de origen', severity: 'error' });
    } finally {
      setLoadingSource(false);
    }
  };

  const fetchAuthorized = async () => {
    setLoadingAuth(true);
    try {
      const dbCorp = await getDbForRecinto(corporateRecinto);
      const snap = await get(ref(dbCorp, AUTH_PATH));
      if (!snap.exists()) {
        setAuthorized({});
      } else {
        setAuthorized(snap.val() || {});
      }
    } catch (e) {
      console.error('Error cargando autorizados', e);
      setAuthorized({});
    } finally {
      setLoadingAuth(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(Array.from(prev));
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const authorizeSelected = async () => {
    if (!selectedIds.size) return;
    try {
      const dbCorp = await getDbForRecinto(corporateRecinto);
      const now = Date.now();
      const updates = {};
      for (const id of selectedIds) {
        const u = usuariosOrigen.find(x => x.id === id) || { id };
        const payload = {
          origenRecinto: sourceRecinto,
          id: id,
          email: u.email || u.usuario || '',
          displayName: u.nombre || u.displayName || u.name || '',
          addedBy: userData?.email || userData?.usuario || 'unknown',
          addedAt: now,
          allowed: true
        };
        await set(ref(dbCorp, `${AUTH_PATH}/${id}`), payload);
        // Escribir también un booleano en una ruta separada por compatibilidad con reglas
        try {
          await set(ref(dbCorp, `corporativo_allowed/${id}`), true);
        } catch (eAllowed) {
          console.debug('No se pudo escribir corporate_allowed flag', eAllowed);
        }
        updates[id] = payload;
      }
      setAuthorized(prev => ({ ...prev, ...updates }));
      setSelectedIds(new Set());
      setSnackbar({ open: true, message: 'Usuarios autorizados correctamente', severity: 'success' });
    } catch (e) {
      console.error('Error autorizando usuarios', e);
      setSnackbar({ open: true, message: 'Error autorizando usuarios', severity: 'error' });
    }
  };

  const revoke = async (id) => {
    try {
      const dbCorp = await getDbForRecinto(corporateRecinto);
      await remove(ref(dbCorp, `${AUTH_PATH}/${id}`));
      setAuthorized(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      setSnackbar({ open: true, message: 'Autorización revocada', severity: 'info' });
    } catch (e) {
      console.error('Error revocando', e);
      setSnackbar({ open: true, message: 'Error al revocar autorización', severity: 'error' });
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, width: '100%' }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>Gestión de acceso a Corporativo</Typography>

      <Paper elevation={1} sx={{ p: 2, mb: 3, borderRadius: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              label="Recinto origen"
              value={sourceRecinto}
              fullWidth
              size="small"
              disabled
              helperText={userData?.recinto ? 'Recinto asignado en tu perfil (no modificable)' : ''}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField label="Recinto corporativo" size="small" fullWidth value={corporateRecinto} disabled />
          </Grid>
          <Grid item xs={12} md={4}>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button variant="contained" onClick={fetchSourceUsers} disabled={loadingSource}>Cargar usuarios</Button>
              <Button variant="outlined" onClick={fetchAuthorized} disabled={loadingAuth}>Refrescar</Button>
              <Button variant="text" onClick={async () => {
                const uidToCheck = selectedIds.size === 1 ? Array.from(selectedIds)[0] : (user?.uid || null);
                if (!uidToCheck) return setSnackbar({ open: true, message: 'Selecciona 1 usuario o inicia sesión', severity: 'warning' });
                try {
                  const { default: canAccessCorporativo } = await import('../utils/canAccessCorporativo');
                  const res = await canAccessCorporativo(uidToCheck);
                  if (res && res.authorized) {
                    setSnackbar({ open: true, message: `UID ${uidToCheck} AUTORIZADO en ${res.foundIn}`, severity: 'success' });
                  } else {
                    setSnackbar({ open: true, message: `UID ${uidToCheck} NO autorizado en ninguna DB`, severity: 'error' });
                  }
                } catch (err) {
                  console.error('Diagnóstico corporativo falló', err);
                  setSnackbar({ open: true, message: 'Error diagnóstico (revisa consola)', severity: 'error' });
                }
              }}>Diagnosticar</Button>
            </Stack>
          </Grid>
        </Grid>
      </Paper>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Paper elevation={1} sx={{ p: 2, minHeight: 320, borderRadius: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Usuarios en {sourceRecinto}</Typography>
              <Chip
                label={`${usuariosOrigen.length} encontrados`}
                size="small"
                color="info"
                variant="outlined"
                sx={{ ml: 1, fontWeight: 600 }}
              />
            </Box>
            <Divider sx={{ mb: 1 }} />
            {loadingSource ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: theme => theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[100] }}>
                      <TableCell></TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Email / Usuario</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Autorizado</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {usuariosOrigen.map(u => (
                      <TableRow key={u.id} hover>
                        <TableCell padding="checkbox">
                          <Checkbox checked={selectedIds.has(u.id)} onChange={() => toggleSelect(u.id)} />
                        </TableCell>
                        <TableCell>{u.nombre || u.displayName || u.name || u.id}</TableCell>
                        <TableCell>{u.email || u.usuario || ''}</TableCell>
                        <TableCell>{authorized[u.id] ? <Chip label="Sí" size="small" color="success" /> : ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <Box sx={{ display: 'flex', gap: 1, mt: 2, justifyContent: 'flex-end' }}>
              <Button variant="contained" disabled={selectedIds.size===0} onClick={authorizeSelected}>Autorizar seleccionados</Button>
              <Button variant="outlined" onClick={()=>setSelectedIds(new Set())}>Limpiar</Button>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper elevation={1} sx={{ p: 2, minHeight: 320, borderRadius: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Usuarios autorizados en {corporateRecinto}</Typography>
              <Chip
                label={`${Object.keys(authorized || {}).length} autorizados`}
                size="small"
                color="success"
                variant="outlined"
                sx={{ ml: 1, fontWeight: 600 }}
              />
            </Box>
            <Divider sx={{ mb: 1 }} />
            {loadingAuth ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: theme => theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[100] }}>
                      <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Origen</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Acción</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(authorized || {}).map(([id, info]) => (
                      <TableRow key={id} hover>
                        <TableCell>{info.displayName || id}</TableCell>
                        <TableCell>{info.email || ''}</TableCell>
                        <TableCell>{info.origenRecinto || ''}</TableCell>
                        <TableCell><Button size="small" color="error" variant="outlined" onClick={()=>revoke(id)}>Revocar</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>
      </Grid>

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar(s => ({ ...s, open: false }))} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
