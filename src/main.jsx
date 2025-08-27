
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { getTheme } from './theme/theme';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { DbProvider } from './context/DbContext';
import './index.css';

const mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const theme = getTheme(mode);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
      <DbProvider>
        <AuthProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <App />
          </ThemeProvider>
        </AuthProvider>
      </DbProvider>
  </React.StrictMode>
);

// Register service worker for basic offline support and PWA installability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = '/sw.js';
    navigator.serviceWorker.register(swUrl).then(reg => {
      console.log('Service Worker registrado:', reg.scope);
    }).catch(err => {
      console.warn('Error registrando Service Worker:', err);
    });
  });
}
