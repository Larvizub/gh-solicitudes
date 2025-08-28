import React, { Suspense } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { NotificationProvider } from './context/NotificationContext';
import ErrorBoundary from './components/ErrorBoundary';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './modules/auth/Login';
import Register from './modules/auth/Register';
import LayoutHeroica from './components/LayoutHeroica';
import Dashboard from './modules/Dashboard';

const Tickets = React.lazy(() => import('./modules/Tickets'));
const TicketPage = React.lazy(() => import('./modules/TicketPage'));
const Reportes = React.lazy(() => import('./modules/Reportes'));
const Departamentos = React.lazy(() => import('./modules/Departamentos'));
const DepartamentosUsuarios = React.lazy(() => import('./modules/DepartamentosUsuarios'));
const ConfigTickets = React.lazy(() => import('./modules/ConfigTickets'));
const Usuarios = React.lazy(() => import('./modules/Usuarios'));
const ConfigSubcategorias = React.lazy(() => import('./modules/ConfigSubcategorias'));
const Perfil = React.lazy(() => import('./modules/Perfil'));
const Sla = React.lazy(() => import('./modules/Sla'));
const PauseReasons = React.lazy(() => import('./modules/PauseReasons'));


import { useAuth } from './context/useAuth';


export default function App() {
  const { user, userData, loading, dbAccessError } = useAuth();
  const isAuthenticated = !!user;
  const userRole = userData?.rol || 'estandar';
  const needsDeptRedirect = isAuthenticated && !(userData?.departamento && userData.departamento.trim());

  return (
    <NotificationProvider>
  {loading ? (
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={60} />
        </Box>
  ) : (
        <BrowserRouter>
          <ErrorBoundary>
          <Suspense fallback={
            <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CircularProgress size={60} />
            </Box>
          }>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
        {isAuthenticated ? (
                <Route element={<LayoutHeroica />}>
          {needsDeptRedirect && <Route path="*" element={<Navigate to="/perfil" replace />} />}
                  <Route path="/dashboard" element={userData?.needsDepartmentSelection ? <Navigate to="/perfil" replace /> : <Dashboard />} />
                  <Route path="/tickets" element={<Tickets />} />
                  <Route path="/tickets/new" element={<TicketPage />} />
                  <Route path="/tickets/:id" element={<TicketPage />} />
                  <Route path="/sla" element={<Sla />} />
                  <Route path="/reportes" element={<Reportes />} />
                  {userRole === 'admin' && <Route path="/departamentos" element={<Departamentos />} />}
                  {userRole === 'admin' && <Route path="/departamentos-usuarios" element={<DepartamentosUsuarios />} />}
                  {userRole === 'admin' && <Route path="/config-tickets" element={<ConfigTickets />} />}
                  {userRole === 'admin' && <Route path="/config-subcategorias" element={<ConfigSubcategorias />} />}
                  {userRole === 'admin' && <Route path="/usuarios" element={<Usuarios />} />}
                  {userRole === 'admin' && <Route path="/pause-reasons" element={<PauseReasons />} />}
                  <Route path="/perfil" element={<Perfil />} />
                  <Route path="*" element={<Navigate to="/dashboard" />} />
                </Route>
              ) : (
                <Route path="*" element={<Navigate to="/login" />} />
              )}
            </Routes>
          </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
      )}
        <Snackbar open={Boolean(dbAccessError)} autoHideDuration={10000} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert severity="warning" sx={{ width: '100%' }}>
            No se pudieron leer permisos/datos del usuario en la base de datos seleccionada. La aplicación usará datos de sesión básicos; revisa el recinto o contacta al administrador si algo falta.
          </Alert>
        </Snackbar>
    </NotificationProvider>
  );
}
