import React, { useEffect, useState } from 'react';
import { Box, TextField, Button, Chip, MenuItem } from '@mui/material';

import EmailIcon from '@mui/icons-material/Email';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import { ref, get, set } from 'firebase/database';
import { useDb } from '../context/DbContext';
import { getDbForRecinto } from '../firebase/multiDb';
import { ModuleContainer, PageHeader, GlassCard, SectionContainer, EmptyState } from '../components/ui/SharedStyles';
import { gradients } from '../components/ui/sharedStyles.constants';
import useNotification from '../context/useNotification';

export default function ConfigCorreo() {
  const { db: ctxDb, recinto } = useDb();
  const { notify } = useNotification();
  const [departamentos, setDepartamentos] = useState([]);
  const [selectedDep, setSelectedDep] = useState('');
  const [pool, setPool] = useState([]);
  const [input, setInput] = useState('');

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
    notify('Pool de correos actualizado', 'success');
  };

  return (
    <ModuleContainer>
      <PageHeader 
        title="Configuración de Correo" 
        subtitle="Administra el pool de correos por departamento"
        icon={<EmailIcon />}
        gradient={gradients.info}
      />
      
      <GlassCard sx={{ p: 3, mb: 3 }}>
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
      </GlassCard>
      
      {selectedDep && (
        <SectionContainer title="Pool de correos" icon={EmailIcon}>
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            <TextField
              sx={{ flex: 1, minWidth: 250 }}
              size="small"
              label="Agregar correo"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && addEmail()}
            />
            <Button 
              variant="contained" 
              onClick={addEmail}
              startIcon={<AddIcon />}
              sx={{ 
                background: gradients.success,
                color: '#fff',
                '&:hover': { opacity: 0.9, color: '#fff' }
              }}
            >
              Agregar
            </Button>
          </Box>
          
          {pool.length === 0 ? (
            <EmptyState message="No hay correos en el pool" icon={EmailIcon} />
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {pool.map(email => (
                <Chip 
                  key={email} 
                  label={email} 
                  onDelete={() => removeEmail(email)} 
                  sx={{ 
                    background: gradients.primary, 
                    color: '#fff',
                    fontWeight: 500,
                    '& .MuiChip-deleteIcon': { color: 'rgba(255,255,255,0.7)' }
                  }} 
                />
              ))}
            </Box>
          )}
          
          <Button 
            variant="contained" 
            onClick={save}
            startIcon={<SaveIcon />}
            sx={{ 
              background: gradients.primary,
              color: '#fff',
              px: 4,
              '&:hover': { opacity: 0.9, color: '#fff' }
            }}
          >
            Guardar
          </Button>
        </SectionContainer>
      )}
    </ModuleContainer>
  );
}
