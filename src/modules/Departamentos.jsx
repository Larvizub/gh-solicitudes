import React, { useEffect, useState } from "react";
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
  Paper,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import { DataGrid } from "@mui/x-data-grid";
import { ref, get, set, remove, update, push } from "firebase/database";
import { useDb } from '../context/DbContext';
import { getDbForRecinto } from '../firebase/multiDb';

export default function Departamentos() {
  const { db: ctxDb, recinto } = useDb();
  const [departamentos, setDepartamentos] = useState([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [nombre, setNombre] = useState("");
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Cargar departamentos
  useEffect(() => {
    const fetchDepartamentos = async () => {
  const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
  if (!dbInstance) return;
  const snapshot = await get(ref(dbInstance, "departamentos"));
      if (snapshot.exists()) {
        const data = snapshot.val();
        // Guardar como array de objetos {id, nombre}
        setDepartamentos(
          Object.entries(data).map(([id, nombre]) => ({ id, nombre }))
        );
      } else {
        setDepartamentos([]);
      }
    };
    fetchDepartamentos();
  }, [success, ctxDb, recinto]);

  // Abrir diálogo para agregar o editar
  const handleOpenDialog = (dep = null) => {
    setError("");
    setSuccess("");
    if (dep) {
      setEditId(dep.id);
      setNombre(dep.nombre);
    } else {
      setEditId(null);
      setNombre("");
    }
    setOpenDialog(true);
  };

  // Guardar departamento
  const handleSave = async () => {
    if (!nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    try {
      const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
      if (!dbInstance) throw new Error('No DB');
      // Evitar duplicados (comparación insensible a mayúsculas/minúsculas y espacios)
      const nameNormalized = String(nombre || '').trim().toLowerCase();
      const depsSnap = await get(ref(dbInstance, 'departamentos'));
      if (depsSnap.exists()) {
        const entries = Object.entries(depsSnap.val()); // [ [id, nombre], ... ]
  const found = entries.find(([, nm]) => String(nm || '').trim().toLowerCase() === nameNormalized);
        if (found) {
          const foundId = found[0];
          if (!editId || foundId !== editId) {
            setError('Ya existe un departamento con ese nombre');
            return;
          }
        }
      }
      if (editId) {
        await update(ref(dbInstance, `departamentos/${editId}`), nombre);
        setSuccess("Departamento actualizado");
      } else {
        const newRef = push(ref(dbInstance, "departamentos"));
        await set(newRef, nombre);
        setSuccess("Departamento agregado");
      }
      setOpenDialog(false);
    } catch {
      setError("Error al guardar");
    }
  };

  // Eliminar departamento
  const handleDelete = async (id) => {
    try {
  const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
  if (!dbInstance) throw new Error('No DB');
  await remove(ref(dbInstance, `departamentos/${id}`));
      setSuccess("Departamento eliminado");
    } catch {
      setError("Error al eliminar");
    }
  };

  // Columnas para DataGrid
  const columns = [
    { field: "nombre", headerName: "Nombre", flex: 1 },
    {
      field: "acciones",
      headerName: "Acciones",
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <IconButton
            onClick={() => handleOpenDialog(params.row)}
            sx={{ '& .MuiSvgIcon-root': { color: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined } }}
          >
            <EditIcon />
          </IconButton>
          <IconButton onClick={() => handleDelete(params.row.id)} sx={{ '& .MuiSvgIcon-root': { color: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined } }}>
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

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
        Departamentos
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      <Paper elevation={1} sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 8px 0 rgba(0,0,0,0.04)', mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenDialog()}
            sx={{
              borderRadius: 2,
              fontWeight: 500,
              bgcolor: theme => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined,
              color: theme => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : undefined,
              '& .MuiSvgIcon-root': { color: theme => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : 'inherit' },
            }}
          >
            Agregar
          </Button>
        </Box>
  <DataGrid
          rows={departamentos}
          columns={columns}
          pageSize={10}
          rowsPerPageOptions={[5, 10, 20]}
          disableSelectionOnClick
          getRowId={(row) => row.id}
          localeText={{ noRowsLabel: 'No hay departamentos' }}
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
        <DialogTitle>{editId ? 'Editar Departamento' : 'Agregar Departamento'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Nombre"
            fullWidth
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)} variant="contained" color="error">Cancelar</Button>
          <Button onClick={handleSave} variant="contained">Guardar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
