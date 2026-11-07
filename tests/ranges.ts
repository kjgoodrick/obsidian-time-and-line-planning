import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NumericAxis } from '../src/scale/NumericAxis';
import { parseTimelineRange, timelineRangeKey } from '../src/collaboration/TimelineRange';
import { axisDescriptor, draftRange, ordinalPixel, projectRange, type RangeState } from '../src/collaboration/RangeProjection';
import { instantToWallMs, offsetISO } from '../src/utils/timezone';
import { createRangeFocus, rangeFocusCurrent } from '../src/collaboration/RangeFocus';
import '../src/scale/scales/index';
import { presenceRange } from '../src/collaboration/RangePresence';
import { ordinalValue } from '../src/collaboration/RangeProjection';

const fixtures = JSON.parse(readFileSync('tests/fixtures/timeline-ranges-v1.json', 'utf8'));
for (const row of fixtures.valid) test(`shared range contract: ${row.name}`, () => {
  const actual = parseTimelineRange(row.input);
  assert.deepEqual(actual, row.normalized); assert.equal(timelineRangeKey(actual), JSON.stringify(row.key));
});
for (const row of fixtures.invalid) test(`shared range contract rejects: ${row.name}`, () => assert.throws(() => parseTimelineRange(row.input)));
function state(sequence = false, zone = 'UTC'): RangeState {
  const values: Record<string, unknown> = { startDateProp: 'note.start', endDateProp: 'note.end', orderProp: 'note.order', timeZone: zone };
  return { axis: new NumericAxis(2024, 2025, 366), renderer: sequence ? 'sabidurian-sequence' : 'sabidurian-timeline',
    config: { get: (key: string) => values[key] } as RangeState['config'], timeZone: sequence ? undefined : zone,
    svg: {} as SVGSVGElement, viewport: {} as HTMLElement };
}
const row = (name: string) => fixtures.valid.find((row: { name: string }) => row.name === name).input;

test('presence retains precise large Sequence origins and fractional dense values', () => {
  const current = state(true); current.axis = new NumericAxis(999999999999998, 999999999999999, 1000);
  assert.equal(ordinalValue(0.000001, current), '999999999999998.000000001');
  assert.equal(presenceRange(0.000001, 0.000002, current)?.start, '999999999999998.000000001');
  current.axis = new NumericAxis(1, 4, 300); current.denseValues = [10, 100, 1000];
  assert.equal(ordinalValue(50, current), '55.000000000');
  assert.equal(presenceRange(50, 150, current)?.end, '550');
  assert.equal(presenceRange(0, 250, current), undefined); // No invented dense values beyond occupied positions.
  current.denseValues = null; current.axis = new NumericAxis(0, 0.000000001, 1000);
  assert.equal(presenceRange(250, 250, current), undefined); // Wire precision cannot represent this coordinate.
});

test('presence publishes explicit instants and historical periods but never guesses repeated or nonexistent civil times', () => {
  const current = state(false, 'America/Denver'); current.axis = new NumericAxis(2026, 2027, 36500);
  const regular = presenceRange(100, 100, current); assert.equal(regular?.kind, 'instant');
  const spanning = presenceRange(6500, 6800, current); assert.ok(spanning);
  assert.equal(projectRange(spanning, current, axisDescriptor(current)!).discontinuous, true);
  const repeated = current.axis.yearToPixel(2026 + (304 + 1.5 / 24) / 365);
  assert.equal(presenceRange(repeated, repeated, current), undefined);
  const missing = current.axis.yearToPixel(2026 + (66 + 2.5 / 24) / 365);
  assert.equal(presenceRange(missing, missing, current), undefined);
  current.axis = new NumericAxis(-10, -9, 36500);
  const historical = presenceRange(100, 150, current); assert.equal(historical?.kind, 'historical');
  assert.ok(projectRange(historical, current, axisDescriptor(current)!).start <= 100);
  assert.equal(presenceRange(NaN, 100, current), undefined); assert.equal(presenceRange(100, 99, current), undefined);
});

test('calendar and astronomical year-zero bounds project complete periods without local Date arithmetic', () => {
  const current = state(false, 'America/Denver');
  const calendar = projectRange(row('calendar leap day'), current, axisDescriptor(current)!);
  assert.ok(Math.abs(calendar.start - 59) < 1e-9); assert.ok(Math.abs(calendar.end - 60) < 1e-9); assert.equal(calendar.discontinuous, false);
  current.axis = new NumericAxis(0, 1, 366);
  const historical = projectRange(row('historical zero is leap year'), current, axisDescriptor(current)!);
  assert.ok(Math.abs(historical.start - 59) < 1e-9); assert.ok(Math.abs(historical.end - 60) < 1e-9);
});

test('large adjacent decimal values remain distinct when projected relative to a large origin', () => {
  const current = state(true); current.axis = new NumericAxis(999999999999998, 999999999999999, 1000);
  const first = ordinalPixel('999999999999998.000000001', current), second = ordinalPixel('999999999999998.000000002', current);
  assert.ok(Math.abs(first - 0.000001) < 1e-15); assert.ok(Math.abs(second - 0.000002) < 1e-15); assert.ok(second > first);
});

test('temporary focus keeps exact adjacent ordinals and uses bounded original-value ticks', () => {
  const current = state(true); current.denseValues = [1, 2];
  const range = row('adjacent exact large ordinal values'), axis = axisDescriptor(current)!;
  const focus = createRangeFocus(range, current, axis);
  assert.deepEqual(focus.range, parseTimelineRange(range));
  const projected = projectRange(range, { ...current, denseValues: null, axis: new NumericAxis(focus.viewStart, focus.viewEnd, 800) }, axis);
  assert.ok(projected.end > projected.start); assert.ok(projected.start >= 0 && projected.end <= 800);
  const columns = focus.scale.getColumnBoundaries(focus.viewStart, focus.viewEnd);
  assert.ok(columns.length > 0 && columns.length <= 64); assert.ok(columns.at(-1)!.end >= focus.viewEnd);
  assert.ok(rangeFocusCurrent(focus, current.config, current.renderer, null));
  assert.equal(rangeFocusCurrent(focus, { ...current.config }, current.renderer, null), false);
});

test('historical focus covers billion-year intervals without Date overflow or enumerating every year', () => {
  const current = state(), axis = axisDescriptor(current)!;
  for (const [start, end] of [[-1000000000, 1000000000], [1000000000, 1000000000], [-1000000000, -1000000000]]) {
    const range = { version: 1, kind: 'historical', start: { precision: 'year', year: start }, end: { precision: 'year', year: end },
      start_inclusive: true, end_inclusive: true, calendar: 'proleptic-gregorian', year_numbering: 'astronomical' };
    const focus = createRangeFocus(parseTimelineRange(range), current, axis), columns = focus.scale.getColumnBoundaries(focus.viewStart, focus.viewEnd);
    assert.ok(columns.length > 0 && columns.length <= 64); assert.ok(columns[0].start <= focus.viewStart && columns.at(-1)!.end >= focus.viewEnd);
    const projected = projectRange(range, { ...current, axis: new NumericAxis(focus.viewStart, focus.viewEnd, 800) }, axis);
    assert.ok(projected.start >= 0 && projected.end <= 800 && projected.end > projected.start);
  }
});

test('focus preserves civil-time discontinuity and rejects stale axes and timezones', () => {
  const current = state(false, 'America/Denver'), axis = axisDescriptor(current)!;
  const range = row('DST repeated wall time'), focus = createRangeFocus(range, current, axis);
  const projected = projectRange(range, { ...current, axis: new NumericAxis(focus.viewStart, focus.viewEnd, 800) }, axis);
  assert.equal(projected.start, projected.end); assert.equal(projected.discontinuous, true);
  assert.equal(rangeFocusCurrent(focus, current.config, current.renderer, 'UTC'), false);
  assert.throws(() => createRangeFocus(range, current, { ...axis, start_property: { source: 'note', name: 'other' } }));
});

test('dense Sequence ranges use original property values and bounded interpolation', () => {
  const current = state(true); current.axis = new NumericAxis(1, 4, 300); current.denseValues = [10, 100, 1000];
  assert.equal(ordinalPixel('10', current), 0); assert.equal(ordinalPixel('55', current), 50); assert.equal(ordinalPixel('1000', current), 200);
  assert.throws(() => ordinalPixel('1', current)); assert.throws(() => ordinalPixel('1001', current));
  assert.deepEqual(draftRange(1, 2, current, 'ordinal').draft, { version: 1, kind: 'ordinal', start: '10', end: '100', start_inclusive: true, end_inclusive: true, unit: 'property-value' });
  assert.match(draftRange(0, 2, current, 'ordinal').issue!, /occupied Sequence/);
});

test('DST repeated time returns explicit endpoint discontinuity and never guesses a capture offset', () => {
  const current = state(false, 'America/Denver'); current.axis = new NumericAxis(2026, 2027, 36500);
  const geometry = projectRange(row('DST repeated wall time'), current, axisDescriptor(current)!);
  assert.equal(geometry.start, geometry.end); assert.equal(geometry.discontinuous, true);
  const repeated = 2026 + (304 + 1.5 / 24) / 365;
  const draft = draftRange(repeated, repeated, current, 'instant');
  assert.match(draft.issue!, /Ambiguous daylight-saving/); assert.match(String(draft.draft?.start), /^2026-11-01T01:30/);
  assert.throws(() => parseTimelineRange(draft.draft));
});

test('axis namespaces, kinds and changed configuration cannot silently reinterpret a range', () => {
  const current = state(true), original = axisDescriptor(current)!;
  current.config = { get: (key: string) => key === 'orderProp' ? 'formula.order' : undefined } as RangeState['config'];
  assert.throws(() => projectRange(row('adjacent exact large ordinal values'), current, original), /axis changed/);
  assert.throws(() => projectRange(row('calendar leap day'), current, axisDescriptor(current)!), /axis changed/);
  assert.throws(() => projectRange(row('calendar leap day'), state(), axisDescriptor(state())!), /different timezone/);
});

test('historical capture keeps year and month precision, including BCE', () => {
  const current = state();
  const year = draftRange(-1, 0, current, 'historical', 'year');
  assert.deepEqual(year.draft?.start, { precision: 'year', year: -1 });
  assert.deepEqual(year.draft?.end, { precision: 'year', year: 0 });
  const month = draftRange(0 + 31 / 366, 0 + 59 / 366, current, 'historical', 'month');
  assert.deepEqual(month.draft?.start, { precision: 'month', year: 0, month: 2 });
  assert.match(draftRange(-1, 1, current, 'calendar').issue!, /historical dates/);
});

test('instant projection preserves the CE boundary and historical second offsets without changing an instant', () => {
  const instant = Date.parse('0001-01-01T00:00:00.123Z'), wall = instantToWallMs(instant, 'America/Denver');
  assert.equal(new Date(wall).getUTCFullYear(), 0);
  assert.equal(Date.parse(offsetISO(instant, 'America/Denver')), instant);
  const current = state(false, 'America/Denver'); current.axis = new NumericAxis(0, 2, 200);
  const range = { version: 1, kind: 'instant', start: '0001-01-01T00:00:00.123Z', end: '0001-01-01T00:00:00.123Z',
    start_inclusive: true, end_inclusive: true, time_zone: 'America/Denver' };
  const geometry = projectRange(range, current, axisDescriptor(current)!);
  assert.ok(geometry.start > 99 && geometry.start < 100); assert.equal(geometry.start, geometry.end);
  assert.throws(() => projectRange({ ...range, time_zone: 'UTC' }, current, axisDescriptor(current)!), /different timezone/);
});
