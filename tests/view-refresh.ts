import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Modal } from './obsidian-mock';
import { SabidurianView } from '../src/SabidurianView';
import { TaskPicker } from '../src/interaction/TaskInspector';
import { axisToWallMs, wallMsToAxis } from '../src/utils/timezone';

// Keep the real view, layout, renderers and interactions. Replace only the
// Obsidian host and animation clock so consecutive metadata updates are exact.
const win = new Window();
Object.assign(globalThis, { window: win, document: win.document, MouseEvent: win.MouseEvent, CSS: win.CSS });
const proto = win.HTMLElement.prototype as any;
proto.createEl = function(tag: string, opts: any = {}) {
  const el = win.document.createElement(tag);
  if (opts.text != null) el.textContent = opts.text;
  if (opts.cls) el.className = opts.cls;
  for (const [key, value] of Object.entries(opts.attr ?? {})) el.setAttribute(key, String(value));
  for (const key of ['type', 'value', 'placeholder']) if (opts[key] != null) (el as any)[key] = opts[key];
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
function flushFrame(): void {
  const callbacks = [...frames.values()]; frames.clear();
  for (const callback of callbacks) callback(0);
}
const views: SabidurianView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.onunload();
  for (const modal of Modal.opened) modal.close();
  Modal.opened = []; frames.clear(); document.body.replaceChildren();
});

function fixture(grouped = false, count = 32) {
  const files = Array.from({ length: count }, (_, index) => ({
    path: `Tasks/step-${index}.md`, basename: `step-${index}`, parent: { path: 'Tasks' },
  }));
  const metadata = new Map(files.map((file, index) => [file.path, {
    Step: `Step ${index + 1}`, Dish: 'Gratin', 'Active Chef': index < 16 ? 'Alex' : 'Jordan',
    start: `2026-11-26T${String(8 + Math.floor(index % 32 / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}:00-07:00`,
    end: `2026-11-26T${String(8 + Math.floor(index % 32 / 2)).padStart(2, '0')}:${index % 2 ? '35' : '05'}:00-07:00`,
  }]));
  const entries = files.map(file => ({ file, getValue: (id: string) => (metadata.get(file.path) as any)?.[id.replace(/^note\./, '')] }));
  const values: Record<string, any> = {
    startDateProp: 'note.start', endDateProp: 'note.end', labelProp: 'note.Step', colorProp: 'note.Dish',
    dependencyProp: 'note.Blocked by', timeZone: 'America/Denver', snapMinutes: 5, tickMinutes: 15,
    scaleId: 'day', oneTaskPerRow: true, showTable: false, showArrows: false, showToday: false,
    locked: true, initialScroll: 'start', collapsedGroups: grouped ? ['Jordan'] : [],
  };
  const workspaceEvents: string[] = [];
  const plugin = {
    settings: { maxEntries: 5000, lockOnMobile: false, dependencyProperty: 'Blocked by', lockedProperty: 'locked',
      showBarProperties: true, barPropertyMinWidth: 80, markers: [] },
    history: { canUndo: false },
    app: {
      metadataCache: { getFileCache: (file: any) => ({ frontmatter: metadata.get(file.path) }),
        getFirstLinkpathDest: (path: string) => files.find(file => file.path === path || file.path === `${path}.md`) },
      vault: { getMarkdownFiles: () => files },
      workspace: { trigger: (event: string) => { workspaceEvents.push(event); }, getLeaf: () => ({ async openFile() {} }) },
    },
  };
  const host = document.createElement('div'); document.body.append(host);
  const view = new SabidurianView({} as any, host, plugin as any) as any;
  views.push(view);
  view.config = { get: (key: string) => values[key], set: (key: string, value: any) => { values[key] = value; },
    getAsPropertyId: (key: string) => values[key] ?? null, getOrder: () => [],
    getDisplayName: (id: string) => id.replace(/^note\./, '') };
  view.allProperties = [];
  view.data = { data: entries, groupedData: grouped ? [
    { hasKey: () => true, key: 'Alex', entries: entries.slice(0, 16) },
    { hasKey: () => true, key: 'Jordan', entries: entries.slice(16) },
  ] : [] };
  view.onDataUpdated(); flushFrame();
  assert.equal(view.currentEntries.length, files.length);
  return { view, host, files, metadata, values, workspaceEvents, body: () => view.timelineRenderer.element as HTMLElement };
}

function assertViewport(view: any, year: number, top: number): void {
  const body = view.timelineRenderer.element;
  const actualTime = axisToWallMs(view.axis.pixelToYear(body.scrollLeft));
  assert.ok(Math.abs(actualTime - axisToWallMs(year)) < 2, 'the same wall-clock time stays at the left edge');
  assert.equal(body.scrollTop, top, 'the same task row stays visible');
  assert.equal(view.headerRenderer.element.scrollLeft, body.scrollLeft, 'the header follows the restored body');
}

test('consecutive metadata refreshes before the next frame retain the timeline time and row', () => {
  const { view, host, body } = fixture();
  const year = wallMsToAxis(Date.UTC(2026, 10, 26, 17, 55));
  body().scrollLeft = view.axis.yearToPixel(year); body().scrollTop = 440;
  const originalBody = body();
  view.onDataUpdated();
  const intermediateBody = body();
  view.onDataUpdated();
  assert.notEqual(body(), intermediateBody);
  assert.equal(originalBody.isConnected, false); assert.equal(intermediateBody.isConnected, false);
  flushFrame();
  assertViewport(view, year, 440);
  assert.equal(host.querySelectorAll('.sabidurian-container').length, 1);
});

test('rapid refreshes preserve the time anchor when an earlier task changes the timeline bounds', () => {
  const { view, files, metadata, body } = fixture();
  const year = wallMsToAxis(Date.UTC(2026, 10, 26, 18));
  body().scrollLeft = view.axis.yearToPixel(year); body().scrollTop = 704;
  const originalPixel = body().scrollLeft;
  metadata.get(files[0].path)!.start = '2026-11-24T08:00:00-07:00';
  view.onDataUpdated(); view.onDataUpdated(); flushFrame();
  assert.notEqual(body().scrollLeft, originalPixel, 'the anchor is a time rather than the old pixel offset');
  assertViewport(view, year, 704);
});

test('Find task expands a collapsed group and reveals its row even if metadata refreshes immediately', () => {
  const { view, files, values, host, body } = fixture(true);
  const target = files[files.length - 1];
  assert.equal(view.currentEntries.find((entry: any) => entry.file.path === target.path).row, -1);
  body().scrollTop = 0;
  const find = [...host.querySelectorAll('button')].find(button => button.textContent === 'Find task…');
  assert.ok(find); find.click();
  const picker = Modal.opened[Modal.opened.length - 1];
  assert.ok(picker instanceof TaskPicker); picker.onChooseItem(target as any);
  const selected = view.currentEntries.find((entry: any) => entry.file.path === target.path);
  assert.ok(selected.row > 15); assert.deepEqual(values.collapsedGroups, []);
  const top = Math.max(0, view.layoutEngine.getRowY(selected.row) - 12);
  view.onDataUpdated(); flushFrame();
  assertViewport(view, selected.startYear, top);
  const inspector = Modal.opened[Modal.opened.length - 1];
  assert.equal(inspector.contentEl.querySelector('h2')?.textContent, 'Step 32');
});

test('edge jump reaches a horizontally culled task without changing its row or data and survives immediate refresh', () => {
  const { view, files, metadata, body, host } = fixture(false, 200);
  assert.equal(view.cullingActive, true);
  const target = view.currentEntries.find((entry: any) => entry.file.path === files[0].path);
  const canvas = body();
  Object.defineProperties(canvas, { clientWidth: { value: 300 }, clientHeight: { value: 200 }, scrollWidth: { value: 100000 } });
  canvas.scrollLeft = target.x + 1000; canvas.scrollTop = 10;
  view.lastViewportBounds = null; view.renderVisibleBars(); view.taskEdges.refresh();
  assert.equal([...host.querySelectorAll('.sabidurian-bar-group')].some(bar => bar.getAttribute('data-file-path') === files[0].path), false);
  const edge = [...host.querySelectorAll<HTMLButtonElement>('.sabidurian-task-edge')].find(button => button.dataset.filePath === files[0].path);
  assert.ok(edge, 'navigation exists even though the bar was horizontally culled');
  const before = JSON.stringify([...metadata]);
  edge.click();
  assert.equal(canvas.scrollTop, 10); assert.ok(Math.abs(canvas.scrollLeft - (target.x - 48)) < .01);
  const endTarget = view.currentEntries.find((entry: any) => entry.file.path === files[10].path);
  canvas.scrollLeft = 0; canvas.scrollTop = view.layoutEngine.getRowY(endTarget.row) - 20;
  const retainedTop = canvas.scrollTop;
  view.taskEdges.refresh();
  const endEdge = [...host.querySelectorAll<HTMLButtonElement>('.sabidurian-task-edge')].find(button => button.dataset.filePath === files[10].path && button.dataset.boundary === 'end');
  assert.ok(endEdge); endEdge.click();
  assert.equal(canvas.scrollTop, retainedTop);
  assert.ok(Math.abs((endTarget.x + endTarget.width) - (canvas.scrollLeft + canvas.clientWidth - 48)) < .01);
  const destination = view.axis.pixelToYear(canvas.scrollLeft);
  view.onDataUpdated(); view.onDataUpdated(); flushFrame();
  assertViewport(view, destination, retainedTop);
  assert.equal(JSON.stringify([...metadata]), before);
});

test('hover stays beside the pointer, outside transformed view containers, with only a label and time', () => {
  const { view, host, workspaceEvents } = fixture();
  host.style.transform = 'translate(300px, 200px)';
  Object.assign(view.currentEntries[0].properties, {
    'Notion URL': 'https://notion.so/private-source', UUID: 'invisible-identity', Description: 'A long imported description',
  });
  const bar = host.querySelector('.sabidurian-bar-group'); assert.ok(bar);
  bar.dispatchEvent(new win.MouseEvent('mouseenter', { clientX: 300, clientY: 200 }));
  bar.dispatchEvent(new win.MouseEvent('mouseover', { clientX: 300, clientY: 200 }));
  const tooltip = document.querySelector('.sabidurian-tooltip') as HTMLElement;
  assert.ok(tooltip); assert.equal(tooltip.parentElement, document.body);
  assert.equal(tooltip.style.display, 'block');
  assert.equal(tooltip.style.left, '312px'); assert.equal(tooltip.style.top, '132px');
  assert.equal(tooltip.querySelector('strong')?.textContent, 'Step 1');
  assert.equal(tooltip.querySelectorAll('br').length, 1);
  assert.match(tooltip.textContent ?? '', /8 AM – 8:05 AM/);
  assert.doesNotMatch(tooltip.textContent ?? '', /notion|identity|Description|imported/i);
  assert.deepEqual(workspaceEvents, [], 'inspector hover does not also open a native note preview');
  bar.dispatchEvent(new win.MouseEvent('mousemove', { clientX: win.innerWidth - 2, clientY: 2 }));
  assert.ok(parseFloat(tooltip.style.left) >= 6);
  assert.ok(parseFloat(tooltip.style.left) + 200 <= win.innerWidth - 6);
  assert.ok(parseFloat(tooltip.style.top) >= 6);
  view.measureManager.activate();
  assert.equal(tooltip.style.display, 'none', 'activating Measure clears an existing task tooltip');
  bar.dispatchEvent(new win.MouseEvent('mouseenter', { clientX: 300, clientY: 200 }));
  assert.equal(tooltip.style.display, 'none', 'task hover does not cover a measurement');
  view.measureManager.deactivate();
  bar.dispatchEvent(new win.MouseEvent('mouseenter', { clientX: 300, clientY: 200 }));
  assert.equal(tooltip.style.display, 'block', 'normal hover resumes after Measure');
  bar.dispatchEvent(new win.MouseEvent('mouseleave'));
  assert.equal(tooltip.style.display, 'none');
  view.onDataUpdated(); flushFrame();
  assert.equal(tooltip.isConnected, false, 'a refresh removes the old portal');
  assert.equal(document.querySelectorAll('.sabidurian-tooltip').length, 1);
});

test('lock toggles and their Bases notifications keep the same canvas, bars, focus, measurement and viewport', () => {
  const { view, host, body, values, metadata, files } = fixture();
  assert.equal(view.type, 'sabidurian-timeline', 'Bases must recognize the registered view instead of recreating it on save');
  values.showArrows = true; values.focusDate = '2026-11-26T12:00'; values.initialScroll = 'today';
  metadata.get(files[0].path)!.start = '2026-11-22T09:00:00-07:00';
  metadata.get(files[0].path)!.end = '2026-11-25T16:00:00-07:00';
  view.onDataUpdated(); flushFrame();
  const year = wallMsToAxis(Date.UTC(2026, 10, 22, 9));
  const canvas = body(), root = view.rootEl, svg = view.timelineRenderer.svgElement;
  canvas.scrollLeft = view.axis.yearToPixel(year); canvas.scrollTop = 8;
  view.headerRenderer.setScrollLeft(canvas.scrollLeft);
  view.measureManager.activate();
  view.measureManager.handleClick(new win.MouseEvent('click', { clientX: 100, clientY: 100 }));
  view.measureManager.handleClick(new win.MouseEvent('click', { clientX: 140, clientY: 100 }));
  const measure = host.querySelector('.sabidurian-measure-label');
  const bars = [...host.querySelectorAll('.sabidurian-bar-group')];
  const drag = view.dragManager, selection = view.selectionManager;
  const lock = host.querySelector<HTMLButtonElement>('.sabidurian-lock-btn')!;
  lock.focus();
  for (const locked of [false, true, false, true, false, true]) {
    lock.click();
    assert.equal(values.locked, locked, 'lock remains persisted in the view config');
    // Obsidian supplies a new result wrapper/array for a config save, retaining
    // entries when it has not rerun the query. Multiple notifications may follow.
    view.data = { ...view.data, data: [...view.data.data] };
    view.onDataUpdated();
    // The later .base-file save can rerun the query with fresh entry objects.
    view.data = { ...view.data, data: view.data.data.map((entry: any) => ({ ...entry })) };
    view.onDataUpdated(); flushFrame();
    assert.equal(body(), canvas); assert.equal(view.rootEl, root);
    assert.equal(view.timelineRenderer.svgElement, svg);
    assert.deepEqual([...host.querySelectorAll('.sabidurian-bar-group')], bars);
    assert.equal(host.querySelector('.sabidurian-measure-label'), measure);
    assert.equal(view.dragManager, drag); assert.equal(view.selectionManager, selection);
    assert.equal(document.activeElement, lock);
    assert.equal(lock.textContent, locked ? 'Locked' : 'Editing');
    assert.equal(lock.getAttribute('aria-pressed'), String(locked));
    assert.equal(host.querySelector<HTMLButtonElement>('.sabidurian-new-task-btn')!.disabled, locked);
    assert.equal(view.contextMenuManager.viewLocked, locked); assert.equal(drag.locked, locked);
    assert.equal(view.arrowDragManager.locked, locked);
    assert.equal((host.querySelector('.sabidurian-arrow-handles-group') as SVGElement).style.display, locked ? 'none' : '');
    assertViewport(view, year, 8);
  }
});

test('a lock notification cannot hide concurrent metadata, query or view-option changes', () => {
  const { view, host, metadata, files, body, values } = fixture();
  const year = wallMsToAxis(Date.UTC(2026, 10, 26, 17));
  body().scrollLeft = view.axis.yearToPixel(year); body().scrollTop = 88;
  host.querySelector<HTMLButtonElement>('.sabidurian-lock-btn')!.click();
  const original = body();
  metadata.get(files[0].path)!.start = '2026-11-25T08:00:00-07:00';
  view.onDataUpdated(); flushFrame();
  assert.notEqual(body(), original); assert.equal(view.currentEntries[0].start.day, 25);
  assertViewport(view, year, 88);
  host.querySelector<HTMLButtonElement>('.sabidurian-lock-btn')!.click();
  const beforeQuery = body();
  view.data = { ...view.data, data: view.data.data.slice(1) };
  view.onDataUpdated(); flushFrame();
  assert.notEqual(body(), beforeQuery); assert.equal(view.currentEntries.length, 31);
  host.querySelector<HTMLButtonElement>('.sabidurian-lock-btn')!.click();
  const beforeOption = body(); values.scaleId = 'week';
  view.onDataUpdated(); flushFrame();
  assert.notEqual(body(), beforeOption); assert.equal(view.currentScale.id, 'week');
  assertViewport(view, year, 88);
  values.labelProp = 'formula.Task';
  let formulaLabel = 'Before';
  const baseEntry = view.data.data[0];
  view.data.data[0] = { ...baseEntry, getValue: (id: string) => id === 'formula.Task' ? formulaLabel : baseEntry.getValue(id) };
  view.onDataUpdated(); flushFrame();
  host.querySelector<HTMLButtonElement>('.sabidurian-lock-btn')!.click();
  const beforeFormula = body(); formulaLabel = 'After';
  view.onDataUpdated(); flushFrame();
  assert.notEqual(body(), beforeFormula); assert.equal(view.currentEntries[0].label, 'After');
  host.querySelector<HTMLButtonElement>('.sabidurian-lock-btn')!.click();
  view.plugin.history.canUndo = true;
  view.onDataUpdated(); flushFrame();
  const undo = [...host.querySelectorAll('button')].find(button => button.textContent === 'Undo')!;
  assert.equal(undo.disabled, false, 'a history change outside the filtered tasks still updates Undo');
});

test('locks cancel pending edits and retired canvas handlers cannot create tasks after viewport redraws', () => {
  const { view, host } = fixture();
  const lock = host.querySelector<HTMLButtonElement>('.sabidurian-lock-btn')!;
  lock.click();
  const retired: any[] = [];
  for (let i = 0; i < 3; i++) { retired.push(view.dragManager); view.renderVisibleBars(); }
  lock.click();
  const svg = view.timelineRenderer.svgElement;
  svg.dispatchEvent(new win.MouseEvent('mousedown', { clientX: 100, clientY: 100, button: 0, bubbles: true }));
  document.dispatchEvent(new win.MouseEvent('mousemove', { clientX: 300, clientY: 100, bubbles: true }));
  document.dispatchEvent(new win.MouseEvent('mouseup', { clientX: 300, clientY: 100, button: 0, bubbles: true }));
  assert.equal(svg.querySelector('.sabidurian-ghost-bar'), null);
  for (const manager of [...retired, view.dragManager]) assert.equal(manager.ctx.state, 'idle');
  assert.equal(Modal.opened.length, 0);
  lock.click();
  const group = host.querySelector('.sabidurian-bar-group')!;
  group.dispatchEvent(new win.MouseEvent('mousedown', { clientX: 100, clientY: 100, button: 0, bubbles: true }));
  assert.equal(view.dragManager.ctx.state, 'pending');
  lock.click(); assert.equal(view.dragManager.ctx.state, 'idle');
  document.dispatchEvent(new win.MouseEvent('mouseup', { clientX: 300, clientY: 100, button: 0, bubbles: true }));
  assert.equal(Modal.opened.length, 0);
});

test('unlocking from the inspector retains the timeline and enables the same task editor', () => {
  const { view, body, host } = fixture();
  const canvas = body(); canvas.scrollLeft = 300; canvas.scrollTop = 132;
  view.inspectTask(view.currentEntries[0]);
  const modal = Modal.opened[Modal.opened.length - 1];
  const unlock = [...modal.contentEl.querySelectorAll('button')].find(button => button.textContent === 'Unlock view to edit')!;
  unlock.click(); view.onDataUpdated(); flushFrame();
  assert.equal(body(), canvas); assert.equal(canvas.scrollLeft, 300); assert.equal(canvas.scrollTop, 132);
  assert.equal(host.querySelector('.sabidurian-lock-label')!.textContent, 'Editing');
  const editor = Modal.opened[Modal.opened.length - 1];
  const save = [...editor.contentEl.querySelectorAll('button')].find(button => button.textContent === 'Save')!;
  assert.equal(save.disabled, false);
});
