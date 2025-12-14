import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { ref, get, set } from 'firebase/database';
import { auth, db as defaultDb } from '../firebase/firebaseConfig';
import { useDb } from './DbContext';
import { AuthContext } from './AuthContextInternal';

// Lógica de dominios permitidos (copiada de Login.jsx para consistencia)
const ALLOWED_DOMAINS = {
  GRUPO_HEROICA: 'grupoheroica.com',
  CCCI: 'cccartagena.com',
  CCCR: 'costaricacc.com',
  CEVP: 'valledelpacifico.co',
};

const ADMIN_EXCEPTIONS = ['admin@costaricacc.com', 'admin@grupoheroica.com'];
const ADMIN_DOMAIN = 'grupoheroica.com';

const isAdminEmail = (email) => {
  if (!email) return false;
  const lc = email.toLowerCase();
  if (ADMIN_EXCEPTIONS.includes(lc)) return true;
  if (lc.endsWith(`@${ADMIN_DOMAIN}`)) return true;
  return false;
};

const extractEmbeddedDomainFromGuest = (localPart) => {
  if (!localPart) return null;
  const marker = '#ext#';
  const lc = localPart.toLowerCase();
  const idx = lc.indexOf(marker);
  if (idx === -1) return null;
  const before = localPart.slice(0, idx);
  const segments = before.split('_');
  const candidate = segments[segments.length - 1];
  if (candidate && candidate.includes('.')) return candidate.toLowerCase();
  return null;
};

const isEmailAllowedForRecinto = (email, recintoKey) => {
  if (!email) return false;
  const lc = email.toLowerCase();
  if (isAdminEmail(lc)) return true;
  const parts = lc.split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1];
  const allowed = ALLOWED_DOMAINS[recintoKey];
  if (!allowed) return false;
  if (domain === allowed || domain.endsWith('.' + allowed)) return true;
  const local = parts[0];
  const embedded = extractEmbeddedDomainFromGuest(local);
  if (embedded) return embedded === allowed || embedded.endsWith('.' + allowed);
  return false;
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbAccessError, setDbAccessError] = useState(null);
  const { db, loading: dbLoading, RECINTO_DB_MAP } = useDb();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setDbAccessError(null);
      // Dar acceso completo en frontend a super-admins conocidos
  const SUPER_ADMINS = ['admin@costaricacc.com', 'admin@grupoheroica.com'];
  const SUPER_ADMIN_DOMAIN = 'grupoheroica.com';
  const emailLower = String(firebaseUser?.email || '').toLowerCase();
  // Solo tratar como super-admin usuarios explícitos en la lista; no
  // hacer short-circuit para todo el dominio para permitir la lógica
  // de enriquecimiento y selección de departamento en Microsoft logins.
  if (firebaseUser?.email && SUPER_ADMINS.includes(emailLower)) {
        const adminData = {
          nombre: firebaseUser.displayName || 'Admin',
          email: firebaseUser.email,
          rol: 'admin',
          isSuperAdmin: true,
        };
        setUserData(adminData);
        setLoading(false);
        return; // evitar lecturas en DB que causen permission-denied
      }
      if (firebaseUser) {
        // Esperar hasta 10s a que DbProvider termine de inicializar la DB para el recinto seleccionado
        const start = Date.now();
        while (dbLoading && Date.now() - start < 10000) {
          await new Promise((res) => setTimeout(res, 200));
        }
        // Intentar leer desde la DB seleccionada primero
        let data = null;
        let sawPermissionDenied = false;
        try {
          if (db) {
            const snap = await get(ref(db, `usuarios/${firebaseUser.uid}`));
            if (snap && snap.exists()) data = snap.val();
          }
          else {
            // DB seleccionada no inicializada: intentar fallback a la DB por defecto
            console.warn('AuthContext: la DB seleccionada no está inicializada, intentando fallback a DB por defecto');
            try {
              const defSnap = await get(ref(defaultDb, `usuarios/${firebaseUser.uid}`));
              if (defSnap && defSnap.exists()) {
                data = defSnap.val();
                console.info('AuthContext: usuario encontrado en DB por defecto (fallback)');
              }
            } catch (defErr) {
              console.debug('AuthContext: error leyendo DB por defecto en fallback', defErr && defErr.message ? defErr.message : defErr);
            }
          }
        } catch (e) {
          if (e && (e.code?.includes('permission-denied') || String(e).toLowerCase().includes('permission denied'))) {
            sawPermissionDenied = true;
            // diagnóstico: registrar contexto para identificar si es problema de reglas o de distinto proyecto
            try {
              console.warn('AuthContext: permiso denegado al leer usuarios/{uid} en DB seleccionada');
              console.debug('DB seleccionada:', db?.app?.options || db);
              console.debug('Auth app:', auth?.app?.options || auth);
              // Intentar leer en la DB por defecto (para ver si el registro existe ahí)
              if (defaultDb) {
                try {
                  const defSnap = await get(ref(defaultDb, `usuarios/${auth.currentUser?.uid || firebaseUser.uid}`));
                  console.debug('Lectura en DB por defecto:', defSnap && defSnap.exists() ? 'existe' : 'no existe');
                } catch (defErr) {
                  console.debug('Error leyendo DB por defecto (diagnóstico):', defErr && defErr.message ? defErr.message : defErr);
                }
              }
            } catch (diagErr) {
              // no bloquear flujo
              console.debug('AuthContext: fallo diagnóstico permiso-denegado', diagErr);
            }
          } else {
            // removed console.error to avoid noisy error logs
          }
        }

        // Si no obtuvimos datos y hubo permission-denied, primero verificar si el usuario
        // está autorizado en la base Corporativo (GRUPO_HEROICA). Si es así, permitir la sesión.
        if (!data && sawPermissionDenied) {
          let foundCorpAuth = false;
          try {
            const { canAccessCorporativo } = await import('../utils/canAccessCorporativo');
            const res = await canAccessCorporativo(firebaseUser.uid);
            console.debug('AuthContext: canAccessCorporativo result ->', res);
            if (res && res.authorized) {
              data = {
                nombre: (res.record && res.record.displayName) || firebaseUser.displayName || '',
                email: (res.record && res.record.email) || firebaseUser.email || '',
                corporativoAuthorized: true,
                corporativoAuthRecord: res.record || null,
                corporativoFoundIn: res.foundIn || 'unknown'
              };
              foundCorpAuth = true;
            }
          } catch (eCorp) {
            console.debug('AuthContext: fallo comprobando autorización corporativa (helper)', eCorp && eCorp.message ? eCorp.message : eCorp);
          }

          if (!foundCorpAuth) {
            // SEGURIDAD: No buscar automáticamente en otras bases de datos
            // Solo permitir acceso si está explícitamente autorizado para corporativo
            // o si el dominio del usuario permite acceso a la base de datos seleccionada
            console.warn('AuthContext: Usuario no autorizado para acceder a esta base de datos');
            console.debug('AuthContext: Usuario:', firebaseUser.email, 'Recinto actual: contexto de DbContext');

            // Verificar si el usuario debería tener acceso basado en su dominio
            // Esto es una verificación adicional de seguridad
            const currentRecinto = localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA';
            if (isEmailAllowedForRecinto(firebaseUser.email, currentRecinto)) {
              console.debug('AuthContext: Usuario tiene dominio válido para este recinto, pero permission-denied sugiere configuración incorrecta');
            } else {
              console.warn('AuthContext: Usuario NO tiene dominio válido para este recinto');
            }

            setDbAccessError('permission-denied');
            // NO buscar en otras DBs - esto era un agujero de seguridad
          }
        }
  // Si aún no hay datos en la DB, construir un registro inicial y tratar de persistirlo
        if (!data) {
          let displayName = firebaseUser.displayName || '';
          let candidatoDeptFromName = '';
          // Manejar formatos con '|' u otros separadores al final: 'Nombre | DEPT'
          if (displayName.includes('|')) {
            const partsPipe = displayName.split('|').map(s => s.trim()).filter(Boolean);
            if (partsPipe.length > 1) {
              candidatoDeptFromName = partsPipe.pop();
              displayName = partsPipe.join(' ');
            }
          }
          // Si no se extrajo por '|', chequear última palabra mayúscula que coincida con un recinto
          if (!candidatoDeptFromName) {
            const partsCheck = displayName.split(' ').filter(Boolean);
            const last = partsCheck[partsCheck.length - 1] || '';
            if (last && /^[A-Z]{2,10}$/.test(last)) {
              // comparar con claves de recintos conocidos
              const keys = Object.keys(RECINTO_DB_MAP || {});
              // Si coincide con un recinto, no lo usamos como departamento
              if (keys.includes(last) || keys.includes(last.toUpperCase())) {
                console.debug('AuthContext: token final en displayName coincide con recinto, se ignora como departamento', last);
              } else {
                candidatoDeptFromName = last;
                partsCheck.pop();
                displayName = partsCheck.join(' ');
              }
            }
          }
          const parts = displayName.split(' ').filter(Boolean);
          let nombreVal = displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Usuario');
          let apellidoVal = '';
          if (parts.length >= 2) {
            apellidoVal = parts[parts.length - 1];
            nombreVal = parts.slice(0, parts.length - 1).join(' ');
          }
          const isMicrosoftCandidate = ((firebaseUser?.providerData || []).map(p => p.providerId || '').join(',').includes('microsoft') || String(firebaseUser.email || '').toLowerCase().includes('microsoft'));
          const newUser = {
            nombre: nombreVal,
            apellido: apellidoVal,
            email: firebaseUser.email,
            departamento: candidatoDeptFromName || undefined,
            // Forzar selección de departamento en primer login si es MS y no tenemos departamento validado
            needsDepartmentSelection: isMicrosoftCandidate && !candidatoDeptFromName,
            rol: (firebaseUser.email === 'admin@costaricacc.com') ? 'admin' : 'estandar',
          };

          // SEGURIDAD: Solo crear usuario si tiene permisos válidos para esta base de datos
          const currentRecinto = localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA';
          const hasValidDomain = isEmailAllowedForRecinto(firebaseUser.email, currentRecinto);
          const isSuperAdmin = SUPER_ADMINS.includes(String(firebaseUser.email || '').toLowerCase());

          if (!hasValidDomain && !isSuperAdmin) {
            console.warn('AuthContext: Usuario no tiene permisos para crear registro en esta base de datos', {
              email: firebaseUser.email,
              recinto: currentRecinto,
              hasValidDomain,
              isSuperAdmin
            });
            setDbAccessError('permission-denied');
            // No crear usuario - denegar acceso
            setUserData(null);
            setLoading(false);
            return;
          }

          // Intentar persistir en la DB seleccionada; si no hay DB, intentar la por defecto
          try {
            const targetDb = db || defaultDb;
            if (targetDb) {
              await set(ref(targetDb, `usuarios/${firebaseUser.uid}`), newUser);
              data = newUser;
            } else {
              // No hay DB inicializada: usar nuevo objeto en memoria
              data = newUser;
            }
          } catch (writeErr) {
            const isPerm = writeErr && (writeErr.code?.includes('permission-denied') || String(writeErr).toLowerCase().includes('permission denied'));
            if (isPerm) {
              setDbAccessError('permission-denied');
              // No interrumpimos la sesión: usar el objeto en memoria
            } else {
              console.warn('AuthContext: fallo al escribir usuario inicial en DB', writeErr);
            }
            data = newUser;
          }
        } else {
          // Si existen datos parciales en la DB, asegurar que contengan email, apellido y rol.
          let displayName = firebaseUser.displayName || '';
          let apellidoFromName = '';
          let candidatoDeptFromName = '';
          if (displayName.includes('|')) {
            const partsPipe = displayName.split('|').map(s => s.trim()).filter(Boolean);
            if (partsPipe.length > 1) {
              candidatoDeptFromName = partsPipe.pop();
              displayName = partsPipe.join(' ');
            }
          }
          if (!candidatoDeptFromName) {
            const partsCheck = displayName.split(' ').filter(Boolean);
            const last = partsCheck[partsCheck.length - 1] || '';
            if (last && /^[A-Z]{2,10}$/.test(last)) {
              const keys = Object.keys(RECINTO_DB_MAP || {});
              if (keys.includes(last) || keys.includes(last.toUpperCase())) {
                candidatoDeptFromName = last;
                partsCheck.pop();
                displayName = partsCheck.join(' ');
              }
            }
          }
          const parts = displayName.split(' ').filter(Boolean);
          if (parts.length >= 2) apellidoFromName = parts[parts.length - 1];
          const needsUpdate = (!data.rol) || (!data.apellido && apellidoFromName) || (!data.email && firebaseUser.email);
          if (needsUpdate) {
            const updated = {
              ...data,
              nombre: data.nombre || (displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Usuario')),
              apellido: data.apellido || apellidoFromName || '',
              email: data.email || firebaseUser.email,
              departamento: data.departamento || candidatoDeptFromName || data.departamento,
              rol: data.rol || ((firebaseUser.email === 'admin@costaricacc.com') ? 'admin' : 'estandar'),
            };
            try {
              const targetDb = db || defaultDb;
              if (targetDb) await set(ref(targetDb, `usuarios/${firebaseUser.uid}`), updated);
              data = updated;
            } catch (updErr) {
              const isPerm = updErr && (updErr.code?.includes('permission-denied') || String(updErr).toLowerCase().includes('permission denied'));
              if (isPerm) setDbAccessError('permission-denied');
              else console.warn('AuthContext: fallo al actualizar usuario en DB', updErr);
              // usamos los datos sin persistir
              data = updated;
            }
          }
        }
        // Intento de inferir/crear/usar departamento para que aparezca prellenado en Perfil
        try {
          let candidatoDept = data?.departamento || '';
          // Buscar en providerData propiedades comunes
          const providerDept = (firebaseUser?.providerData || []).reduce((acc, p) => acc || p?.department || p?.organization || '', '');
          if (!candidatoDept && providerDept) candidatoDept = providerDept;
          // Heurísticas sobre displayName: 'Nombre - Departamento' o 'Nombre (Departamento)'
          if (!candidatoDept) {
            const dn = firebaseUser?.displayName || '';
            if (dn.includes(' - ')) candidatoDept = dn.split(' - ').pop().trim();
            else {
              const m = dn.match(/\(([^)]+)\)/);
              if (m) candidatoDept = m[1].trim();
            }
          }
          if (candidatoDept) {
            const targetDb = db || defaultDb;
            if (targetDb) {
              try {
                const depsSnap = await get(ref(targetDb, 'departamentos'));
                let matchedDepName = null;
                if (depsSnap && depsSnap.exists()) {
                  const deps = depsSnap.val();
                  // Buscar coincidencia exacta (case-insensitive) y usar el nombre almacenado
                  for (const nombre of Object.values(deps)) {
                    if (String(nombre).toLowerCase() === String(candidatoDept).toLowerCase()) {
                      matchedDepName = nombre;
                      break;
                    }
                  }
                }
                if (matchedDepName) {
                  // Solo asignar si hay una coincidencia explícita en la DB
                  if (!data?.departamento || String(data.departamento).toLowerCase() !== String(matchedDepName).toLowerCase()) {
                    await set(ref(targetDb, `usuarios/${firebaseUser.uid}/departamento`), matchedDepName);
                    data = { ...(data || {}), departamento: matchedDepName };
                    console.debug('AuthContext: departamento existente asignado al usuario:', matchedDepName);
                  }
                } else {
                  // No crear departamentos nuevos automáticamente. Si el usuario ya tenía ese valor erróneo, limpiarlo.
                  console.debug('AuthContext: candidato de departamento NO coincide con departamentos existentes, no se creará:', candidatoDept);
                  if (data?.departamento && String(data.departamento).toLowerCase() === String(candidatoDept).toLowerCase()) {
                    try {
                      await set(ref(targetDb, `usuarios/${firebaseUser.uid}/departamento`), '');
                      data = { ...(data || {}), departamento: '' };
                      console.debug('AuthContext: se limpió el departamento erróneo del usuario');
                    } catch (clearErr) {
                      const isPerm = clearErr && (clearErr.code?.includes('permission-denied') || String(clearErr).toLowerCase().includes('permission denied'));
                      if (isPerm) setDbAccessError('permission-denied');
                      else console.warn('AuthContext: fallo al limpiar departamento erróneo', clearErr);
                    }
                  }
                }
              } catch (deptErr) {
                const isPerm = deptErr && (deptErr.code?.includes('permission-denied') || String(deptErr).toLowerCase().includes('permission denied'));
                if (isPerm) setDbAccessError('permission-denied');
                else console.warn('AuthContext: fallo al verificar departamento en DB', deptErr);
              }
            }
          }
        } catch (deptException) {
          console.debug('AuthContext: heurística departamento falló', deptException);
        }

        // Para usuarios del dominio @grupoheroica.com, comprobar en cada recinto si falta departamento
        try {
          const emailLower = String(firebaseUser.email || '').toLowerCase();
          if (emailLower.endsWith('@grupoheroica.com')) {
            const missing = [];
            const recintoKeys = Object.keys(RECINTO_DB_MAP || {});
            for (const key of recintoKeys) {
              try {
                const otherDb = await (await import('../firebase/multiDb')).getDbForRecinto(key);
                if (!otherDb) {
                  missing.push(key);
                  continue;
                }
                const snapOther = await get(ref(otherDb, `usuarios/${firebaseUser.uid}`));
                if (!snapOther.exists()) {
                  missing.push(key);
                } else {
                  const otherData = snapOther.val() || {};
                  if (!(otherData.departamento && String(otherData.departamento).trim())) missing.push(key);
                }
              } catch {
                // Si hay error (permission-denied o similar), marcar como pendiente para que el usuario lo revise
                missing.push(key);
              }
            }
            data = { ...(data || {}), missingDepartamentos: missing };
          }
        } catch (errCompute) {
          console.debug('AuthContext: fallo computando missingDepartamentos', errCompute);
        }

        console.debug('AuthContext: setUserData (final) ->', data);
        setUserData(data);
        // Decide whether to force the department-selection modal.
        // Consider both a validated `departamento` and a raw `departamentoMs` (from Graph).
        // Also respect an explicit `needsDepartmentSelection` flag.
        try {
          const hasDept = data && (
            (data.departamento && String(data.departamento).trim()) ||
            (data.departamentoMs && String(data.departamentoMs).trim())
          );
          const shouldForce = !!(data && (data.needsDepartmentSelection === true)) || !hasDept;
          if (shouldForce) {
            try {
              sessionStorage.setItem('forceShowDeptModal', '1');
            } catch (_err) {
              console.debug('AuthContext: could not set sessionStorage.forceShowDeptModal', _err?.message || _err);
            }
            if (typeof window !== 'undefined' && window.dispatchEvent) {
              // Emit a global event so components like Perfil can open the dialog immediately
              try {
                window.dispatchEvent(new Event('forceShowDeptModal'));
              } catch (_err2) {
                console.debug('AuthContext: dispatchEvent failed', _err2?.message || _err2);
              }
            }
          }
        } catch (errOuter) {
          console.debug('AuthContext: error while checking departamento presence', errOuter?.message || errOuter);
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, dbLoading, RECINTO_DB_MAP]);

  // Listen to in-page events that request a refresh of the current user's profile
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = async () => {
      if (!user) return;
      try {
        const targetDb = db || defaultDb;
        if (!targetDb) return;
        const snap = await get(ref(targetDb, `usuarios/${user.uid}`));
        let newData = snap && snap.exists() ? snap.val() : null;
        // recompute missingDepartamentos for grupoheroica domain users
        try {
          const emailLower = String(user.email || '').toLowerCase();
          if (emailLower.endsWith('@grupoheroica.com')) {
            const missing = [];
            const recintoKeys = Object.keys(RECINTO_DB_MAP || {});
            for (const key of recintoKeys) {
              try {
                const otherDb = await (await import('../firebase/multiDb')).getDbForRecinto(key);
                if (!otherDb) {
                  missing.push(key);
                  continue;
                }
                const snapOther = await get(ref(otherDb, `usuarios/${user.uid}`));
                if (!snapOther.exists()) {
                  missing.push(key);
                } else {
                  const otherData = snapOther.val() || {};
                  if (!(otherData.departamento && String(otherData.departamento).trim())) missing.push(key);
                }
              } catch {
                missing.push(key);
              }
            }
            newData = { ...(newData || {}), missingDepartamentos: missing };
          }
        } catch (errCompute) {
          console.debug('AuthContext: fallo recomputando missingDepartamentos', errCompute);
        }
        if (newData) {
          console.debug('AuthContext: userProfileUpdated fetched ->', newData);
          setUserData(prev => ({ ...(prev || {}), ...(newData || {}) }));
          console.debug('AuthContext: userProfileUpdated applied, userData refreshed');
        }
      } catch (err) {
        console.debug('AuthContext: userProfileUpdated handler failed', err && err.message ? err.message : err);
      }
    };
    window.addEventListener('userProfileUpdated', handler);
    return () => window.removeEventListener('userProfileUpdated', handler);
  }, [user, db, RECINTO_DB_MAP]);

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider value={{ user, userData, loading, logout, dbAccessError }}>
      {children}
    </AuthContext.Provider>
  );
}

