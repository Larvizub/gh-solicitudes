export function msToHoursMinutes(ms) {
  if (ms === null || ms === undefined) return '';
  if (ms <= 0) return '0h 0m';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export default msToHoursMinutes;
