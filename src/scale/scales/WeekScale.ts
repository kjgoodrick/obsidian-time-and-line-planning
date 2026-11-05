import { axisToWallMs, wallMsToAxis } from '../../utils/timezone';
import { TimeScale, ColumnBoundary, registerScale } from '../TimeScale';

const WEEK_IN_YEARS = 7 / 365;

export const WeekScale: TimeScale = {
  id: 'week',
  label: 'Week',
  unitDurationYears: WEEK_IN_YEARS,
  supportsSubYear: true,
  supportsBCE: false,

  getColumnBoundaries(start: number, end: number): ColumnBoundary[] {
    const cols: ColumnBoundary[] = [];
    // Start from the Monday on or before the start date
    const startDate = fractionalYearToDate(start);
    const dow = startDate.getUTCDay();
    const diff = dow === 0 ? -6 : 1 - dow; // Monday = 1
    startDate.setUTCDate(startDate.getUTCDate() + diff);
    startDate.setUTCHours(0, 0, 0, 0);

    const endDate = fractionalYearToDate(end);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    let cur = new Date(startDate);
    while (cur <= endDate && cols.length < 1000) {
      const next = new Date(cur);
      next.setUTCDate(next.getUTCDate() + 7);

      const colStart = dateToFracYear(cur);
      const colEnd = dateToFracYear(next);
      const label = `${months[cur.getUTCMonth()]} ${cur.getUTCDate()}`;
      const tierLabel = `${months[cur.getUTCMonth()]} ${cur.getUTCFullYear()}`;
      const isTierStart = cur.getUTCDate() <= 7;

      cols.push({ start: colStart, end: colEnd, label, tierLabel, isTierStart });
      cur = next;
    }
    return cols;
  },

  snapToUnit(year: number): number {
    const d = fractionalYearToDate(year);
    const dow = d.getUTCDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setUTCDate(d.getUTCDate() + diff);
    return dateToFracYear(d);
  },
};

function fractionalYearToDate(fy: number): Date { return new Date(axisToWallMs(fy)); }
function dateToFracYear(d: Date): number { return wallMsToAxis(d.getTime()); }

registerScale(WeekScale);
