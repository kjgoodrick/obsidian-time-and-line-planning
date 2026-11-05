import { axisToWallMs, utcMs } from './timezone';

const unit = (count: number, name: string) => `${count.toLocaleString()} ${name}${count === 1 ? '' : 's'}`;

/** Calendar distance on the civil-time axis, with at most two nonzero units. */
export function formatMeasureDuration(a: number, b: number): string {
  const start = axisToWallMs(Math.min(a, b));
  const end = axisToWallMs(Math.max(a, b));
  // Very distant historical axes can exceed JavaScript's calendar range.
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return `~${unit(Math.round(Math.abs(b - a)), 'year')}`;
  }

  const first = new Date(start), last = new Date(end);
  // Clamp calendar-month anniversaries (Jan 31 → Feb 28/29).
  const afterMonths = (months: number) => {
    const monthStart = new Date(utcMs(first.getUTCFullYear(), first.getUTCMonth() + months));
    const year = monthStart.getUTCFullYear(), month = monthStart.getUTCMonth();
    const days = new Date(utcMs(year, month + 1, 0)).getUTCDate();
    return utcMs(year, month, Math.min(first.getUTCDate(), days), first.getUTCHours(), first.getUTCMinutes(), first.getUTCSeconds()) + first.getUTCMilliseconds();
  };
  let months = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth();
  if (afterMonths(months) > end) months--;
  const parts: string[] = [];
  const add = (count: number, name: string) => { if (count && parts.length < 2) parts.push(unit(count, name)); };
  add(Math.floor(months / 12), 'year');
  add(months % 12, 'month');

  // Round once before splitting, avoiding floating-point tails and “60 seconds”.
  let seconds = Math.round((end - afterMonths(months)) / 1000);
  for (const [name, size] of [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]] as const) {
    add(Math.floor(seconds / size), name);
    seconds %= size;
  }
  return parts.join(', ') || '0 seconds';
}
