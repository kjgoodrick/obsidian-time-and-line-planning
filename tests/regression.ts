import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSabidurianDate, sabidurianDateToYear, sabidurianDateToDate, yearToYAMLString, formatDateForYAML } from '../src/utils/dateUtils';
import { axisToWallMs, wallMsToAxis, instantToWallMs, wallToInstant, offsetISO, parseExactTime } from '../src/utils/timezone';
import { Scheduling } from '../src/model/Scheduling';
import { EditHistory } from '../src/model/EditHistory';
import { fullLabel, dependencyLinks, labelWidth } from '../src/model/labels';
import { LayoutEngine } from '../src/model/LayoutEngine';
import { NumericAxis } from '../src/scale/NumericAxis';
import { DayScale } from '../src/scale/scales/DayScale';
import { DragManager } from '../src/interaction/DragManager';
const zone = 'America/Denver';
const axis = (s: string) => sabidurianDateToYear(parseSabidurianDate(s, zone)!);
const iso = (n: number) => String(yearToYAMLString(n, 'minute', zone));
const scheduler = new Scheduling(5, zone);

test('checkpoint: five-minute task displays, edits, saves and reopens with property label and undo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'timeline-checkpoint-'));
  const path = join(dir, 'distinct-identity.md');
  const original = { Step: 'Rest', Dish: 'Gratin', start: '2026-11-26T17:55:00-07:00', end: '2026-11-26T18:00:00-07:00' };
  // JSON is valid YAML and provides an actual Markdown frontmatter disk round-trip.
  const write = (fm: any) => writeFile(path, `---\n${JSON.stringify(fm)}\n---\n`);
  const read = async () => JSON.parse((await readFile(path, 'utf8')).split('---\n')[1]);
  await write(original);
  const history = new EditHistory(async (_file, mutate) => { const fm = await read(); mutate(fm); await write(fm); });
  const before = await read();
  const moved = scheduler.edit('move', { start: axis(before.start), end: axis(before.end) }, axis('2026-11-26T18:00:00-07:00'));
  await history.patch(path, { start: iso(moved.start), end: iso(moved.end) });
  const reopened = await read();
  assert.equal(reopened.start, '2026-11-26T18:00:00-07:00');
  assert.equal(reopened.end, '2026-11-26T18:05:00-07:00');
  assert.equal(fullLabel(reopened.Step, reopened, ['Dish']), 'Rest · Gratin');
  assert.equal(Date.parse(reopened.end) - Date.parse(reopened.start), 300000);
  await history.undo(); assert.deepEqual(await read(), original);
});

test('five-minute create, reverse-create, move, resize and intentional 17:15–17:25 gap', () => {
  const s = axis('2026-11-26T17:25'), e = axis('2026-11-26T17:55');
  const created = scheduler.edit('create', { start: s, end: s }, s);
  assert.equal(iso(created.end), '2026-11-26T17:30:00-07:00');
  const reverse = scheduler.edit('create', { start: e, end: e }, s);
  assert.equal(iso(reverse.start), '2026-11-26T17:25:00-07:00');
  assert.equal(iso(reverse.end), '2026-11-26T17:55:00-07:00');
  assert.equal(iso(scheduler.edit('resize-start', { start: s, end: e }, axis('2026-11-26T17:50')).start), '2026-11-26T17:50:00-07:00');
  assert.equal(iso(scheduler.edit('resize-end', { start: s, end: e }, axis('2026-11-26T17:30')).end), '2026-11-26T17:30:00-07:00');
  assert.equal(axisToWallMs(s) - axisToWallMs(axis('2026-11-26T17:15')), 600000);
  assert.ok(scheduler.changed(s, created.end));
});

test('off-grid times remain exact; moving preserves seconds and elapsed duration', () => {
  const s = axis('2026-11-26T17:27:13-07:00'), e = axis('2026-11-26T17:32:13-07:00');
  assert.equal(iso(s), '2026-11-26T17:27:13-07:00');
  const moved = scheduler.edit('move', { start: s, end: e }, axis('2026-11-26T17:32:13-07:00'));
  assert.equal(iso(moved.end), '2026-11-26T17:37:13-07:00');
});

test('round trips: midnight, year and leap boundaries, UTC and non-hour offsets', () => {
  for (const value of ['2026-12-31T23:55:00-07:00', '2027-01-01T00:00:00-07:00', '2028-02-29T17:55:00-07:00', '2026-11-27T00:25:00Z', '2026-11-26T17:25:00+05:45']) {
    assert.equal(Date.parse(iso(axis(value))), Date.parse(value));
  }
  const moved = scheduler.edit('move', { start: axis('2027-12-31T23:55'), end: axis('2028-01-01T00:00') }, axis('2028-01-01T00:00'));
  assert.equal(iso(moved.end), '2028-01-01T00:05:00-07:00');
});

test('DST rejects missing/ambiguous wall times and preserves explicit offsets', () => {
  assert.throws(() => parseExactTime('2026-03-08T02:30', zone), /does not exist/);
  assert.throws(() => parseExactTime('2026-11-01T01:30', zone), /Ambiguous/);
  for (const s of ['2026-11-01T01:30:00-06:00', '2026-11-01T01:30:00-07:00']) assert.equal(offsetISO(parseExactTime(s, zone), zone), s);
  assert.throws(() => parseExactTime('2026-02-30T12:00', zone), /Invalid/);
  const moved = scheduler.edit('move', { start: axis('2026-03-07T01:30'), end: axis('2026-03-07T03:30') }, axis('2026-03-08T01:30'));
  assert.equal(Date.parse(iso(moved.end)) - Date.parse(iso(moved.start)), 7200000);
  assert.equal(iso(moved.end), '2026-03-08T04:30:00-06:00');
});

test('multi-day defrost duration preserved across a leap-year boundary', () => {
  const start = axis('2027-12-29T09:00'), end = axis('2028-01-01T18:00');
  const moved = scheduler.edit('move', { start, end }, axis('2028-01-02T09:00'));
  assert.equal(Date.parse(iso(moved.end)) - Date.parse(iso(moved.start)), 81 * 3600000);
});

test('15-minute tick labels are independent of 5-minute snapping', () => {
  const columns = DayScale.getColumnBoundaries(axis('2026-11-26T17:00'), axis('2026-11-26T18:00'), 15);
  assert.deepEqual(columns.slice(0, 4).map(c => c.label), [':00', ':15', ':30', ':45']);
  assert.equal(iso(scheduler.snap(axis('2026-11-26T17:25'))), '2026-11-26T17:25:00-07:00');
});

test('labels preserve property order, long values and omit empties; duplicate names retain identity', () => {
  const label = fullLabel('Bake', { Oven: '400', Dish: 'A very long descriptive dish name', Empty: '' }, ['Oven', 'Empty', 'Dish']);
  assert.equal(label, 'Bake · 400 · A very long descriptive dish name');
  const rows: any[] = ['task-a.md', 'task-b.md'].map((path, i) => ({ file: { path }, label: 'Bake', displayLabel: label, startYear: axis(`2026-11-26T17:${i ? '55' : '25'}`), endYear: axis(`2026-11-26T18:${i ? '00' : '05'}`), isPoint: false, row: 0 }));
  const layout = new LayoutEngine(); layout.oneTaskPerRow = true;
  layout.layout(rows, new NumericAxis(axis('2026-11-26T17:00'), axis('2026-11-26T19:00'), 200));
  assert.notEqual(rows[0].row, rows[1].row);
  assert.ok(rows[1].width < labelWidth(label));
  assert.equal(rows[1].endYear, axis('2026-11-26T18:00'));
  const grouped = [{ name: 'A', entries: [rows[0]], collapsed: false }, { name: 'B', entries: [rows[1]], collapsed: false }] as any;
  layout.layoutGrouped(grouped, new NumericAxis(2026, 2027, 800));
  assert.notEqual(rows[0].row, rows[1].row);
  grouped[1].collapsed = true; layout.layoutGrouped(grouped, new NumericAxis(2026, 2027, 800)); assert.equal(rows[1].row, -1);
});

test('multiple dependencies keep stable paths and aliases resolve without name collisions', () => {
  assert.deepEqual(dependencyLinks(['[[Tasks/Bake-a|Bake]]', '[[Tasks/Bake-b]]', '[[Tasks/Bake-b]]']), ['Tasks/Bake-a', 'Tasks/Bake-b']);
});

test('undo restores raw values, missing properties and rejects conflicting external edits', async () => {
  let fm: any = { start: '2026-11-26T17:25:00-07:00' };
  const history = new EditHistory(async (_f, edit) => { edit(fm); });
  await history.patch({}, { start: '2026-11-26T17:30:00-07:00', end: '2026-11-26T17:35:00-07:00' });
  await history.undo(); assert.deepEqual(fm, { start: '2026-11-26T17:25:00-07:00' });
  await history.patch({}, { start: 'new' }); fm.start = 'external';
  await assert.rejects(history.undo(), /changed/); assert.equal(fm.start, 'external');
});

test('exact datetime rejects normalized invalid dates with and without explicit offsets', () => {
  for (const suffix of ['', 'Z', '-07:00', '+05:45']) {
    for (const civil of ['2026-02-30T12:00', '2026-02-29T12:00', '2026-04-31T12:00', '2026-11-26T24:00', '2026-11-26T17:60', '2026-11-26T17:55:60', '2026-00-26T17:55']) {
      assert.throws(() => parseExactTime(civil + suffix, zone), /Invalid/, civil + suffix);
    }
    assert.ok(Number.isFinite(parseExactTime('2028-02-29T12:00' + suffix, zone)));
  }
  assert.throws(() => parseExactTime('2026-11-26T17:55:00+24:00', zone), /Invalid UTC offset/);
  assert.throws(() => parseExactTime('2026-11-26T17:55:00-07:60', zone), /Invalid UTC offset/);
});

test('exact edits preserve fractional milliseconds and elapsed duration', () => {
  const start = '2026-11-26T17:55:00.100-07:00', end = '2026-11-26T18:00:00.500-07:00';
  assert.equal(offsetISO(parseExactTime(start, zone), zone), start);
  assert.equal(parseExactTime('2026-11-26T17:55:00.1', zone), Date.parse(start));
  const moved = scheduler.nudge(start, end, 5);
  assert.equal(moved.start, '2026-11-26T18:00:00.100-07:00');
  assert.equal(moved.end, '2026-11-26T18:05:00.500-07:00');
  assert.equal(Date.parse(moved.end) - Date.parse(moved.start), Date.parse(end) - Date.parse(start));
});

test('mouse creation awaits persistence and propagates a failed write to the drag error handler', async () => {
  // The completion path does not need a DOM; it must await the same callback used
  // by the actual mouse handler instead of leaving an unhandled rejection.
  const drag: any = Object.create(DragManager.prototype);
  const start = axis('2026-11-26T17:55'), end = axis('2026-11-26T18:00');
  drag.ctx = { _newStart: start, _newEnd: end }; drag.scheduling = scheduler;
  let release!: () => void; let finished = false;
  drag.setCreateCallback(async (s: number, e: number) => {
    assert.equal(s, start); assert.equal(e, end); await new Promise<void>(resolve => release = resolve);
  });
  const result = drag.finishCreate().then(() => finished = true);
  await Promise.resolve(); assert.equal(finished, false);
  release(); await result; assert.equal(finished, true);
  drag.setCreateCallback(async () => { throw new Error('Vault write failed'); });
  await assert.rejects(drag.finishCreate(), /Vault write failed/);
});

test('fractional milliseconds round-trip through parsed values, civil axis and mouse persistence', () => {
  for (const value of ['2026-11-26T17:55:00.100-07:00', '2026-12-31T23:59:59.999-07:00', '2028-02-29T00:00:00.001-07:00']) {
    const parsed = parseSabidurianDate(value, zone)!;
    assert.equal(parsed.millisecond, new Date(value).getUTCMilliseconds());
    assert.equal(iso(sabidurianDateToYear(parsed)), value);
    const naive = value.slice(0, -6);
    assert.equal(formatDateForYAML(parseSabidurianDate(naive, zone)!), naive);
    assert.equal(yearToYAMLString(sabidurianDateToYear(parseSabidurianDate(naive, zone)!), 'minute'), naive);
    const dateValue = parseSabidurianDate({date:new Date(value)}, zone)!;
    assert.equal(dateValue.millisecond, parsed.millisecond);
    assert.equal(sabidurianDateToDate(parsed)!.getMilliseconds(), parsed.millisecond);
  }
  const start = '2026-11-26T17:55:00.100-07:00', end = '2026-11-26T18:00:00.500-07:00';
  const moved = scheduler.edit('move', {start:axis(start),end:axis(end)}, axis('2026-11-26T18:00:00.100-07:00'));
  assert.equal(iso(moved.start), '2026-11-26T18:00:00.100-07:00');
  assert.equal(iso(moved.end), '2026-11-26T18:05:00.500-07:00');
  assert.equal(Date.parse(iso(moved.end))-Date.parse(iso(moved.start)), Date.parse(end)-Date.parse(start));
});

test('early CE years and historical numeric values retain upstream identity and calendar years', () => {
  for (const value of ['0001-01-01T00:00:00.125', '0050-11-26T17:55:00.001', '0096-02-29T12:00:00.999']) {
    const parsed = parseSabidurianDate(value, 'UTC')!;
    assert.equal(yearToYAMLString(sabidurianDateToYear(parsed),'minute','UTC'), value + '+00:00');
    assert.equal(sabidurianDateToDate(parsed)!.getFullYear(), Number(value.slice(0,4)));
  }
  assert.equal(yearToYAMLString(sabidurianDateToYear(parseSabidurianDate('501 BCE')!)), -500);
  assert.ok(yearToYAMLString(sabidurianDateToYear(parseSabidurianDate('1 BCE')!)) === 0);
});

test('property colors use configured tones before numeric-looking hex values and tolerate invalid persisted settings', async () => {
  const { getColorForValue, getPropertyTone, normalizePropertyColors } = await import('../src/utils/colorUtils');
  const colors = normalizePropertyColors({ 'Oven Temp': { '400': 'yellow', '375': 'purple', bad: 'unknown' }, Dish: null });
  assert.equal(getColorForValue('400', 'note.Oven Temp', colors), 'var(--sabidurian-tone-yellow)');
  assert.equal(getColorForValue('#abc'), '#abc');
  assert.equal(getPropertyTone('Dish', 'Gratin', null as any), undefined);
  assert.equal(getPropertyTone('Oven Temp', 'bad', colors), undefined);
  assert.equal(Object.keys(normalizePropertyColors(null)).length, 0);
});
