import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { DragManager } from '../src/interaction/DragManager';
import { SequenceView } from '../src/SequenceView';
import { NumericAxis } from '../src/scale/NumericAxis';
import { DayScale } from '../src/scale/scales/DayScale';
import { Modal } from './obsidian-mock';

const win = new Window();
Object.assign(globalThis, { window: win, document: win.document, MouseEvent: win.MouseEvent, CSS: win.CSS });
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
const proto = win.HTMLElement.prototype as any;
proto.createEl = function(tag: string, opts: any = {}) {
  const el = document.createElement(tag);
  if (opts.text != null) el.textContent = opts.text;
  if (opts.cls) el.className = opts.cls;
  for (const [key, value] of Object.entries(opts.attr ?? {})) el.setAttribute(key, String(value));
  this.append(el); return el;
};
proto.createDiv = function(opts: any) { return this.createEl('div', opts); };
proto.createSpan = function(opts: any) { return this.createEl('span', opts); };
proto.addClass = function(...names: string[]) { this.classList.add(...names); };
proto.empty = function() { this.replaceChildren(); };
proto.setText = function(text: string) { this.textContent = text; };
proto.appendText = function(text: string) { this.append(document.createTextNode(text)); };

let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
globalThis.cancelAnimationFrame = id => { frames.delete(id); };
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
  for (const modal of Modal.opened) modal.close();
  Modal.opened = []; frames.clear(); document.body.replaceChildren();
});

test('overflow and uncertainty hit areas move tasks while true bar edges advertise the matching resize', () => {
  const root = document.createElement('div'); document.body.append(root);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); root.append(svg);
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.classList.add('sabidurian-bar-group'); svg.append(group);
  // The group bounds include a fuzzy extension; they are not the real bar bounds.
  svg.getBoundingClientRect = () => ({ left: 20 } as DOMRect);
  group.getBoundingClientRect = () => ({ left: 70 } as DOMRect);
  const entry: any = { x: 100, width: 100, isPoint: false, isOngoing: false, locked: false };
  const drag: any = new DragManager(svg, root, {} as any, new NumericAxis(0, 10, 1000), DayScale);
  cleanup.push(() => drag.destroy()); drag.attachToBarGroups([entry], () => 20);
  for (const [offset, expectedCursor, expectedDrag] of [
    [-20, 'grab', 'drag-move'], [0, 'col-resize', 'drag-resize-start'],
    [50, 'grab', 'drag-move'], [100, 'col-resize', 'drag-resize-end'],
    [101, 'grab', 'drag-move'], [180, 'grab', 'drag-move'],
  ] as const) {
    const clientX = 120 + offset;
    group.dispatchEvent(new win.MouseEvent('mousemove', { clientX, bubbles: true }));
    assert.equal(group.style.cursor, expectedCursor, `cursor at offset ${offset}`);
    group.dispatchEvent(new win.MouseEvent('mousedown', { clientX, button: 0, bubbles: true }));
    assert.equal(drag.ctx._pendingType, expectedDrag, `drag at offset ${offset}`);
    win.dispatchEvent(new win.Event('blur'));
  }
  entry.isOngoing = true;
  group.dispatchEvent(new win.MouseEvent('mousemove', { clientX: 215, bubbles: true }));
  assert.equal(group.style.cursor, 'grab');
  group.dispatchEvent(new win.MouseEvent('mousedown', { clientX: 215, button: 0, bubbles: true }));
  assert.equal(drag.ctx._pendingType, 'drag-move'); win.dispatchEvent(new win.Event('blur'));
  group.dispatchEvent(new win.MouseEvent('mousemove', { clientX: 125, bubbles: true }));
  assert.equal(group.style.cursor, 'col-resize', 'ongoing tasks still resize their start');
  entry.locked = true;
  group.dispatchEvent(new win.MouseEvent('mousemove', { clientX: 215, bubbles: true }));
  assert.equal(group.style.cursor, 'default', 'ongoing status cannot override a locked cursor');
  entry.locked = false; entry.width = 5;
  group.dispatchEvent(new win.MouseEvent('mousemove', { clientX: 121, bubbles: true }));
  assert.equal(group.style.cursor, 'grab', 'very short bars remain move-only');
});

test('Sequence refreshes shared colors, honors view/task locks, and unsubscribes without changing note-open behavior', async () => {
  const metadata = { order: 1, Dish: 'Gratin' };
  const file = { path: 'Tasks/Bake.md', basename: 'Bake' };
  const palette: any = { Dish: { Gratin: 'orange' } };
  const subscribers = new Set<() => void>();
  const opened: string[] = [];
  const trashed: string[] = [];
  const plugin: any = {
    colorSubscribers: subscribers,
    settings: { propertyColors: palette, maxEntries: 5000, lockOnMobile: false,
      dependencyProperty: 'blocked-by', lockedProperty: 'locked', showBarProperties: true, barPropertyMinWidth: 80 },
    app: {
      metadataCache: { getFirstLinkpathDest: () => null },
      workspace: { trigger() {}, getLeaf: () => ({ openFile: (value: any) => { opened.push(value.path); } }) },
      vault: { trash: async (value: any) => { trashed.push(value.path); } },
      fileManager: { processFrontMatter() { assert.fail('Changing presentation must not modify notes'); } },
    },
  };
  const host = document.createElement('div'); document.body.append(host);
  const view = new SequenceView({} as any, host, plugin) as any;
  cleanup.push(() => view.onunload());
  const values: Record<string, any> = { orderProp: 'note.order', colorProp: 'note.Dish',
    barDisplayProp1: 'note.Dish', showTable: true, showArrows: false, locked: true };
  view.config = { get: (key: string) => values[key], set: (key: string, value: any) => { values[key] = value; },
    getAsPropertyId: (key: string) => values[key] ?? null, getOrder: () => ['note.Dish'],
    getDisplayName: (id: string) => id.replace(/^note\./, '') };
  view.allProperties = ['note.Dish'];
  view.data = { data: [{ file, getValue: (id: string) => (metadata as any)[id.replace(/^note\./, '')] }], groupedData: [] };
  assert.equal(subscribers.size, 1);
  view.onDataUpdated();
  const checkColors = (tone: string) => {
    assert.equal(host.querySelector('.sabidurian-bar').style.fill, `var(--sabidurian-tone-${tone})`);
    assert.equal(host.querySelector('.sabidurian-property-badge').dataset.sabidurianColor, tone);
    assert.equal(host.querySelector('.sabidurian-st-cell [data-sabidurian-color]').dataset.sabidurianColor, tone);
    assert.equal(document.querySelectorAll('.sabidurian-tooltip').length, 1);
    assert.equal(subscribers.size, 1, 'refresh does not register another subscription');
  };
  checkColors('orange');
  palette.Dish.Gratin = 'blue';
  for (const update of subscribers) update();
  checkColors('blue');
  assert.deepEqual(metadata, { order: 1, Dish: 'Gratin' });
  host.querySelector('.sabidurian-bar-group').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(opened, [file.path], 'Sequence keeps its existing note-open behavior');

  assert.equal(view.contextMenuManager.viewLocked, true);
  await view.keyboardManager.onDeleteEntry(view.currentEntries[0]);
  assert.equal(Modal.opened.length, 0, 'locked views cannot open keyboard delete confirmation');
  values.locked = false; view.onDataUpdated();
  assert.equal(view.contextMenuManager.viewLocked, false, 'unlocked Sequence keeps context operations available');
  const task = view.currentEntries[0]; task.locked = true;
  await view.keyboardManager.onDeleteEntry(task);
  assert.equal(Modal.opened.length, 0, 'per-note locks also guard keyboard deletion');
  task.locked = false;
  const pending = view.keyboardManager.onDeleteEntry(task);
  assert.equal(Modal.opened.length, 1, 'unlocked keyboard deletion retains confirmation');
  task.locked = true;
  Modal.opened[0].contentEl.querySelector<HTMLButtonElement>('button.mod-warning')!.click();
  await pending;
  assert.deepEqual(trashed, [], 'a new lock is respected while confirmation is pending');
  view.onunload();
  assert.equal(subscribers.size, 0); assert.equal(document.querySelectorAll('.sabidurian-tooltip').length, 0);
});
