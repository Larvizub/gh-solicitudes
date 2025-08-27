import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  MenuItem,
  TextField,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { useDb } from '../context/DbContext';
import { useAuth } from '../context/useAuth';
import { ref, get, update } from 'firebase/database';
import { getDbForRecinto } from '../firebase/multiDb';

export default function DepartamentosUsuarios() {
  const { db: ctxDb, recinto } = useDb();
  const { userData } = useAuth();
  const [departamentos, setDepartamentos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [selectedDept, setSelectedDept] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
    <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      <Paper sx={{ p: 2, width: { xs: '100%', md: 320 } }} elevation={2}>
        <Typography variant="h6" sx={{ mb: 1 }}>Departamentos</Typography>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 1 }}>{success}</Alert>}
        <TextField
          select
          label="Seleccione departamento"
          fullWidth
          value={selectedDept}
          onChange={e => setSelectedDept(e.target.value)}
        >
          {departamentos.length === 0 ? <MenuItem value="" disabled>No hay departamentos</MenuItem> : departamentos.map((d) => (
            <MenuItem key={d.id} value={d.id}>{d.nombre}</MenuItem>
          ))}
        </TextField>
      </Paper>

      <Paper sx={{ p: 2, flex: 1, minWidth: 320 }} elevation={2}>
  <Typography variant="h6" sx={{ mb: 1 }}>Usuarios asignados a "{selectedDeptName || '—'}"</Typography>
        <List>
          {assigned.length === 0 ? <ListItem><ListItemText primary="No hay usuarios asignados" /></ListItem> : assigned.map(u => (
            <ListItem key={u.id} divider>
              <ListItemText primary={`${u.nombre || ''} ${u.apellido || ''}`.trim() || u.email} secondary={u.email} />
              <ListItemSecondaryAction>
                <IconButton edge="end" onClick={() => unassignUser(u)} size="small">
                  <RemoveIcon />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      </Paper>

      <Paper sx={{ p: 2, flex: 1, minWidth: 320 }} elevation={2}>
        <Typography variant="h6" sx={{ mb: 1 }}>Usuarios disponibles</Typography>
        <List>
          {available.length === 0 ? <ListItem><ListItemText primary="No hay usuarios disponibles" /></ListItem> : available.map(u => (
            <ListItem key={u.id} divider>
              <ListItemText primary={`${u.nombre || ''} ${u.apellido || ''}`.trim() || u.email} secondary={u.email} />
              <ListItemSecondaryAction>
                <IconButton edge="end" onClick={() => assignUser(u)} size="small">
                  <AddIcon />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  );
}
