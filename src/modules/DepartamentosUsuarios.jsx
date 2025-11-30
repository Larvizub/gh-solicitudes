import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  MenuItem,
  TextField,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import GroupIcon from '@mui/icons-material/Group';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useDb } from '../context/DbContext';
import { useAuth } from '../context/useAuth';
import { ref, get, update } from 'firebase/database';
import { getDbForRecinto } from '../firebase/multiDb';
import { ModuleContainer, PageHeader, GlassCard, SectionContainer, EmptyState } from '../components/ui/SharedStyles';
import { gradients } from '../components/ui/sharedStyles.constants';
import useNotification from '../context/useNotification';

export default function DepartamentosUsuarios() {
  const { db: ctxDb, recinto } = useDb();
  const { userData } = useAuth();
  const theme = useTheme();
  const { notify } = useNotification();
  const [departamentos, setDepartamentos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [selectedDept, setSelectedDept] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Mostrar notificaciones
  useEffect(() => {
    if (success) notify(success, 'success');
    if (error) notify(error, 'error');
  }, [success, error, notify]);

  useEffect(() => {
    const fetch = async () => {
      try {
        const dbToUse = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
        if (!dbToUse) return;
        const depSnap = await get(ref(dbToUse, 'departamentos'));
        const userSnap = await get(ref(dbToUse, 'usuarios'));
        const deps = depSnap.exists() ? depSnap.val() : {};
        const users = userSnap.exists() ? userSnap.val() : {};
  // deps: { id: nombre }
  const depArray = Object.entries(deps).map(([id, nombre]) => ({ id, nombre }));
  setDepartamentos(depArray);
        setUsuarios(Object.entries(users).map(([id, u]) => ({ id, ...u })));
        if (!selectedDept && depArray.length > 0) setSelectedDept(depArray[0].id);
      } catch (e) {
        console.error('Error cargando departamentos/usuarios', e);
        setError('No se pudieron cargar departamentos o usuarios');
      }
    };
    fetch();
  }, [ctxDb, recinto, success, selectedDept]);

  const selectedDeptName = departamentos.find(d => d.id === selectedDept)?.nombre || '';

  const assigned = usuarios.filter(u => {
    const dep = u.departamento || '';
    return dep && (dep === selectedDept || dep === selectedDeptName);
  });

  const available = usuarios.filter(u => {
    const dep = u.departamento || '';
    return !dep || !(dep === selectedDept || dep === selectedDeptName);
  });

  const requireAdmin = () => {
    return !(userData?.rol === 'admin' || userData?.isSuperAdmin);
  };

  const assignUser = async (user) => {
    setError('');
    try {
      if (requireAdmin()) { setError('Solo administradores pueden asignar usuarios'); return; }
      const dbToUse = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
      if (!dbToUse) throw new Error('No DB disponible');
  // Prefer storing departamento as id for consistency; fallback to name if id missing
  const depToStore = selectedDept || selectedDeptName || '';
  await update(ref(dbToUse, `usuarios/${user.id}`), { ...user, departamento: depToStore });
      setSuccess('Usuario asignado');
      setTimeout(() => setSuccess(''), 1500);
    } catch (e) {
      console.error(e);
      setError('Error al asignar usuario');
    }
  };

  const unassignUser = async (user) => {
    setError('');
    try {
      if (requireAdmin()) { setError('Solo administradores pueden quitar asignaciones'); return; }
      const dbToUse = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
      if (!dbToUse) throw new Error('No DB disponible');
  await update(ref(dbToUse, `usuarios/${user.id}`), { ...user, departamento: '' });
      setSuccess('Asignación removida');
      setTimeout(() => setSuccess(''), 1500);
    } catch (e) {
      console.error(e);
      setError('Error al remover asignación');
    }
  };

  return (
    <ModuleContainer>
      <PageHeader 
        title="Asignación de Usuarios" 
        subtitle="Asigna usuarios a departamentos de tu organización"
        icon={<GroupIcon />}
        gradient={gradients.secondary}
      />
      
      <GlassCard sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Seleccionar Departamento</Typography>
        <TextField
          select
          label="Departamento"
          fullWidth
          value={selectedDept}
          onChange={e => setSelectedDept(e.target.value)}
          sx={{ maxWidth: 400 }}
        >
          {departamentos.length === 0 ? <MenuItem value="" disabled>No hay departamentos</MenuItem> : departamentos.map((d) => (
            <MenuItem key={d.id} value={d.id}>{d.nombre}</MenuItem>
          ))}
        </TextField>
      </GlassCard>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        <SectionContainer title={`Usuarios asignados a "${selectedDeptName || '—'}"`} icon={<GroupIcon />}>
          {assigned.length === 0 ? (
            <EmptyState message="No hay usuarios asignados a este departamento" icon={<GroupIcon />} />
          ) : (
            <List>
              {assigned.map(u => (
                <ListItem 
                  key={u.id} 
                  sx={{ 
                    mb: 1, 
                    borderRadius: 2, 
                    bgcolor: alpha(theme.palette.background.paper, 0.6),
                    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                    '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.05) }
                  }}
                >
                  <ListItemText 
                    primary={<Typography fontWeight={600}>{`${u.nombre || ''} ${u.apellido || ''}`.trim() || u.email}</Typography>} 
                    secondary={u.email} 
                  />
                  <ListItemSecondaryAction>
                    <IconButton 
                      edge="end" 
                      onClick={() => unassignUser(u)} 
                      size="small"
                      sx={{ 
                        color: theme.palette.error.main,
                        '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.1) }
                      }}
                    >
                      <RemoveIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </SectionContainer>

        <SectionContainer title="Usuarios disponibles" icon={<PersonAddIcon />}>
          {available.length === 0 ? (
            <EmptyState message="No hay usuarios disponibles para asignar" icon={<PersonAddIcon />} />
          ) : (
            <List>
              {available.map(u => (
                <ListItem 
                  key={u.id} 
                  sx={{ 
                    mb: 1, 
                    borderRadius: 2, 
                    bgcolor: alpha(theme.palette.background.paper, 0.6),
                    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                    '&:hover': { bgcolor: alpha(theme.palette.success.main, 0.05) }
                  }}
                >
                  <ListItemText 
                    primary={<Typography fontWeight={600}>{`${u.nombre || ''} ${u.apellido || ''}`.trim() || u.email}</Typography>} 
                    secondary={u.email} 
                  />
                  <ListItemSecondaryAction>
                    <IconButton 
                      edge="end" 
                      onClick={() => assignUser(u)} 
                      size="small"
                      sx={{ 
                        color: theme.palette.success.main,
                        '&:hover': { bgcolor: alpha(theme.palette.success.main, 0.1) }
                      }}
                    >
                      <AddIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </SectionContainer>
      </Box>
    </ModuleContainer>
  );
}
