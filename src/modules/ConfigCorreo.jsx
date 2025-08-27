import React, { useEffect, useState } from 'react';
import { Box, Typography, Paper, TextField, Button, Chip, MenuItem, Alert } from '@mui/material';
import { ref, get, set } from 'firebase/database';
import { useDb } from '../context/DbContext';
import { getDbForRecinto } from '../firebase/multiDb';

export default function ConfigCorreo() {
  const { db: ctxDb, recinto } = useDb();
  const [departamentos, setDepartamentos] = useState([]);
  const [selectedDep, setSelectedDep] = useState('');
  const [pool, setPool] = useState([]);
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const load = async () => {
  const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
  if (!dbInstance) return;
  const depSnap = await get(ref(dbInstance, 'departamentos'));
      if (depSnap.exists()) {
        const deps = Object.entries(depSnap.val()).map(([id, nombre]) => ({ id, nombre }));
        setDepartamentos(deps);
      }
    };
    load();
  }, [ctxDb, recinto]);

  useEffect(() => {
    const loadPool = async () => {
      if (!selectedDep) { setPool([]); return; }
  const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
  if (!dbInstance) { setPool([]); return; }
  const snap = await get(ref(dbInstance, `configCorreo/departamentos/${selectedDep}/pool`));
      if (snap.exists()) {
        const val = snap.val();
        const emails = Array.isArray(val) ? val : Object.values(val || {});
        setPool(emails);
      } else {
        setPool([]);
      }
    };
    loadPool();
  }, [selectedDep, ctxDb, recinto]);

  const addEmail = () => {
    const email = input.trim();
    if (!email) return;
    if (pool.includes(email)) return;
    setPool(p => [...p, email]);
    setInput('');
  };

  const removeEmail = (email) => setPool(p => p.filter(e => e !== email));

  const save = async () => {
    if (!selectedDep) return;
  const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
  if (!dbInstance) return;
  await set(ref(dbInstance, `configCorreo/departamentos/${selectedDep}/pool`), pool);
    setMsg('Pool actualizado');
    setTimeout(() => setMsg(''), 2000);
  };

  return (
    <Box sx={{ p: { xs: 1, sm: 2 } }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Configuración de Correo</Typography>
      {msg && <Alert severity="success" sx={{ mb: 2 }}>{msg}</Alert>}
      <Paper sx={{ p: 2, mb: 2 }}>
        <TextField
          select
          label="Departamento"
          value={selectedDep}
          onChange={e => setSelectedDep(e.target.value)}
          sx={{ minWidth: 260 }}
        >
          {departamentos.map(dep => (
            <MenuItem key={dep.id} value={dep.id}>{dep.nombre}</MenuItem>
          ))}
        </TextField>
      </Paper>
      {selectedDep && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>Pool de correos</Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              fullWidth
              size="small"
              label="Agregar correo"
              value={input}
              onChange={e => setInput(e.target.value)}
            />
            <Button variant="contained" onClick={addEmail} sx={{ '&.MuiButton-contained': { backgroundColor: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined, color: (theme) => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : undefined } }}>Agregar</Button>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            {pool.map(email => (
              <Chip key={email} label={email} onDelete={() => removeEmail(email)} sx={{ background: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined, color: (theme) => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : undefined }} />
            ))}
          </Box>
          <Button variant="contained" onClick={save} sx={{ '&.MuiButton-contained': { backgroundColor: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined, color: (theme) => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : undefined } }}>Guardar</Button>
        </Paper>
      )}
    </Box>
  );
}
