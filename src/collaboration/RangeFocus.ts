import type { BasesViewConfig } from 'obsidian';
import { autoSelectScale, type ColumnBoundary, type TimeScale } from '../scale/TimeScale';
import { formatYear } from '../utils/dateUtils';
import { axisDescriptor, axisKey, rangeExtent, type RangeAxis, type RangeState } from './RangeProjection';
import { parseTimelineRange, timelineRangeLabel, type TimelineRange } from './TimelineRange';

/** Local navigation state only: never written to the Bases config or a note. */
export interface RangeFocus {
  config: BasesViewConfig; axis: RangeAxis; zone: string | null; range: TimelineRange;
  viewStart: number; viewEnd: number; scale: TimeScale;
}

/** A bounded grid across the entire interval, including negative Sequence values
 * and years outside JavaScript Date's domain. Never enumerate the gap to data. */
function numericScale(start: number, end: number, sequence: boolean): TimeScale {
  const desired = Math.max((end - start) / 8, sequence ? 1e-9 : 1);
  const power = 10 ** Math.floor(Math.log10(desired));
  const step = [1, 2, 5, 10].find(value => value * power >= desired)! * power;
  return { id: 'comment-range', label: sequence ? 'Sequence values' : 'Years', unitDurationYears: step,
    supportsSubYear: false, supportsBCE: !sequence, writePrecision: sequence ? undefined : 'year',
    getColumnBoundaries(from, to) {
      const columns: ColumnBoundary[] = [], first = Math.floor(from / step);
      for (let i = 0; i < 64; i++) {
        const a = (first + i) * step, b = (first + i + 1) * step;
        if (a > to) break;
        if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) break;
        columns.push({ start: a, end: b, label: sequence ? String(Number(a.toFixed(9))) : formatYear(Math.round(a)) });
      }
      return columns;
    },
    snapToUnit: value => sequence ? Math.round(value) : Math.round(value / step) * step };
}

export function createRangeFocus(input: TimelineRange, state: RangeState, expected: RangeAxis): RangeFocus {
  const range = parseTimelineRange(input), extent = rangeExtent(range, state, expected);
  const low = Math.min(extent.start, extent.end), high = Math.max(extent.start, extent.end);
  const sequence = range.kind === 'ordinal', beyondDate = low < -270000 || high > 270000;
  const minimum = sequence ? 0.5 : beyondDate ? 1 : 1 / (366 * 24);
  const padding = Math.max((high - low) * 0.1, minimum, Math.max(Math.abs(low), Math.abs(high)) * Number.EPSILON * 8);
  const viewStart = low - padding, viewEnd = high + padding;
  if (![viewStart, viewEnd].every(Number.isFinite) || viewEnd <= viewStart) throw new Error('The range cannot be displayed.');
  const scale = sequence || beyondDate || viewEnd - viewStart > 10000 ? numericScale(viewStart, viewEnd, sequence) : autoSelectScale(viewEnd - viewStart, 800);
  return { config: state.config, axis: axisDescriptor(state)!, zone: state.timeZone ?? null, range, viewStart, viewEnd, scale };
}

export function rangeFocusCurrent(focus: RangeFocus, config: BasesViewConfig, renderer: RangeAxis['renderer'], zone: string | null): boolean {
  const axis = axisDescriptor({ config, renderer });
  return focus.config === config && !!axis && axisKey(axis) === axisKey(focus.axis) && focus.zone === zone;
}

export function renderRangeFocus(parent: HTMLElement, focus: RangeFocus, restore: () => void): void {
  const group = parent.createDiv({ cls: 'sabidurian-comment-range-focus', attr: { role: 'group', 'aria-label': 'Comment range navigation' } });
  group.createSpan({ text: 'Viewing comment range · ' + timelineRangeLabel(focus.range) });
  if (focus.range.kind === 'ordinal') group.createSpan({ text: 'Original property values' });
  const button = group.createEl('button', { text: 'Return to data', attr: { type: 'button' } });
  button.onclick = restore;
}
