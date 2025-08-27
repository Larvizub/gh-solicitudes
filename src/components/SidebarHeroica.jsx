import React from 'react';
import { useAuth } from '../context/useAuth';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListItemButton from '@mui/material/ListItemButton';
import Divider from '@mui/material/Divider';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AssignmentIcon from '@mui/icons-material/Assignment';
import BarChartIcon from '@mui/icons-material/BarChart';
import ApartmentIcon from '@mui/icons-material/Apartment';
import SettingsIcon from '@mui/icons-material/Settings';
import PeopleIcon from '@mui/icons-material/People';
import EmailIcon from '@mui/icons-material/Email';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useNavigate, useLocation } from 'react-router-dom';


const adminItems = [
  { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
  { text: 'Tickets', icon: <AssignmentIcon />, path: '/tickets' },
  { text: 'Reportes', icon: <BarChartIcon />, path: '/reportes' },
  { text: 'Departamentos', icon: <ApartmentIcon />, path: '/departamentos' },
  { text: 'Departamentos-Usuarios', icon: <PeopleIcon />, path: '/departamentos-usuarios' },
  { text: 'Config. Tickets', icon: <SettingsIcon />, path: '/config-tickets' },
  { text: 'Subcategorías', icon: <SettingsIcon />, path: '/config-subcategorias' },
  { text: 'Motivos Pausa', icon: <ScheduleIcon />, path: '/pause-reasons' },
  { text: 'Usuarios', icon: <PeopleIcon />, path: '/usuarios' },
  { text: 'SLA', icon: <ScheduleIcon />, path: '/sla' },
  { text: 'Config. Correo', icon: <EmailIcon />, path: '/config-correo' },
  { text: 'Perfil', icon: <AccountCircleIcon />, path: '/perfil' },
];

const estandarItems = [
  { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
  { text: 'Tickets', icon: <AssignmentIcon />, path: '/tickets' },
  { text: 'Reportes', icon: <BarChartIcon />, path: '/reportes' },
  { text: 'Perfil', icon: <AccountCircleIcon />, path: '/perfil' },
];


const SidebarHeroica = ({ role, mini, variant, open, onClose, sx }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { userData, user } = useAuth();
  // Determinar rol efectivo: si el usuario autenticado tiene isSuperAdmin o rol 'admin', forzar admin
  const effectiveRole = (userData?.isSuperAdmin || userData?.rol === 'admin') ? 'admin' : (role || 'estandar');
  const filteredItems = effectiveRole === 'admin' ? adminItems : estandarItems;
  // Altura de la AppBar
  const APP_BAR_HEIGHT = 64;
  const SIDEBAR_WIDTH = mini ? 64 : 240;
  
  return (
    <Drawer
      variant={variant}
      open={open}
      onClose={onClose}
      sx={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
          '& .MuiDrawer-paper': {
          width: SIDEBAR_WIDTH,
          boxSizing: 'border-box',
          overflowX: 'hidden',
          transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1), background 0.3s',
          background: theme => mini ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.85)') : 'background.paper',
          backdropFilter: mini ? 'blur(4px)' : 'none',
          boxShadow: mini ? 3 : 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          ...(variant === 'permanent' && {
            top: `${APP_BAR_HEIGHT}px`,
            height: `calc(100vh - ${APP_BAR_HEIGHT}px)`
          }),
        },
        ...sx,
      }}
    >
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <List>
          {filteredItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <ListItem key={item.text} sx={{ px: 0 }}>
                <ListItemButton
                  selected={isActive}
                  onClick={() => {
                    if (!isActive) navigate(item.path);
                    // Close drawer on mobile / temporary variants after navigation
                    if (variant !== 'permanent' && typeof onClose === 'function') onClose();
                  }}
                  sx={{ justifyContent: mini ? 'center' : 'flex-start', px: mini ? 1 : 2 }}
                >
                  <ListItemIcon sx={{ minWidth: 0, mr: mini ? 0 : 2, justifyContent: 'center' }}>{item.icon}</ListItemIcon>
                  {!mini && <ListItemText primary={item.text} />}
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
        <Divider />
      </Box>
      {/* Usuario en la parte inferior */}
  <Box sx={{ p: 2, pb: 3, display: 'flex', alignItems: 'center', gap: 1, minHeight: 64, background: theme => mini ? 'transparent' : (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)') }}>
        <Avatar src={user?.photoURL || undefined} sx={{ width: 40, height: 40, fontSize: 22 }}>
          {(!user?.photoURL && userData?.nombre) ? userData.nombre[0] : ''}
        </Avatar>
        {!mini && (
          <Box sx={{ ml: 1, minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" noWrap fontWeight={600}>{userData?.nombre || 'Usuario'}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>{user?.email || ''}</Typography>
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

export default SidebarHeroica;
