import React, { useEffect, useState } from 'react';
import { Box, Typography, Paper, TextField, Button, MenuItem, List, ListItem, ListItemText, Divider, Alert } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ref as dbRef, get, push, remove } from 'firebase/database';
import { useDb } from '../context/DbContext';
import { getDbForRecinto } from '../firebase/multiDb';

export default function PauseReasons() {
  const { db: ctxDb, recinto } = useDb();
  const theme = useTheme();
  const [departamentos, setDepartamentos] = useState([]);
  const [selectedDep, setSelectedDep] = useState('');
  const [reasons, setReasons] = useState([]);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [error, setError] = useState('');
  // loading state not required in this simple UI

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
    } catch (e) {
      console.error('Error eliminando motivo', e);
      setError('Error al eliminar motivo');
    }
  };

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Motivos de Pausa por Departamento</Typography>
      <Paper sx={{ p: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
          <TextField select label="Departamento" value={selectedDep} onChange={e => setSelectedDep(e.target.value)}>
            {departamentos.map(d => <MenuItem key={d.id} value={d.id}>{d.nombre}</MenuItem>)}
          </TextField>
        </Box>
        <Divider sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <TextField label="Nombre" value={newName} onChange={e => setNewName(e.target.value)} />
          <TextField label="Descripción" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
          <Button variant="contained" onClick={handleAdd}>Agregar</Button>
        </Box>
        <List>
          {reasons.map(r => {
            const isDark = theme?.palette?.mode === 'dark';
            return (
              <ListItem
                key={r.id}
                secondaryAction={
                  isDark ? (
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => handleDelete(r.id)}
                      sx={{ color: '#000000ff', borderColor: 'rgba(255,255,255,0.23)' }}
                    >
                      Eliminar
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      size="small"
                      color="error"
                      onClick={() => handleDelete(r.id)}
                    >
                      Eliminar
                    </Button>
                  )
                }
              >
                <ListItemText primary={r.nombre} secondary={r.descripcion} />
              </ListItem>
            );
          })}
        </List>
      </Paper>
    </Box>
  );
}
