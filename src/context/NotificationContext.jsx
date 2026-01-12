import React, { createContext, useState, useCallback, useEffect } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import { registerForPush, listenForegroundMessages } from '../services/fcm';

const NotificationContext = createContext();
function NotificationProvider({ children }) {
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');
  const [toastDuration, setToastDuration] = useState(3000);
  const [toastPersist, setToastPersist] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalSeverity, setModalSeverity] = useState('success');

  const notify = useCallback((msg, sev = 'success', options = {}) => {
  try { console.debug('[Notification] notify called', { msg, sev, options }); } catch { /* ignore */ }
    const { mode = 'toast', duration = 3000, persist = false } = options || {};
    if (mode === 'modal') {
      setModalMessage(msg);
      setModalSeverity(sev);
      setModalOpen(true);
    } else {
      setToastMessage(msg);
      setToastSeverity(sev);
      setToastDuration(duration || 3000);
      setToastPersist(Boolean(persist));
      setToastOpen(true);
    }
  }, []);

  const enableNotifications = useCallback(async () => {
    try {
      const token = await registerForPush();
      if (token) {
        notify('Notificaciones activadas con éxito', 'success');
        return token;
      } else {
        notify('No se pudieron activar las notificaciones. Verifica los permisos de tu navegador.', 'warning');
      }
    } catch (error) {
      console.error('Error enabling notifications:', error);
      notify('Error al activar notificaciones', 'error');
    }
    return null;
  }, [notify]);

  useEffect(() => {
    const unsubscribe = listenForegroundMessages((payload) => {
      console.log('Foreground notification received in context:', payload);
      const title = payload.notification?.title || 'Nueva notificación';
      const body = payload.notification?.body || 'Tienes un nuevo mensaje';
      notify(`${title}: ${body}`, 'info', { duration: 6000 });
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [notify]);

  const handleToastClose = (_, reason) => {
    if (reason === 'clickaway') return;
    setToastOpen(false);
  };

  const handleModalClose = () => setModalOpen(false);

  return (
    <NotificationContext.Provider value={{ notify, enableNotifications }}>
      {children}

      {/* Toast positioned top-right so it's visible regardless of scroll */}
      <Snackbar
        open={toastOpen}
        autoHideDuration={toastPersist ? null : toastDuration}
        onClose={handleToastClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert onClose={handleToastClose} severity={toastSeverity} sx={{ width: '100%' }}>
          {toastMessage}
        </Alert>
      </Snackbar>

      {/* Modal dialog for critical or persistent notifications */}
      <Dialog open={modalOpen} onClose={handleModalClose} maxWidth="xs" fullWidth>
        <DialogTitle>Notificación</DialogTitle>
        <DialogContent>
          <Alert severity={modalSeverity}>{modalMessage}</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleModalClose} variant="contained" sx={{ color: '#fff', '&:hover': { color: '#fff' } }}>Cerrar</Button>
        </DialogActions>
      </Dialog>

    </NotificationContext.Provider>
  );
}

export default NotificationProvider;
export { NotificationContext };
