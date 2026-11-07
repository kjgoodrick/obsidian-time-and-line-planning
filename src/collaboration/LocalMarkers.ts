import type { SabidurianMarker } from '../settings';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Local identities survive edits and reordering. They grant no shared access. */
export function identifyLocalMarkers(markers: SabidurianMarker[], createId: () => string = () => crypto.randomUUID()): boolean {
  let changed = false;
  const used = new Set<string>();
  const reserved = new Set(markers.filter(marker => typeof marker?.id === 'string' && idPattern.test(marker.id)).map(marker => marker.id!.toLowerCase()));
  for (const marker of markers) {
    if (!marker || typeof marker !== 'object') continue;
    if (!marker.id || !idPattern.test(marker.id) || used.has(marker.id.toLowerCase())) {
      let id: string | undefined;
      for (let attempt = 0; attempt < 16; attempt++) {
        const candidate = createId();
        if (idPattern.test(candidate) && !reserved.has(candidate.toLowerCase())) { id = candidate; break; }
      }
      if (!id) throw new Error('Unable to create a unique local marker identity.');
      marker.id = id; reserved.add(id.toLowerCase()); changed = true;
    }
    used.add(marker.id.toLowerCase());
  }
  return changed;
}

export interface LocalMarkerSnapshot {
  id: string; label: string; color: string; enabled: boolean;
  date?: string; start?: string; end?: string;
  current(): boolean;
}
function snapshot(marker: SabidurianMarker): Omit<LocalMarkerSnapshot, 'current'> {
  if (!marker || typeof marker.id !== 'string' || !idPattern.test(marker.id) ||
    typeof marker.label !== 'string' || marker.label.length > 512 ||
    typeof marker.color !== 'string' || marker.color.length > 256 || typeof marker.enabled !== 'boolean' ||
    [marker.date, marker.start, marker.end].some(value => value !== undefined && (typeof value !== 'string' || value.length > 128))) {
    throw new Error('A local marker needs repair in Time & Line settings.');
  }
  return { id: marker.id.toLowerCase(), label: marker.label, color: marker.color, enabled: marker.enabled,
    ...(marker.date === undefined ? {} : { date: marker.date }), ...(marker.start === undefined ? {} : { start: marker.start }),
    ...(marker.end === undefined ? {} : { end: marker.end }) };
}

/** Read-only and bounded. A snapshot becomes stale on edit, deletion or duplicate
 * identity, but not when another marker moves in the settings list. */
export function localMarkerSnapshots(read: () => readonly SabidurianMarker[], current: () => boolean): LocalMarkerSnapshot[] {
  const markers = read();
  if (!current()) return [];
  if (!Array.isArray(markers) || markers.length > 256) throw new Error('Local marker selection supports at most 256 markers.');
  const values = markers.map(snapshot), ids = new Set(values.map(value => value.id));
  if (ids.size !== values.length) throw new Error('Local marker identities are ambiguous. Reopen Time & Line.');
  return values.map(value => {
    const key = JSON.stringify(value);
    return Object.freeze({ ...value, current: () => {
      try {
        const now = read(); if (!current() || !Array.isArray(now) || now.length > 256) return false;
        const matches = now.filter(marker => marker?.id?.toLowerCase() === value.id);
        return matches.length === 1 && JSON.stringify(snapshot(matches[0])) === key;
      } catch { return false; }
    } });
  });
}
