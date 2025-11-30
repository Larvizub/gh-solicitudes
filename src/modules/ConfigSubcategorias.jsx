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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import CategoryIcon from '@mui/icons-material/Category';
import DeleteIcon from '@mui/icons-material/Delete';
import { ref, get, push, set, remove } from 'firebase/database';
import { useDb } from '../context/DbContext';
import { getDbForRecinto } from '../firebase/multiDb';
import { ModuleContainer, PageHeader, GlassCard, SectionContainer, EmptyState } from '../components/ui/SharedStyles';
import { gradients, dialogStyles } from '../components/ui/sharedStyles.constants';
import useNotification from '../context/useNotification';

export default function ConfigSubcategorias() {
  const { db: ctxDb, recinto } = useDb();
  const theme = useTheme();
  const { notify } = useNotification();
  const [departamentos, setDepartamentos] = useState([]);
  const [tipos, setTipos] = useState({});
  const [subcats, setSubcats] = useState({});
  const [slaSubcats, setSlaSubcats] = useState({});
  const [openDialog, setOpenDialog] = useState(false);
  const [depActivo, setDepActivo] = useState('');
  const [tipoActivo, setTipoActivo] = useState('');
  const [nuevoSub, setNuevoSub] = useState('');
  const [nuevoSla, setNuevoSla] = useState('');
  const [editSub, setEditSub] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');

  // Mostrar notificaciones
  useEffect(() => {
    if (success) notify(success, 'success');
    if (error) notify(error, 'error');
  }, [success, error, notify]);

  // Carga inicial
  useEffect(() => {
    const fetchData = async () => {
  const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
  if (!dbInstance) return;
  const depSnap = await get(ref(dbInstance, 'departamentos'));
      if (depSnap.exists()) {
        setDepartamentos(Object.entries(depSnap.val()).map(([id, nombre]) => ({ id, nombre })));
      }
  const tiposSnap = await get(ref(dbInstance, 'tiposTickets'));
      if (tiposSnap.exists()) setTipos(tiposSnap.val());
  const subSnap = await get(ref(dbInstance, 'subcategoriasTickets'));
      if (subSnap.exists()) setSubcats(subSnap.val());
  const slaSnap = await get(ref(dbInstance, 'sla/subcategorias'));
      if (slaSnap.exists()) setSlaSubcats(slaSnap.val());
    };
    fetchData();
  }, [success, ctxDb, recinto]);

  // Prepara filas con subcategorías
  const filas = departamentos.flatMap(dep =>
    tipos[dep.id]
      ? Object.entries(tipos[dep.id]).map(([tipoId, nombre]) => ({
          depId: dep.id,
          departamento: dep.nombre,
          tipoId,
          tipoNombre: nombre,
          subs: subcats[dep.id] && subcats[dep.id][tipoId]
            ? Object.entries(subcats[dep.id][tipoId]).map(([id, nombre]) => ({ id, nombre }))
            : [],
        }))
      : []
  );
  // Filtrado según búsqueda
  const filasFiltradas = filas.filter(row =>
    row.tipoNombre.toLowerCase().includes(search.toLowerCase()) ||
    row.departamento.toLowerCase().includes(search.toLowerCase())
  );

  const handleOpen = (depId, tipoId, sub = null) => {
    setError('');
    setSuccess('');
    setDepActivo(depId);
    setTipoActivo(tipoId);
    setEditSub(sub);
    setNuevoSub(sub ? sub.nombre : '');
    // cargar SLA existente si está disponible
    try {
      const existingSla = (slaSubcats && slaSubcats[depId] && slaSubcats[depId][tipoId] && sub && slaSubcats[depId][tipoId][sub.id] != null) ? String(slaSubcats[depId][tipoId][sub.id]) : '';
      setNuevoSla(existingSla);
    } catch {
      setNuevoSla('');
    }
    setOpenDialog(true);
  };
  
  const handleSave = async () => {
    if (!nuevoSub.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    try {
      const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
      if (!dbInstance) throw new Error('No DB');
      if (editSub) {
  await set(ref(dbInstance, `subcategoriasTickets/${depActivo}/${tipoActivo}/${editSub.id}`), nuevoSub);
        setSuccess('Subcategoría actualizada');
  // guardar SLA si se proporcionó (puede quedar vacío)
  const hours = Number(nuevoSla) || 0;
  await set(ref(dbInstance, `sla/subcategorias/${depActivo}/${tipoActivo}/${editSub.id}`), hours || null);
      } else {
        const newRef = push(ref(dbInstance, `subcategoriasTickets/${depActivo}/${tipoActivo}`));
  await set(newRef, nuevoSub);
  // guardar SLA asociado al nuevo id
  const hours = Number(nuevoSla) || 0;
  await set(ref(dbInstance, `sla/subcategorias/${depActivo}/${tipoActivo}/${newRef.key}`), hours || null);
        setSuccess('Subcategoría agregada');
      }
      setOpenDialog(false);
    } catch {
      setError('Error al guardar');
    }
  };

  const handleDelete = async (depId, tipoId, subId) => {
    try {
  const dbInstance = ctxDb || (recinto ? await getDbForRecinto(recinto) : null);
  if (!dbInstance) throw new Error('No DB');
  await remove(ref(dbInstance, `subcategoriasTickets/${depId}/${tipoId}/${subId}`));
      setSuccess('Subcategoría eliminada');
    } catch {
      setError('Error al eliminar');
    }
  };

  return (
    <ModuleContainer>
      <PageHeader 
        title="Subcategorías" 
        subtitle="Configura las subcategorías para cada tipo de ticket por departamento"
        icon={CategoryIcon}
        gradient="teal"
      />
      
      {/* Campo de búsqueda */}
      <GlassCard sx={{ p: 2, mb: 3 }}>
        <TextField
          label="Buscar tipo o departamento"
          variant="outlined"
          size="small"
          value={search}
          onChange={e => setSearch(e.target.value)}
          fullWidth
          sx={{ maxWidth: 400 }}
        />
      </GlassCard>

      <SectionContainer title="Subcategorías por Categoría" icon={CategoryIcon}>
        {filasFiltradas.length === 0 ? (
          <EmptyState message="No hay categorías configuradas" icon={CategoryIcon} />
        ) : (
          <TableContainer component={Paper} elevation={0} sx={{ bgcolor: 'transparent' }}>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                  <TableCell sx={{ fontWeight: 700 }}>Departamento</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Categoría</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Subcategorías</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filasFiltradas.map(row => (
                  <TableRow 
                    key={`${row.depId}-${row.tipoId}`}
                    sx={{ 
                      '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) },
                      transition: 'background-color 0.2s'
                    }}
                  > 
                    <TableCell>{row.departamento}</TableCell>
                    <TableCell>
                      <Chip label={row.tipoNombre} size="small" sx={{ fontWeight: 600 }} />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {row.subs.map(sub => (
                          <Chip
                            key={sub.id}
                            label={sub.nombre}
                            onDelete={() => handleDelete(row.depId, row.tipoId, sub.id)}
                            deleteIcon={<DeleteIcon fontSize="small" />}
                            onClick={() => handleOpen(row.depId, row.tipoId, sub)}
                            sx={{ 
                              background: gradients.primary, 
                              color: '#fff',
                              fontWeight: 500,
                              '&:hover': { opacity: 0.9 }
                            }}
                          />
                        ))}
                        <IconButton 
                          size="small" 
                          onClick={() => handleOpen(row.depId, row.tipoId)}
                          sx={{ 
                            bgcolor: alpha(theme.palette.success.main, 0.1),
                            '&:hover': { bgcolor: alpha(theme.palette.success.main, 0.2) }
                          }}
                        >
                          <AddIcon fontSize="small" color="success" />
                        </IconButton>
                      </Box>
                    </TableCell>
                    <TableCell>
                      {/* Opcional acciones extra */}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </SectionContainer>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} fullWidth maxWidth="xs" PaperProps={{ sx: dialogStyles.paper }}>
        <DialogTitle sx={dialogStyles.title}>{editSub ? 'Editar Subcategoría' : 'Agregar Subcategoría'}</DialogTitle>
        <DialogContent sx={dialogStyles.content}>
          <TextField
            autoFocus
            margin="dense"
            label="Nombre de Subcategoría"
            fullWidth
            value={nuevoSub}
            onChange={e => setNuevoSub(e.target.value)}
          />
          <TextField
            margin="dense"
            label="SLA (horas, opcional)"
            type="number"
            fullWidth
            value={nuevoSla}
            onChange={e => setNuevoSla(e.target.value)}
            helperText="Si se deja vacío se usará el SLA por departamento o el por defecto"
          />
        </DialogContent>
        <DialogActions sx={dialogStyles.actions}>
          <Button onClick={() => setOpenDialog(false)} variant="outlined" color="inherit">Cancelar</Button>
          <Button variant="contained" onClick={handleSave} sx={{ background: gradients.primary }}>Guardar</Button>
        </DialogActions>
      </Dialog>
    </ModuleContainer>
  );
}
