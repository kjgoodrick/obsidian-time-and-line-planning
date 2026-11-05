import { axisToWallMs, wallMsToAxis } from '../../utils/timezone';
import { TimeScale, ColumnBoundary, registerScale } from '../TimeScale';

const HOUR_IN_YEARS = 1 / 8760;
const MINUTE_IN_MS = 60 * 1000;

/**
 * Choose column step (in minutes) based on data range. Preserves 15-minute
 * granularity when zoomed in and coarsens automatically at wider ranges.
 */
function pickStepMinutes(rangeYears: number): number {
  const rangeHours = rangeYears * 8760;
  if (rangeHours <= 12) return 15;       // ≤ 12h: 4 cols/hour
  if (rangeHours <= 48) return 30;       // ≤ 2 days: 2 cols/hour
  if (rangeHours <= 7 * 24) return 60;   // ≤ 1 week: 1 col/hour
  return 180;                             // wider: 3-hour cols
}

export const DayScale: TimeScale = {
  id: 'day',
  label: 'Hours',
  unitDurationYears: HOUR_IN_YEARS,
  supportsSubYear: true,
  supportsBCE: false,
  minColumnPx: 26,
  writePrecision: 'minute',

  getColumnBoundaries(start: number, end: number, tickMinutes?: number): ColumnBoundary[] {
    const cols: ColumnBoundary[] = [];
    const stepMin = tickMinutes || pickStepMinutes(Math.max(end - start, 0.00001));
    const stepMs = stepMin * MINUTE_IN_MS;

    const startDate = fractionalYearToDate(start);
    startDate.setUTCSeconds(0, 0);
    startDate.setUTCMinutes(Math.floor(startDate.getUTCMinutes() / stepMin) * stepMin);
    const endDate = fractionalYearToDate(end);

    let cur = new Date(startDate);
    while (cur <= endDate && cols.length < 10000) {
      const next = new Date(cur.getTime() + stepMs);

      const colStart = dateToFractionalYear(cur);
      const colEnd = dateToFractionalYear(next);

      const h = cur.getUTCHours();
      const m = cur.getUTCMinutes();
      const hourLabel = `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
      const mm = String(m).padStart(2, '0');
      const label = stepMin >= 60 ? hourLabel : `:${mm}`;
      const dayLabel = cur.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      let tierLabel: string;
      let isTierStart: boolean;
      if (stepMin >= 60) {
        tierLabel = dayLabel;
        isTierStart = h === 0;
      } else {
        tierLabel = hourLabel;
        isTierStart = m === 0;
      }

      cols.push({ start: colStart, end: colEnd, label, tierLabel, isTierStart, contextLabel: dayLabel });
      cur = next;
    }
    return cols;
  },

  snapToUnit(year: number): number {
    const d = fractionalYearToDate(year);
    d.setUTCSeconds(0, 0);
    d.setUTCMinutes(Math.round(d.getUTCMinutes() / 15) * 15);
    return dateToFractionalYear(d);
  },
};

function fractionalYearToDate(fy: number): Date { return new Date(axisToWallMs(fy)); }
function dateToFractionalYear(d: Date): number { return wallMsToAxis(d.getTime()); }

registerScale(DayScale);
