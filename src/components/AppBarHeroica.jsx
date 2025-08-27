import React, { useState } from 'react';
import { useAuth } from '../context/useAuth';
import { useNavigate } from 'react-router-dom';
import Avatar from '@mui/material/Avatar';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import Box from '@mui/material/Box';

export default function AppBarHeroica({ onMenuClick, onMiniToggle, isMini, recinto }) {
  const { user, userData, logout } = useAuth();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState(null);
  const handleMenu = (event) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);
  const handleLogout = () => {
    handleClose();
    logout();
  };
  const handlePerfil = () => {
    handleClose();
    navigate('/perfil');
  };

  // Formatea el nombre del recinto reemplazando guiones bajos por espacios
  const formattedRecinto = (recinto && typeof recinto === 'string')
    ? recinto.replace(/_/g, ' ')
    : 'GRUPO HEROICA';

  return (
    <AppBar position="fixed" elevation={1}>
      <Toolbar>
        <IconButton
          color="inherit"
          aria-label="open drawer"
          edge="start"
          onClick={onMenuClick}
          sx={{ mr: 2, display: { sm: 'none' } }}
        >
          <MenuIcon />
        </IconButton>
        <IconButton
          color="inherit"
          aria-label="minimizar barra lateral"
          edge="start"
          onClick={onMiniToggle}
          sx={{ mr: 2, display: { xs: 'none', sm: 'inline-flex' } }}
        >
          <ChevronLeftIcon style={{ transform: isMini ? 'rotate(180deg)' : 'none' }} />
        </IconButton>
        <Box
          component="img"
          src="https://costaricacc.com/cccr/Logoheroica.png"
          alt="Logo Grupo Heroica"
          sx={{ height: 40, mr: 2, filter: 'brightness(0) invert(1)' }}
        />
        {/* espacio flexible entre logo y acciones */}
        <Box sx={{ flexGrow: 1 }} />
        {/* Nombre | Recinto al lado izquierdo del avatar (formato: Nombre | Recinto) */}
        <Box sx={{ mr: 1, display: { xs: 'none', sm: 'flex' }, alignItems: 'center', minWidth: 0 }}>
          <Typography
            variant="body2"
            noWrap
            sx={{ fontWeight: 700, mr: 1, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            { (userData?.nombre || user?.displayName)
              ? `${userData?.nombre || user?.displayName} | ${formattedRecinto}`
              : formattedRecinto
            }
          </Typography>
        </Box>
        {/* Icono de usuario y menú (después del nombre) */}
        <IconButton onClick={handleMenu} color="inherit" sx={{ ml: 0 }}>
          <Avatar src={user?.photoURL || undefined} sx={{ width: 36, height: 36, fontSize: 18 }}>
            {(!user?.photoURL && userData?.nombre) ? userData.nombre[0] : ''}
          </Avatar>
        </IconButton>
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem onClick={handlePerfil}>Perfil</MenuItem>
          <MenuItem onClick={handleLogout}>Cerrar sesión</MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
