
import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, TextField, Button, Link, MenuItem, Alert } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { ref, get, set } from 'firebase/database';
import { auth } from '../../firebase/firebaseConfig';
import { useDb } from '../../context/DbContext';
import { getDbForRecinto } from '../../firebase/multiDb';


export default function Register() {
  const theme = useTheme();
  const { recinto, RECINTO_DB_MAP } = useDb();
  const navigate = useNavigate();
  const [targetRecinto, setTargetRecinto] = useState(() => recinto || 'GRUPO_HEROICA');
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
    } catch (err) {
      console.error('Error registrando usuario', err);
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
            alt="Logo Grupo Heroica"
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
            {Object.keys(RECINTO_DB_MAP || {}).map((key) => (
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
            sx={{ mt: 2 }}
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
