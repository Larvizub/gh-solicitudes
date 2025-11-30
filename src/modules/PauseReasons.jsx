import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, MenuItem, List, ListItem, ListItemText, ListItemSecondaryAction, Divider, IconButton } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { ref as dbRef, get, push, remove } from 'firebase/database';
import { useDb } from '../context/DbContext';
import { getDbForRecinto } from '../firebase/multiDb';
import { ModuleContainer, PageHeader, GlassCard, SectionContainer, EmptyState, gradients } from '../components/ui/SharedStyles';
import useNotification from '../context/useNotification';

export default function PauseReasons() {
  const { db: ctxDb, recinto } = useDb();
  const theme = useTheme();
  const { notify } = useNotification();
  const [departamentos, setDepartamentos] = useState([]);
  const [selectedDep, setSelectedDep] = useState('');
  const [reasons, setReasons] = useState([]);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [error, setError] = useState('');

  // Mostrar notificaciones
  useEffect(() => {
    if (error) notify(error, 'error');
  }, [error, notify]);

  useEffect(() => {
    let mounted = true;
    const loadDeps = async () => {
      try {
        const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
        const depSnap = await get(dbRef(dbInstance, 'departamentos'));
        if (!mounted) return;
        if (depSnap.exists()) {
          const depVal = depSnap.val();
          const deps = Object.entries(depVal).map(([id, v]) => ({ id, nombre: typeof v === 'string' ? v : (v?.nombre || v?.name || id) }));
          setDepartamentos(deps);
          if (!selectedDep && deps.length) setSelectedDep(deps[0].id);
        }
      } catch (e) {
        console.warn('Error cargando departamentos', e);
      }
    };
    loadDeps();
    return () => { mounted = false; };
  }, [ctxDb, recinto, selectedDep]);

  useEffect(() => {
    let mounted = true;
    const loadReasons = async () => {
      if (!selectedDep) { setReasons([]); return; }
      try {
        const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
        const snap = await get(dbRef(dbInstance, `pauseReasons/${selectedDep}`));
        if (!mounted) return;
        if (snap.exists()) {
          const val = snap.val();
          setReasons(Object.entries(val).map(([id, v]) => ({ id, ...v })));
        } else {
          setReasons([]);
        }
      } catch (e) {
        console.warn('Error cargando motivos', e);
        setReasons([]);
      } finally {
        // noop
      }
    };
    loadReasons();
    return () => { mounted = false; };
  }, [selectedDep, ctxDb, recinto]);

  const handleAdd = async () => {
    if (!newName.trim()) { setError('Nombre requerido'); return; }
    setError('');
    try {
      const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      await push(dbRef(dbInstance, `pauseReasons/${selectedDep}`), { nombre: newName.trim(), descripcion: newDesc.trim() });
      setNewName(''); setNewDesc('');
      notify('Motivo agregado correctamente', 'success');
      // reload
      const snap = await get(dbRef(dbInstance, `pauseReasons/${selectedDep}`));
      if (snap.exists()) setReasons(Object.entries(snap.val()).map(([id, v]) => ({ id, ...v })));
    } catch (e) {
      console.error('Error agregando motivo', e);
      setError('Error al agregar motivo');
    }
  };

  const handleDelete = async (id) => {
    try {
      const dbInstance = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      await remove(dbRef(dbInstance, `pauseReasons/${selectedDep}/${id}`));
      setReasons(r => r.filter(x => x.id !== id));
      notify('Motivo eliminado', 'success');
    } catch (e) {
      console.error('Error eliminando motivo', e);
      setError('Error al eliminar motivo');
    }
  };

  return (
    <ModuleContainer>
      <PageHeader 
        title="Motivos de Pausa" 
        subtitle="Configura los motivos de pausa disponibles por departamento"
        icon={<PauseCircleIcon />}
        gradient={gradients.orange}
      />
      
      <GlassCard sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField 
            select 
            label="Departamento" 
            value={selectedDep} 
            onChange={e => setSelectedDep(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            {departamentos.map(d => <MenuItem key={d.id} value={d.id}>{d.nombre}</MenuItem>)}
          </TextField>
        </Box>
      </GlassCard>
      
      <SectionContainer title="Agregar Nuevo Motivo" icon={<AddIcon />}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <TextField 
            label="Nombre" 
            value={newName} 
            onChange={e => setNewName(e.target.value)} 
            sx={{ flex: 1, minWidth: 200 }}
          />
          <TextField 
            label="Descripción" 
            value={newDesc} 
            onChange={e => setNewDesc(e.target.value)} 
            sx={{ flex: 2, minWidth: 250 }}
          />
          <Button 
            variant="contained" 
            onClick={handleAdd}
            startIcon={<AddIcon />}
            sx={{ 
              background: gradients.success, 
              px: 3,
              '&:hover': { opacity: 0.9 }
            }}
          >
            Agregar
          </Button>
        </Box>
      </SectionContainer>
      
      <SectionContainer title="Motivos Configurados" icon={<PauseCircleIcon />}>
        {reasons.length === 0 ? (
          <EmptyState message="No hay motivos de pausa configurados para este departamento" icon={<PauseCircleIcon />} />
        ) : (
          <List>
            {reasons.map(r => (
              <ListItem
                key={r.id}
                sx={{ 
                  mb: 1, 
                  borderRadius: 2, 
                  bgcolor: alpha(theme.palette.background.paper, 0.6),
                  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  '&:hover': { bgcolor: alpha(theme.palette.warning.main, 0.05) }
                }}
              >
                <ListItemText 
                  primary={<Typography fontWeight={600}>{r.nombre}</Typography>} 
                  secondary={r.descripcion} 
                />
                <ListItemSecondaryAction>
                  <IconButton 
                    edge="end" 
                    onClick={() => handleDelete(r.id)}
                    sx={{ 
                      color: theme.palette.error.main,
                      '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.1) }
                    }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </SectionContainer>
    </ModuleContainer>
  );
}
