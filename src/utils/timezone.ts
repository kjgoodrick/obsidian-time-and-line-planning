/** Civil-time axis, independent of the device timezone. Instants retain explicit offsets. */
export function utcMs(year: number, month = 0, day = 1, hour = 0, minute = 0, second = 0): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month, day);
  d.setUTCHours(hour, minute, second, 0);
  return d.getTime();
}

export function axisToWallMs(axis: number): number {
  const y = Math.floor(axis);
  return Math.round(utcMs(y) + (axis - y) * (utcMs(y + 1) - utcMs(y)));
}

export function wallMsToAxis(ms: number): number {
  const y = new Date(ms).getUTCFullYear();
  return y + (ms - utcMs(y)) / (utcMs(y + 1) - utcMs(y));
}

export function instantToWallMs(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const p: Record<string, number> = {};
  for (const part of parts) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return utcMs(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) + ((ms % 1000 + 1000) % 1000);
}

/** Reject nonexistent and ambiguous local times rather than silently changing a schedule. */
export function wallToInstant(ms: number, zone: string, preferredOffset?: number): number {
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = ms + hours * 3600000;
    offsets.add(instantToWallMs(probe, zone) - probe);
  }
  const candidates = [...offsets].map(offset => ms - offset)
    .filter(instant => instantToWallMs(instant, zone) === ms);
  if (candidates.length === 1) return candidates[0];
  if (preferredOffset != null) {
    const preferred = candidates.find(instant => ms - instant === preferredOffset);
    if (preferred != null) return preferred;
  }
  throw new Error(candidates.length ? 'Ambiguous daylight-saving time; enter an explicit UTC offset.' : 'This local time does not exist because of daylight saving time.');
}

export function offsetISO(instant: number, zone: string): string {
  const wall = instantToWallMs(instant, zone);
  const offsetMinutes = Math.round((wall - instant) / 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return new Date(wall).toISOString().slice(0, -1).replace(/\.000$/, '') + offset;
}

export function parseExactTime(value: string, zone: string): number {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))?$/);
  if (!match)
    throw new Error('Enter YYYY-MM-DDTHH:mm, optionally with an offset.');

  // Date.parse normalizes February 30 and 24:00, including strings with explicit
  // offsets. Validate the stated civil components before applying any offset.
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(part => Number(part ?? 0));
  const milliseconds = Number((match[7] ?? '').padEnd(3, '0'));
  const wall = utcMs(year, month - 1, day, hour, minute, second) + milliseconds;
  const civil = new Date(wall);
  if (year < 1 || civil.getUTCFullYear() !== year || civil.getUTCMonth() !== month - 1 ||
      civil.getUTCDate() !== day || civil.getUTCHours() !== hour || civil.getUTCMinutes() !== minute ||
      civil.getUTCSeconds() !== second)
    throw new Error('Invalid calendar date.');

  if (match[8] === 'Z') return wall;
  if (match[9]) {
    const offsetHour = Number(match[10]), offsetMinute = Number(match[11]);
    if (offsetHour > 23 || offsetMinute > 59) throw new Error('Invalid UTC offset.');
    const offset = (offsetHour * 60 + offsetMinute) * 60000 * (match[9] === '+' ? 1 : -1);
    return wall - offset;
  }
  return wallToInstant(wall, zone);
}
