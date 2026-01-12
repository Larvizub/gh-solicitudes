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
  subcategoriasTickets: {}
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
      return () => {};
    }
    const tiposRef = dbRef(db, 'tiposTickets');
    const subsRef = dbRef(db, 'subcategoriasTickets');
    const tiposCb = (snap) => {
      try { setTiposTickets(snap.exists() ? snap.val() : {}); } catch (e) { console.warn('Error parsing tiposTickets', e); setTiposTickets({}); }
    };
    const subsCb = (snap) => {
      try { setSubcategoriasTickets(snap.exists() ? snap.val() : {}); } catch (e) { console.warn('Error parsing subcategoriasTickets', e); setSubcategoriasTickets({}); }
    };
    onValue(tiposRef, tiposCb);
    onValue(subsRef, subsCb);
    return () => {
      try {
        off(tiposRef, 'value', tiposCb);
      } catch (e) { console.warn('Error unsubscribing tiposTickets listener', e); }
      try {
        off(subsRef, 'value', subsCb);
      } catch (e) { console.warn('Error unsubscribing subcategoriasTickets listener', e); }
      setTiposTickets({});
      setSubcategoriasTickets({});
    };
  }, [db]);

  useEffect(() => {
  try { localStorage.setItem('selectedRecinto', recinto); } catch (e) { console.warn('No se pudo persistir recinto', e); }
  }, [recinto]);

  const value = { db, recinto, setRecinto, loading, RECINTO_DB_MAP, tiposTickets, subcategoriasTickets };
  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}
