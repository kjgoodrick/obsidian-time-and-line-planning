import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { SabidurianView } from '../src/SabidurianView';
import { SequenceView } from '../src/SequenceView';
import { CollaborationBridge, type TimelineHandle } from '../src/collaboration/CollaborationBridge';
import { TaskInspector } from '../src/interaction/TaskInspector';
import { Modal } from './obsidian-mock';

const win = new Window();
Object.assign(globalThis, { window: win, document: win.document, MouseEvent: win.MouseEvent, CSS: win.CSS });
const proto = win.HTMLElement.prototype as any;
proto.createEl = function(tag: string, opts: any = {}) {
  const el = document.createElement(tag);
  if (opts.text != null) el.textContent = opts.text;
  if (opts.cls) el.className = opts.cls;
  for (const [key, value] of Object.entries(opts.attr ?? {})) el.setAttribute(key, String(value));
  for (const key of ['type', 'value', 'placeholder']) if (opts[key] != null) (el as any)[key] = opts[key];
  this.append(el); return el;
};
proto.createDiv = function(opts: any) { return this.createEl('div', opts); };
proto.createSpan = function(opts: any) { return this.createEl('span', opts); };
proto.addClass = function(...classes: string[]) { this.classList.add(...classes); };
proto.empty = function() { this.replaceChildren(); };
proto.setText = function(text: string) { this.textContent = text; };
(win.SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 40, height: 20 });
const frames = new Map<number, FrameRequestCallback>(); let serial = 0;
globalThis.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
globalThis.cancelAnimationFrame = id => { frames.delete(id); };
const views: (SabidurianView | SequenceView)[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.onunload();
  for (const modal of Modal.opened) modal.close(); Modal.opened = [];
  frames.clear(); document.body.replaceChildren();
});

function fixture(kind: 'timeline' | 'sequence', grouped = false) {
  const files = [0, 1].map(index => ({ path: `Tasks/item-${index}.md`, basename: `item-${index}`, parent: { path: 'Tasks' } }));
  const metadata = new Map(files.map(file => [file.path, { start: '2026-11-26T08:00:00Z', end: '2026-11-26T09:00:00Z', status: 'Ready', title: 'Same name' }]));
  const entries = files.map((file, index) => ({ file, getValue: (id: string) => id === 'note.order' ? index + 1 : id === 'formula.total' ? index + 20 : (metadata.get(file.path) as any)[id.replace(/^note\./, '')] }));
  const values: Record<string, any> = { startDateProp: 'note.start', endDateProp: 'note.end', labelProp: 'note.title',
    orderProp: 'note.order', orderEndProp: null, timeZone: 'UTC', scaleId: 'day', snapMinutes: 5, tickMinutes: 15,
    oneTaskPerRow: true, showTable: false, showArrows: false, showToday: false, locked: true,
    initialScroll: 'start', collapsedGroups: grouped ? ['Lane'] : [], barDisplayProp1: 'note.status', barDisplayProp2: 'formula.total' };
  const writes: unknown[] = [], configWrites: unknown[] = [];
  const bridge = new CollaborationBridge();
  const plugin = { collaboration: bridge, colorSubscribers: new Set(), settings: { maxEntries: 5000, lockOnMobile: false,
    dependencyProperty: 'blocked-by', lockedProperty: 'locked', showBarProperties: true, barPropertyMinWidth: 80, markers: [] },
    history: { canUndo: false, patch: (...args: unknown[]) => { writes.push(args); } },
    app: { metadataCache: { getFileCache: (file: any) => ({ frontmatter: metadata.get(file.path) }), getFirstLinkpathDest: () => null },
      vault: { getMarkdownFiles: () => files }, workspace: { trigger() {}, getLeaf: () => ({ openFile: (...args: unknown[]) => { writes.push(args); } }) } } };
  const root = document.createElement('div'); document.body.append(root);
  const view: any = kind === 'timeline' ? new SabidurianView({} as any, root, plugin as any) : new SequenceView({} as any, root, plugin as any);
  views.push(view);
  view.config = { get: (key: string) => values[key], set: (key: string, value: unknown) => { configWrites.push([key, value]); values[key] = value; },
    getAsPropertyId: (key: string) => values[key] ?? null, getOrder: () => [], getDisplayName: (id: string) => 'Alias for ' + id };
  view.allProperties = ['note.status', 'formula.total'];
  view.data = { data: entries, groupedData: grouped ? [{ hasKey: () => true, key: 'Lane', entries }] : [] };
  view.onDataUpdated(); for (const callback of [...frames.values()]) callback(0); frames.clear();
  return { view, surface: view.collaboration, root, files, values, metadata, bridge, plugin, writes, configWrites };
}

for (const kind of ['timeline', 'sequence'] as const) {
  test(`${kind}: record and badge targets preserve file/property identity across render and rename`, () => {
    const f = fixture(kind), surface = f.surface;
    assert.equal(f.bridge.getSurfaces()[0], surface); assert.equal(surface.owner, f.view);
    const handles: TimelineHandle[] = surface.handles();
    assert.equal(handles.filter(handle => handle.target.type === 'item').length, 2);
    const badge = handles.find(handle => handle.target.type === 'cell' && handle.target.file === f.files[0] && handle.target.property === 'formula.total')!;
    assert.ok(badge); assert.equal(surface.hit(badge.element.firstChild!)?.target.property, 'formula.total');
    assert.equal(surface.hit(f.root), undefined); assert.equal(badge.current(), true);
    f.files[0].path = 'Tasks/renamed.md'; f.metadata.set(f.files[0].path, { start: '2026-11-26T08:00:00Z', end: '2026-11-26T09:00:00Z', status: 'Ready', title: 'Same name' });
    f.view.onDataUpdated(); assert.equal(badge.current(), false);
    assert.ok(surface.handles().some((handle: TimelineHandle) => handle.target.file === f.files[0]));
    assert.deepEqual(f.writes, []);
  });

  test(`${kind}: coordinate hit-testing reaches a badge underneath the task's transparent hit area`, () => {
    const f = fixture(kind), handles: TimelineHandle[] = f.surface.handles();
    const item = handles.find(handle => handle.target.type === 'item' && handle.target.file === f.files[0])!;
    const badge = handles.find(handle => handle.target.type === 'cell' && handle.target.file === f.files[0] && handle.target.property === 'note.status')!;
    badge.element.getBoundingClientRect = () => new win.DOMRect(100, 20, 40, 20) as any;
    const hit = item.element.querySelector('.sabidurian-task-hit')!;
    assert.equal(f.surface.hit(hit, { clientX: 110, clientY: 30 })?.target.property, 'note.status');
    assert.equal(f.surface.hit(hit, { clientX: 10, clientY: 30 })?.target.type, 'item');
    const viewport = f.surface.viewport()!; viewport.getBoundingClientRect = () => new win.DOMRect(0, 0, 400, 300) as any;
    assert.ok(f.surface.geometry(badge.target));
    badge.element.getBoundingClientRect = () => new win.DOMRect(500, 20, 40, 20) as any;
    assert.equal(f.surface.geometry(badge.target), undefined);
  });

  test(`${kind}: reveal preserves schedules, locks, config and selection; collapsed groups stay explicit`, () => {
    const f = fixture(kind), before = structuredClone([...f.metadata]);
    f.view.selectionManager.select(0); const selection = f.surface.selection();
    const config = JSON.stringify(f.values), writes = f.configWrites.length;
    assert.equal(f.surface.reveal({ type: 'item', file: f.files[1] }), 'revealed');
    assert.deepEqual(f.surface.selection(), selection); assert.equal(JSON.stringify(f.values), config);
    assert.equal(f.configWrites.length, writes); assert.deepEqual([...f.metadata], before); assert.deepEqual(f.writes, []);
    assert.equal(f.surface.reveal({ type: 'cell', file: f.files[1], property: 'note.hidden' }), 'property-hidden');
    const grouped = fixture(kind, true), groupedConfig = JSON.stringify(grouped.values);
    assert.equal(grouped.surface.reveal({ type: 'item', file: grouped.files[0] }), 'hidden');
    assert.equal(JSON.stringify(grouped.values), groupedConfig);
  });

  test(`${kind}: external navigation refuses a dirty inspector and resumes after explicit close`, () => {
    const f = fixture(kind);
    const modal = new TaskInspector(f.plugin.app as any, f.files[0] as any,
      { start: 'start', end: 'end', label: 'title', dependencies: 'blocked-by', zone: 'UTC' }, f.plugin.history as any, false, () => {}, () => {});
    modal.open(); const input = modal.contentEl.querySelector('input')!; input.value = '2026-11-26T08:05:00'; const dirtyValue = input.value;
    assert.equal(TaskInspector.hasDirty(document), true);
    assert.equal(f.bridge.canNavigate(document), false);
    assert.equal(f.surface.beginAnnotation(() => assert.fail('dirty inspector selection'), () => {}), undefined);
    const body = f.surface.viewport()!, before = [body.scrollLeft, body.scrollTop];
    assert.equal(f.surface.reveal({ type: 'item', file: f.files[1] }), 'busy');
    assert.deepEqual([body.scrollLeft, body.scrollTop], before); assert.equal(input.value, dirtyValue);
    modal.close(); assert.equal(TaskInspector.hasDirty(document), false);
    assert.equal(f.bridge.canNavigate(document), true);
    assert.equal(f.surface.reveal({ type: 'item', file: f.files[1] }), 'revealed'); assert.deepEqual(f.writes, []);
  });

  test(`${kind}: empty results invalidate old geometry and cannot reveal a detached renderer`, () => {
    const f = fixture(kind), captured = f.surface.handles()[0];
    f.view.data = { data: [], groupedData: [] }; f.view.onDataUpdated();
    assert.equal(captured.current(), false); assert.deepEqual(f.surface.handles(), []);
    assert.equal(f.surface.viewport(), undefined); assert.equal(f.surface.reveal({ type: 'item', file: f.files[0] }), 'unavailable');
  });

  test(`${kind}: explicit annotation mode captures a badge without invoking schedule handlers`, () => {
	const f = fixture(kind), received: TimelineHandle[] = []; let stopped = 0, scheduleGestures = 0;
	const item = f.surface.handles().find((handle: TimelineHandle) => handle.target.type === 'item' && handle.target.file === f.files[0])!;
	const badge = f.surface.handles().find((handle: TimelineHandle) => handle.target.type === 'cell' && handle.target.file === f.files[0] && handle.target.property === 'note.status')!;
	badge.element.getBoundingClientRect = () => new win.DOMRect(100, 20, 40, 20) as any;
	const hit = item.element.querySelector('.sabidurian-task-hit')!;
	hit.addEventListener('mousedown', () => scheduleGestures++);
	const stop = f.surface.beginAnnotation((handle: TimelineHandle) => received.push(handle), () => stopped++); assert.ok(stop);
	const down = new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 110, clientY: 30 }); hit.dispatchEvent(down);
	hit.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 110, clientY: 30 }));
	assert.equal(down.defaultPrevented, true); assert.equal(scheduleGestures, 0); assert.equal(stopped, 1); assert.equal(received.length, 1);
	assert.equal(received[0].target.type, 'cell'); assert.equal(received[0].current(), true); assert.deepEqual(f.writes, []);
	stop(); assert.equal(stopped, 1);
	hit.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true })); assert.equal(scheduleGestures, 1);
  });

  test(`${kind}: touch annotation leaves pan available and ignores the click following a drag`, () => {
	const f = fixture(kind); let selected = 0, stopped = 0, touchHandlers = 0;
	const item = f.surface.handles().find((handle: TimelineHandle) => handle.target.type === 'item')!;
	const hit = item.element.querySelector('.sabidurian-task-hit')!;
	hit.addEventListener('touchstart', () => touchHandlers++);
	f.surface.beginAnnotation(() => selected++, () => stopped++);
	hit.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
	const touch = new win.Event('touchstart', { bubbles: true, cancelable: true }); hit.dispatchEvent(touch);
	assert.equal(touch.defaultPrevented, false); assert.equal(touchHandlers, 0);
	hit.dispatchEvent(new win.MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 10 }));
	hit.dispatchEvent(new win.MouseEvent('click', { bubbles: true, clientX: 50, clientY: 10 }));
	assert.equal(selected, 0); assert.equal(stopped, 0); assert.deepEqual(f.writes, []);
	hit.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
	hit.dispatchEvent(new win.MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
	assert.equal(selected, 1); assert.equal(stopped, 1); assert.deepEqual(f.writes, []);
  });

  test(`${kind}: annotation guards close on Escape and unload`, () => {
	const f = fixture(kind); let stopped = 0, selected = 0;
	f.surface.beginAnnotation(() => selected++, () => stopped++);
	document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	assert.equal(stopped, 1);
	f.surface.beginAnnotation(() => selected++, () => stopped++); f.view.onunload();
	assert.equal(stopped, 2); assert.equal(selected, 0); assert.equal(f.bridge.available, true);
	f.bridge.dispose(); assert.equal(f.bridge.available, false); assert.equal(f.bridge.canNavigate(document), false);
  });

  test(`${kind}: leaving the window cancels annotation without retaining schedule interception`, () => {
    const f = fixture(kind); let stopped = 0, gestures = 0;
    const item = f.surface.handles().find((handle: TimelineHandle) => handle.target.type === 'item')!;
    item.element.addEventListener('mousedown', () => gestures++);
    f.surface.beginAnnotation(() => assert.fail('unexpected selection'), () => stopped++);
    win.dispatchEvent(new win.Event('blur'));
    item.element.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
    assert.equal(stopped, 1); assert.equal(gestures, 1);
    f.surface.beginAnnotation(() => assert.fail('unexpected selection'), () => stopped++);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    try { document.dispatchEvent(new win.Event('visibilitychange')); assert.equal(stopped, 2); }
    finally { delete (document as any).hidden; }
  });

  test(`${kind}: ambiguous badge property names cannot fall back to whole-item selection`, () => {
    const f = fixture(kind);
    f.values.barDisplayProp1 = 'note.file.name'; f.values.barDisplayProp2 = 'file.name';
    for (const value of f.metadata.values()) Object.assign(value, { 'file.name': 'Same visible value' });
    f.view.onDataUpdated();
    const badge = f.root.querySelector<SVGElement>('.sabidurian-property-badge')!; assert.ok(badge);
    assert.equal(f.surface.hit(badge.firstChild!), undefined);
    badge.getBoundingClientRect = () => new win.DOMRect(100, 20, 40, 20) as any;
    const hit = badge.parentElement!.querySelector('.sabidurian-task-hit')!;
    assert.equal(f.surface.hit(hit, { clientX: 110, clientY: 30 }), undefined);
  });
}

test('disposal invalidates captured handles and notifies independent consumers even when one throws', () => {
  const f = fixture('timeline'), handle = f.surface.handles()[0]; let changed = 0, closed = false;
  f.bridge.onChange(() => { throw new Error('consumer failure'); });
  f.bridge.onChange(() => { changed++; closed = f.bridge.getSurfaces().length === 0; });
  f.bridge.dispose(); assert.ok(changed > 0); assert.equal(closed, true); assert.equal(handle.current(), false);
  assert.deepEqual(f.surface.handles(), []); assert.equal(f.surface.reveal({ type: 'item', file: f.files[0] }), 'unavailable');
  f.view.onunload(); assert.deepEqual(f.bridge.getSurfaces(), []);
});
