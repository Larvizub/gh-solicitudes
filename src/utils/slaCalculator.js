import workingMsBetween from './businessHours';

/**
 * Calcula el tiempo restante del SLA usando horas laborales (08:00 - 17:00)
 * @param {Object} ticket - El ticket del cual calcular el SLA
 * @param {Object} slaConfig - Configuración de SLA por departamento
 * @param {Object} slaSubcatsConfig - Configuración de SLA por subcategoría
 * @param {Object} tiposConfig - Configuración de tipos por departamento
 * @param {Object} subcatsConfig - Configuración de subcategorías
 * @returns {Object|null} - {remainingHours, slaHours, isExpired} o null
 */
export const calculateSlaRemaining = (ticket, slaConfig = {}, slaSubcatsConfig = {}, tiposConfig = {}, subcatsConfig = {}) => {
  try {
    // Si el ticket está cerrado, no mostrar tiempo restante
    if (ticket.estado === 'Cerrado') return null;

    // Obtener tiempo de creación
    const parseTimestamp = (val) => {
      if (!val) return null;
      if (typeof val === 'number') return val < 1e12 ? val * 1000 : val;
      if (typeof val === 'string') {
        const n = parseInt(val, 10);
        if (!isNaN(n)) return n < 1e12 ? n * 1000 : n;
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d.getTime();
      }
      if (typeof val === 'object' && val.seconds) return Number(val.seconds) * 1000;
      return null;
    };

  // Permitir reinicio de SLA si existe lastSlaStartAt (por reasignación/subcategoría nueva)
  const createdMs = parseTimestamp(ticket.lastSlaStartAt) || parseTimestamp(ticket.createdAt || ticket.fecha || ticket.timestamp);
    if (!createdMs) return null;

  // Determinar SLA aplicable
    let slaHours = null;
  // Normalizar departamento (priorizar id preservado)
  const deptId = ticket._departamentoId || ticket.departamento;
    
    // Intentar SLA por subcategoría
    try {
  const tiposForDept = tiposConfig[deptId] || {};
      const tipoEntry = Object.entries(tiposForDept).find(([, nombre]) => nombre === ticket.tipo);
      const tipoId = tipoEntry ? tipoEntry[0] : null;
      
      if (tipoId && subcatsConfig[deptId] && subcatsConfig[deptId][tipoId]) {
        const subEntries = Object.entries(subcatsConfig[deptId][tipoId]);
        const found = subEntries.find(([, nombre]) => nombre === ticket.subcategoria);
        const subId = found ? found[0] : null;
        
        if (subId && slaSubcatsConfig[deptId] && slaSubcatsConfig[deptId][tipoId] && slaSubcatsConfig[deptId][tipoId][subId]) {
          const slaConfigItem = slaSubcatsConfig[deptId][tipoId][subId];
          const priority = ticket.prioridad || 'Media';
          slaHours = typeof slaConfigItem === 'object' ? slaConfigItem[priority] : (priority === 'Media' ? slaConfigItem : null);
        }
      }
    } catch {
      // Continuar con SLA por departamento
    }

    // Si no hay SLA por subcategoría, usar SLA por departamento
    if (slaHours == null) {
      const deptConfig = slaConfig[deptId] || {};
      const priority = ticket.prioridad || 'Media';
      const DEFAULT_SLA = { Alta: 24, Media: 72, Baja: 168 };
      slaHours = deptConfig[priority] ?? DEFAULT_SLA[priority] ?? 72;
    }

    // Calcular tiempo transcurrido usando horas laborales (08:00 - 17:00)
    const now = Date.now();
    const bhOpts = { startHour: 8, startMinute: 0, endHour: 17, endMinute: 0 };
    let elapsedMs = workingMsBetween(createdMs, now, bhOpts);

    // Descontar pausas: ticket.pauses es un objeto de objetos { start, end? }
    if (ticket.pauses && typeof ticket.pauses === 'object') {
      for (const key of Object.keys(ticket.pauses)) {
        const p = ticket.pauses[key];
        if (!p) continue;
        const ps = parseTimestamp(p.start);
        if (!ps) continue;
        const pe = parseTimestamp(p.end) || now; // si no ha terminado la pausa, cuenta hasta ahora
        if (pe <= ps) continue;
        // Solo considerar pausas que inician después de la creación (superposición)
        const overlapStart = Math.max(ps, createdMs);
        const overlapEnd = Math.min(pe, now);
        if (overlapEnd > overlapStart) {
          const pausedMs = workingMsBetween(overlapStart, overlapEnd, bhOpts);
            if (pausedMs > 0) elapsedMs -= pausedMs;
        }
      }
      if (elapsedMs < 0) elapsedMs = 0; // evitar negativo tras restar pausas
    }

    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    // Calcular tiempo restante (countdown)
    const remainingHours = slaHours - elapsedHours;

    return {
      remainingHours,
      slaHours,
      isExpired: remainingHours <= 0,
      overdueHours: remainingHours < 0 ? Math.abs(remainingHours) : 0
    };
  } catch (e) {
    console.warn('Error calculando SLA restante:', e);
    return null;
  }
};

/**
 * Formatea las horas restantes de SLA para mostrar en la UI
 * @param {number} remainingHours - Horas restantes (puede ser negativo si está vencido)
 * @param {boolean} isExpired - Si el SLA está vencido
 * @returns {string} - Texto formateado para mostrar
 */
export const formatSlaHours = (remainingHours, isExpired = false) => {
  const totalHours = Math.round(Math.abs(remainingHours) * 10) / 10;
  return isExpired ? `Vencido: ${totalHours}h` : `${totalHours}h`;
};
