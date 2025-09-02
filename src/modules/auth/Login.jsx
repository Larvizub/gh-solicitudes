import React, { useState } from 'react';
import { Box, Paper, Typography, TextField, Button, Link, InputAdornment, Alert, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { Email, Lock, Microsoft } from '@mui/icons-material';
import { signInWithEmailAndPassword, OAuthProvider, signInWithPopup, fetchSignInMethodsForEmail, signOut } from 'firebase/auth';
import { auth } from '../../firebase/firebaseConfig';
import { useDb } from '../../context/DbContext';
import branding, { BRAND_LABEL, BRAND_LOGO_ALT } from '../../config/branding';
import { getDbForRecinto } from '../../firebase/multiDb';
import { ref, update } from 'firebase/database';


 // Provider de Microsoft para Firebase Auth
const msProvider = new OAuthProvider('microsoft.com');
// Configurar para aceptar cualquier cuenta Microsoft (tenant + MSA personales)
msProvider.addScope('user.read');
msProvider.setCustomParameters({
  prompt: 'select_account',
  tenant: 'common' // Permite cuentas de cualquier directorio y cuentas personales
});

export default function Login() {
  const navigate = useNavigate();
  const theme = useTheme();
  const { setRecinto } = useDb();
  // Recintos soportados y dominios permitidos
  const RECINTOS = [
  { key: branding.key, label: BRAND_LABEL },
    { key: 'CCCI', label: 'CCCI' },
    { key: 'CCCR', label: 'CCCR' },
    { key: 'CEVP', label: 'CEVP' },
  ];

  const ALLOWED_DOMAINS = {
    GRUPO_HEROICA: 'grupoheroica.com',
    CCCI: 'cccartagena.com',
    CCCR: 'costaricacc.com',
    CEVP: 'valledelpacifico.co',
  };

  // Correos admin que pueden acceder a cualquier recinto
  const ADMIN_EXCEPTIONS = [
    'admin@costaricacc.com',
    'admin@grupoheroica.com',
  ];
  // Dominio que consideramos de confianza (acceso amplio)
  const ADMIN_DOMAIN = 'grupoheroica.com';

  const [selectedRecinto, setSelectedRecinto] = useState(() => {
    try {
      return localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA';
    } catch {
      return 'GRUPO_HEROICA';
    }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isAdminEmail = (email) => {
    if (!email) return false;
  const lc = email.toLowerCase();
  if (ADMIN_EXCEPTIONS.includes(lc)) return true;
  // Permitir todo el dominio @grupoheroica.com
  if (lc.endsWith(`@${ADMIN_DOMAIN}`)) return true;
  return false;
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
    // Direct domain match
    if (domain === allowed || domain.endsWith('.' + allowed)) return true;
    // Handle Microsoft guest accounts where original email is embedded in the local part
    // Example: douglas.granados_grupoheroica.com#ext#@cccostarica.onmicrosoft.com
    const local = parts[0];
    const embedded = extractEmbeddedDomainFromGuest(local);
    if (embedded) {
      console.info('Login: detected embedded domain in guest account', { email, embedded });
      return embedded === allowed || embedded.endsWith('.' + allowed);
    }
    return false;
  };

  // Intentar inferir recinto a partir del dominio del email
  const inferRecintoFromEmail = (email) => {
    if (!email) return null;
    const lc = email.toLowerCase();
    const parts = lc.split('@');
    if (parts.length !== 2) return null;
    const domain = parts[1];
    for (const key of Object.keys(ALLOWED_DOMAINS)) {
      const allowed = ALLOWED_DOMAINS[key];
      if (!allowed) continue;
      if (domain === allowed || domain.endsWith('.' + allowed)) return key;
    }
    // Try embedded domain for Microsoft guest users
    const local = parts[0];
    const embedded = extractEmbeddedDomainFromGuest(local);
    if (embedded) {
      for (const key of Object.keys(ALLOWED_DOMAINS)) {
        const allowed = ALLOWED_DOMAINS[key];
        if (!allowed) continue;
        if (embedded === allowed || embedded.endsWith('.' + allowed)) return key;
      }
    }
    return null;
  };

  // Extract domain embedded in local part for Microsoft guest accounts
  const extractEmbeddedDomainFromGuest = (localPart) => {
    if (!localPart) return null;
    const marker = '#ext#';
    const lc = localPart.toLowerCase();
    const idx = lc.indexOf(marker);
    if (idx === -1) return null;
    // take substring before marker, then after last underscore which often replaces '@'
    const before = localPart.slice(0, idx);
    const segments = before.split('_');
    const candidate = segments[segments.length - 1];
    if (candidate && candidate.includes('.')) return candidate.toLowerCase();
    return null;
  };

  // Login con Firebase Email/Password
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Si el recinto seleccionado no coincide con el dominio del email,
      // intentar inferir y corregir automáticamente para evitar bloqueos.
      const inferred = inferRecintoFromEmail(email);
      if (inferred && inferred !== selectedRecinto) {
        console.info('Login: recinto inferido a partir del email, actualizando selección', { email, inferred });
  try { setSelectedRecinto(inferred); } catch (e) { console.warn('No se pudo setSelectedRecinto', e); }
  try { localStorage.setItem('selectedRecinto', inferred); } catch (e) { console.warn('No se pudo persistir selectedRecinto', e); }
  try { setRecinto(inferred); } catch (e) { console.warn('No se pudo setRecinto desde inferRecinto', e); }
      }

      // Validar dominio según recinto seleccionado antes de intentar autenticación
      if (!isEmailAllowedForRecinto(email, selectedRecinto)) {
        console.warn('Login: intento de inicio con email no autorizado para recinto', { email, selectedRecinto });
        setError('El correo no está autorizado para el recinto seleccionado.');
        setLoading(false);
        return;
      }
      // Persistir selección
  try { localStorage.setItem('selectedRecinto', selectedRecinto); } catch { /* ignore */ }
      // además avisar al contexto de DB para que inicialice la DB correspondiente
  try { setRecinto(selectedRecinto); } catch { /* ignore */ }
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // After successful sign-in, check usuarios/{uid} for needsDepartmentSelection
      try {
        const dbToUse = await getDbForRecinto(selectedRecinto);
        const uid = cred.user.uid;
        const snap = await (await import('firebase/database')).get((await import('firebase/database')).ref(dbToUse, `usuarios/${uid}`));
        console.debug('Login(email): usuarios/{uid} snapshot ->', snap && snap.exists() ? snap.val() : null);
        if (snap && snap.exists()) {
          const data = snap.val();
          if (data.needsDepartmentSelection || !(data.departamento && data.departamento.trim())) {
            try { sessionStorage.setItem('forceShowDeptModal', '1'); } catch { /* ignore */ }
            navigate('/perfil');
          } else {
            navigate('/dashboard');
          }
        } else {
          try { sessionStorage.setItem('forceShowDeptModal', '1'); } catch { /* ignore */ }
          navigate('/perfil');
        }
      } catch (e) {
        console.warn('Login: error comprobando usuarios/{uid}, navegando a dashboard por defecto', e);
        navigate('/dashboard');
      }
    } catch (err) {
      console.error(err);
      setError('Correo o contraseña incorrectos');
    } finally {
      setLoading(false);
    }
  };

  // Login con Microsoft
  const handleMicrosoftLogin = async () => {
    setError('');
    setLoading(true);
    try {
  // avisar al contexto de DB antes de abrir el popup para que la app empiece a inicializar la DB
  try { setRecinto(selectedRecinto); } catch { /* ignore */ }
  try { localStorage.setItem('selectedRecinto', selectedRecinto); } catch { /* ignore */ }
  const result = await signInWithPopup(auth, msProvider);
      const userEmail = result?.user?.email?.toLowerCase();
      if (!isEmailAllowedForRecinto(userEmail, selectedRecinto)) {
        console.warn('Login (Microsoft): usuario no autorizado para recinto', { userEmail, selectedRecinto });
        // No autorizado para el recinto
        await signOut(auth);
        setError('Tu cuenta no está autorizada para el recinto seleccionado.');
        setLoading(false);
        return;
      }
      // Intentar enriquecer perfil desde Microsoft Graph usando el token devuelto por el popup
      try {
        const accessToken = result?.credential?.accessToken || result?.credential?.oauthAccessToken || null;
        if (accessToken) {
          console.debug('Login: usando accessToken devuelto por Microsoft para consultar Graph');
          const graphRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=givenName,surname,mail,department,mobilePhone,jobTitle,displayName', {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          if (graphRes.ok) {
            const profile = await graphRes.json();
            console.debug('Login: perfil Graph obtenido', profile);
            // Mapear campos y persistir en la DB del recinto seleccionado
            try {
              const dbToUse = await getDbForRecinto(selectedRecinto);
              if (dbToUse) {
                const uid = result.user.uid;
                const mapped = {
                  nombre: profile.givenName || profile.displayName || result.user.displayName || '',
                  apellido: profile.surname || '',
                  email: profile.mail || profile.userPrincipalName || result.user.email || '',
                  departamento: profile.department || '',
                  telefono: profile.mobilePhone || '',
                  cargo: profile.jobTitle || '',
                  rol: 'estandar',
                };
                await update(ref(dbToUse, `usuarios/${uid}`), mapped);
                console.debug('Login: perfil persistido en usuarios/{uid}', mapped);
              } else {
                console.debug('Login: no hay dbToUse disponible para persistir perfil Graph');
              }
            } catch (dbErr) {
              console.warn('Login: fallo al persistir perfil Graph', dbErr);
            }
          } else {
            console.debug('Login: Graph /me devolvió status', graphRes.status);
          }
        } else {
          console.debug('Login: no se obtuvo accessToken de result.credential, no se consulta Graph a nivel de user');
        }
      } catch (gErr) {
        console.debug('Login: error consultando Graph con token de usuario', gErr);
      }
      // After MS login, check persisted usuario node and redirect accordingly
      try {
        const dbToUse = await getDbForRecinto(selectedRecinto);
        const uid = result.user.uid;
        const snap = await (await import('firebase/database')).get((await import('firebase/database')).ref(dbToUse, `usuarios/${uid}`));
        if (snap && snap.exists()) {
            const data = snap.val();
            if (data.needsDepartmentSelection || !(data.departamento && data.departamento.trim())) {
              try { sessionStorage.setItem('forceShowDeptModal', '1'); } catch { /* ignore */ }
              navigate('/perfil');
            } else {
              navigate('/dashboard');
            }
          } else {
            try { sessionStorage.setItem('forceShowDeptModal', '1'); } catch { /* ignore */ }
            navigate('/perfil');
          }
      } catch (e) {
        console.warn('Login(MS): error comprobando usuarios/{uid}, navegando a dashboard por defecto', e);
        navigate('/dashboard');
      }
    } catch (err) {
      console.error(err);
      // Manejar cuenta existente con otro proveedor
      if (err.code === 'auth/account-exists-with-different-credential') {
        const email = err.customData?.email;
        let methods = [];
        try {
          methods = await fetchSignInMethodsForEmail(auth, email);
        } catch (fetchErr) {
          console.error(fetchErr);
        }
        const methodList = methods.join(', ');
        setError(`Ya existe una cuenta con ${email}. Inicia sesión usando: ${methodList} y luego vincula Microsoft.`);
      } else {
        setError('Error al iniciar sesión con Microsoft');
      }
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
        <Typography variant="h5" align="center" gutterBottom>Iniciar Sesión</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <FormControl fullWidth margin="normal">
          <InputLabel id="recinto-label">Recinto</InputLabel>
          <Select
            labelId="recinto-label"
            value={selectedRecinto}
            label="Recinto"
            onChange={(e) => setSelectedRecinto(e.target.value)}
          >
            {RECINTOS.map(r => (
              <MenuItem key={r.key} value={r.key}>{r.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button
          fullWidth
          variant="contained"
          color="primary"
          sx={{ mt: 2 }}
          startIcon={<Microsoft />}
          onClick={handleMicrosoftLogin}
          disabled={loading}
        >
          Iniciar con Microsoft
        </Button>
        <Typography variant="body2" align="center" sx={{ mt: 2 }}>o</Typography>
        <form onSubmit={handleLogin}>
          <TextField
            fullWidth
            margin="normal"
            label="Correo"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Email sx={{ mr: 1 }} />
                </InputAdornment>
              ),
            }}
            required
          />
          <TextField
            fullWidth
            margin="normal"
            label="Contraseña"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Lock sx={{ mr: 1 }} />
                </InputAdornment>
              ),
            }}
            required
          />
          <Button
            fullWidth
            variant="contained"
            color="primary"
            sx={{ mt: 2 }}
            type="submit"
            disabled={loading}
          >
            Ingresar
          </Button>
        </form>
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Link
            href="#"
            onClick={() => navigate('/register')}
            sx={{ color: theme && theme.palette && theme.palette.mode === 'dark' ? '#fff' : 'inherit' }}
          >
            ¿No tienes cuenta? Regístrate
          </Link>
        </Box>
      </Paper>
    </Box>
  );
}
