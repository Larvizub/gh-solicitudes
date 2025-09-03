
import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  MenuItem,
  Paper,
  CircularProgress,
} from '@mui/material';
import Avatar from '@mui/material/Avatar';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import { DataGrid } from '@mui/x-data-grid';
import { ref as dbRef, get, set, remove, update, push } from 'firebase/database';
import { storage } from '../firebase/firebaseConfig';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../context/useAuth';
import { useDb } from '../context/DbContext';
import useNotification from '../context/useNotification';
import { getDbForRecinto } from '../firebase/multiDb';

export default function Usuarios() {
  const { userData } = useAuth();
  const { db: ctxDb, recinto } = useDb();
  const [usuarios, setUsuarios] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [loading, setLoading] = useState(false); // Se agrega el botón de refrescar
  const [openDialog, setOpenDialog] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ nombre: '', apellido: '', email: '', departamento: '', rol: 'estandar' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const notify = useNotification();

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

  // Cargar usuarios y departamentos
  // Reusable fetch function so UI can trigger refresh
  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      // Usuarios
      const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      const snap = await get(dbRef(dbToUse, 'usuarios'));
      if (snap.exists()) {
        const data = snap.val();
        setUsuarios(Object.entries(data).map(([id, u]) => ({ id, ...u })));
      } else {
        setUsuarios([]);
      }
      // Departamentos
      const depSnap = await get(dbRef(dbToUse, 'departamentos'));
      if (depSnap.exists()) {
        const data = depSnap.val();
        setDepartamentos(Object.values(data));
      } else {
        setDepartamentos([]);
      }
    } catch (err) {
      setError(err?.message || 'Error cargando usuarios');
    } finally {
      setLoading(false);
    }
  }, [ctxDb, recinto]);

  useEffect(() => {
    fetchData();
    // re-run when success (after create/delete) or when fetchData changes
  }, [success, fetchData]);

  const handleRefresh = () => {
    fetchData();
  };

  // Abrir diálogo para agregar/editar
  const handleOpenDialog = (usuario = null) => {
    setError('');
    setSuccess('');
    if (usuario) {
      setEditId(usuario.id);
      setForm({
        nombre: usuario.nombre || '',
        apellido: usuario.apellido || '',
        email: usuario.email || '',
        departamento: usuario.departamento || '',
        rol: usuario.rol || 'estandar',
      });
  setPreviewUrl(usuario.photoURL || '');
  setSelectedFile(null);
    } else {
      setEditId(null);
      setForm({ nombre: '', apellido: '', email: '', departamento: '', rol: 'estandar' });
  setPreviewUrl('');
  setSelectedFile(null);
    }
    setOpenDialog(true);
  };

  // Guardar usuario (crear o editar)
  const handleSave = async () => {
    if (!form.nombre.trim() || !form.apellido.trim() || !form.email.trim() || !form.departamento.trim()) {
  try { notify('Todos los campos son obligatorios', 'error', { mode: 'toast', persist: true }); } catch { setError('Todos los campos son obligatorios'); }
      return;
    }
    try {
      const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
      if (editId) {
  // Update existing user; upload photo first if provided
  if (selectedFile) {
    setUploading(true);
    const sRef = storageRef(storage, `${recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA'}/usuarios/${editId}/${selectedFile.name}`);
    await uploadBytes(sRef, selectedFile);
    const url = await getDownloadURL(sRef);
    await update(dbRef(dbToUse, `usuarios/${editId}`), { ...form, photoURL: url });
    setUploading(false);
  } else {
    await update(dbRef(dbToUse, `usuarios/${editId}`), form);
  }
        setSuccess('Usuario actualizado');
      } else {
        // Crear nuevo usuario
  const newRef = push(dbRef(dbToUse, 'usuarios'));
  await set(newRef, form);
  if (selectedFile) {
    setUploading(true);
    const id = newRef.key;
    const sRef = storageRef(storage, `${recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA'}/usuarios/${id}/${selectedFile.name}`);
    await uploadBytes(sRef, selectedFile);
    const url = await getDownloadURL(sRef);
    await update(dbRef(dbToUse, `usuarios/${id}`), { photoURL: url });
    setUploading(false);
  }
        setSuccess('Usuario agregado');
      }
      setOpenDialog(false);
      setSelectedFile(null);
      setPreviewUrl('');
    } catch {
      setError('Error al guardar');
    }
  };

  // Eliminar usuario
  const handleDelete = async (id) => {
    try {
  const dbToUse = ctxDb || await getDbForRecinto(recinto || localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA');
  await remove(dbRef(dbToUse, `usuarios/${id}`));
      setSuccess('Usuario eliminado');
    } catch {
      setError('Error al eliminar');
    }
  };

  // Columnas para DataGrid
  const columns = [
    { field: 'nombre', headerName: 'Nombre', flex: 1 },
    { field: 'apellido', headerName: 'Apellido', flex: 1 },
    { field: 'email', headerName: 'Correo', flex: 1 },
    { field: 'departamento', headerName: 'Departamento', flex: 1 },
    { field: 'rol', headerName: 'Rol', flex: 1 },
    userData?.rol === 'admin' && {
      field: 'acciones',
      headerName: 'Acciones',
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <IconButton onClick={() => handleOpenDialog(params.row)} sx={{ '& .MuiSvgIcon-root': { color: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined } }}>
            <EditIcon />
          </IconButton>
          <IconButton onClick={() => handleDelete(params.row.id)} sx={{ '& .MuiSvgIcon-root': { color: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined } }}>
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ].filter(Boolean);

  return (
    <Box
      sx={{
        p: { xs: 1, sm: 2 },
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
        minHeight: '90vh',
        width: { xs: '100%', md: '80vw' },
        maxWidth: '100vw',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
        Usuarios
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      <Paper elevation={1} sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 8px 0 rgba(0,0,0,0.04)', mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1, gap: 1 }}>
          {userData?.rol === 'admin' && (
            <>
              <Button
                variant="outlined"
                startIcon={loading ? <CircularProgress size={18} /> : <RefreshIcon />}
                onClick={handleRefresh}
                sx={{ borderRadius: 2, fontWeight: 500 }}
              >
                Refrescar
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => handleOpenDialog()}
                sx={{ borderRadius: 2, fontWeight: 500, bgcolor: theme => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined, color: theme => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : undefined, '& .MuiSvgIcon-root': { color: theme => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : 'inherit' } }}
              >
                Agregar
              </Button>
            </>
          )}
        </Box>
          <DataGrid
          rows={usuarios}
          columns={columns}
          pageSize={10}
          rowsPerPageOptions={[5, 10, 20]}
          disableSelectionOnClick
          getRowId={(row) => row.id}
          localeText={{ noRowsLabel: 'No hay usuarios' }}
          sx={{
            backgroundColor: 'background.paper',
            borderRadius: 2,
            boxShadow: '0 2px 8px 0 rgba(0,0,0,0.04)',
            '& .MuiDataGrid-columnHeaders': {
              background: theme => theme.palette.mode === 'dark' ? theme.palette.background.paper : 'linear-gradient(90deg, #e3e6ec 0%, #f5f6fa 100%)',
              color: theme => theme.palette.text.primary,
              fontWeight: 700,
              fontSize: '1.05rem',
              letterSpacing: 0.5,
              borderTopLeftRadius: 8,
              borderTopRightRadius: 8,
              textShadow: 'none',
            },
            '& .MuiDataGrid-row:hover': {
              backgroundColor: theme => theme.palette.action.hover,
            },
            '& .MuiDataGrid-cell': {
              fontSize: { xs: '0.95rem', sm: '1rem' },
            },
            minHeight: 400,
          }}
        />
      </Paper>
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} fullWidth maxWidth="xs">
        <DialogTitle>{editId ? 'Editar Usuario' : 'Agregar Usuario'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Nombre"
            fullWidth
            value={form.nombre}
            onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
          />
          <TextField
            margin="dense"
            label="Apellido"
            fullWidth
            value={form.apellido}
            onChange={e => setForm(f => ({ ...f, apellido: e.target.value }))}
          />
          {/* Foto de perfil */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, mb: 1 }}>
            <Avatar src={previewUrl} sx={{ width: 64, height: 64 }} />
            <Button component="label" variant="outlined">
              Seleccionar foto
              <input hidden accept="image/*" type="file" onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) {
                  setSelectedFile(f);
                  try { setPreviewUrl(URL.createObjectURL(f)); } catch { setPreviewUrl(''); }
                }
              }} />
            </Button>
            {uploading && <Typography variant="body2">Subiendo...</Typography>}
          </Box>
          <TextField
            margin="dense"
            label="Correo"
            fullWidth
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            disabled={!!editId}
          />
          <TextField
            select
            margin="dense"
            label="Departamento"
            fullWidth
            value={form.departamento}
            onChange={e => setForm(f => ({ ...f, departamento: e.target.value }))}
          >
            {departamentos.length === 0 ? (
              <MenuItem value="" disabled>No hay departamentos</MenuItem>
            ) : (
              departamentos.map((dep, idx) => (
                <MenuItem key={idx} value={dep}>{dep}</MenuItem>
              ))
            )}
          </TextField>
          <TextField
            select
            margin="dense"
            label="Rol"
            fullWidth
            value={form.rol}
            onChange={e => setForm(f => ({ ...f, rol: e.target.value }))}
          >
            <MenuItem value="estandar">Estandar</MenuItem>
            <MenuItem value="admin">Admin</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)} variant="contained" color="error">Cancelar</Button>
          <Button onClick={handleSave} variant="contained">Guardar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
