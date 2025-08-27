// Utilidad para calcular milisegundos laborales entre dos marcas de tiempo
// Horario laboral por defecto: Lunes-Viernes, 08:00 - 17:30 hora local
export function workingMsBetween(startMs, endMs, options = {}) {
    if (!startMs) return 0;
    if (!endMs || endMs <= startMs) return 0;
    const workStartHour = options.startHour ?? 8;
    const workStartMinute = options.startMinute ?? 0;
    const workEndHour = options.endHour ?? 17;
    const workEndMinute = options.endMinute ?? 30;

    let total = 0;
    const start = new Date(startMs);
    const end = new Date(endMs);

    // iterar día por día (aceptable para rangos de informe)
    const cur = new Date(start);
    cur.setHours(0,0,0,0);
    const endDay = new Date(end);
    endDay.setHours(0,0,0,0);

    while (cur.getTime() <= endDay.getTime()) {
        const dow = cur.getDay(); // 0 Dom .. 6 Sáb
        // Solo días laborables (Lun-Vie)
        if (dow >= 1 && dow <= 5) {
            const dayWorkStart = new Date(cur);
            dayWorkStart.setHours(workStartHour, workStartMinute, 0, 0);
            const dayWorkEnd = new Date(cur);
            dayWorkEnd.setHours(workEndHour, workEndMinute, 0, 0);

            const segStart = Math.max(startMs, dayWorkStart.getTime());
            const segEnd = Math.min(endMs, dayWorkEnd.getTime());
            if (segEnd > segStart) total += segEnd - segStart;
        }
        // siguiente día
        cur.setDate(cur.getDate() + 1);
        cur.setHours(0,0,0,0);
    }
    return total;
}

export default workingMsBetween;
