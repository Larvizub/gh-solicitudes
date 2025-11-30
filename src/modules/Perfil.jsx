import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, TextField, Button, MenuItem, Alert, Avatar, Chip, CircularProgress, Badge, IconButton, LinearProgress, List, ListItem, ListItemText, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import PhotoCamera from '@mui/icons-material/PhotoCamera';
import PersonIcon from '@mui/icons-material/Person';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { ref, get, update } from 'firebase/database';
import { updatePassword, updateProfile } from 'firebase/auth';
import { useAuth } from '../context/useAuth';
import { useDb } from '../context/DbContext';
import { getDbForRecinto } from '../firebase/multiDb';
import { auth } from '../firebase/firebaseConfig';
import { ModuleContainer, PageHeader, GlassCard, StatCard } from '../components/ui/SharedStyles';
import { gradients, dialogStyles } from '../components/ui/sharedStyles.constants';
import useNotification from '../context/useNotification';

export default function Perfil() {
  const { user, userData, logout } = useAuth();
  const { db: ctxDb, recinto } = useDb();
  const theme = useTheme();
  const { notify } = useNotification();
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [departamento, setDepartamento] = useState('');
  const [departamentos, setDepartamentos] = useState([]);
  const [openDeptDialog, setOpenDeptDialog] = useState(false);
  const [selectedDeptForDialog, setSelectedDeptForDialog] = useState('');
  const [telefono, setTelefono] = useState(userData?.telefono || '');
  // Prefer `puesto` (nuevo campo). Para compatibilidad leemos `bio` si `puesto` no existe.
  const [puesto, setPuesto] = useState(userData?.puesto || userData?.bio || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  // const [avatarFile, setAvatarFile] = useState(null);
  const [perfilCompleto, setPerfilCompleto] = useState(0);
  const [fechaRegistro, setFechaRegistro] = useState('');
  const [ticketsCreados, setTicketsCreados] = useState(0);
  const [ticketsCerrados, setTicketsCerrados] = useState(0);
  const [ultimosTickets, setUltimosTickets] = useState([]);

  // Mostrar notificaciones
  useEffect(() => {
    if (success) notify(success, 'success');
    if (error) notify(error, 'error');
  }, [success, error, notify]);

  useEffect(() => {
    if (userData) {
      setNombre(userData.nombre || '');
      setApellido(userData.apellido || '');
      // Mostrar departamento validado si existe; si no, mostrar valor obtenido desde Microsoft (departamentoMs)
      setDepartamento(userData.departamento || userData.departamentoMs || '');
      // Si el usuario necesita seleccionar departamento y no tiene uno validado, abrir diálogo
      const isMicrosoftProvider = (user?.providerData || []).map(p => p.providerId || '').join(',').includes('microsoft') || String(user?.email || '').toLowerCase().includes('microsoft');
      const promptKey = `deptPromptShown_${user?.uid || 'anon'}`;
      const alreadyShown = !!localStorage.getItem(promptKey);
      // DEBUG: registrar condiciones que determinan apertura del diálogo
      try {
        console.debug('Perfil: dialog open check', {
          uid: user?.uid,
          needsDepartmentSelection: userData.needsDepartmentSelection,
          departamento: userData.departamento,
          departamentoMs: userData.departamentoMs,
          isMicrosoftProvider,
          promptKey,
          alreadyShown,
        });
      } catch (dbgErr) {
        console.debug('Perfil: dialog debug failed', dbgErr?.message || dbgErr);
      }
      // Pre-fill dialog selection with departamentoMs if present
      if (userData.departamentoMs) setSelectedDeptForDialog(userData.departamentoMs);
      // If user has a departamento in DB, ensure local state matches
      if (userData.departamento) setDepartamento(userData.departamento);

      // If the user has no departamento assigned, force the modal to open (mandatory)
      // Also support a session flag set right after login to avoid races
      let forceShow = false;
      try { forceShow = sessionStorage.getItem('forceShowDeptModal') === '1'; } catch (e) { console.debug('Perfil: sessionStorage read failed', e?.message || e); }
      if (forceShow) {
        try { sessionStorage.removeItem('forceShowDeptModal'); } catch (e) { console.debug('Perfil: sessionStorage remove failed', e?.message || e); }
      }
  // Consider usuario con departamento válido si tiene `departamento` o `departamentoMs` (valor desde Microsoft)
  const hasDept = (userData.departamento || userData.departamentoMs) && String((userData.departamento || userData.departamentoMs) || '').trim();
  if (forceShow || !hasDept) {
        if (alreadyShown) {
          console.debug('Perfil: user has no departamento but prompt alreadyShown, forcing reopen and clearing local flag');
          try { localStorage.removeItem(promptKey); } catch (e) { console.debug('Perfil: localStorage remove failed', e?.message || e); }
        }
        setOpenDeptDialog(true);
      }
      setTelefono(userData.telefono || '');
      setPuesto(userData.puesto || userData.bio || '');
    }
    if (user?.metadata?.creationTime) {
      setFechaRegistro(new Date(user.metadata.creationTime).toLocaleDateString());
    }
  }, [userData, user]);

  // Listen for the global event from AuthContext that forces the modal open
  useEffect(() => {
    function onForceShow() {
      console.debug('Perfil: received forceShowDeptModal event, opening dialog');
      setOpenDeptDialog(true);
    }
    try {
      window.addEventListener('forceShowDeptModal', onForceShow);
    } catch (e) {
      console.debug('Perfil: could not add forceShowDeptModal listener', e?.message || e);
    }
    return () => {
      try { window.removeEventListener('forceShowDeptModal', onForceShow); } catch (err) { console.debug('Perfil: removeEventListener failed', err?.message || err); }
    };
  }, []);

  useEffect(() => {
    const fetchDepartamentos = async () => {
      try {
        const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
        const snapshot = await get(ref(dbToUse, 'departamentos'));
        if (snapshot.exists()) {
          const data = snapshot.val();
          setDepartamentos(Object.values(data));
        } else {
          setDepartamentos([]);
        }
      } catch {
        setDepartamentos([]);
      }
    };
    fetchDepartamentos();
  }, [ctxDb, recinto]);

  // Guardar la selección obligatoria de departamento
  const handleConfirmDept = async () => {
    if (!selectedDeptForDialog) return;
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const ok = await saveDeptFromDialog(selectedDeptForDialog);
      if (!ok) throw new Error('no_saved');
      // verify the write
      try {
        const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
        const snap = await get(ref(dbToUse, `usuarios/${user.uid}`));
        if (snap.exists()) {
          const data = snap.val();
          if (data.departamento === selectedDeptForDialog) {
            setSuccess('Departamento guardado correctamente');
          } else {
            setError('No se confirmó el guardado del departamento. Intenta de nuevo.');
          }
        }
      } catch (vErr) {
        console.warn('Verificación de guardado falló', vErr);
        setSuccess('Departamento guardado (verificación fallida)');
      }
    } catch {
      setError('Error al guardar el departamento. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  // Save department selected in dialog immediately
  const saveDeptFromDialog = async (dept) => {
    if (!dept || !user) return false;
    try {
      const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      await update(ref(dbToUse, `usuarios/${user.uid}`), { departamento: dept, needsDepartmentSelection: false });
      setDepartamento(dept);
      setOpenDeptDialog(false);
      // Mostrar mensaje de éxito local al guardar desde el diálogo
      setSuccess('Departamento guardado correctamente');
      try { localStorage.setItem(`deptPromptShown_${user?.uid || 'anon'}`, '1'); } catch { /* ignore */ }
      // notify global context if needed
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new Event('userProfileUpdated'));
      }
      return true;
    } catch {
      console.error('Error asignando departamento desde diálogo');
      return false;
    }
  };

  // Progreso de perfil completo (nombre, apellido, departamento, teléfono, puesto, avatar)
  useEffect(() => {
    let total = 6;
    let filled = 0;
    if (nombre) filled++;
    if (apellido) filled++;
    if (departamento) filled++;
    if (telefono) filled++;
    if (puesto) filled++;
    if (user?.photoURL) filled++;
    setPerfilCompleto(Math.round((filled / total) * 100));
  }, [nombre, apellido, departamento, telefono, puesto, user]);

  // Resumen de tickets
  useEffect(() => {
    const fetchTickets = async () => {
      if (!user) return;
      try {
  const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
  const snap = await get(ref(dbToUse, 'tickets'));
        if (snap.exists()) {
          const all = Object.entries(snap.val()).map(([id, t]) => ({ id, ...t }));
          const creados = all.filter(t => t.usuarioEmail === user.email);
          setTicketsCreados(creados.length);
          setTicketsCerrados(creados.filter(t => t.estado === 'Cerrado').length);
          setUltimosTickets(creados.sort((a, b) => (b.fecha || 0) - (a.fecha || 0)).slice(0, 2));
        }
      } catch {
        setTicketsCreados(0);
        setTicketsCerrados(0);
        setUltimosTickets([]);
      }
    };
    fetchTickets();
  }, [user, ctxDb, recinto]);

  const handleUpdate = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      // Actualizar nombre y apellido en Firebase Auth
      await updateProfile(auth.currentUser, { displayName: `${nombre} ${apellido}` });
      // Actualizar datos en la base de datos
  const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
  await update(ref(dbToUse, `usuarios/${user.uid}`), {
        nombre,
        apellido,
        departamento,
        telefono,
        // Guardamos puesto y por compatibilidad actualizamos bio con el mismo valor
        puesto,
        bio: puesto,
      });
      // Cambiar contraseña si se ingresó una nueva
      if (password) {
        await updatePassword(auth.currentUser, password);
      }
      // Recargar datos del usuario desde la base de datos
  const snap = await get(ref(dbToUse, `usuarios/${user.uid}`));
      if (snap.exists()) {
        const data = snap.val();
  setNombre(data.nombre || '');
  setApellido(data.apellido || '');
  setDepartamento(data.departamento || '');
  setTelefono(data.telefono || '');
  setPuesto(data.puesto || data.bio || '');
      }
      setPassword(''); // Limpiar campo de contraseña tras guardar
      // Si existe función para recargar el contexto global de usuario, invocarla aquí
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        // Disparar un evento personalizado para que AuthContext recargue datos si es necesario
        window.dispatchEvent(new Event('userProfileUpdated'));
      }
      setSuccess('Datos actualizados correctamente');
    } catch {
      setError('Error al actualizar los datos');
    } finally {
      setLoading(false);
    }
  };

  // Auto-save departamento when changed in the edit form
  useEffect(() => {
    const saveDept = async () => {
      if (!user || !departamento) return;
      try {
        const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
        await update(ref(dbToUse, `usuarios/${user.uid}`), { departamento });
        // notify global context if needed
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new Event('userProfileUpdated'));
        }
      } catch {
        // ignore for now
      }
    };
    // debounce minimal: save after user stops typing/choosing for 700ms
    const t = setTimeout(saveDept, 700);
    return () => clearTimeout(t);
  }, [departamento, ctxDb, recinto, user]);

  // Cambio de avatar con Firebase Storage
  const handleAvatarChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !user) return;
    setError('');
    setSuccess('');
    try {
      if (!file.type.startsWith('image/')) {
        setError('El archivo debe ser una imagen');
        return;
      }
      if (file.size > 2 * 1024 * 1024) { // 2MB
        setError('La imagen supera 2MB');
        return;
      }
      const { getStorage, ref: sRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const storage = getStorage();
      const storagePath = `avatars/${user.uid}/${Date.now()}-${file.name}`;
      const fileRef = sRef(storage, storagePath);
      await uploadBytes(fileRef, file, { contentType: file.type });
      const url = await getDownloadURL(fileRef);
      // Actualizar photoURL en Auth y en RTDB
      const { updateProfile } = await import('firebase/auth');
      await updateProfile(user, { photoURL: url });
      const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      await update(ref(dbToUse, `usuarios/${user.uid}`), { photoURL: url });
      // Notificar a contexto para refrescar
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new Event('userProfileUpdated'));
      }
      setSuccess('Avatar actualizado');
    } catch (err) {
      console.error('Error subiendo avatar', err);
      setError('Error al subir el avatar');
    }
  };

  // Placeholder para eliminar cuenta
  const handleDeleteAccount = () => {
    setSuccess('Funcionalidad de eliminar cuenta pendiente');
  };



  return (
    <>
      {/* Dialog for mandatory department selection on first Microsoft login */}
      <Dialog
        open={openDeptDialog}
        onClose={(e, reason) => {
          // Prevent closing the mandatory department dialog via backdrop click or escape
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
        }}
        disableEscapeKeyDown
        fullWidth
        maxWidth="xs"
        hideBackdrop={false}
        PaperProps={{ sx: dialogStyles.paper }}
      >
        <DialogTitle sx={dialogStyles.title}>Selecciona tu departamento</DialogTitle>
        <DialogContent sx={dialogStyles.content}>
          <Typography sx={{ mb: 2, color: 'text.secondary' }}>Para continuar, selecciona el departamento al que perteneces.</Typography>
          <TextField select fullWidth label="Departamento" value={selectedDeptForDialog} onChange={e => {
            const val = e.target.value;
            setSelectedDeptForDialog(val);
          }}>
            {departamentos.length === 0 ? (
              <MenuItem value="" disabled>No hay departamentos</MenuItem>
            ) : (
              departamentos.map((dep, idx) => (
                <MenuItem key={idx} value={dep}>{dep}</MenuItem>
              ))
            )}
          </TextField>
        </DialogContent>
        <DialogActions sx={dialogStyles.actions}>
          <Button disabled={!selectedDeptForDialog} onClick={handleConfirmDept} variant="contained" sx={{ fontWeight: 600 }}>Confirmar</Button>
        </DialogActions>
      </Dialog>
      
    <ModuleContainer>
      <PageHeader 
        title="Mi Perfil" 
        subtitle="Administra tu información personal y configuración"
        icon={PersonIcon}
        gradient="info"
      />
      
      {/* Stats Cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
        <StatCard
          title="Tickets Creados"
          value={ticketsCreados}
          icon={AssignmentIcon}
          gradient="primary"
        />
        <StatCard
          title="Tickets Cerrados"
          value={ticketsCerrados}
          icon={CheckCircleIcon}
          gradient="success"
        />
        <StatCard
          title="Miembro desde"
          value={fechaRegistro || '-'}
          icon={CalendarTodayIcon}
          gradient="info"
          isText
        />
      </Box>

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gap: 3,
        alignItems: 'flex-start',
        overflow: 'hidden',
      }}>
        {/* Columna 1: Info personal y actividad */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, overflow: 'hidden' }}>
          {/* Tarjeta de información personal */}
          <GlassCard sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Badge
              overlap="circular"
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              badgeContent={
                <IconButton size="small" color="primary" component="label" sx={{ 
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) }
                }}>
                  <PhotoCamera fontSize="small" />
                  <input hidden accept="image/*" type="file" onChange={handleAvatarChange} />
                </IconButton>
              }
            >
              <Avatar 
                src={user?.photoURL || ''} 
                sx={{ 
                  width: 120, 
                  height: 120, 
                  mb: 2, 
                  border: `4px solid ${theme.palette.primary.main}`,
                  boxShadow: `0 8px 24px ${alpha(theme.palette.primary.main, 0.3)}`
                }} 
              />
            </Badge>
            <Typography variant="h5" fontWeight={700}>{nombre} {apellido}</Typography>
            <Typography color="text.secondary" sx={{ mb: 1 }}>{user?.email}</Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Chip 
                label={userData?.rol || 'Sin rol'} 
                sx={{ 
                  background: gradients.primary,
                  color: '#fff',
                  fontWeight: 600
                }} 
              />
              <Chip 
                label={departamento || 'Sin departamento'} 
                sx={{ 
                  background: gradients.secondary,
                  color: '#fff',
                  fontWeight: 600
                }} 
              />
            </Box>
            <Box sx={{ width: '100%', mt: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">Perfil completo</Typography>
                <Typography variant="body2" fontWeight={600}>{perfilCompleto}%</Typography>
              </Box>
              <LinearProgress 
                variant="determinate" 
                value={perfilCompleto} 
                sx={{ 
                  height: 8, 
                  borderRadius: 4,
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 4,
                    background: gradients.primary
                  }
                }} 
              />
            </Box>
          </GlassCard>
          
          {/* Tarjeta de actividad */}
          <GlassCard sx={{ p: 3, overflow: 'hidden', minWidth: 0 }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>Últimos Tickets</Typography>
            <List dense sx={{ bgcolor: 'transparent' }}>
              {ultimosTickets.length === 0 && (
                <ListItem sx={{ py: 3, justifyContent: 'center' }}>
                  <Typography color="text.secondary">No hay tickets recientes</Typography>
                </ListItem>
              )}
              {ultimosTickets.map(t => (
                <ListItem 
                  key={t.id} 
                  sx={{ 
                    mb: 1, 
                    borderRadius: 2, 
                    bgcolor: alpha(theme.palette.background.paper, 0.5),
                    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.05) },
                    overflow: 'hidden',
                    minWidth: 0,
                  }}
                >
                  <ListItemText
                    primary={
                      <Typography 
                        fontWeight={600} 
                        sx={{ 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis', 
                          whiteSpace: 'nowrap',
                          maxWidth: '100%',
                          display: 'block'
                        }}
                      >
                        {t.descripcion}
                      </Typography>
                    }
                    secondary={
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
                        <Chip 
                          size="small" 
                          label={t.estado} 
                          color={t.estado === 'Cerrado' ? 'success' : t.estado === 'En Proceso' ? 'info' : 'warning'}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {t.fecha ? new Date(t.fecha).toLocaleDateString() : ''}
                        </Typography>
                      </Box>
                    }
                    secondaryTypographyProps={{ component: 'div' }}
                    sx={{ overflow: 'hidden', minWidth: 0 }}
                  />
                </ListItem>
              ))}
            </List>
          </GlassCard>
          
          {/* Tarjeta de acciones */}
          <GlassCard sx={{ p: 3, display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button
              variant="contained"
              onClick={() => setPassword('')}
              sx={{
                background: gradients.warning,
                color: '#fff',
                fontWeight: 600,
                '&:hover': { opacity: 0.9 }
              }}
            >
              Cambiar contraseña
            </Button>
            <Button
              variant="contained"
              onClick={handleDeleteAccount}
              sx={{
                background: gradients.error,
                color: '#fff',
                fontWeight: 600,
                '&:hover': { opacity: 0.9 }
              }}
            >
              Eliminar cuenta
            </Button>
            <Button 
              variant="outlined" 
              color="secondary" 
              onClick={logout}
              sx={{ fontWeight: 600 }}
            >
              Cerrar sesión
            </Button>
          </GlassCard>
        </Box>
        
        {/* Columna 2: Edición de datos */}
        <GlassCard sx={{ p: 3 }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 3 }}>Editar Información</Typography>
          <Box component="form" onSubmit={handleUpdate}>
            <TextField label="Nombre" fullWidth margin="normal" value={nombre} onChange={e => setNombre(e.target.value)} required />
            <TextField label="Apellido" fullWidth margin="normal" value={apellido} onChange={e => setApellido(e.target.value)} required />
            <TextField label="Teléfono" fullWidth margin="normal" value={telefono} onChange={e => setTelefono(e.target.value)} />
            <TextField label="Puesto" fullWidth margin="normal" value={puesto} onChange={e => setPuesto(e.target.value)} />
            <TextField select fullWidth margin="normal" label="Departamento" value={departamento} onChange={e => setDepartamento(e.target.value)} required>
              {departamentos.length === 0 ? (
                <MenuItem value="" disabled>No hay departamentos</MenuItem>
              ) : (
                departamentos.map((dep, idx) => (
                  <MenuItem key={idx} value={dep}>{dep}</MenuItem>
                ))
              )}
            </TextField>
            <TextField label="Nueva contraseña" fullWidth margin="normal" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
            <TextField label="Fecha de registro" fullWidth margin="normal" value={fechaRegistro} InputProps={{ readOnly: true }} />
            <Button 
              fullWidth 
              variant="contained" 
              sx={{ 
                mt: 3, 
                py: 1.5, 
                fontWeight: 700, 
                fontSize: 16, 
                background: gradients.primary,
                '&:hover': { opacity: 0.9 }
              }} 
              type="submit" 
              disabled={loading} 
              startIcon={loading && <CircularProgress size={20} color="inherit" />}
            >
              Guardar cambios
            </Button>
          </Box>
        </GlassCard>
      </Box>
    </ModuleContainer>
    </>
  );
}
