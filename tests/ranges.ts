import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NumericAxis } from '../src/scale/NumericAxis';
import { parseTimelineRange, timelineRangeKey } from '../src/collaboration/TimelineRange';
import { axisDescriptor, draftRange, ordinalPixel, projectRange, type RangeState } from '../src/collaboration/RangeProjection';
import { instantToWallMs, offsetISO } from '../src/utils/timezone';

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
