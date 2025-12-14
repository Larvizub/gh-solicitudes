import React from 'react';
import { useEffect, useState } from "react";
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
  Grid,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Avatar,
  alpha,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CategoryIcon from "@mui/icons-material/Category";
import { ref, get, set, remove, push } from "firebase/database";
import { useDb } from "../context/DbContext";
import { getDbForRecinto } from "../firebase/multiDb";
import { 
  PageHeader, 
  GlassCard, 
  ModuleContainer, 
  SectionContainer,
  EmptyState 
} from '../components/ui/SharedStyles';
import { dialogStyles } from '../components/ui/sharedStyles.constants';
import useNotification from '../context/useNotification';

export default function ConfigTickets() {
  const { db: ctxDb, recinto, tiposTickets: tiposFromCtx } = useDb();
  const [departamentos, setDepartamentos] = useState([]);
  const [tipos, setTipos] = useState({}); // { depId: [ {id, nombre} ] }
  const [openDialog, setOpenDialog] = useState(false);
  const [nuevoTipo, setNuevoTipo] = useState("");
  const [depActivo, setDepActivo] = useState(null);
  const [editTipo, setEditTipo] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
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

  // Cargar departamentos y tipos de tickets
  useEffect(() => {
    const fetchData = async () => {
  const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
  if (!dbInstance) return;
      // Departamentos
  const depSnap = await get(ref(dbInstance, "departamentos"));
      let deps = [];
      if (depSnap.exists()) {
        deps = Object.entries(depSnap.val()).map(([id, nombre]) => ({ id, nombre }));
        setDepartamentos(deps);
      } else {
        setDepartamentos([]);
      }
      // Tipos por departamento: preferir datos en contexto (suscripción en tiempo real)
      if (tiposFromCtx && Object.keys(tiposFromCtx).length) {
        setTipos(tiposFromCtx);
      } else {
        const tiposSnap = await get(ref(dbInstance, "tiposTickets"));
        if (tiposSnap.exists()) setTipos(tiposSnap.val()); else setTipos({});
      }
    };
    fetchData();
  }, [success, ctxDb, recinto, tiposFromCtx]);

  // Abrir diálogo para agregar/editar tipo
  const handleOpenDialog = (depId, tipo = null) => {
    setError("");
    setSuccess("");
    setDepActivo(depId);
    setEditTipo(tipo);
    setNuevoTipo(tipo ? tipo.nombre : "");
    setOpenDialog(true);
  };

  // Guardar tipo de ticket
  const handleSaveTipo = async () => {
    if (!nuevoTipo.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    try {
      const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
      if (!dbInstance) throw new Error('No DB');
      if (editTipo) {
        // Editar
        await set(ref(dbInstance, `tiposTickets/${depActivo}/${editTipo.id}`), nuevoTipo);
        setSuccess("Tipo actualizado");
      } else {
        // Agregar
        const newRef = push(ref(dbInstance, `tiposTickets/${depActivo}`));
        await set(newRef, nuevoTipo);
        setSuccess("Tipo agregado");
      }
      setOpenDialog(false);
    } catch {
      setError("Error al guardar");
    }
  };

  // Eliminar tipo
  const handleDeleteTipo = async (depId, tipoId) => {
    try {
      const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
      if (!dbInstance) throw new Error('No DB');
      await remove(ref(dbInstance, `tiposTickets/${depId}/${tipoId}`));
      // Optimistically update local state so UI refleje el cambio inmediatamente
      setTipos(prev => {
        const next = { ...(prev || {}) };
        if (next[depId]) {
          const obj = { ...(next[depId] || {}) };
          delete obj[tipoId];
          if (Object.keys(obj).length) next[depId] = obj;
          else delete next[depId];
        }
        return next;
      });
      setSuccess('Tipo eliminado');
      setError('');
    } catch (e) {
        // removed console.error for delete errors
      setError("Error al eliminar");
    }
  };

  // Construir lista plana de tipos para la tabla
  const tiposTabla = departamentos.flatMap(dep =>
    tipos[dep.id]
      ? Object.entries(tipos[dep.id]).map(([tipoId, nombre]) => ({
          id: tipoId,
          nombre,
          departamento: dep.nombre,
          depId: dep.id,
        }))
      : []
  );

  const totalTipos = tiposTabla.length;

  return (
    <ModuleContainer>
      <PageHeader
        title="Categorías de Tickets"
        subtitle={`${totalTipos} tipos en ${departamentos.length} departamentos`}
        icon={CategoryIcon}
        gradient="warning"
      />

      {/* Grid de departamentos con sus tipos */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {departamentos.map((dep) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={dep.id}>
            <GlassCard sx={{ height: '100%', minHeight: 180 }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                <Avatar 
                  sx={{ 
                    bgcolor: alpha(theme.palette.warning.main, 0.15),
                    mr: 1.5,
                    width: 36,
                    height: 36,
                  }}
                >
                  <CategoryIcon sx={{ color: theme.palette.warning.main, fontSize: 20 }} />
                </Avatar>
                <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 700 }}>
                  {dep.nombre}
                </Typography>
                <IconButton 
                  onClick={() => handleOpenDialog(dep.id)} 
                  size="small"
                  sx={{ 
                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) }
                  }}
                >
                  <AddIcon sx={{ color: theme.palette.primary.main }} />
                </IconButton>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                {tipos[dep.id] ? (
                  Object.entries(tipos[dep.id]).map(([tipoId, nombre]) => (
                    <Chip
                      key={tipoId}
                      label={nombre}
                      onDelete={() => handleDeleteTipo(dep.id, tipoId)}
                      deleteIcon={<DeleteIcon fontSize="small" />}
                      onClick={() => handleOpenDialog(dep.id, { id: tipoId, nombre })}
                      sx={{ 
                        fontWeight: 600,
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                        color: theme.palette.primary.main,
                        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) },
                        '& .MuiChip-deleteIcon': { color: theme.palette.error.main }
                      }}
                    />
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    Sin categorías
                  </Typography>
                )}
              </Box>
            </GlassCard>
          </Grid>
        ))}
      </Grid>

      {/* Tabla de tipos de ticket */}
      <SectionContainer title="Vista de Tabla" icon={CategoryIcon}>
        <TableContainer sx={{ borderRadius: 2, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                <TableCell sx={{ fontWeight: 700 }}>Departamento</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Categoría</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tiposTabla.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <EmptyState 
                      icon={CategoryIcon} 
                      title="Sin categorías" 
                      subtitle="Agrega categorías desde los departamentos arriba"
                    />
                  </TableCell>
                </TableRow>
              ) : (
                tiposTabla.map(tipo => (
                  <TableRow 
                    key={tipo.id + '-' + tipo.depId}
                    sx={{ '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.02) } }}
                  >
                    <TableCell>
                      <Chip 
                        label={tipo.departamento} 
                        size="small" 
                        sx={{ fontWeight: 600 }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 500 }}>{tipo.nombre}</TableCell>
                    <TableCell align="right">
                      <IconButton 
                        size="small" 
                        onClick={() => handleOpenDialog(tipo.depId, { id: tipo.id, nombre: tipo.nombre })}
                        sx={{ color: theme.palette.primary.main }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton 
                        size="small" 
                        onClick={() => handleDeleteTipo(tipo.depId, tipo.id)}
                        sx={{ color: theme.palette.error.main }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionContainer>

      <Dialog 
        open={openDialog} 
        onClose={() => setOpenDialog(false)} 
        fullWidth 
        maxWidth="xs"
        PaperProps={{ sx: dialogStyles.paper }}
      >
        <DialogTitle sx={dialogStyles.title('warning')(theme)}>
          {editTipo ? "Editar Categoría" : "Nueva Categoría"}
        </DialogTitle>
        <DialogContent sx={dialogStyles.content}>
          <TextField
            autoFocus
            margin="dense"
            label="Nombre de la categoría"
            fullWidth
            value={nuevoTipo}
            onChange={e => setNuevoTipo(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions sx={dialogStyles.actions}>
          <Button onClick={() => setOpenDialog(false)} variant="contained" color="error" sx={{ fontWeight: 600, color: '#fff', '&:hover': { color: '#fff' } }}>
            Cancelar
          </Button>
          <Button onClick={handleSaveTipo} variant="contained" sx={{ fontWeight: 600, color: '#fff', '&:hover': { color: '#fff' } }}>
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </ModuleContainer>
  );
}
