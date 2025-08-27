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
  Alert,
  Paper,
  Grid,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { ref, get, set, update, remove, push } from "firebase/database";
import { useDb } from "../context/DbContext";
import { getDbForRecinto } from "../firebase/multiDb";

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
        await update(ref(dbInstance, `tiposTickets/${depActivo}/${editTipo.id}`), nuevoTipo);
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
      console.error('Error eliminando tipo:', e);
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

  return (
    <Box
      sx={{
        p: { xs: 1, sm: 2 },
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        minHeight: "90vh",
        width: "100%",
        maxWidth: "100vw",
        margin: "0 auto",
        boxSizing: "border-box",
      }}
    >
      <Typography variant="h5" sx={{ mb: 2 }}>
        Configuración de Tickets
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}
      <Grid container spacing={2} sx={{ alignItems: 'stretch' }}>
        {departamentos.map((dep) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={dep.id} sx={{ display: 'flex', minWidth: 260, maxWidth: 400 }}>
            <Paper elevation={1} sx={{
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minWidth: 260,
              maxWidth: 400,
              width: '100%',
              borderRadius: 3,
              boxShadow: '0 2px 8px 0 rgba(0,0,0,0.04)',
            }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 600 }}>
                  {dep.nombre}
                </Typography>
                <IconButton color="primary" onClick={() => handleOpenDialog(dep.id)} size="small" sx={{ '& .MuiSvgIcon-root': { color: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined } }}>
                  <AddIcon />
                </IconButton>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, flex: 1, alignItems: 'flex-start' }}>
                {(tipos[dep.id]
                  ? Object.entries(tipos[dep.id]).map(([tipoId, nombre]) => (
                      <Chip
                        key={tipoId}
                        label={nombre}
                        onDelete={() => handleDeleteTipo(dep.id, tipoId)}
                        deleteIcon={<DeleteIcon fontSize="small" />}
                        sx={{ mb: 1, fontWeight: 500, background: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.primary.main, color: (theme) => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : '#fff' }}
                        onClick={() => handleOpenDialog(dep.id, { id: tipoId, nombre })}
                      />
                    ))
                  : <Typography variant="body2" color="text.secondary">Sin tipos</Typography>
                )}
              </Box>
            </Paper>
          </Grid>
        ))}
      </Grid>
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} fullWidth maxWidth="xs">
        <DialogTitle>{editTipo ? "Editar tipo de ticket" : "Agregar tipo de ticket"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Nombre del tipo"
            fullWidth
            value={nuevoTipo}
            onChange={e => setNuevoTipo(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)} variant="contained" color="error">Cancelar</Button>
          <Button onClick={handleSaveTipo} variant="contained" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined, color: (theme) => theme.palette.mode === 'dark' ? theme.palette.getContrastText(theme.palette.common.white) : undefined }}>Guardar</Button>
        </DialogActions>
      </Dialog>

      {/* Tabla de tipos de ticket */}
      <Box sx={{ mt: 4, width: '100%', maxWidth: '100vw' }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Tipos de ticket (vista tabla)
        </Typography>
        <TableContainer component={Paper} sx={{ width: '100%', maxWidth: '100vw', overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Departamento</TableCell>
                <TableCell>Tipo</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tiposTabla.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} align="center">Sin tipos registrados</TableCell>
                </TableRow>
              ) : (
                tiposTabla.map(tipo => (
                  <TableRow key={tipo.id + '-' + tipo.depId}>
                    <TableCell>{tipo.departamento}</TableCell>
                    <TableCell>{tipo.nombre}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => handleOpenDialog(tipo.depId, { id: tipo.id, nombre: tipo.nombre })} sx={{ '& .MuiSvgIcon-root': { color: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined } }}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => handleDeleteTipo(tipo.depId, tipo.id)} sx={{ '& .MuiSvgIcon-root': { color: (theme) => theme.palette.mode === 'dark' ? theme.palette.common.white : undefined } }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  );
}
