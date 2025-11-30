import React, { useEffect, useState } from "react";
import {
  Box,
  IconButton,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  alpha,
  useTheme,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import BusinessIcon from "@mui/icons-material/Business";
import { DataGrid } from "@mui/x-data-grid";
import { ref, get, set, remove, push } from "firebase/database";
import { useDb } from '../context/DbContext';
import { getDbForRecinto } from '../firebase/multiDb';
import { 
  PageHeader, 
  GlassCard, 
  ModuleContainer, 
} from '../components/ui/SharedStyles';
import { tableStyles, dialogStyles } from '../components/ui/sharedStyles.constants';
import useNotification from '../context/useNotification';

export default function Departamentos() {
  const { db: ctxDb, recinto } = useDb();
  const [departamentos, setDepartamentos] = useState([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [nombre, setNombre] = useState("");
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const notify = useNotification();
  const theme = useTheme();

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

  // Cargar departamentos
  const fetchDepartamentos = React.useCallback(async () => {
    setLoading(true);
    try {
      const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
      if (!dbInstance) return;
      const snapshot = await get(ref(dbInstance, "departamentos"));
      if (snapshot.exists()) {
        const data = snapshot.val();
        setDepartamentos(
          Object.entries(data).map(([id, nombre]) => ({ id, nombre }))
        );
      } else {
        setDepartamentos([]);
      }
    } finally {
      setLoading(false);
    }
  }, [ctxDb, recinto]);

  useEffect(() => {
    fetchDepartamentos();
  }, [success, fetchDepartamentos]);

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
        await set(ref(dbInstance, `departamentos/${editId}`), nombre);
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
    { field: "nombre", headerName: "Nombre", flex: 1, minWidth: 200 },
    {
      field: "acciones",
      headerName: "Acciones",
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <IconButton
            onClick={() => handleOpenDialog(params.row)}
            sx={{ color: theme.palette.primary.main }}
          >
            <EditIcon />
          </IconButton>
          <IconButton 
            onClick={() => handleDelete(params.row.id)} 
            sx={{ color: theme.palette.error.main }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

  return (
    <ModuleContainer maxWidth="900px">
      <PageHeader
        title="Departamentos"
        subtitle={`${departamentos.length} departamentos registrados`}
        icon={BusinessIcon}
        gradient="secondary"
        onRefresh={fetchDepartamentos}
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenDialog()}
            sx={{
              bgcolor: alpha('#fff', 0.2),
              color: '#fff',
              fontWeight: 700,
              '&:hover': { bgcolor: alpha('#fff', 0.3) },
            }}
          >
            Agregar
          </Button>
        }
      />

      <GlassCard>
        <Box sx={tableStyles.container(theme)}>
          <DataGrid
            rows={departamentos}
            columns={columns}
            pageSize={10}
            rowsPerPageOptions={[5, 10, 20]}
            disableSelectionOnClick
            getRowId={(row) => row.id}
            loading={loading}
            localeText={{ noRowsLabel: 'No hay departamentos registrados' }}
            sx={{
              border: 'none',
              minHeight: 400,
              '& .MuiDataGrid-cell': {
                fontSize: { xs: '0.9rem', sm: '0.95rem' },
              },
            }}
          />
        </Box>
      </GlassCard>

      <Dialog 
        open={openDialog} 
        onClose={() => setOpenDialog(false)} 
        fullWidth 
        maxWidth="xs"
        PaperProps={{ sx: dialogStyles.paper }}
      >
        <DialogTitle sx={dialogStyles.title('secondary')(theme)}>
          {editId ? 'Editar Departamento' : 'Nuevo Departamento'}
        </DialogTitle>
        <DialogContent sx={dialogStyles.content}>
          <TextField
            autoFocus
            margin="dense"
            label="Nombre del departamento"
            fullWidth
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions sx={dialogStyles.actions}>
          <Button onClick={() => setOpenDialog(false)} variant="contained" color="error" sx={{ fontWeight: 600 }}>
            Cancelar
          </Button>
          <Button onClick={handleSave} variant="contained" sx={{ fontWeight: 600 }}>
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </ModuleContainer>
  );
}
