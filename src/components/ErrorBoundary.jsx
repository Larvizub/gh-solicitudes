import React from 'react';
import { Box, Typography, Button } from '@mui/material';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught error', error, info);
  }
  handleReload = () => {
    // Try to recover without forcing a full reload: reset state to attempt render again
    this.setState({ hasError: false, error: null });
  };
  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 3 }}>
          <Typography variant="h6" color="error" sx={{ mb: 2 }}>Ocurrió un error cargando esta sección.</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{String(this.state.error || '')}</Typography>
          <Button variant="contained" onClick={this.handleReload} sx={{ color: '#fff', '&:hover': { color: '#fff' } }}>Reintentar</Button>
        </Box>
      );
    }
    return this.props.children;
  }
}
