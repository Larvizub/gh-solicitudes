import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Avatar,
  useTheme,
  Fade,
  Grow,
  alpha,
  IconButton,
  Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES UI COMPARTIDOS - Estilo visual coherente
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

// Encabezado de página con título e icono
export function PageHeader({ 
  title, 
  subtitle, 
  icon: Icon, 
  action, 
  onRefresh,
  gradient = 'primary' 
}) {
  const theme = useTheme();
  const bg = typeof gradients[gradient] === 'function' 
    ? gradients[gradient](theme) 
    : gradients[gradient];

  return (
    <Fade in timeout={400}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 3 },
          mb: 3,
          borderRadius: 4,
          background: bg,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decoración de fondo */}
        {Icon && (
          <Box
            sx={{
              position: 'absolute',
              right: { xs: -20, sm: 20 },
              top: '50%',
              transform: 'translateY(-50%)',
              opacity: 0.1,
            }}
          >
            <Icon sx={{ fontSize: { xs: 80, sm: 120 } }} />
          </Box>
        )}
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, zIndex: 1 }}>
          {Icon && (
            <Avatar 
              sx={{ 
                bgcolor: alpha('#fff', 0.2), 
                width: { xs: 48, sm: 56 }, 
                height: { xs: 48, sm: 56 } 
              }}
            >
              <Icon sx={{ fontSize: { xs: 28, sm: 32 }, color: '#fff' }} />
            </Avatar>
          )}
          <Box>
            <Typography 
              variant="h4" 
              sx={{ 
                fontWeight: 800, 
                letterSpacing: 1,
                fontSize: { xs: '1.5rem', sm: '2rem' }
              }}
            >
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, zIndex: 1 }}>
          {onRefresh && (
            <Tooltip title="Actualizar">
              <IconButton 
                onClick={onRefresh}
                sx={{ 
                  color: '#fff',
                  bgcolor: alpha('#fff', 0.15),
                  '&:hover': { bgcolor: alpha('#fff', 0.25) }
                }}
              >
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          )}
          {action}
        </Box>
      </Paper>
    </Fade>
  );
}

// Tarjeta con efecto glass
export function GlassCard({ 
  children, 
  sx = {}, 
  elevation = 0, 
  delay = 0,
  ...props 
}) {
  const theme = useTheme();
  
  return (
    <Grow in timeout={500 + delay}>
      <Paper
        elevation={elevation}
        sx={{
          p: { xs: 2, sm: 3 },
          borderRadius: 4,
          bgcolor: theme.palette.mode === 'dark' 
            ? alpha(theme.palette.background.paper, 0.8)
            : alpha(theme.palette.background.paper, 0.9),
          backdropFilter: 'blur(10px)',
          border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          transition: 'transform 0.2s, box-shadow 0.3s',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: theme.shadows[8],
          },
          ...sx,
        }}
        {...props}
      >
        {children}
      </Paper>
    </Grow>
  );
}

// Tarjeta de estadísticas con gradiente
export function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  gradient = 'primary',
  trend,
  trendLabel,
  delay = 0,
  onClick
}) {
  const theme = useTheme();
  const bg = typeof gradients[gradient] === 'function' 
    ? gradients[gradient](theme) 
    : gradients[gradient];

  return (
    <Grow in timeout={500 + delay}>
      <Paper
        elevation={0}
        onClick={onClick}
        sx={{
          p: 2.5,
          borderRadius: 3,
          background: bg,
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
          minHeight: 130,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          cursor: onClick ? 'pointer' : 'default',
          transition: 'transform 0.2s, box-shadow 0.2s',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: theme.shadows[12],
          },
        }}
      >
        {/* Icono decorativo de fondo */}
        {Icon && (
          <Box
            sx={{
              position: 'absolute',
              right: -10,
              top: -10,
              opacity: 0.15,
              transform: 'rotate(-15deg)',
            }}
          >
            <Icon sx={{ fontSize: 100 }} />
          </Box>
        )}
        
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', zIndex: 1 }}>
          <Box>
            <Typography variant="body2" sx={{ opacity: 0.9, fontWeight: 500, mb: 0.5 }}>
              {title}
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
              {value}
            </Typography>
          </Box>
          {Icon && (
            <Avatar sx={{ bgcolor: alpha('#fff', 0.2), width: 44, height: 44 }}>
              <Icon sx={{ color: '#fff' }} />
            </Avatar>
          )}
        </Box>
        
        {(subtitle || trend !== undefined) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, zIndex: 1 }}>
            {subtitle && (
              <Typography variant="caption" sx={{ opacity: 0.85 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
        )}
      </Paper>
    </Grow>
  );
}

// Contenedor de sección con título
export function SectionContainer({ title, icon: Icon, children, action, sx = {} }) {
  const theme = useTheme();
  
  return (
    <GlassCard sx={{ mb: 3, ...sx }}>
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        mb: 2,
        pb: 2,
        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {Icon && (
            <Avatar 
              sx={{ 
                bgcolor: alpha(theme.palette.primary.main, 0.1), 
                width: 40, 
                height: 40 
              }}
            >
              <Icon sx={{ color: theme.palette.primary.main, fontSize: 22 }} />
            </Avatar>
          )}
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
        </Box>
        {action}
      </Box>
      {children}
    </GlassCard>
  );
}

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

// Botón de acción principal estilizado
export function PrimaryActionButton({ 
  children, 
  icon: Icon, 
  gradient = 'primary',
  sx = {},
  ...props 
}) {
  const theme = useTheme();
  const bg = typeof gradients[gradient] === 'function' 
    ? gradients[gradient](theme) 
    : gradients[gradient];

  return (
    <Box
      component="button"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 3,
        py: 1.5,
        border: 'none',
        borderRadius: 3,
        background: bg,
        color: '#fff',
        fontWeight: 700,
        fontSize: '0.95rem',
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
        boxShadow: theme.shadows[4],
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: theme.shadows[8],
        },
        '&:active': {
          transform: 'translateY(0)',
        },
        '&:disabled': {
          opacity: 0.6,
          cursor: 'not-allowed',
          transform: 'none',
        },
        ...sx,
      }}
      {...props}
    >
      {Icon && <Icon sx={{ fontSize: 20 }} />}
      {children}
    </Box>
  );
}

// Estado vacío con icono
export function EmptyState({ icon: Icon, title, subtitle }) {
  const theme = useTheme();
  
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 6,
        color: 'text.secondary',
      }}
    >
      {Icon && (
        <Avatar
          sx={{
            width: 80,
            height: 80,
            bgcolor: alpha(theme.palette.primary.main, 0.1),
            mb: 2,
          }}
        >
          <Icon sx={{ fontSize: 40, color: theme.palette.primary.main, opacity: 0.7 }} />
        </Avatar>
      )}
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {subtitle}
        </Typography>
      )}
    </Box>
  );
}

// Layout contenedor principal para módulos
export function ModuleContainer({ children, maxWidth = '100vw' }) {
  return (
    <Box
      sx={{
        p: { xs: 1.5, sm: 2, md: 3 },
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
        minHeight: '90vh',
        width: '100%',
        maxWidth,
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </Box>
  );
}

export default {
  gradients,
  PageHeader,
  GlassCard,
  StatCard,
  SectionContainer,
  tableStyles,
  dialogStyles,
  PrimaryActionButton,
  EmptyState,
  ModuleContainer,
};
