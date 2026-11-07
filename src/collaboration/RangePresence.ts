import { axisDescriptor, draftRange, ordinalValue, projectRange, type RangeState } from './RangeProjection';
import { parseTimelineRange, type TimelineRange } from './TimelineRange';

/** A pointer is an instant/original Sequence value; historical pointers carry
 * a Gregorian day plus an offset in its projected period. Never guess a DST
 * occurrence, snap dense Sequence to a task, or silently lose decimal precision. */
export function presenceRange(start: number, end: number, state: RangeState): TimelineRange | undefined {
  try {
    if (![start, end].every(Number.isFinite) || start < 0 || end < start || end > state.axis.totalWidth) return;
    let range: TimelineRange;
    if (state.renderer === 'sabidurian-sequence') {
      range = parseTimelineRange({ version: 1, kind: 'ordinal', start: ordinalValue(start, state), end: ordinalValue(end, state),
        start_inclusive: true, end_inclusive: true, unit: 'property-value' });
    } else {
      const a = state.axis.pixelToYear(start), b = state.axis.pixelToYear(end);
      const kind = a >= 1 && b < 10000 ? 'instant' : 'historical';
      const draft = draftRange(a, b, state, kind, 'day');
      if (draft.issue || !draft.draft) return;
      range = parseTimelineRange(draft.draft);
    }
    const axis = axisDescriptor(state); if (!axis) return;
    const projected = projectRange(range, state, axis);
    if (projected.end < projected.start || projected.discontinuous && projected.end === projected.start) return;
    // Millisecond rounding must not move a high-zoom pointer visibly.
    if (range.kind !== 'historical' && (Math.abs(projected.start - start) > 0.1 || Math.abs(projected.end - end) > 0.1)) return;
    return range;
  } catch { return; }
}
