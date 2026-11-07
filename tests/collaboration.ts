import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { SabidurianView } from '../src/SabidurianView';
import { SequenceView } from '../src/SequenceView';
import { CollaborationBridge, type TimelineHandle } from '../src/collaboration/CollaborationBridge';
import { TaskInspector } from '../src/interaction/TaskInspector';
import { Modal } from './obsidian-mock';
import { parseTimelineRange } from '../src/collaboration/TimelineRange';
import { projectRange } from '../src/collaboration/RangeProjection';
import { identifyLocalMarkers, localMarkerSnapshots } from '../src/collaboration/LocalMarkers';
import type { SabidurianMarker } from '../src/settings';

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
test('local marker identities survive reorder and repair duplicate legacy IDs without changing metadata', () => {
  const first = '73000000-0000-4000-8000-000000000001'; let serial = 1;
  const markers: SabidurianMarker[] = [{ id: first, label: 'First', color: '#112233', date: '2026-11-07', enabled: true },
    { id: first, label: 'Second', color: 'var(--color-blue)', start: '-500', end: '0', enabled: false },
    { label: 'Third', color: '#ffffff', date: '2027', enabled: true }];
  const original = markers.map(({ id, ...value }) => value);
  assert.equal(identifyLocalMarkers(markers, () => `73000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`), true);
  assert.equal(new Set(markers.map(marker => marker.id)).size, 3);
  assert.deepEqual(markers.map(({ id, ...value }) => value), original);
  markers.reverse(); assert.equal(identifyLocalMarkers(markers), false);
});
test('local snapshots fence edits, deletion, duplication and unload while allowing reorder', () => {
  const markers: SabidurianMarker[] = [1, 2].map(value => ({ id: `73000000-0000-4000-8000-${String(value).padStart(12, '0')}`,
    label: 'Same label', color: '#112233', date: '2026-11-07', enabled: true }));
  let active = true;
  const snapshots = localMarkerSnapshots(() => markers, () => active);
  markers.reverse(); assert.equal(snapshots[0].current(), true);
  markers[1].label = 'Changed'; assert.equal(snapshots[0].current(), false);
  assert.equal(snapshots[1].current(), true); markers.push({ ...markers[0] });
  assert.equal(snapshots[1].current(), false); assert.throws(() => localMarkerSnapshots(() => markers, () => active));
  markers.pop(); markers.pop(); assert.equal(snapshots[0].current(), false);
  active = false; assert.equal(snapshots[1].current(), false);
  assert.throws(() => localMarkerSnapshots(() => Array(257).fill(markers[0]), () => true));
});
afterEach(() => {
  for (const view of views.splice(0)) view.onunload();
  for (const modal of Modal.opened) modal.close(); Modal.opened = [];
  frames.clear(); document.body.replaceChildren();
});

function fixture(kind: 'timeline' | 'sequence', grouped = false, empty = false) {
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
  view.data = { data: empty ? [] : entries, groupedData: grouped && !empty ? [{ hasKey: () => true, key: 'Lane', entries }] : [] };
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
    const context = f.surface.rangeContext()!;
    assert.equal(f.surface.revealRangePresence(distantRange(kind === 'sequence'), context.axis, { x: 0.5, y: 0.5 }), 'busy');
    assert.deepEqual([body.scrollLeft, body.scrollTop], before); assert.equal(input.value, dirtyValue);
    modal.close(); assert.equal(TaskInspector.hasDirty(document), false);
    assert.equal(f.bridge.canNavigate(document), true);
    assert.equal(f.surface.reveal({ type: 'item', file: f.files[1] }), 'revealed'); assert.deepEqual(f.writes, []);
  });

  test(`${kind}: empty results replace the old renderer with a live range axis but cannot reveal removed tasks`, () => {
    const f = fixture(kind), captured = f.surface.handles()[0], previous = f.surface.viewport();
    f.view.data = { data: [], groupedData: [] }; f.view.onDataUpdated();
    assert.equal(captured.current(), false); assert.deepEqual(f.surface.handles(), []);
    assert.equal(previous.isConnected, false); assert.notEqual(f.surface.viewport(), previous);
    assert.ok(f.surface.rangeContext()?.current()); assert.equal(f.surface.reveal({ type: 'item', file: f.files[0] }), 'unavailable');
  });

  test(`${kind}: collapsed lane annotation preserves its exact source and never toggles the lane`, () => {
    const f = fixture(kind, true), group = f.view.data.groupedData[0], handles = f.surface.groups();
    assert.equal(handles.length, 1); assert.equal(handles[0].target.group, group);
    const heading = handles[0].element, before = JSON.stringify(f.values); let selected: any, stopped = 0;
    f.surface.beginAnnotation((handle: any) => { selected = handle; }, () => stopped++);
    heading.querySelector('text')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(selected.target.type, 'group'); assert.equal(selected.target.group, group); assert.equal(stopped, 1);
    assert.equal(selected.current(), true); assert.equal(JSON.stringify(f.values), before); assert.deepEqual(f.configWrites, []);
    assert.deepEqual(f.writes, []); assert.equal(heading.getAttribute('aria-expanded'), 'false');
  });

  test(`${kind}: lane reveal changes only vertical scroll and respects dirty inspector drafts`, () => {
    const f = fixture(kind, true), group = f.view.data.groupedData[0], body = f.surface.viewport()!;
    body.scrollLeft = 75; body.scrollTop = 400; const before = JSON.stringify(f.values);
    assert.equal(f.surface.revealGroup(group), 'revealed'); assert.equal(body.scrollLeft, 75); assert.ok(body.scrollTop >= 0 && body.scrollTop < 400);
    assert.equal(JSON.stringify(f.values), before); assert.deepEqual(f.configWrites, []); assert.deepEqual(f.writes, []);
    const modal = new TaskInspector(f.plugin.app as any, f.files[0] as any,
      { start: 'start', end: 'end', label: 'title', dependencies: 'blocked-by', zone: 'UTC' }, f.plugin.history as any, false, () => {}, () => {});
    modal.open(); modal.contentEl.querySelector('input')!.value = 'invalid draft'; body.scrollTop = 400;
    assert.equal(f.surface.revealGroup(group), 'busy'); assert.equal(body.scrollTop, 400); modal.close();
  });

  test(`${kind}: equal lane labels never replace group identity, even after order or render changes`, () => {
    const f = fixture(kind, true), entries = f.view.data.data;
    const first = { hasKey: () => true, key: 'Same label', entries: [entries[0]] }, second = { hasKey: () => true, key: 'Same label', entries: [entries[1]] };
    f.view.data = { data: entries, groupedData: [first, second] }; f.view.onDataUpdated();
    const handles = f.surface.groups(); assert.equal(handles.length, 2);
    assert.equal(handles[0].target.group, first); assert.equal(handles[1].target.group, second);
    assert.equal(f.surface.groupHit(handles[1].element.firstChild!)?.target.group, second);
    f.view.data.groupedData.reverse(); f.view.onDataUpdated();
    assert.equal(handles[0].current(), false); assert.equal(f.surface.groups()[0].target.group, second);
    assert.equal(f.surface.revealGroup({ ...first }), 'unavailable');
  });

  test(`${kind}: removed source groups invalidate mounted lane handles before the next render`, () => {
    const f = fixture(kind, true), handle = f.surface.groups()[0], group = handle.target.group;
    f.view.data.groupedData = [];
    assert.equal(handle.current(), false); assert.deepEqual(f.surface.groups(), []); assert.equal(f.surface.revealGroup(group), 'unavailable');
    f.view.onunload(); assert.equal(f.surface.groupHit(handle.element), undefined);
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

  test(`${kind}: keyboard picker selects the exact property without scheduling keys or writes`, () => {
    const f = fixture(kind), trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const received: TimelineHandle[] = []; let stopped = 0, scheduleKeys = 0;
    f.root.addEventListener('keydown', () => scheduleKeys++);
    const before = JSON.stringify(f.values);
    f.surface.beginAnnotation((handle: TimelineHandle) => received.push(handle), () => stopped++);
    const panel = f.root.querySelector('.sabidurian-annotation-picker')!;
    const picker = panel.querySelector('select')!;
    assert.equal(document.activeElement, picker);
    assert.equal(panel.querySelector('label')?.htmlFor, picker.id);
    assert.ok(document.getElementById(picker.getAttribute('aria-describedby')!)?.getAttribute('role') === 'status');
    const option = [...picker.options].find(option => option.textContent === `Property: ${f.files[0].path} — note.status`)!;
    assert.ok(option); picker.value = option.value; picker.dispatchEvent(new win.Event('change', { bubbles: true }));
    const arrow = new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }); picker.dispatchEvent(arrow);
    assert.equal(arrow.defaultPrevented, false); assert.equal(scheduleKeys, 0);
    picker.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    picker.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(received.length, 0);
    // A scroll/geometry notification replaces wrappers without changing identity.
    f.surface.changed();
    picker.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(received.length, 1); assert.equal(received[0].current(), true);
    assert.equal(received[0].target.type, 'cell'); assert.equal(received[0].target.file, f.files[0]);
    assert.equal((received[0].target as any).property, 'note.status'); assert.equal(stopped, 1);
    assert.equal(f.root.querySelector('.sabidurian-annotation-picker'), null);
    assert.equal(f.root.querySelector('.sabidurian-annotation-target'), null); assert.equal(document.activeElement, trigger);
    assert.equal(JSON.stringify(f.values), before); assert.deepEqual(f.configWrites, []); assert.deepEqual(f.writes, []);
  });

  test(`${kind}: picker confirmation rechecks an inspector that becomes dirty after selection begins`, () => {
    const f = fixture(kind); let selected = 0;
    const stop = f.surface.beginAnnotation(() => selected++, () => {});
    const picker = f.root.querySelector<HTMLSelectElement>('.sabidurian-annotation-picker select')!;
    picker.value = [...picker.options].find(option => option.textContent === `Item: ${f.files[0].path}`)!.value;
    picker.dispatchEvent(new win.Event('change', { bubbles: true }));
    const modal = new TaskInspector(f.plugin.app as any, f.files[0] as any,
      { start: 'start', end: 'end', label: 'title', dependencies: 'blocked-by', zone: 'UTC' }, f.plugin.history as any, false, () => {}, () => {});
    modal.open(); modal.contentEl.querySelector('input')!.value = '2026-11-27T10:15';
    picker.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(selected, 0); assert.equal(modal.contentEl.querySelector('input')!.value, '2026-11-27T10:15');
    assert.deepEqual(f.writes, []); stop(); modal.close();
  });

  test(`${kind}: native picker buttons confirm exact items and cancel without selecting`, () => {
    const f = fixture(kind); let selected: any, stopped = 0;
    f.surface.beginAnnotation((handle: any) => { selected = handle; }, () => stopped++);
    const panel = f.root.querySelector('.sabidurian-annotation-picker')!, picker = panel.querySelector('select')!;
    picker.value = [...picker.options].find(option => option.textContent === `Item: ${f.files[1].path}`)!.value;
    picker.dispatchEvent(new win.Event('change', { bubbles: true }));
    panel.querySelector('button')!.click();
    assert.equal(selected.target.type, 'item'); assert.equal(selected.target.file, f.files[1]); assert.equal(stopped, 1);
    f.surface.beginAnnotation(() => assert.fail('Cancel selected a target'), () => stopped++);
    f.root.querySelectorAll<HTMLButtonElement>('.sabidurian-annotation-picker button')[1].click();
    assert.equal(stopped, 2); assert.deepEqual(f.writes, []);
  });

  if (kind === 'timeline') test('timeline: verified lock-only query replacement rebinds item handles without redrawing', () => {
    const f = fixture(kind), body = f.surface.viewport();
    const oldHandle = f.surface.handles().find((handle: TimelineHandle) => handle.target.type === 'item')!;
    f.view.setLocked(false);
    f.view.data = { ...f.view.data, data: [...f.view.data.data] };
    assert.equal(oldHandle.current(), false);
    f.view.onDataUpdated();
    assert.equal(f.surface.viewport() === body, true);
    const current = f.surface.handles().find((handle: TimelineHandle) => handle.target.type === 'item' && handle.target.file === oldHandle.target.file)!;
    assert.ok(current); assert.equal(current.current(), true); assert.equal(oldHandle.current(), false);
    assert.deepEqual(f.writes, []);
  });

  test(`${kind}: keyboard lane selection keeps source identity and collapsed state`, () => {
    const f = fixture(kind, true), group = f.view.data.groupedData[0], heading = f.surface.groups()[0].element;
    let selected: any;
    f.surface.beginAnnotation((handle: any) => { selected = handle; }, () => {});
    const picker = f.root.querySelector<HTMLSelectElement>('.sabidurian-annotation-picker select')!;
    picker.value = [...picker.options].find(option => option.textContent?.startsWith('Lane:'))!.value;
    picker.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(heading.classList.contains('sabidurian-annotation-target'), true);
    picker.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(selected.target.type, 'group'); assert.equal(selected.target.group, group);
    assert.equal(heading.getAttribute('aria-expanded'), 'false'); assert.deepEqual(f.writes, []); assert.deepEqual(f.configWrites, []);
  });

  test(`${kind}: disappearing picker target cannot become another target or whole-view comment`, () => {
    const f = fixture(kind); let selected = 0, stopped = 0;
    f.surface.beginAnnotation(() => selected++, () => stopped++);
    const panel = f.root.querySelector('.sabidurian-annotation-picker')!, picker = panel.querySelector('select')!;
    picker.value = [...picker.options].find(option => option.textContent === `Item: ${f.files[0].path}`)!.value;
    picker.dispatchEvent(new win.Event('change', { bubbles: true }));
    const oldHandle = f.surface.handles().find((handle: TimelineHandle) => handle.target.type === 'item')!;
    // Query identity is checked even before the renderer processes the update.
    f.view.data = { data: [], groupedData: [] };
    assert.equal(oldHandle.current(), false); assert.equal(f.surface.hit(oldHandle.element), undefined);
    assert.equal(f.surface.reveal(oldHandle.target), 'unavailable'); assert.deepEqual(f.surface.selection(), []);
    picker.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(selected, 0); assert.equal(picker.value, ''); assert.equal(panel.querySelector('button')?.disabled, true);
    assert.match(panel.querySelector('[role="status"]')!.textContent!, /changed|ambiguous/);
    f.view.onDataUpdated();
    assert.equal(stopped, 1); assert.equal(f.root.querySelector('.sabidurian-annotation-picker'), null); assert.deepEqual(f.writes, []);
  });

  test(`${kind}: empty annotation picker has an accessible cancel path and never chooses a fallback`, () => {
    const f = fixture(kind); f.view.data = { data: [], groupedData: [] }; f.view.onDataUpdated();
    let stopped = 0; f.surface.beginAnnotation(() => assert.fail('empty picker selected'), () => stopped++);
    const panel = f.root.querySelector('.sabidurian-annotation-picker')!, picker = panel.querySelector('select')!;
    assert.equal(picker.options.length, 1); assert.equal(panel.querySelector('button')?.disabled, true);
    assert.match(panel.querySelector('[role="status"]')!.textContent!, /No item, property or lane/);
    picker.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(stopped, 0);
    picker.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(stopped, 1); assert.deepEqual(f.writes, []);
  });

  test(`${kind}: cancelling annotation does not steal focus moved outside the picker`, () => {
    const f = fixture(kind), outside = document.createElement('input'); document.body.append(outside);
    f.surface.beginAnnotation(() => assert.fail('unexpected choice'), () => {}); outside.focus();
    outside.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(document.activeElement, outside); assert.equal(f.root.querySelector('.sabidurian-annotation-picker'), null);
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

function rangeLayout(f: ReturnType<typeof fixture>, resetAxis = true) {
  const viewport = f.view.timelineRenderer.element as HTMLElement, svg = f.view.timelineRenderer.svgElement as SVGSVGElement;
  if (resetAxis) f.view.axis.setView(f.view.type === 'sabidurian-sequence' ? 1 : 2026, f.view.type === 'sabidurian-sequence' ? 5 : 2027, 800);
  Object.defineProperties(viewport, { clientWidth: { value: 400, configurable: true }, clientHeight: { value: 200, configurable: true }, scrollWidth: { value: 800, configurable: true } });
  viewport.scrollLeft = 0;
  viewport.getBoundingClientRect = () => ({ left: 100, right: 500, top: 50, bottom: 250, width: 400, height: 200 } as DOMRect);
  svg.getBoundingClientRect = () => ({ left: 100 - viewport.scrollLeft, right: 900 - viewport.scrollLeft, top: 50, bottom: 450, width: 800, height: 400 } as DOMRect);
  return { viewport, svg };
}
function rangePointer(target: EventTarget, type: string, x: number, y = 100, pointerType = 'mouse', pointerId = 1) {
  const event = new win.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerType, pointerId });
  target.dispatchEvent(event); return event;
}
const ordinal = { version: 1 as const, kind: 'ordinal' as const, start: '1', end: '3', start_inclusive: true, end_inclusive: false, unit: 'property-value' as const };

test('range context follows the live axis, retains scroll, and rejects changed configuration or replaced rendering', () => {
  const f = fixture('sequence'), { viewport } = rangeLayout(f), context = f.surface.rangeContext()!;
  assert.ok(context.current()); viewport.scrollLeft = 200; assert.ok(context.current());
  f.values.orderProp = 'note.other'; assert.equal(context.current(), false);
  f.values.orderProp = 'note.order'; const next = f.surface.rangeContext()!;
  f.view.onDataUpdated(); assert.equal(next.current(), false);
  assert.ok(f.surface.rangeContext()); f.view.onunload(); assert.equal(f.surface.rangeContext(), undefined);
});

test('range geometry uses current SVG scale and scroll without changing axis or saved settings', () => {
  const f = fixture('sequence'), { viewport, svg } = rangeLayout(f), context = f.surface.rangeContext()!;
  const before = JSON.stringify(f.configWrites), geometry = f.surface.rangeGeometry(ordinal, context.axis)!;
  assert.equal(geometry.startX, 100); assert.equal(geometry.endX, 500); assert.equal(geometry.top, 54);
  viewport.scrollLeft = 100;
  assert.equal(f.surface.rangeGeometry(ordinal, context.axis)?.startX, 0);
  svg.getBoundingClientRect = () => ({ left: 100, right: 1700, top: 50, bottom: 450, width: 1600, height: 400 } as DOMRect);
  assert.equal(f.surface.rangeGeometry(ordinal, context.axis)?.endX, 900);
  assert.equal(JSON.stringify(f.configWrites), before); assert.equal(f.writes.length, 0);
});

test('range mouse drag consumes its compatibility click before returning control to scheduling', () => {
  const f = fixture('sequence'), { svg } = rangeLayout(f), selections: any[] = []; let normalClicks = 0, stopped = 0;
  svg.addEventListener('click', () => normalClicks++);
  const before = JSON.stringify(f.configWrites);
  f.surface.beginRange('ordinal', 'day', (value: any) => selections.push(value), () => stopped++);
  rangePointer(svg, 'pointerdown', 100); rangePointer(document, 'pointermove', 500); rangePointer(document, 'pointerup', 500);
  assert.equal(selections.length, 0);
  svg.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 500 }));
  assert.equal(selections.length, 1); assert.equal(stopped, 1); assert.equal(normalClicks, 0);
  assert.equal(selections[0].draft.start, '1'); assert.equal(selections[0].draft.end, '3'); assert.ok(selections[0].current());
  assert.equal(document.querySelector('.sabidurian-range-selection-status'), null);
  svg.dispatchEvent(new win.MouseEvent('click', { bubbles: true, clientX: 500 })); assert.equal(normalClicks, 1);
  assert.equal(JSON.stringify(f.configWrites), before); assert.equal(f.writes.length, 0);
});

test('touch pan and pinch retain native defaults and the next two taps select a range', () => {
  const f = fixture('sequence'), { svg } = rangeLayout(f), selections: any[] = [];
  f.surface.beginRange('ordinal', 'day', (value: any) => selections.push(value), () => {});
  assert.equal(rangePointer(svg, 'pointerdown', 150, 100, 'touch').defaultPrevented, false);
  assert.ok(document.querySelector('.sabidurian-range-selection-status'), 'active after touch start');
  assert.equal(rangePointer(document, 'pointermove', 300, 100, 'touch').defaultPrevented, false);
  assert.ok(document.querySelector('.sabidurian-range-selection-status'), 'active after touch pan');
  rangePointer(document, 'pointerup', 300, 100, 'touch');
  assert.ok(document.querySelector('.sabidurian-range-selection-status'), 'active after touch release');
  assert.equal(rangePointer(svg, 'pointerdown', 200, 100, 'touch', 2).defaultPrevented, false);
  assert.equal(rangePointer(svg, 'pointerdown', 300, 100, 'touch', 3).defaultPrevented, false);
  assert.equal(rangePointer(document, 'pointermove', 350, 100, 'touch', 3).defaultPrevented, false);
  rangePointer(document, 'pointerup', 200, 100, 'touch', 2); rangePointer(document, 'pointerup', 350, 100, 'touch', 3);
  svg.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 350 }));
  assert.equal(selections.length, 0);
  for (const x of [200, 400]) {
    rangePointer(svg, 'pointerdown', x, 100, 'touch'); rangePointer(document, 'pointerup', x, 100, 'touch');
    svg.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, clientX: x }));
    if (x === 200) assert.match(document.querySelector('.sabidurian-range-selection-status')?.textContent ?? 'closed', /End:/);
  }
  assert.equal(selections.length, 1); assert.equal(selections[0].draft.start, '1.5'); assert.equal(selections[0].draft.end, '2.5');
});

test('range selection survives descendant focus changes but cancels when its window loses focus', () => {
  const f = fixture('sequence'); rangeLayout(f); let stopped = 0;
  f.surface.beginRange('ordinal', 'day', () => assert.fail('unexpected selection'), () => stopped++);
  document.querySelector('.sabidurian-range-selection-status')!.dispatchEvent(new win.FocusEvent('blur'));
  assert.equal(stopped, 0); win.dispatchEvent(new win.FocusEvent('blur'));
  assert.equal(stopped, 1); assert.equal(document.querySelector('.sabidurian-range-selection-status'), null);
});

test('keyboard range selection announces values and supports cancellation without any editing', () => {
  const f = fixture('sequence'); rangeLayout(f); const selections: any[] = [];
  f.surface.beginRange('ordinal', 'day', (value: any) => selections.push(value), () => {});
  const status = document.querySelector('.sabidurian-range-selection-status')!;
  assert.equal(document.activeElement, status); assert.match(status.textContent!, /Sequence range/);
  status.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
  status.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight', shiftKey: true }));
  status.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
  assert.equal(selections.length, 1); assert.equal(selections[0].draft.start, '2'); assert.equal(selections[0].draft.end, '2.2');
  f.surface.beginRange('ordinal', 'day', () => assert.fail('cancelled selection'), () => {});
  document.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  assert.equal(document.querySelector('.sabidurian-comment-range-selection'), null); assert.equal(f.writes.length, 0);
});

test('range selection refuses dirty inspector input and stale callbacks after unload', () => {
  const f = fixture('timeline'); rangeLayout(f);
  const modal = new TaskInspector(f.plugin.app as any, f.files[0] as any,
    { start: 'start', end: 'end', label: 'title', dependencies: 'blocked-by', zone: 'UTC' }, f.plugin.history as any, false, () => {}, () => {});
  modal.open(); const input = modal.contentEl.querySelector('input')!; input.value = '2026-11-26T08:05:00';
  assert.equal(f.surface.beginRange('calendar', 'day', () => assert.fail('dirty capture'), () => {}), undefined);
  modal.close(); let stopped = 0;
  f.surface.beginRange('calendar', 'day', () => assert.fail('unloaded capture'), () => stopped++);
  f.view.onunload(); assert.equal(stopped, 1); assert.equal(document.querySelector('.sabidurian-range-selection-status'), null);
});

test('range reveal preserves vertical position and temporarily focuses an interval outside the rendered axis', () => {
  const f = fixture('sequence'), { viewport } = rangeLayout(f), context = f.surface.rangeContext()!;
  viewport.scrollTop = 123; const before = JSON.stringify(f.configWrites);
  assert.equal(f.surface.revealRange({ ...ordinal, start: '3', end: '4' }, context.axis), 'revealed');
  assert.equal(viewport.scrollLeft, 352); assert.equal(viewport.scrollTop, 123);
  assert.equal(f.surface.revealRange({ ...ordinal, start: '100', end: '101' }, context.axis), 'revealed');
  assert.equal(f.surface.viewport().scrollTop, 123); assert.equal(context.current(), false); assert.equal(JSON.stringify(f.configWrites), before);
});

const flushFrames = () => { for (const callback of [...frames.values()]) callback(0); frames.clear(); };
const distantRange = (sequence: boolean) => parseTimelineRange(sequence ? { ...ordinal, start: '-100', end: '-50' } : {
  version: 1, kind: 'calendar', start: '1800-01-01', end: '1800-01-02', time_zone: 'UTC', start_inclusive: true, end_inclusive: true });

for (const kind of ['timeline', 'sequence'] as const) {
  test(`${kind}: an initially empty view supports range selection, distant navigation and return without task editing`, () => {
    const f = fixture(kind, false, true); f.values.locked = false; f.view.onDataUpdated(); flushFrames();
    const { viewport, svg } = rangeLayout(f, false), context = f.surface.rangeContext()!, selected: any[] = [];
    assert.ok(context.current()); assert.deepEqual(f.surface.handles(), []); assert.deepEqual(f.surface.groups(), []);
    assert.ok(f.root.querySelector('.sabidurian-empty-axis-message'));
    assert.equal(f.view.dragManager, null); assert.equal(f.view.keyboardManager, null); assert.equal(f.view.touchManager, null);
    assert.equal(f.values.locked, false);
    viewport.scrollLeft = 21; viewport.scrollTop = 17;
    assert.ok(f.surface.beginRange(kind === 'sequence' ? 'ordinal' : 'calendar', 'day', (value: any) => selected.push(value), () => {}));
    const status = f.root.querySelector('.sabidurian-range-selection-status')!;
    for (const key of ['Enter', 'ArrowRight', 'Enter']) status.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, key }));
    assert.equal(selected.length, 1); assert.ok(selected[0].current()); assert.ok(parseTimelineRange(selected[0].draft));
    svg.dispatchEvent(new win.MouseEvent('click', { bubbles: true, clientX: 120 }));
    const range = distantRange(kind === 'sequence');
    assert.equal(f.surface.revealRange(range, context.axis), 'revealed'); flushFrames();
    assert.equal(context.current(), false); assert.equal(selected[0].current(), false);
    const focused = [f.view.axis.viewStart, f.view.axis.viewEnd]; f.view.onDataUpdated(); flushFrames();
    assert.deepEqual([f.view.axis.viewStart, f.view.axis.viewEnd], focused);
    f.root.querySelector<HTMLButtonElement>('.sabidurian-comment-range-focus button')!.click(); flushFrames();
    assert.equal(f.root.querySelector('.sabidurian-comment-range-focus'), null); assert.ok(f.surface.rangeContext()?.current());
    assert.ok(Math.abs(f.surface.viewport().scrollLeft - 21) < 0.00001); assert.equal(f.surface.viewport().scrollTop, 17);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.configWrites, []);
    if (kind === 'timeline') {
      f.view.applyLockState(false);
      assert.equal(f.root.querySelector<HTMLButtonElement>('.sabidurian-new-task-btn')!.disabled, true);
    }
  });

  test(`${kind}: ranges remain available when every record has an invalid coordinate, including exact source lanes`, () => {
    const f = fixture(kind, true), group = f.view.data.groupedData[0];
    if (kind === 'timeline') for (const file of f.files) f.metadata.set(file.path, { ...f.metadata.get(file.path)!, start: 'invalid', end: 'invalid' });
    for (const entry of group.entries) {
      const get = entry.getValue;
      entry.getValue = (property: string) => [kind === 'sequence' ? 'note.order' : 'note.start', 'note.end'].includes(property) ? null : get(property);
    }
    f.view.onDataUpdated(); flushFrames();
    assert.equal(f.view.currentEntries.length, 0); assert.ok(f.surface.rangeContext()?.current());
    assert.equal(f.surface.groups()[0].target.group, group);
    const range = distantRange(kind === 'sequence'), axis = f.surface.rangeContext()!.axis;
    assert.equal(f.surface.revealRange(range, axis, group), 'revealed');
    assert.equal(f.surface.groups()[0].target.group, group); assert.deepEqual(f.values.collapsedGroups, ['Lane']);
    f.view.data = { data: [], groupedData: [] }; f.view.onDataUpdated(); flushFrames();
    assert.equal(f.surface.revealRange(range, axis, group), 'unavailable'); assert.deepEqual(f.surface.groups(), []);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.configWrites, []);
  });

  test(`${kind}: filters can hide and restore every task while a range keeps its axis identity`, () => {
    const f = fixture(kind), data = f.view.data, context = f.surface.rangeContext()!, range = distantRange(kind === 'sequence');
    assert.equal(f.surface.revealRange(range, context.axis), 'revealed');
    const focused = [f.view.axis.viewStart, f.view.axis.viewEnd];
    f.view.data = { data: [], groupedData: [] }; f.view.onDataUpdated(); flushFrames();
    assert.deepEqual([f.view.axis.viewStart, f.view.axis.viewEnd], focused); assert.deepEqual(f.surface.rangeContext()!.axis, context.axis);
    assert.equal(f.surface.reveal({ type: 'item', file: f.files[0] }), 'unavailable');
    f.view.data = data; f.view.onDataUpdated(); flushFrames();
    assert.deepEqual([f.view.axis.viewStart, f.view.axis.viewEnd], focused);
    assert.equal(f.surface.reveal({ type: 'item', file: f.files[0] }), 'revealed'); flushFrames();
    assert.equal(f.root.querySelector('.sabidurian-comment-range-focus'), null);
    assert.equal(f.view.currentEntries.length, 2); assert.deepEqual(f.writes, []); assert.deepEqual(f.configWrites, []);
  });

  test(`${kind}: an empty view with missing axis configuration never substitutes a guessed axis`, () => {
    const f = fixture(kind, false, true), context = f.surface.rangeContext()!, viewport = f.surface.viewport();
    f.values[kind === 'sequence' ? 'orderProp' : 'startDateProp'] = undefined;
    f.view.onDataUpdated(); flushFrames();
    assert.equal(context.current(), false); assert.equal(viewport.isConnected, false);
    assert.equal(f.surface.rangeContext(), undefined); assert.equal(f.surface.viewport(), undefined);
    assert.equal(f.surface.revealRange(distantRange(kind === 'sequence'), context.axis), 'unavailable');
    assert.deepEqual(f.writes, []); assert.deepEqual(f.configWrites, []);
  });

  test(`${kind}: range focus preserves data/settings, survives refresh and returns to the original viewport`, () => {
    const f = fixture(kind), before = JSON.stringify(f.values), { viewport } = rangeLayout(f, false);
    const bounds = [f.view.axis.viewStart, f.view.axis.viewEnd], context = f.surface.rangeContext()!;
    viewport.scrollLeft = 23; viewport.scrollTop = 37;
    const range = distantRange(kind === 'sequence'), unchanged = JSON.stringify(range);
    assert.equal(f.surface.revealRange(range, context.axis), 'revealed');
    assert.equal(context.current(), false); assert.equal(viewport.isConnected, false);
    assert.ok(f.root.querySelector('.sabidurian-comment-range-focus')); assert.equal(f.surface.viewport().scrollTop, 37);
    assert.ok(f.view.axis.totalWidth <= 3200); assert.equal(f.view.cullingActive, true);
    const projected = projectRange(range, f.view.rangeState(), context.axis);
    assert.ok(projected.start >= 0 && projected.end <= f.view.axis.totalWidth);
    const focused = [f.view.axis.viewStart, f.view.axis.viewEnd];
    flushFrames(); assert.equal(f.surface.viewport().scrollTop, 37);
    f.view.onDataUpdated(); flushFrames(); assert.deepEqual([f.view.axis.viewStart, f.view.axis.viewEnd], focused);
    // A second distant target retains the original return point.
    const second = kind === 'sequence' ? parseTimelineRange({ ...ordinal, start: '1000', end: '1010' }) : parseTimelineRange({ ...range, start: '2100-01-01', end: '2100-01-02' });
    assert.equal(f.surface.revealRange(second, context.axis), 'revealed'); flushFrames();
    f.root.querySelector<HTMLButtonElement>('.sabidurian-comment-range-focus button')!.click(); flushFrames();
    assert.equal(f.root.querySelector('.sabidurian-comment-range-focus'), null);
    assert.deepEqual([f.view.axis.viewStart, f.view.axis.viewEnd], bounds);
    assert.ok(Math.abs(f.surface.viewport().scrollLeft - 23) < 0.00001); assert.equal(f.surface.viewport().scrollTop, 37);
    assert.equal(JSON.stringify(range), unchanged); assert.equal(JSON.stringify(f.values), before);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.configWrites, []);
  });

  test(`${kind}: lane range focus retains the exact collapsed source group`, () => {
    const f = fixture(kind, true), context = f.surface.rangeContext()!, group = f.view.data.groupedData[0];
    const range = distantRange(kind === 'sequence');
    assert.equal(f.surface.revealRange(range, context.axis, { ...group }), 'unavailable');
    assert.equal(f.root.querySelector('.sabidurian-comment-range-focus'), null);
    assert.equal(f.surface.revealRange(range, context.axis, group), 'revealed');
    assert.equal(f.surface.groups()[0].target.group, group);
    assert.deepEqual(f.values.collapsedGroups, ['Lane']); assert.deepEqual(f.configWrites, []);
    const { viewport } = rangeLayout(f, false), handle = f.surface.groups()[0];
    handle.element.getBoundingClientRect = () => new win.DOMRect(100, 80, 400, 28);
    const geometry = f.surface.rangeGeometry(range, context.axis, group);
    assert.ok(geometry?.current()); assert.equal(geometry.top, 80); assert.equal(geometry.bottom, 108);
    flushFrames(); assert.equal(viewport.scrollTop, 12); // The collapsed header is at y=24; pending restoration must not undo its reveal.
  });

  test(`${kind}: changed axes clear focus and invalid requests never move the viewport`, () => {
    const f = fixture(kind), context = f.surface.rangeContext()!, range = distantRange(kind === 'sequence');
    assert.equal(f.surface.revealRange(range, { ...context.axis, start_property: { source: 'note', name: 'other' } }), 'unavailable');
    assert.equal(f.root.querySelector('.sabidurian-comment-range-focus'), null);
    assert.equal(f.surface.revealRange(range, context.axis), 'revealed');
    f.values[kind === 'sequence' ? 'orderProp' : 'startDateProp'] = 'note.missing'; f.view.onDataUpdated(); flushFrames();
    assert.equal(f.root.querySelector('.sabidurian-comment-range-focus'), null); assert.equal(f.view.rangeFocus, undefined);
    assert.deepEqual(f.configWrites, []); assert.deepEqual(f.writes, []);
  });

  test(`${kind}: returning to an item exits range focus without delayed scroll overriding navigation`, () => {
    const f = fixture(kind), context = f.surface.rangeContext()!, range = distantRange(kind === 'sequence');
    assert.equal(f.surface.revealRange(range, context.axis), 'revealed');
    assert.equal(f.surface.reveal({ type: 'item', file: f.files[0] }), 'revealed');
    assert.equal(f.root.querySelector('.sabidurian-comment-range-focus'), null);
    const left = f.surface.viewport().scrollLeft, top = f.surface.viewport().scrollTop;
    flushFrames(); assert.equal(f.surface.viewport().scrollLeft, left); assert.equal(f.surface.viewport().scrollTop, top);
  });
}

test('dense Sequence range navigation uses original values temporarily, then restores dense layout', () => {
  const f = fixture('sequence'); f.values.denseMode = true; f.view.onDataUpdated(); flushFrames();
  const context = f.surface.rangeContext()!, before = [...f.view._denseToSparse];
  assert.equal(f.surface.revealRange({ ...ordinal, start: '999999999999998.000000001', end: '999999999999998.000000002' }, context.axis), 'revealed');
  assert.equal(f.values.denseMode, true); assert.equal(f.view._denseToSparse, null);
  assert.match(f.root.querySelector('.sabidurian-comment-range-focus')!.textContent!, /Original property values/);
  f.root.querySelector<HTMLButtonElement>('.sabidurian-comment-range-focus button')!.click(); flushFrames();
  assert.deepEqual(f.view._denseToSparse, before); assert.deepEqual(f.configWrites, []); assert.deepEqual(f.writes, []);
});

test('dirty inspector input blocks both range focus and return without discarding the draft', () => {
  const f = fixture('timeline'), context = f.surface.rangeContext()!, range = distantRange(false);
  const modal = new TaskInspector(f.plugin.app as any, f.files[0] as any,
    { start: 'start', end: 'end', label: 'title', dependencies: 'blocked-by', zone: 'UTC' }, f.plugin.history as any, false, () => {}, () => {});
  modal.open(); const input = modal.contentEl.querySelector('input')!; input.value = '2026-11-26T08:05:00';
  assert.equal(f.surface.revealRange(range, context.axis), 'busy'); assert.equal(f.root.querySelector('.sabidurian-comment-range-focus'), null);
  modal.close(); assert.equal(f.surface.revealRange(range, context.axis), 'revealed');
  modal.open(); const draft = modal.contentEl.querySelector('input')!; draft.value = '2026-11-26T08:10:00';
  const retained = draft.value;
  f.root.querySelector<HTMLButtonElement>('.sabidurian-comment-range-focus button')!.click();
  assert.ok(f.root.querySelector('.sabidurian-comment-range-focus')); assert.equal(draft.value, retained);
  assert.deepEqual(f.configWrites, []); assert.deepEqual(f.writes, []);
});

for (const kind of ['timeline', 'sequence'] as const) {
  test(`${kind}: passive presence preserves semantic coordinates across scaled viewports and clears stale geometry`, () => {
    const f = fixture(kind), { viewport, svg } = rangeLayout(f);
    Object.defineProperty(viewport, 'scrollHeight', { value: 400, configurable: true });
    const initial = JSON.stringify(f.values), captured = f.surface.rangePresence({ clientX: 300, clientY: 150 });
    assert.ok(captured?.current()); assert.equal(captured.range.kind, kind === 'sequence' ? 'ordinal' : 'instant');
    const visible = f.surface.rangePresence(); assert.ok(visible?.current()); assert.notEqual(visible.range.start, visible.range.end);
    assert.equal(captured.group, null); assert.equal(captured.offset.y, 0.25);
    const geometry = f.surface.rangePresenceGeometry(captured.range, captured.context.axis)!;
    assert.ok(Math.abs(geometry.startX - 300) < 0.01);
    viewport.scrollLeft = 100; assert.equal(captured.current(), false); assert.equal(geometry.current(), false);
    svg.getBoundingClientRect = () => new win.DOMRect(100 - viewport.scrollLeft, 50 - viewport.scrollTop, 1600, 400) as any;
    assert.ok(Math.abs(f.surface.rangePresenceGeometry(captured.range, captured.context.axis)!.startX - 400) < 0.01);
    assert.equal(f.surface.revealRangePresence(captured.range, captured.context.axis, captured.offset), 'revealed');
    assert.ok(Math.abs(viewport.scrollLeft - 200) < 0.01); assert.equal(viewport.scrollTop, 0);
    assert.equal(JSON.stringify(f.values), initial); assert.deepEqual(f.writes, []); assert.deepEqual(f.configWrites, []);
    assert.equal(f.root.querySelector('.sabidurian-range-selection-status'), null);
    assert.equal(f.surface.rangePresence({ clientX: -1, clientY: 150 }), undefined);
    f.view.data = { ...f.view.data }; assert.equal(f.surface.rangePresence(), undefined);
  });

  test(`${kind}: range presence uses exact lane bands and preserves collapsed state`, () => {
    const f = fixture(kind, true), { viewport } = rangeLayout(f), lane = f.surface.groups()[0];
    Object.defineProperty(viewport, 'scrollHeight', { value: 400, configurable: true });
    const band = lane.band!()!, y = (band.top + band.bottom) / 2, before = JSON.stringify(f.values);
    const captured = f.surface.rangePresence({ clientX: 300, clientY: y }); assert.ok(captured?.current());
    assert.equal(captured.group, f.view.data.groupedData[0]); assert.equal(captured.offset.y, 0.5);
    assert.equal(f.surface.revealRangePresence(captured.range, captured.context.axis, captured.offset, captured.group), 'revealed');
    assert.equal(f.surface.revealRangePresence(captured.range, captured.context.axis, { x: NaN, y: 0.5 }, captured.group), 'unavailable');
    assert.equal(f.surface.revealRangePresence(captured.range, captured.context.axis, captured.offset, { ...captured.group }), 'unavailable');
    assert.equal(JSON.stringify(f.values), before); assert.deepEqual(f.configWrites, []); assert.deepEqual(f.writes, []);
    f.view.onunload(); assert.equal(f.surface.rangePresence(), undefined);
  });
}

for (const kind of ['timeline', 'sequence'] as const) test(`${kind}: an empty native axis captures presence without inventing an item or lane`, () => {
  const f = fixture(kind, false, true); rangeLayout(f);
  const captured = f.surface.rangePresence({ clientX: 300, clientY: 150 }); assert.ok(captured?.current());
  assert.equal(captured.group, null); assert.deepEqual(f.surface.handles(), []);
  assert.ok(f.surface.rangePresence()); assert.deepEqual(f.writes, []); assert.deepEqual(f.configWrites, []);
});

test('range presence expires when viewport dimensions change and refuses a rotated SVG', () => {
  const f = fixture('sequence'), { viewport, svg } = rangeLayout(f), capture = f.surface.rangePresence()!;
  viewport.getBoundingClientRect = () => new win.DOMRect(100, 50, 600, 200) as any;
  assert.equal(capture.current(), false);
  const matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; (svg as any).getScreenCTM = () => matrix;
  const unchangedBounds = f.surface.rangePresence({ clientX: 300, clientY: 150 })!; assert.ok(unchangedBounds.current());
  matrix.b = 0.5; assert.equal(unchangedBounds.current(), false);
  assert.equal(f.surface.rangePresence({ clientX: 300, clientY: 150 }), undefined);
});
