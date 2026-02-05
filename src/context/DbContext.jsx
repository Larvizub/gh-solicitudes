import React, { createContext, useContext, useEffect, useState } from 'react';
import { getDbForRecinto, RECINTO_DB_MAP } from '../firebase/multiDb';
import { ref as dbRef, onValue, off } from 'firebase/database';

const DbContext = createContext({
  db: null,
  recinto: 'GRUPO_HEROICA',
  setRecinto: () => {},
  loading: true,
  RECINTO_DB_MAP: {},
  tiposTickets: {},
  subcategoriasTickets: {},
  departamentos: [],
  usuarios: []
});

export function useDb() {
  return useContext(DbContext);
}

export function DbProvider({ children }) {
  const [recinto, setRecinto] = useState(() => {
    try {
      return localStorage.getItem('selectedRecinto') || 'GRUPO_HEROICA';
    } catch {
      return 'GRUPO_HEROICA';
    }
  });
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tiposTickets, setTiposTickets] = useState({});
  const [subcategoriasTickets, setSubcategoriasTickets] = useState({});
  const [departamentos, setDepartamentos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      try {
        console.log('DbContext: Inicializando DB para recinto', recinto);
        const inst = await getDbForRecinto(recinto);
        console.log('DbContext: DB inicializada correctamente', inst ? 'OK' : 'NULL');
        if (!cancelled) setDb(inst);
      } catch {
        // removed console.error to avoid error logs
        if (!cancelled) setDb(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, [recinto]);

  useEffect(() => {
    if (!db) {
      setTiposTickets({});
      setSubcategoriasTickets({});
      setDepartamentos([]);
      setUsuarios([]);
      return () => {};
    }
    const tiposRef = dbRef(db, 'tiposTickets');
    const subsRef = dbRef(db, 'subcategoriasTickets');
    const depsRef = dbRef(db, 'departamentos');
    const usersRef = dbRef(db, 'usuarios');

    const tiposCb = (snap) => {
      try { setTiposTickets(snap.exists() ? snap.val() : {}); } catch (e) { console.warn('Error parsing tiposTickets', e); setTiposTickets({}); }
    };
    const subsCb = (snap) => {
      try { setSubcategoriasTickets(snap.exists() ? snap.val() : {}); } catch (e) { console.warn('Error parsing subcategoriasTickets', e); setSubcategoriasTickets({}); }
    };
    const depsCb = (snap) => {
      try {
        if (snap.exists()) {
          const deps = Object.entries(snap.val()).map(([id, nombre]) => ({ id, nombre }));
          deps.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));
          setDepartamentos(deps);
        } else {
          setDepartamentos([]);
        }
      } catch (e) { console.warn('Error parsing departamentos', e); setDepartamentos([]); }
    };
    const usersCb = (snap) => {
      try {
        if (snap.exists()) {
          const users = Object.entries(snap.val()).map(([id, u]) => ({ id, ...u }));
          setUsuarios(users);
        } else {
          setUsuarios([]);
        }
      } catch (e) { console.warn('Error parsing usuarios', e); setUsuarios([]); }
    };

    onValue(tiposRef, tiposCb);
    onValue(subsRef, subsCb);
    onValue(depsRef, depsCb);
    onValue(usersRef, usersCb);

    return () => {
      try { off(tiposRef, 'value', tiposCb); } catch (e) { console.debug('error off tipos', e); }
      try { off(subsRef, 'value', subsCb); } catch (e) { console.debug('error off subs', e); }
      try { off(depsRef, 'value', depsCb); } catch (e) { console.debug('error off deps', e); }
      try { off(usersRef, 'value', usersCb); } catch (e) { console.debug('error off users', e); }
      setTiposTickets({});
      setSubcategoriasTickets({});
      setDepartamentos([]);
      setUsuarios([]);
    };
  }, [db]);

  useEffect(() => {
  try { localStorage.setItem('selectedRecinto', recinto); } catch (e) { console.warn('No se pudo persistir recinto', e); }
  }, [recinto]);

  const value = React.useMemo(() => ({
    db,
    recinto,
    setRecinto,
    loading,
    RECINTO_DB_MAP,
    tiposTickets,
    subcategoriasTickets,
    departamentos,
    usuarios
  }), [db, recinto, loading, tiposTickets, subcategoriasTickets, departamentos, usuarios]);

  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}
