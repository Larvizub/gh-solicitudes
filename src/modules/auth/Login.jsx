import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, TextField, Button, Link, InputAdornment, Alert, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { Email, Lock, Microsoft } from '@mui/icons-material';
import { signInWithEmailAndPassword, OAuthProvider, signInWithPopup, fetchSignInMethodsForEmail, signOut } from 'firebase/auth';
import { auth } from '../../firebase/firebaseConfig';
import { useDb } from '../../context/DbContext';
import { BRAND_LOGO_ALT } from '../../config/branding';
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

  const RECINTOS = [
    { key: 'CORPORATIVO', label: 'Corporativo' },
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

  const ADMIN_EXCEPTIONS = ['admin@costaricacc.com', 'admin@grupoheroica.com'];
  const ADMIN_DOMAIN = 'grupoheroica.com';

  const [selectedRecinto, setSelectedRecinto] = useState(() => {
    try {
      const stored = localStorage.getItem('selectedRecinto');
      console.log('Valor guardado en localStorage:', stored);
      console.log('RECINTOS disponibles:', RECINTOS.map(r => r.key));
      // Verificar que el valor guardado sea uno de los recintos válidos
      if (stored && RECINTOS.some(r => r.key === stored)) {
        console.log('Usando valor guardado:', stored);
        return stored;
      }
      console.log('Usando valor por defecto: CORPORATIVO');
      return 'CORPORATIVO';
    } catch (e) {
      console.log('Error al leer localStorage, usando CORPORATIVO:', e);
      return 'CORPORATIVO';
    }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Debug: Mostrar valor actual del selectedRecinto
  console.log('Valor actual de selectedRecinto:', selectedRecinto);

  // Guardar en localStorage cuando cambie el valor
  useEffect(() => {
    try {
      localStorage.setItem('selectedRecinto', selectedRecinto);
      console.log('Guardado en localStorage:', selectedRecinto);
    } catch (e) {
      console.log('Error al guardar en localStorage:', e);
    }
  }, [selectedRecinto]);

  const isAdminEmail = (email) => {
    if (!email) return false;
    const lc = email.toLowerCase();
    if (ADMIN_EXCEPTIONS.includes(lc)) return true;
    if (lc.endsWith(`@${ADMIN_DOMAIN}`)) return true;
    return false;
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

  const checkCorporativoEmailAuth = async (email) => {
    if (!email) return false;
    try {
      const corporativoDb = await getDbForRecinto('CORPORATIVO');
      const db = await import('firebase/database');
      
      // Buscar por email en corporativo_authorized_users
      const authUsersSnap = await db.get(db.ref(corporativoDb, 'corporativo_authorized_users'));
      if (authUsersSnap && authUsersSnap.exists()) {
        const authUsers = authUsersSnap.val();
        for (const [uid, userData] of Object.entries(authUsers)) {
          if (userData && userData.email && userData.email.toLowerCase() === email.toLowerCase()) {
            // Verificar si está en corporativo_allowed
            const allowedSnap = await db.get(db.ref(corporativoDb, `corporativo_allowed/${uid}`));
            if (allowedSnap && allowedSnap.exists() && allowedSnap.val() === true) {
              console.debug('Login: email autorizado en Corporativo', email, 'uid:', uid);
              return true;
            }
          }
        }
      }
      console.debug('Login: email NO encontrado en autorizaciones Corporativo', email);
      return false;
    } catch (err) {
      console.warn('Login: error verificando autorización Corporativo por email', err);
      return false;
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const inferred = inferRecintoFromEmail(email);
      // Solo cambiar automáticamente si el recinto actual no es válido para el email
      // y el usuario no ha seleccionado explícitamente CORPORATIVO
      if (inferred && inferred !== selectedRecinto && selectedRecinto !== 'CORPORATIVO' && !isEmailAllowedForRecinto(email, selectedRecinto)) {
        try { setSelectedRecinto(inferred); } catch (e) { void e; }
        try { localStorage.setItem('selectedRecinto', inferred); } catch (e) { void e; }
        try { setRecinto(inferred); } catch (e) { void e; }
      }

      if (!isEmailAllowedForRecinto(email, selectedRecinto)) {
        // Si es Corporativo, verificar autorización adicional en DB
        if (selectedRecinto === 'CORPORATIVO') {
          const isCorporativoAuthorized = await checkCorporativoEmailAuth(email);
          if (!isCorporativoAuthorized) {
            setError('El correo no está autorizado para acceder a Corporativo.');
            setLoading(false);
            return;
          }
        } else {
          setError('El correo no está autorizado para el recinto seleccionado.');
          setLoading(false);
          return;
        }
      }

      try { localStorage.setItem('selectedRecinto', selectedRecinto); } catch (e) { void e; }
      try { setRecinto(selectedRecinto); } catch (e) { void e; }

      const cred = await signInWithEmailAndPassword(auth, email, password);

      // check usuarios/{uid}
      try {
        const dbToUse = await getDbForRecinto(selectedRecinto);
        const uid = cred.user.uid;
        const db = await import('firebase/database');
        const snap = await db.get(db.ref(dbToUse, `usuarios/${uid}`));
        console.debug('Login(email): usuarios/{uid} snapshot ->', snap && snap.exists() ? snap.val() : null);
        if (snap && snap.exists()) {
          const data = snap.val();
          if (data.needsDepartmentSelection || !(data.departamento && data.departamento.trim())) {
            try { sessionStorage.setItem('forceShowDeptModal', '1'); } catch (e) { void e; }
            navigate('/perfil');
          } else {
            navigate('/dashboard');
          }
        } else {
          // fallback: comprobar canAccessCorporativo
          try {
            const { default: canAccessCorporativo } = await import('../../utils/canAccessCorporativo');
            const res = await canAccessCorporativo(uid);
            console.debug('Login(email): canAccessCorporativo ->', res);
            if (res && res.authorized) {
              const targetRecinto = res.foundIn === 'GRUPO_HEROICA-URL' ? 'GRUPO_HEROICA' : (res.foundIn || 'GRUPO_HEROICA');
              try { setRecinto(targetRecinto); } catch (e) { void e; }
              try { localStorage.setItem('selectedRecinto', targetRecinto); } catch (e) { void e; }
              navigate('/dashboard');
            } else {
              try { sessionStorage.setItem('forceShowDeptModal', '1'); } catch (e) { void e; }
              navigate('/perfil');
            }
          } catch (errCorp) {
            console.warn('Login: fallo comprobando autorización corporativa', errCorp);
            try { sessionStorage.setItem('forceShowDeptModal', '1'); } catch (e) { void e; }
            navigate('/perfil');
          }
        }
      } catch (e) {
        console.warn('Login: error comprobando usuarios/{uid}, intentando verificación corporativa', e);
        try {
          const uid = cred.user.uid;
          const { default: canAccessCorporativo } = await import('../../utils/canAccessCorporativo');
          const res = await canAccessCorporativo(uid);
          console.debug('Login(email) fallback: canAccessCorporativo ->', res);
          if (res && res.authorized) {
            const targetRecinto = res.foundIn === 'GRUPO_HEROICA-URL' ? 'GRUPO_HEROICA' : (res.foundIn || 'GRUPO_HEROICA');
            try { setRecinto(targetRecinto); } catch (e) { void e; }
            try { localStorage.setItem('selectedRecinto', targetRecinto); } catch (e) { void e; }
            navigate('/dashboard');
          } else {
            navigate('/dashboard');
          }
        } catch (err2) {
          console.warn('Login: verificación corporativa falló en fallback', err2);
          navigate('/dashboard');
        }
      }
    } catch (err) {
      console.error(err);
      setError('Correo o contraseña incorrectos');
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    setError('');
    setLoading(true);
    try {
      try { setRecinto(selectedRecinto); } catch (e) { void e; }
      try { localStorage.setItem('selectedRecinto', selectedRecinto); } catch (e) { void e; }
      const result = await signInWithPopup(auth, msProvider);
      const userEmail = result?.user?.email?.toLowerCase();
      if (!isEmailAllowedForRecinto(userEmail, selectedRecinto)) {
        // Si es Corporativo, verificar autorización adicional en DB
        if (selectedRecinto === 'CORPORATIVO') {
          const isCorporativoAuthorized = await checkCorporativoEmailAuth(userEmail);
          if (!isCorporativoAuthorized) {
            await signOut(auth);
            setError('Tu cuenta no está autorizada para acceder a Corporativo.');
            setLoading(false);
            return;
          }
        } else {
          await signOut(auth);
          setError('Tu cuenta no está autorizada para el recinto seleccionado.');
          setLoading(false);
          return;
        }
      }

      try {
        const accessToken = result?.credential?.accessToken || result?.credential?.oauthAccessToken || null;
        if (accessToken) {
          const graphRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=givenName,surname,mail,department,mobilePhone,jobTitle,displayName', {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          if (graphRes.ok) {
            const profile = await graphRes.json();
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
              }
            } catch (dbErr) {
              console.warn('Login: fallo al persistir perfil Graph', dbErr);
            }
          }
        }
      } catch (gErr) {
        console.debug('Login: error consultando Graph con token de usuario', gErr);
      }

      try {
        const dbToUse = await getDbForRecinto(selectedRecinto);
        const uid = result.user.uid;
        const db = await import('firebase/database');
        const snap = await db.get(db.ref(dbToUse, `usuarios/${uid}`));
        if (snap && snap.exists()) {
          const data = snap.val();
          if (data.needsDepartmentSelection || !(data.departamento && data.departamento.trim())) {
            try { sessionStorage.setItem('forceShowDeptModal', '1'); } catch (e) { void e; }
            navigate('/perfil');
          } else {
            navigate('/dashboard');
          }
        } else {
          try {
            const { default: canAccessCorporativo } = await import('../../utils/canAccessCorporativo');
            const res = await canAccessCorporativo(uid);
            if (res && res.authorized) {
              const targetRecinto = res.foundIn === 'GRUPO_HEROICA-URL' ? 'GRUPO_HEROICA' : (res.foundIn || 'GRUPO_HEROICA');
              try { setRecinto(targetRecinto); } catch (e) { void e; }
              try { localStorage.setItem('selectedRecinto', targetRecinto); } catch (e) { void e; }
              navigate('/dashboard');
            } else {
              try { sessionStorage.setItem('forceShowDeptModal', '1'); } catch (e) { void e; }
              navigate('/perfil');
            }
          } catch (errCorp) {
            console.warn('Login(MS): fallo comprobando autorización corporativa', errCorp);
            try { sessionStorage.setItem('forceShowDeptModal', '1'); } catch (e) { void e; }
            navigate('/perfil');
          }
        }
      } catch (e) {
        console.warn('Login(MS): error comprobando usuarios/{uid}, intentando verificación corporativa', e);
        try {
          const uid = result.user.uid;
          const { default: canAccessCorporativo } = await import('../../utils/canAccessCorporativo');
          const res = await canAccessCorporativo(uid);
          if (res && res.authorized) {
            const targetRecinto = res.foundIn === 'GRUPO_HEROICA-URL' ? 'GRUPO_HEROICA' : (res.foundIn || 'GRUPO_HEROICA');
            try { setRecinto(targetRecinto); } catch (e) { void e; }
            try { localStorage.setItem('selectedRecinto', targetRecinto); } catch (e) { void e; }
            navigate('/dashboard');
          } else {
            navigate('/dashboard');
          }
        } catch (err2) {
          console.warn('Login(MS): verificación corporativa falló en fallback', err2);
          navigate('/dashboard');
        }
      }
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/account-exists-with-different-credential') {
        const emailErr = err.customData?.email;
        let methods = [];
        try { methods = await fetchSignInMethodsForEmail(auth, emailErr); } catch (e) { void e; }
        const methodList = methods.join(', ');
        setError(`Ya existe una cuenta con ${emailErr}. Inicia sesión usando: ${methodList} y luego vincula Microsoft.`);
      } else {
        setError('Error al iniciar sesión con Microsoft');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ position: 'fixed', inset: 0, minHeight: '100vh', minWidth: '100vw', bgcolor: 'background.default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Paper elevation={3} sx={{ p: 4, maxWidth: 400, width: '100%' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
          <img src="https://costaricacc.com/cccr/Logoheroica.png" alt={BRAND_LOGO_ALT} style={{ height: 60, filter: theme && theme.palette && theme.palette.mode === 'dark' ? 'brightness(0) invert(1)' : 'none' }} />
        </Box>
        <Typography variant="h5" align="center" gutterBottom>Iniciar Sesión</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <FormControl fullWidth margin="normal">
          <InputLabel id="recinto-label">Recinto</InputLabel>
          <Select labelId="recinto-label" value={selectedRecinto} label="Recinto" onChange={(e) => setSelectedRecinto(e.target.value)}>
            {RECINTOS.map(r => (<MenuItem key={r.key} value={r.key}>{r.label}</MenuItem>))}
          </Select>
        </FormControl>

        <Button fullWidth variant="contained" color="primary" sx={{ mt: 2 }} startIcon={<Microsoft />} onClick={handleMicrosoftLogin} disabled={loading}>Iniciar con Microsoft</Button>

        <Typography variant="body2" align="center" sx={{ mt: 2 }}>o</Typography>

        <form onSubmit={handleLogin}>
          <TextField fullWidth margin="normal" label="Correo" type="email" value={email} onChange={e => setEmail(e.target.value)} InputProps={{ startAdornment: (<InputAdornment position="start"><Email sx={{ mr: 1 }} /></InputAdornment>) }} required />
          <TextField fullWidth margin="normal" label="Contraseña" type="password" value={password} onChange={e => setPassword(e.target.value)} InputProps={{ startAdornment: (<InputAdornment position="start"><Lock sx={{ mr: 1 }} /></InputAdornment>) }} required />
          <Button fullWidth variant="contained" color="primary" sx={{ mt: 2 }} type="submit" disabled={loading}>Ingresar</Button>
        </form>

        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Link href="#" onClick={() => navigate('/register')} sx={{ color: theme && theme.palette && theme.palette.mode === 'dark' ? '#fff' : 'inherit' }}>¿No tienes cuenta? Regístrate</Link>
        </Box>
      </Paper>
    </Box>
  );
}

