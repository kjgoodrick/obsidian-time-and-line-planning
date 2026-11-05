import { axisToWallMs, wallMsToAxis, utcMs } from '../../utils/timezone';
import { TimeScale, ColumnBoundary, registerScale } from '../TimeScale';

export const MonthScale: TimeScale = {
  id: 'month',
  label: 'Month',
  unitDurationYears: 1 / 12,
  supportsSubYear: true,
  supportsBCE: false,

  getColumnBoundaries(start: number, end: number): ColumnBoundary[] {
    const cols: ColumnBoundary[] = [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    let year = Math.floor(start);
    let month = new Date(axisToWallMs(start)).getUTCMonth();

    while (cols.length < 1000) {
      const colStart = wallMsToAxis(utcMs(year, month));
      const nextMonth = month + 1;
      const nextYear = nextMonth >= 12 ? year + 1 : year;
      const nm = nextMonth % 12;
      const colEnd = wallMsToAxis(utcMs(nextYear, nm));

      if (colStart > end) break;

      cols.push({
        start: colStart,
        end: colEnd,
        label: months[month],
        tierLabel: `${year}`,
        isTierStart: month === 0,
      });

      year = nextYear;
      month = nm;
    }
    return cols;
  },

  snapToUnit(year: number): number {
    const y = Math.floor(year);
    const m = Math.round((year - y) * 12);
    return y + m / 12;
  },
};

registerScale(MonthScale);
