// Utilidades de roles y permisos
export const isAdminRole = (userData) => {
  return Boolean(userData?.isSuperAdmin || userData?.rol === 'admin');
};

// Gerencia General (rol 'gerencia') puede ver todos los tickets pero no tiene permisos admin para módulos
export const canViewAllTickets = (userData) => {
  if (!userData) return false;
  return isAdminRole(userData) || (String(userData?.rol || '').toLowerCase() === 'gerencia' || String(userData?.rol || '').toLowerCase() === 'gerencia_general');
};

export default {
  isAdminRole,
  canViewAllTickets,
};