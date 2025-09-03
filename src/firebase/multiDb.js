import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

// Mapeo de recintos a URLs de Realtime Database
const RECINTO_DB_URLS = {
  GRUPO_HEROICA: import.meta.env.VITE_FIREBASE_DATABASE_URL_GRUPO_HEROICA, // Se deja como está en caso de crear un error en cascada
  CCCI: import.meta.env.VITE_FIREBASE_DATABASE_URL_CCCI,
  CCCR: import.meta.env.VITE_FIREBASE_DATABASE_URL_CCCR,
  CEVP: import.meta.env.VITE_FIREBASE_DATABASE_URL_CEVP,
  CORPORATIVO: import.meta.env.VITE_FIREBASE_DATABASE_URL_CORPORATIVO || import.meta.env.VITE_FIREBASE_DATABASE_URL_GRUPO_HEROICA,
};

// Cache de apps por URL
const apps = {};

export function getDbForRecinto(recintoKey) {
  const url = RECINTO_DB_URLS[recintoKey] || RECINTO_DB_URLS.GRUPO_HEROICA;
  if (apps[url]) return apps[url];
  // Inicializamos una app aislada con solo el databaseURL
  const config = { databaseURL: url };
  const name = `db-${recintoKey}`;
  try {
    const app = initializeApp(config, name);
    const db = getDatabase(app);
    apps[url] = db;
    return db;
  } catch (err) {
    // Si falla (por ejemplo, ya existe una app con ese nombre), intentar obtenerla
    try {
  return import('firebase/app').then(module => {
        const getApps = module.getApps;
        const existing = getApps().find(a => a.name === name);
        if (existing) {
          const db = getDatabase(existing);
          apps[url] = db;
          return db;
        }
        // si no existe, re-throw el error original
        throw err;
      });
    } catch {
      // ignore
    }
    throw err;
  }
}

// Exportar mapping público en caso de necesitarse en UI
export const RECINTO_DB_MAP = RECINTO_DB_URLS;
