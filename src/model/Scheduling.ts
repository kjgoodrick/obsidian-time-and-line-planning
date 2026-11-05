import { axisToWallMs, wallMsToAxis, wallToInstant, instantToWallMs, parseExactTime, offsetISO } from '../utils/timezone';

export type ScheduleAction = 'move' | 'resize-start' | 'resize-end' | 'create';
export interface ScheduleRange { start: number; end: number }

/** Shared by mouse, touch and exact controls. Pixel size never constrains task duration. */
export class Scheduling {
  constructor(public snapMinutes = 5, public timeZone = 'UTC') {
    if (!Number.isFinite(snapMinutes) || snapMinutes < 1) throw new Error('Snap must be at least one minute.');
    new Intl.DateTimeFormat('en', { timeZone }).format();
  }
  validate(start: string, end: string): { s: number; e: number } {
    const s = parseExactTime(start, this.timeZone), e = parseExactTime(end, this.timeZone);
    if (e <= s) throw new Error('End must be after start.');
    return { s, e };
  }
  nudge(start: string, end: string, minutes: number): { start: string; end: string } {
    const { s, e } = this.validate(start, end);
    return { start: offsetISO(s + minutes * 60000, this.timeZone), end: offsetISO(e + minutes * 60000, this.timeZone) };
  }
  snap(axis: number): number {
    const unit = this.snapMinutes * 60000;
    return wallMsToAxis(Math.round(axisToWallMs(axis) / unit) * unit);
  }
  changed(a: number, b: number): boolean {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(axisToWallMs(a) - axisToWallMs(b)) >= 1;
  }
  edit(action: ScheduleAction, original: ScheduleRange, target: number): ScheduleRange {
    const start = axisToWallMs(original.start), end = axisToWallMs(original.end);
    const snapped = axisToWallMs(this.snap(target));
    const minimum = this.snapMinutes * 60000;
    if (action === 'create') {
      const anchor = axisToWallMs(this.snap(original.start));
      return { start: wallMsToAxis(Math.min(anchor, snapped)), end: wallMsToAxis(Math.max(Math.min(anchor, snapped) + minimum, anchor, snapped)) };
    }
    if (action === 'move') {
      // Snap the delta, preserving an off-grid task's original minutes/seconds.
      const delta = Math.round((axisToWallMs(target) - start) / minimum) * minimum;
      const duration = wallToInstant(end, this.timeZone) - wallToInstant(start, this.timeZone);
      const newInstant = wallToInstant(start + delta, this.timeZone);
      return { start: wallMsToAxis(start + delta), end: wallMsToAxis(instantToWallMs(newInstant + duration, this.timeZone)) };
    }
    const s = action === 'resize-start' ? Math.min(snapped, end - minimum) : start;
    const e = action === 'resize-end' ? Math.max(snapped, start + minimum) : end;
    wallToInstant(s, this.timeZone); wallToInstant(e, this.timeZone);
    return { start: wallMsToAxis(s), end: wallMsToAxis(e) };
  }
}
