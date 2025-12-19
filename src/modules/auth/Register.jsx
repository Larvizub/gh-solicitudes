
import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, TextField, Button, Link, MenuItem, Alert } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { BRAND_LOGO_ALT } from '../../config/branding';
import { useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { ref, get, set } from 'firebase/database';
import { auth } from '../../firebase/firebaseConfig';
import { useDb } from '../../context/DbContext';
import { getDbForRecinto } from '../../firebase/multiDb';

// Lógica de dominios permitidos (copiada de Login.jsx para consistencia)
const ALLOWED_DOMAINS = {
  GRUPO_HEROICA: 'grupoheroica.com',
  CCCI: 'cccartagena.com',
  CCCR: 'costaricacc.com',
  CEVP: 'valledelpacifico.co',
};

const ADMIN_EXCEPTIONS = ['admin@costaricacc.com', 'admin@grupoheroica.com'];

const isAdminEmail = (email) => {
  if (!email) return false;
  const lc = email.toLowerCase();
  if (ADMIN_EXCEPTIONS.includes(lc)) return true;
  return lc.endsWith('@grupoheroica.com');
};

const extractEmbeddedDomainFromGuest = (localPart) => {
  if (!localPart) return null;
  const marker = '#ext#';
  const lc = localPart.toLowerCase();
  const idx = lc.indexOf(marker);
  if (idx === -1) return null;
  const before = localPart.slice(0, idx);
  const segments = before.split('_');
  const candidate = segments[segments.length - 1];
  if (candidate && candidate.includes('.')) return candidate.toLowerCase();
  return null;
};

const isEmailAllowedForRecinto = (email, recintoKey) => {
  if (!email) return false;
  const lc = email.toLowerCase();
  if (isAdminEmail(lc)) return true;
  const parts = lc.split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1];
  const allowed = ALLOWED_DOMAINS[recintoKey];
  if (!allowed) return false;
  if (domain === allowed || domain.endsWith('.' + allowed)) return true;
  const local = parts[0];
  const embedded = extractEmbeddedDomainFromGuest(local);
  if (embedded) return embedded === allowed || embedded.endsWith('.' + allowed);
  return false;
};


export default function Register() {
  const theme = useTheme();
  const { recinto, RECINTO_DB_MAP } = useDb();
  const navigate = useNavigate();
  const [targetRecinto, setTargetRecinto] = useState(() => recinto || 'CORPORATIVO');
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [departamento, setDepartamento] = useState('');
  const [departamentos, setDepartamentos] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  // Obtener pool de departamentos desde la base de datos
  useEffect(() => {
    const fetchDepartamentos = async () => {
      try {
        const dbInstance = await getDbForRecinto(targetRecinto);
        if (!dbInstance) return setDepartamentos([]);
        const snapshot = await get(ref(dbInstance, 'departamentos'));
        if (snapshot.exists()) {
          const data = snapshot.val();
          setDepartamentos(Object.values(data));
        } else {
          setDepartamentos([]);
        }
      } catch (e) {
        console.warn('No se pudieron cargar departamentos para recinto', targetRecinto, e);
        setDepartamentos([]);
      }
    };
    fetchDepartamentos();
  }, [targetRecinto]);

    // Construir lista de opciones para el select de recintos: quitar GRUPO_HEROICA y poner CORPORATIVO primero
    const recintoOptions = (() => {
      const keys = Object.keys(RECINTO_DB_MAP || {});
      // excluir GRUPO_HEROICA
      const filtered = keys.filter(k => k !== 'GRUPO_HEROICA');
      // ordenar poniendo CORPORATIVO al inicio si existe
      filtered.sort((a, b) => {
        if (a === 'CORPORATIVO') return -1;
        if (b === 'CORPORATIVO') return 1;
        return String(a).localeCompare(String(b));
      });
      return filtered;
    })();

  // Registro de usuario
  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!departamento) {
      setError('Selecciona un departamento');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      setLoading(false);
      return;
    }

    // SEGURIDAD: Verificar que el email tenga permisos para el recinto seleccionado
    if (!isEmailAllowedForRecinto(email, targetRecinto)) {
      // Si es Corporativo, verificar autorización adicional
      if (targetRecinto === 'CORPORATIVO') {
        try {
          const corporativoDb = await getDbForRecinto('CORPORATIVO');
          const db = await import('firebase/database');

          // Buscar por email en corporativo_authorized_users
          const authUsersSnap = await db.get(db.ref(corporativoDb, 'corporativo_authorized_users'));
          if (authUsersSnap && authUsersSnap.exists()) {
            const authUsers = authUsersSnap.val();
            let isAuthorized = false;
            for (const [uid, userData] of Object.entries(authUsers)) {
              if (userData && userData.email && userData.email.toLowerCase() === email.toLowerCase()) {
                // Verificar si está en corporativo_allowed
                const allowedSnap = await db.get(db.ref(corporativoDb, `corporativo_allowed/${uid}`));
                if (allowedSnap && allowedSnap.exists() && allowedSnap.val() === true) {
                  isAuthorized = true;
                  break;
                }
              }
            }
            if (!isAuthorized) {
              setError('El correo no está autorizado para acceder a Corporativo.');
              setLoading(false);
              return;
            }
          } else {
            setError('El correo no está autorizado para acceder a Corporativo.');
            setLoading(false);
            return;
          }
        } catch (err) {
          console.warn('Register: error verificando autorización Corporativo por email', err);
          setError('Error verificando permisos para Corporativo.');
          setLoading(false);
          return;
        }
      } else {
        setError('El correo no está autorizado para el recinto seleccionado.');
        setLoading(false);
        return;
      }
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: `${nombre} ${apellido}` });
      // Guardar usuario en la base de datos seleccionada por el formulario
      const dbInstance = await getDbForRecinto(targetRecinto);
      if (dbInstance) {
        await set(ref(dbInstance, `usuarios/${userCredential.user.uid}`), {
          nombre,
          apellido,
          email,
          departamento,
          rol: 'estandar',
        });
      }
      navigate('/dashboard');
    } catch {
      // removed console.error for registration errors
      setError('Error al registrar usuario');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        minHeight: '100vh',
        minWidth: '100vw',
        bgcolor: 'background.default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Paper elevation={3} sx={{ p: 4, maxWidth: 400, width: '100%' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
          <img
            src="https://costaricacc.com/cccr/Logoheroica.png"
            alt={BRAND_LOGO_ALT}
            style={{
              height: 60,
              filter: theme && theme.palette && theme.palette.mode === 'dark' ? 'brightness(0) invert(1)' : 'none',
            }}
          />
        </Box>
        <Typography variant="h5" align="center" gutterBottom>Registro</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <form onSubmit={handleRegister}>
          <TextField
            fullWidth
            margin="normal"
            label="Nombre"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            required
          />
          <TextField
            fullWidth
            margin="normal"
            label="Apellido"
            value={apellido}
            onChange={e => setApellido(e.target.value)}
            required
          />
          <TextField
            fullWidth
            margin="normal"
            label="Correo"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <TextField
            fullWidth
            margin="normal"
            label="Contraseña"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <TextField
            fullWidth
            margin="normal"
            label="Confirmar Contraseña"
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
          />
          <TextField
            select
            fullWidth
            margin="normal"
            label="Recinto (base de datos)"
            value={targetRecinto}
            onChange={e => setTargetRecinto(e.target.value)}
            required
          >
            {recintoOptions.map((key) => (
              <MenuItem key={key} value={key}>{key}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            margin="normal"
            label="Departamento"
            value={departamento}
            onChange={e => setDepartamento(e.target.value)}
            required
          >
            {departamentos.length === 0 ? (
              <MenuItem value="" disabled>No hay departamentos</MenuItem>
            ) : (
              departamentos.map((dep, idx) => (
                <MenuItem key={idx} value={dep}>{dep}</MenuItem>
              ))
            )}
          </TextField>
          
          <Button
            fullWidth
            variant="contained"
            color="primary"
            sx={{ mt: 2, color: '#fff', '&:hover': { color: '#fff' } }}
            type="submit"
            disabled={loading}
          >
            Registrarse
          </Button>
        </form>
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Link
            href="#"
            onClick={() => navigate('/login')}
            sx={{ color: (theme) => (theme.palette.mode === 'dark' ? '#fff' : 'inherit') }}
          >
            ¿Ya tienes cuenta? Inicia sesión
          </Link>
        </Box>
      </Paper>
    </Box>
  );
}
