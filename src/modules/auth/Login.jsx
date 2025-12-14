import React, { useState, useEffect } from 'react';
import { Box, Typography, TextField, Button, Link, InputAdornment, Alert, Select, MenuItem, FormControl, InputLabel, IconButton, Divider, Fade, Grow } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { Email, Lock, Microsoft, Visibility, VisibilityOff, LoginOutlined } from '@mui/icons-material';
import { signInWithEmailAndPassword, OAuthProvider, signInWithPopup, fetchSignInMethodsForEmail, signOut } from 'firebase/auth';
import { auth } from '../../firebase/firebaseConfig';
import { useDb } from '../../context/DbContext';
import { BRAND_LOGO_ALT } from '../../config/branding';
import { getDbForRecinto } from '../../firebase/multiDb';
import { ref, update } from 'firebase/database';

// Provider de Microsoft para Firebase Auth
const msProvider = new OAuthProvider('microsoft.com');
msProvider.addScope('user.read');
msProvider.setCustomParameters({
  prompt: 'select_account',
  tenant: 'common'
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
      // Verificar que el valor guardado sea uno de los recintos válidos
      if (stored && RECINTOS.some(r => r.key === stored)) {
        return stored;
      }
      return 'CORPORATIVO';
    } catch {
      return 'CORPORATIVO';
    }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);


  // Guardar en localStorage cuando cambie el valor
  useEffect(() => {
    try {
      localStorage.setItem('selectedRecinto', selectedRecinto);
    } catch {
      // Silenciar error
    }
  }, [selectedRecinto]);
  // Estado para mostrar/ocultar contraseña
  const [showPassword, setShowPassword] = useState(false);

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
    <Box sx={{
      position: 'fixed',
      inset: 0,
      minHeight: '100vh',
      minWidth: '100vw',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 50%, ${theme.palette.secondary.main} 100%)`,
      overflow: 'hidden',
      '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.1) 0%, transparent 50%), radial-gradient(circle at 70% 80%, rgba(255,255,255,0.08) 0%, transparent 40%)',
        pointerEvents: 'none',
      }
    }}>
      <Fade in={true} timeout={800}>
        <Box sx={{
          background: alpha(theme.palette.background.paper, 0.9),
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 4,
          border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
          boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.25)}`,
          p: { xs: 3, sm: 5 },
          width: '100%',
          maxWidth: 420,
          mx: 2,
        }}>
          {/* Logo */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
            <Grow in={true} timeout={1000}>
              <Box
                component="img"
                src="https://costaricacc.com/cccr/Logoheroica.png"
                alt={BRAND_LOGO_ALT}
                sx={{
                  height: 70,
                  filter: theme.palette.mode === 'dark' ? 'brightness(0) invert(1)' : 'none',
                  transition: 'transform 0.3s ease',
                  '&:hover': { transform: 'scale(1.05)' }
                }}
              />
            </Grow>
          </Box>

          {/* Title */}
          <Typography
            variant="h4"
            align="center"
            gutterBottom
            sx={{
              fontWeight: 700,
              background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              mb: 1
            }}
          >
            Bienvenido
          </Typography>
          <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
            Inicia sesión para continuar
          </Typography>

          {/* Error Alert */}
          {error && (
            <Fade in={true}>
              <Alert
                severity="error"
                sx={{
                  mb: 2,
                  borderRadius: 2,
                  '& .MuiAlert-icon': { alignItems: 'center' }
                }}
              >
                {error}
              </Alert>
            </Fade>
          )}

          {/* Recinto Selector */}
          <FormControl
            fullWidth
            sx={{
              mb: 2,
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                transition: 'all 0.3s ease',
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: theme.palette.primary.main,
                },
                '&.Mui-focused': {
                  boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.15)}`,
                }
              }
            }}
          >
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

          {/* Microsoft Login Button */}
          <Button
            fullWidth
            variant="outlined"
            onClick={handleMicrosoftLogin}
            disabled={loading}
            startIcon={<Microsoft />}
            sx={{
              py: 1.5,
              borderRadius: 2,
              fontWeight: 600,
              textTransform: 'none',
              fontSize: '1rem',
              background: alpha(theme.palette.background.default, 0.8),
              color: theme.palette.text.primary,
              border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
              boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, 0.1)}`,
              transition: 'all 0.3s ease',
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.15)}`,
                background: alpha(theme.palette.background.paper, 1),
                borderColor: theme.palette.primary.main,
              },
              '&:disabled': {
                transform: 'none',
                boxShadow: 'none',
              }
            }}
          >
            Iniciar con Microsoft
          </Button>

          {/* Divider */}
          <Divider sx={{ my: 3 }}>
            <Typography variant="body2" color="text.secondary">
              o continúa con email
            </Typography>
          </Divider>

          {/* Email/Password Form */}
          <form onSubmit={handleLogin}>
            <TextField
              fullWidth
              margin="normal"
              label="Correo"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  transition: 'all 0.3s ease',
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: theme.palette.primary.main,
                  },
                  '&.Mui-focused': {
                    boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.15)}`,
                  }
                }
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Email color="action" />
                  </InputAdornment>
                )
              }}
            />
            <TextField
              fullWidth
              margin="normal"
              label="Contraseña"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  transition: 'all 0.3s ease',
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: theme.palette.primary.main,
                  },
                  '&.Mui-focused': {
                    boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.15)}`,
                  }
                }
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Lock color="action" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      onClick={() => setShowPassword((prev) => !prev)}
                      edge="end"
                      size="small"
                    >
                      {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                )
              }}
            />
            <Button
              fullWidth
              variant="contained"
              type="submit"
              disabled={loading}
              startIcon={<LoginOutlined />}
              sx={{
                mt: 3,
                py: 1.5,
                borderRadius: 2,
                fontWeight: 600,
                textTransform: 'none',
                fontSize: '1rem',
                color: '#ffffff',
                background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
                boxShadow: `0 4px 14px ${alpha(theme.palette.primary.main, 0.4)}`,
                transition: 'all 0.3s ease',
                '&:hover': {
                  color: '#ffffff',
                  transform: 'translateY(-2px)',
                  boxShadow: `0 6px 20px ${alpha(theme.palette.primary.main, 0.5)}`,
                  background: `linear-gradient(135deg, ${theme.palette.primary.light} 0%, ${theme.palette.primary.main} 100%)`,
                },
                '&:disabled': {
                  color: 'rgba(255,255,255,0.6)',
                  transform: 'none',
                  boxShadow: 'none',
                }
              }}
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </Button>
          </form>

          {/* Register Link */}
          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              ¿No tienes cuenta?{' '}
              <Link
                href="#"
                onClick={(e) => { e.preventDefault(); navigate('/register'); }}
                sx={{
                  color: theme.palette.primary.main,
                  fontWeight: 600,
                  textDecoration: 'none',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    color: theme.palette.primary.dark,
                    textDecoration: 'underline',
                  }
                }}
              >
                Regístrate
              </Link>
            </Typography>
          </Box>
        </Box>
      </Fade>
    </Box>
  );
}

