import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Outlet } from 'react-router-dom';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import AppBarHeroica from './AppBarHeroica';
import SidebarHeroica from './SidebarHeroica';
import { useAuth } from '../context/useAuth';
import { useDb } from '../context/DbContext';

function LayoutHeroica() {
  const { userData, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!userData) return;
    const isMicrosoftProvider = (user?.providerData || []).map(p => p.providerId || '').join(',').includes('microsoft') || String(user?.email || '').toLowerCase().includes('microsoft');
    if (userData.needsDepartmentSelection || (isMicrosoftProvider && !(userData.departamento && userData.departamento.trim()))) {
      navigate('/perfil', { replace: true });
    }
  }, [userData, user, navigate]);
  const role = userData?.rol || 'estandar';
  const { recinto } = useDb();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mini, setMini] = useState(false);
  const handleDrawerToggle = () => setMobileOpen(!mobileOpen);
  const handleMiniToggle = () => setMini((prev) => !prev);

  // Altura de la AppBar
  const APP_BAR_HEIGHT = 64;
  const SIDEBAR_WIDTH = mini ? 64 : 240;

  return (
    <Box sx={{ display: 'flex' }}>
      {/* AppBar con zIndex superior */}
      <AppBarHeroica onMenuClick={handleDrawerToggle} onMiniToggle={handleMiniToggle} isMini={mini} recinto={recinto} />
      {/* Sidebar temporal para móvil */}
      <SidebarHeroica
        open={mobileOpen}
        onClose={handleDrawerToggle}
        variant="temporary"
        role={role}
      />
      {/* Sidebar permanente para desktop, debajo de la AppBar */}
      <Box
        sx={{
          width: { sm: SIDEBAR_WIDTH },
          flexShrink: 0,
          display: { xs: 'none', sm: 'block' },
          position: 'fixed',
          top: APP_BAR_HEIGHT,
          left: 0,
          height: `calc(100vh - ${APP_BAR_HEIGHT}px)`,
          zIndex: (theme) => theme.zIndex.appBar - 1,
        }}
      >
        <SidebarHeroica open variant="permanent" role={role} mini={mini} />
      </Box>
      {/* Contenido principal con margen izquierdo y superior */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3 },
          width: { sm: `calc(100% - ${SIDEBAR_WIDTH}px)` },
          ml: { sm: `${SIDEBAR_WIDTH}px` },
          mt: `${APP_BAR_HEIGHT}px`,
          minWidth: 0,
        }}
      >
        {/* Renderizar rutas hijas */}
        <Outlet />
      </Box>
    </Box>
  );
}

export default LayoutHeroica;
