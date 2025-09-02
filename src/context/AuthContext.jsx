import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { ref, get, set, update } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app as firebaseApp } from '../firebase/firebaseConfig';
import { auth, db as defaultDb } from '../firebase/firebaseConfig';
import { useDb } from './DbContext';
import { AuthContext } from './AuthContextInternal';

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
            console.error('Error cargando userData desde la DB seleccionada', e);
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
            setDbAccessError('permission-denied');
            const recintoKeys = Object.keys(RECINTO_DB_MAP || {});
            for (const key of recintoKeys) {
              try {
                const otherDb = await (await import('../firebase/multiDb')).getDbForRecinto(key);
                if (!otherDb) continue;
                const snap = await get(ref(otherDb, `usuarios/${firebaseUser.uid}`));
                if (snap && snap.exists()) {
                  data = snap.val();
                  // no cambiamos el recinto automáticamente, solo usamos los datos
                  break;
                }
              } catch (err) {
                // Ignorar permission-denied u otros errores al inspeccionar otras DBs
                const isPerm = err && (err.code?.includes('permission-denied') || String(err).toLowerCase().includes('permission denied'));
                if (!isPerm) console.debug('AuthContext: error inspeccionando otras DBs', err && err.message ? err.message : err);
              }
            }
          }
        }

        // Si el proveedor incluye Microsoft, intentar enriquecer con Graph via Cloud Function
        try {
          const providerIds = (firebaseUser.providerData || []).map(p => p.providerId || '').join(',');
          const emailLower = String(firebaseUser.email || '').toLowerCase();
          const isMicrosoft = providerIds.includes('microsoft') || emailLower.includes('onmicrosoft.com') || emailLower.includes('microsoft.com');
          console.debug('AuthContext: providerIds=', providerIds, 'email=', emailLower, 'isMicrosoft=', isMicrosoft);
          if (isMicrosoft) {
              try {
              // Forzar región donde desplegaste las funciones (ajusta si usaste otra región)
              const functions = getFunctions(firebaseApp, 'us-central1');
              const callable = httpsCallable(functions, 'getGraphProfile');
                const emailToQuery = firebaseUser.email;
                console.debug('AuthContext: llamando getGraphProfile para', emailToQuery);
                const resp = await callable({ email: emailToQuery });
                console.debug('AuthContext: getGraphProfile response', resp);
                const profile = resp.data?.profile || null;
                if (profile) {
                  // Mapear campos comunes de Graph (sin persistir departamento todavía)
                  const enriched = {
                    nombre: (profile.givenName || profile.displayName || (data?.nombre || '')).toString().trim(),
                    apellido: (profile.surname || data?.apellido || '').toString().trim(),
                    email: (profile.mail || profile.userPrincipalName || firebaseUser.email).toString().trim(),
                    // departamento validated below before persisting
                    telefono: (profile.mobilePhone || data?.telefono || '').toString().trim(),
                    cargo: (profile.jobTitle || data?.cargo || '').toString().trim(),
                    rol: data?.rol || ((firebaseUser.email === 'admin@costaricacc.com') ? 'admin' : 'estandar'),
                  };
                  console.debug('AuthContext: perfil enriquecido detectado (sin departamento), persistiendo en DB', enriched);
                  // Persistir en DB seleccionada (usar update para merge en lugar de set)
                  try {
                    const targetDb = db || defaultDb;
                    if (targetDb) {
                      // Antes de persistir, validar si profile.department existe en la lista de departamentos
                      let deptToPersist = null;
                      const graphDept = (profile.department || '').toString().trim();
                      if (graphDept) {
                        try {
                          const depsSnapCheck = await get(ref(targetDb, 'departamentos'));
                          if (depsSnapCheck && depsSnapCheck.exists()) {
                            const depsCheck = depsSnapCheck.val();
                            for (const nombre of Object.values(depsCheck)) {
                              if (String(nombre).toLowerCase() === String(graphDept).toLowerCase()) {
                                deptToPersist = nombre;
                                break;
                              }
                            }
                          }
                        } catch (depsErr) {
                          console.debug('AuthContext: no se pudo validar department contra departamentos list', depsErr);
                        }
                      }
                      if (deptToPersist) {
                        enriched.departamento = deptToPersist;
                      }
                      // Si no hay departamento validado y el provider es Microsoft, marcar necesidad de selección
                      if (!enriched.departamento) {
                        const providerIdsLocal = (firebaseUser.providerData || []).map(p => p.providerId || '').join(',');
                        const isMicrosoftLocal = providerIdsLocal.includes('microsoft') || String(firebaseUser.email || '').toLowerCase().includes('microsoft');
                        if (isMicrosoftLocal) {
                          enriched.needsDepartmentSelection = true;
                          try {
                            const targetDb2 = db || defaultDb;
                            if (targetDb2) await set(ref(targetDb2, `usuarios/${firebaseUser.uid}/needsDepartmentSelection`), true);
                          } catch (eSet) {
                            const isPerm = eSet && (eSet.code?.includes('permission-denied') || String(eSet).toLowerCase().includes('permission denied'));
                            if (isPerm) setDbAccessError('permission-denied');
                            else console.debug('AuthContext: no se pudo persistir needsDepartmentSelection', eSet);
                          }
                        }
                      }
                      // Guardar también el valor crudo proveniente de Microsoft para mostrar en Perfil
                      const rawGraphDept = (profile.department || '').toString().trim();
                      if (rawGraphDept) enriched.departamentoMs = rawGraphDept;
                      await update(ref(targetDb, `usuarios/${firebaseUser.uid}`), enriched);
                      data = { ...(data || {}), ...enriched };
                      console.debug('AuthContext: perfil enriquecido persistido en DB (update)', { persistedDepartamento: enriched.departamento });
                    } else {
                      data = enriched;
                      console.debug('AuthContext: no hay DB, usando perfil enriquecido en memoria');
                    }
                  } catch (persistErr) {
                    const isPerm = persistErr && (persistErr.code?.includes('permission-denied') || String(persistErr).toLowerCase().includes('permission denied'));
                    if (isPerm) {
                      setDbAccessError('permission-denied');
                      // Si pertenece al dominio de confianza, intentar persistir en defaultDb como fallback
                      try {
                        const emailLowerLocal = String(firebaseUser?.email || '').toLowerCase();
                        if (emailLowerLocal.endsWith('@grupoheroica.com') && defaultDb) {
                          await update(ref(defaultDb, `usuarios/${firebaseUser.uid}`), enriched);
                          data = { ...(data || {}), ...enriched };
                          console.debug('AuthContext: fallback persistido en defaultDb para usuario @grupoheroica.com');
                        }
                      } catch (fallbackErr) {
                        console.warn('AuthContext: fallback a defaultDb falló', fallbackErr);
                      }
                    } else console.warn('AuthContext: fallo al persistir perfil enriquecido', persistErr);
                    data = enriched; // usar en memoria
                  }
                } else {
                  console.debug('AuthContext: getGraphProfile no devolvió profile');
                }
            } catch (callErr) {
              // No bloquear si la función falla
              console.debug('AuthContext: getGraphProfile fallo o no disponible', callErr && callErr.message ? callErr.message : callErr);
            }
          }
        } catch (eGraph) {
          console.debug('AuthContext: error al intentar enriquecer con Graph', eGraph);
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

