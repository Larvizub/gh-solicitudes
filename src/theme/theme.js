import { createTheme } from '@mui/material/styles';
import { heroicaPalette } from './palette';

export const getTheme = (mode = 'light') =>
  createTheme({
    palette: {
      mode,
      ...heroicaPalette,
      background: {
        default: mode === 'light' ? '#f5f5f5' : '#121212',
        paper: mode === 'light' ? '#fff' : '#1e1e1e',
      },
      text: {
        primary: mode === 'light' ? heroicaPalette.text.primary : '#e6eef0',
        secondary: mode === 'light' ? heroicaPalette.text.secondary : '#b0bec5',
      },
      divider: mode === 'light' ? heroicaPalette.divider : 'rgba(255,255,255,0.08)',
    },
    typography: {
      fontFamily: 'Roboto, Arial, sans-serif',
    },
    components: {
      MuiAppBar: {
        styleOverrides: {
          root: {
            background: heroicaPalette.primary.main,
            color: heroicaPalette.primary.contrastText,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: mode === 'light' ? undefined : '#1e1e1e',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            // Asegurar texto blanco en botones con gradientes/fondos oscuros
            '&.MuiButton-contained': {
              color: '#ffffff',
            },
          },
          containedPrimary: {
            color: '#ffffff',
            '&:hover': {
              color: '#ffffff',
            },
          },
          containedSecondary: {
            color: '#ffffff',
            '&:hover': {
              color: '#ffffff',
            },
          },
          contained: {
            color: '#ffffff',
          },
          outlined: {
            ...(mode === 'dark'
              ? {
                  borderColor: 'rgba(255,255,255,0.23)',
                  color: '#e6eef0',
                  '&:hover': {
                    borderColor: 'rgba(255,255,255,0.5)',
                  },
                }
              : {}),
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            ...(mode === 'dark' ? {
              // keep outline color visible and avoid theme-green tint on focus
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.7)' },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.9)' },
            } : {}),
          },
          notchedOutline: {
            ...(mode === 'dark' ? { borderColor: 'rgba(255,255,255,0.6)' } : {}),
          },
        },
      },
      MuiFilledInput: {
        styleOverrides: {
          root: {
            ...(mode === 'dark' ? {
              // adjust underline for filled inputs on focus
              '&:hover:before': { borderBottomColor: 'rgba(255,255,255,0.6)' },
              '&:before': { borderBottomColor: 'rgba(255,255,255,0.4)' },
              '&:after': { borderBottomColor: 'rgba(255,255,255,0.9)' },
            } : {}),
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            ...(mode === 'dark' ? {
              color: 'rgba(255,255,255,0.7)',
              '&.Mui-focused': { color: 'rgba(255,255,255,0.95)' },
            } : {}),
          },
        },
      },
    },
  });
