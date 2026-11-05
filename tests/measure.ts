import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { MeasureManager } from '../src/interaction/MeasureManager';
import { DragManager } from '../src/interaction/DragManager';
import { NumericAxis } from '../src/scale/NumericAxis';
import { DayScale } from '../src/scale/scales/DayScale';
import { formatMeasureDuration } from '../src/utils/measureDuration';
import { wallMsToAxis } from '../src/utils/timezone';

const win = new Window();
Object.assign(globalThis, { window: win, document: win.document });
const axisTime = (date: string) => wallMsToAxis(Date.parse(date + 'Z'));
const duration = (a: string, b: string) => formatMeasureDuration(axisTime(a), axisTime(b));
const managers: { destroy(): void }[] = [];
afterEach(() => { managers.splice(0).forEach(manager => manager.destroy()); document.body.replaceChildren(); });

test('measure reports at most two nonzero units, including minutes and seconds in either direction', () => {
  const start = '2026-11-26T09:00:00';
  for (const [end, expected] of [
    ['2026-11-29T11:17:32', '3 days, 2 hours'],
    ['2026-11-26T10:05:42', '1 hour, 5 minutes'],
    ['2026-11-26T09:05:20', '5 minutes, 20 seconds'],
    ['2026-11-26T09:00:30', '30 seconds'],
    ['2026-11-26T10:00:00', '1 hour'],
    ['2026-11-26T09:01:00', '1 minute'],
    [start, '0 seconds'],
    ['2026-11-26T09:00:59.999', '1 minute'],
  ]) {
    assert.equal(duration(start, end), expected);
    assert.equal(duration(end, start), expected);
  }
});

test('measure handles leap days, year crossings and calendar months without 365-day estimates', () => {
  assert.equal(duration('2028-02-28T23:55:00', '2028-02-29T01:00:00'), '1 hour, 5 minutes');
  assert.equal(duration('2028-12-31T23:55:00', '2029-01-01T00:00:30'), '5 minutes, 30 seconds');
  assert.equal(duration('2028-01-31T12:00:00', '2028-02-29T14:00:00'), '1 month, 2 hours');
  assert.equal(duration('2028-02-29T12:00:00', '2029-03-01T12:00:00'), '1 year, 1 day');
  assert.equal(duration('2026-11-26T09:00:00', '2028-02-26T09:00:00'), '1 year, 3 months');
  assert.equal(formatMeasureDuration(-500, 2026), '2,526 years');
});

function fixture() {
  const root = document.createElement('div'), body = document.createElement('div');
  body.className = 'sabidurian-timeline-body';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('height', '300'); body.append(svg); root.append(body); document.body.append(root);
  // Nonzero origin represents a horizontally and vertically scrolled timeline.
  svg.getBoundingClientRect = () => ({ left: -200, top: 50 } as DOMRect);
  const axis = new NumericAxis(axisTime('2028-02-29T09:00:00'), axisTime('2028-02-29T10:00:00'), 3600);
  const manager = new MeasureManager(svg as any, root as any, axis); managers.push(manager);
  svg.addEventListener('click', event => { if (manager.handleClick(event as any)) event.stopImmediatePropagation(); }, true);
  root.addEventListener('keydown', event => manager.handleKeydown(event as any), true);
  const send = (type: string, x: number, target: EventTarget = svg, button = 0) =>
    target.dispatchEvent(new win.MouseEvent(type, { clientX: x - 200, clientY: 150, button, bubbles: true, cancelable: true }));
  const click = (x: number) => { send('mousedown', x); send('mouseup', x); send('click', x); };
  const label = () => root.querySelector('.sabidurian-measure-label')?.textContent;
  manager.activate();
  return { root, body, svg, axis, manager, send, click, label };
}

test('drag updates a single live label, retains the result after release and supports measuring again', () => {
  const { svg, root, body, manager, send, label } = fixture();
  body.scrollTop = 90;
  send('mousedown', 100); send('mousemove', 165, document);
  assert.equal(label(), '1 minute, 5 seconds');
  send('mousemove', 220, document); assert.equal(label(), '2 minutes');
  assert.equal(root.querySelectorAll('.sabidurian-measure-label').length, 1);
  assert.ok(parseFloat((root.querySelector('.sabidurian-measure-label') as HTMLElement).style.top) >= body.scrollTop + 4,
    'measurement label remains below the header on a vertically scrolled timeline');
  assert.equal(svg.querySelectorAll('.sabidurian-measure-marker').length, 2);
  assert.equal(svg.querySelectorAll('.sabidurian-measure-span').length, 1);
  send('mouseup', 225, document); send('click', 225);
  assert.equal(label(), '2 minutes, 5 seconds'); assert.equal(manager.state, 'displaying');
  send('mousedown', 900); send('mousemove', 870, document); send('mouseup', 840, document); send('click', 840);
  assert.equal(label(), '1 minute'); assert.equal(manager.state, 'displaying');
});

test('two-click measurement, a small hand tremor, sequence distances, and click to clear still work', () => {
  const { manager, send, click, label } = fixture();
  send('mousedown', 100); send('mousemove', 102); send('mouseup', 102); send('click', 102);
  assert.equal(manager.state, 'awaiting-b'); assert.equal(label(), undefined);
  click(167); assert.equal(label(), '1 minute, 5 seconds');
  click(180); assert.equal(manager.isActive, false); assert.equal(label(), undefined);
  manager.activate(); manager.sequenceMode = true;
  click(100); click(200); assert.equal(label(), '0 positions');
});

test('Escape and blur cancel an in-flight drag, and destruction removes global handlers', () => {
  const { root, manager, send, label } = fixture();
  send('mousedown', 100); send('mousemove', 180, document);
  root.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  send('mouseup', 200); send('click', 200); assert.equal(label(), undefined); assert.equal(manager.isActive, false);
  manager.activate(); send('mousedown', 100); send('mousemove', 180, document);
  win.dispatchEvent(new win.Event('blur')); assert.equal(label(), undefined); assert.equal(manager.isActive, false);
  manager.activate(); send('mousedown', 100); manager.destroy();
  send('mousemove', 180, document); send('mouseup', 200); send('click', 200); assert.equal(label(), undefined);
});

test('measuring cannot start task movement, resizing or creation while editing is unlocked', () => {
  const { body, svg, axis, manager, send, label } = fixture();
  (body as any).createDiv = ({ cls }: any) => { const el = document.createElement('div'); el.className = cls; body.append(el); return el; };
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.classList.add('sabidurian-bar-group'); svg.append(group);
  const drag = new DragManager(svg as any, body as any, {} as any, axis, DayScale); managers.push(drag);
  let writes = 0, creates = 0;
  drag.persist = async () => { writes++; }; drag.setCreateCallback(() => { creates++; });
  drag.attachToBarGroups([{ x: 100, width: 600, locked: false } as any], () => 0);
  for (const [x, target] of [[100, group], [300, group], [1000, svg]] as const) {
    send('mousedown', x, target); send('mousemove', x + 65, document); send('mouseup', x + 65, document); send('click', x + 65, target);
    assert.equal(label(), '1 minute, 5 seconds');
    assert.equal((drag as any).ctx.state, 'idle');
    assert.equal(svg.querySelector('.sabidurian-ghost-bar'), null);
  }
  assert.equal(writes, 0); assert.equal(creates, 0);
  manager.deactivate();
  send('mousedown', 300, group); assert.equal((drag as any).ctx.state, 'pending', 'normal editing resumes after measurement');
});
