import { ref, get, getDatabase } from 'firebase/database';
import { initializeApp } from 'firebase/app';
import { getDbForRecinto, RECINTO_DB_MAP } from '../firebase/multiDb';

// Rutas candidatas donde distintos proyectos pueden almacenar listas/flags de excepción
export const USERS_EXCEPTIONS = [
  'corporativo_authorized_users',
  'corporativo_allowed',
  'corporativo_allowed_users',
  'corporativo_exceptions',
  'corporativo_user_exceptions',
  'usuarios_excepciones',
  'exceptions',
];

// Revisa en todas las DBs mapeadas si existe autorización para uid hacia Corporativo
export async function canAccessCorporativo(uid) {
  if (!uid) return { authorized: false };
  const keys = Object.keys(RECINTO_DB_MAP || {});
  for (const key of keys) {
    try {
      const db = await getDbForRecinto(key);
      if (!db) continue;
      // check multiple possible exception nodes in this DB
      for (const path of USERS_EXCEPTIONS) {
        try {
          const snap = await get(ref(db, `${path}/${uid}`));
          if (snap && snap.exists()) {
            const val = snap.val();
            // acepta varias formas: boolean true, objeto con allowed:true, o cualquier objeto/registro
            if (val === true || (val && val.allowed === true) || (val && typeof val === 'object') ) {
              return { authorized: true, foundIn: key, path, record: val };
            }
          }
        } catch (innerErr) {
          // ignorar errores leyendo rutas concretas
          console.debug('canAccessCorporativo: error leyendo ruta', path, 'en', key, innerErr && innerErr.message ? innerErr.message : innerErr);
          continue;
        }
      }
    } catch (e) {
      // ignorar errores de lectura en recintos donde no tengamos permiso
      console.debug('canAccessCorporativo: error chequeando', key, e && e.message ? e.message : e);
      continue;
    }
  }
  // Si no lo encontramos, intentar directamente la URL conocida de Corporativo
  try {
    const corpUrl = 'https://gh-solicitudes-default-rtdb.firebaseio.com/';
    // crear app temporal
    const tmpName = `corp-check-${Math.random().toString(36).slice(2,8)}`;
    const app = initializeApp({ databaseURL: corpUrl }, tmpName);
    const db = getDatabase(app);
    try {
      for (const path of USERS_EXCEPTIONS) {
        try {
          const snap = await get(ref(db, `${path}/${uid}`));
          if (snap && snap.exists()) {
            const val = snap.val();
            if (val === true || (val && val.allowed === true) || (val && typeof val === 'object')) {
              return { authorized: true, foundIn: 'GRUPO_HEROICA-URL', path, record: val };
            }
          }
        } catch (innerErr) {
          console.debug('canAccessCorporativo: error leyendo ruta en URL directa', path, innerErr && innerErr.message ? innerErr.message : innerErr);
          continue;
        }
      }
    } catch (e) {
      console.debug('canAccessCorporativo: intento directo a URL corporativo falló', e && e.message ? e.message : e);
    }
  } catch (e) {
    console.debug('canAccessCorporativo: no pudo inicializar app temporal para URL corporativo', e && e.message ? e.message : e);
  }

  return { authorized: false };
}

export default canAccessCorporativo;
