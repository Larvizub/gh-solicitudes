import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Grid, TextField, Button, CircularProgress,
  Table, TableBody, TableCell, TableHead, TableRow, Checkbox, Snackbar, Alert,
  TableContainer, Chip, Divider, Stack
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import BusinessIcon from '@mui/icons-material/Business';
import PeopleIcon from '@mui/icons-material/People';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { ref, get, set, remove } from 'firebase/database';
import { getDbForRecinto } from '../firebase/multiDb';
import { useAuth } from '../context/useAuth';
import { useDb } from '../context/DbContext';
import { ModuleContainer, PageHeader, GlassCard, SectionContainer, EmptyState } from '../components/ui/SharedStyles';
import { gradients } from '../components/ui/sharedStyles.constants';
import useNotification from '../context/useNotification';

// Módulo para gestionar autorizaciones de usuarios de recintos a la base Corporate
export default function CorporativoAccess() {
  const { userData } = useAuth();
  const { recinto: currentRecinto } = useDb();
  const theme = useTheme();
  const notify = useNotification();
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

  // Mostrar notificaciones
  useEffect(() => {
    if (snackbar.open) {
      notify(snackbar.message, snackbar.severity);
    }
  }, [snackbar, notify]);

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
      } catch {
          // removed console.error while loading authorized users
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
    } catch {
      // removed console.error while fetching source users
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
    } catch {
      // removed console.error while refreshing authorized
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
    } catch {
      // removed console.error for authorizeSelected
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
    } catch {
      // removed console.error for revoke
      setSnackbar({ open: true, message: 'Error al revocar autorización', severity: 'error' });
    }
  };

  return (
    <ModuleContainer>
      <PageHeader 
        title="Gestión de acceso a Corporativo" 
        subtitle="Autoriza usuarios de tu recinto para acceder a la base corporativa"
        icon={BusinessIcon}
        gradient="dark"
      />

      <GlassCard sx={{ p: 3, mb: 3 }}>
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
              <Button 
                variant="contained" 
                onClick={fetchSourceUsers} 
                disabled={loadingSource}
                sx={{ background: gradients.primary, color: '#fff', '&:hover': { opacity: 0.9, color: '#fff' } }}
              >
                Cargar usuarios
              </Button>
              <Button variant="outlined" onClick={fetchAuthorized} disabled={loadingAuth}>Refrescar</Button>
            </Stack>
          </Grid>
        </Grid>
      </GlassCard>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <SectionContainer title={`Usuarios en ${sourceRecinto}`} icon={PeopleIcon}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Chip
                label={`${usuariosOrigen.length} encontrados`}
                size="small"
                color="info"
                variant="outlined"
                sx={{ fontWeight: 600 }}
              />
            </Box>
            {loadingSource ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
            ) : usuariosOrigen.length === 0 ? (
              <EmptyState message="Carga usuarios del recinto origen" icon={PeopleIcon} />
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                      <TableCell></TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Email / Usuario</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Autorizado</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {usuariosOrigen.map(u => (
                      <TableRow 
                        key={u.id} 
                        hover
                        sx={{ '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) } }}
                      >
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
              <Button 
                variant="contained" 
                disabled={selectedIds.size===0} 
                onClick={authorizeSelected}
                sx={{ background: gradients.success, color: '#fff', '&:hover': { opacity: 0.9, color: '#fff' } }}
              >
                Autorizar seleccionados
              </Button>
              <Button variant="outlined" onClick={()=>setSelectedIds(new Set())}>Limpiar</Button>
            </Box>
          </SectionContainer>
        </Grid>

        <Grid item xs={12} md={6}>
          <SectionContainer title={`Usuarios autorizados en ${corporateRecinto}`} icon={VerifiedUserIcon}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Chip
                label={`${Object.keys(authorized || {}).length} autorizados`}
                size="small"
                color="success"
                variant="outlined"
                sx={{ fontWeight: 600 }}
              />
            </Box>
            {loadingAuth ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
            ) : Object.keys(authorized || {}).length === 0 ? (
              <EmptyState message="No hay usuarios autorizados" icon={VerifiedUserIcon} />
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.success.main, 0.08) }}>
                      <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Origen</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Acción</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(authorized || {}).map(([id, info]) => (
                      <TableRow 
                        key={id} 
                        hover
                        sx={{ '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.04) } }}
                      >
                        <TableCell>{info.displayName || id}</TableCell>
                        <TableCell>{info.email || ''}</TableCell>
                        <TableCell>{info.origenRecinto || ''}</TableCell>
                        <TableCell>
                          <Button 
                            size="small" 
                            variant="outlined" 
                            onClick={()=>revoke(id)}
                            sx={{ 
                              color: theme.palette.error.main,
                              borderColor: theme.palette.error.main,
                              '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.1) }
                            }}
                          >
                            Revocar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </SectionContainer>
        </Grid>
      </Grid>

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar(s => ({ ...s, open: false }))} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </ModuleContainer>
  );
}
