import { alpha } from '@mui/material';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES Y ESTILOS COMPARTIDOS
// ═══════════════════════════════════════════════════════════════════════════════

// Gradientes predefinidos
export const gradients = {
  primary: (theme) => `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
  secondary: (theme) => `linear-gradient(135deg, ${theme.palette.secondary.main} 0%, ${theme.palette.secondary.dark} 100%)`,
  success: (theme) => `linear-gradient(135deg, ${theme.palette.success.main} 0%, ${theme.palette.success.dark} 100%)`,
  warning: (theme) => `linear-gradient(135deg, ${theme.palette.warning.main} 0%, ${theme.palette.warning.dark} 100%)`,
  error: (theme) => `linear-gradient(135deg, ${theme.palette.error.main} 0%, ${theme.palette.error.dark} 100%)`,
  info: (theme) => `linear-gradient(135deg, ${theme.palette.info.main} 0%, ${theme.palette.info.dark} 100%)`,
  purple: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  orange: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  teal: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  dark: 'linear-gradient(135deg, #434343 0%, #000000 100%)',
};

// Estilo para tablas mejorado
export const tableStyles = {
  container: (theme) => ({
    borderRadius: 3,
    overflow: 'hidden',
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    '& .MuiDataGrid-root': {
      border: 'none',
    },
    '& .MuiDataGrid-columnHeaders': {
      bgcolor: alpha(theme.palette.primary.main, 0.08),
      borderBottom: `2px solid ${alpha(theme.palette.primary.main, 0.2)}`,
    },
    '& .MuiDataGrid-columnHeaderTitle': {
      fontWeight: 700,
    },
    '& .MuiDataGrid-row:hover': {
      bgcolor: alpha(theme.palette.primary.main, 0.04),
    },
    '& .MuiDataGrid-cell': {
      borderColor: alpha(theme.palette.divider, 0.08),
    },
  }),
  paper: (theme) => ({
    borderRadius: 3,
    overflow: 'hidden',
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    boxShadow: theme.shadows[2],
  }),
};

// Estilo para diálogos
export const dialogStyles = {
  paper: {
    borderRadius: 4,
    boxShadow: 24,
  },
  title: (gradient = 'primary') => (theme) => {
    const bg = typeof gradients[gradient] === 'function' 
      ? gradients[gradient](theme) 
      : gradients[gradient];
    return {
      background: bg,
      color: '#fff',
      fontWeight: 800,
      letterSpacing: 1,
      textAlign: 'center',
    };
  },
  content: {
    p: 3,
    bgcolor: 'background.default',
  },
  actions: {
    p: 2,
    bgcolor: 'background.default',
  },
};

// Estilos para botones con gradiente - asegura texto blanco en modo oscuro
export const buttonStyles = {
  primary: (theme) => ({
    background: typeof gradients.primary === 'function' ? gradients.primary(theme) : gradients.primary,
    color: '#ffffff',
    '&:hover': {
      color: '#ffffff',
      opacity: 0.9,
    },
  }),
  success: (theme) => ({
    background: typeof gradients.success === 'function' ? gradients.success(theme) : gradients.success,
    color: '#ffffff',
    '&:hover': {
      color: '#ffffff',
      opacity: 0.9,
    },
  }),
  warning: (theme) => ({
    background: typeof gradients.warning === 'function' ? gradients.warning(theme) : gradients.warning,
    color: '#ffffff',
    '&:hover': {
      color: '#ffffff',
      opacity: 0.9,
    },
  }),
  error: (theme) => ({
    background: typeof gradients.error === 'function' ? gradients.error(theme) : gradients.error,
    color: '#ffffff',
    '&:hover': {
      color: '#ffffff',
      opacity: 0.9,
    },
  }),
  secondary: (theme) => ({
    background: typeof gradients.secondary === 'function' ? gradients.secondary(theme) : gradients.secondary,
    color: '#ffffff',
    '&:hover': {
      color: '#ffffff',
      opacity: 0.9,
    },
  }),
};
