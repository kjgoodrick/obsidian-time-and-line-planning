import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Modal } from './obsidian-mock';
import { TaskInspector, TaskPicker, type TaskFields } from '../src/interaction/TaskInspector';
import { EditHistory } from '../src/model/EditHistory';

const win = new Window();
Object.assign(globalThis, { window: win, document: win.document });
const proto = win.HTMLElement.prototype as any;
proto.createEl = function(tag: string, options: any = {}) {
  const element = document.createElement(tag);
  if (options.text != null) element.textContent = options.text;
  if (options.cls) element.className = options.cls;
  for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, String(value));
  for (const key of ['type', 'value', 'placeholder']) if (options[key] != null) (element as any)[key] = options[key];
  this.append(element); return element;
};
proto.createDiv = function(options: any) { return this.createEl('div', options); };
proto.createSpan = function(options: any) { return this.createEl('span', options); };
proto.addClass = function(...classes: string[]) { this.classList.add(...classes); };
proto.empty = function() { this.replaceChildren(); };
proto.setText = function(text: string) { this.textContent = text; };
afterEach(() => { for (const modal of Modal.opened) modal.close(); Modal.opened = []; document.body.replaceChildren(); });

const fields: TaskFields = { start: 'begin', end: 'finish', label: 'Step', dependencies: 'Prerequisites', zone: 'America/Denver', folder: 'Tasks', locked: 'frozen' };
function fixture() {
  const files = ['a', 'b', 'c', 'd'].map(id => ({ path: `Tasks/${id}.md`, basename: id }));
  const metadata = new Map(files.map((file, index) => [file.path, {
    Step: index < 2 ? 'Rest' : index === 2 ? 'Serve' : 'Clear table', Dish: index === 0 ? 'Gratin' : index === 1 ? 'Turkey' : '',
    begin: '2026-11-26T17:55:13.250-07:00', finish: '2026-11-26T18:00:17.500-07:00',
    Prerequisites: index === 2 ? ['[[Tasks/a|Rest potatoes]]', '[[Tasks/b|Rest turkey]]'] : index === 3 ? ['[[Tasks/c]]'] : [],
  } as any]));
  const navigated: any[] = [], opened: any[] = [], writes: string[] = [];
  let unlocks = 0;
  const app: any = {
    vault: { getMarkdownFiles: () => files },
    metadataCache: { getFileCache: (file: any) => ({ frontmatter: metadata.get(file.path) }),
      getFirstLinkpathDest: (path: string) => files.find(file => file.path === path || file.path === `${path}.md`) ?? null },
    workspace: { getLeaf: () => ({ openFile: async (file: any) => { opened.push(file); } }) },
  };
  const history = new EditHistory(async (file, mutate) => { writes.push(file.path); mutate(metadata.get(file.path)); });
  const open = (locked = false, callback = true) => {
    const modal = new TaskInspector(app, files[2] as any, fields, history, locked, () => {}, () => { unlocks++; },
      undefined, callback ? file => { navigated.push(file); } : undefined);
    // The host owns this control; production only changes its accessible intent.
    const shell = document.createElement('section');
    shell.createEl('button', { cls: 'modal-close-button' }); (modal as any).modalEl = shell;
    modal.open(); return modal;
  };
  return { files, metadata, navigated, opened, writes, open, unlocks: () => unlocks };
}
function button(modal: Modal, label: string): HTMLButtonElement {
  const found = [...modal.contentEl.querySelectorAll('button')].find(button => button.textContent === label);
  assert.ok(found, `Missing ${label}`); return found;
}
async function press(modal: Modal, label: string) {
  const control = button(modal, label); assert.equal(control.disabled, false, label);
  await control.onclick?.call(control, new win.MouseEvent('click') as any);
}
function links(modal: Modal): HTMLButtonElement[] { return [...modal.contentEl.querySelectorAll<HTMLButtonElement>('.sabidurian-dependency-link')]; }
async function follow(link: HTMLButtonElement) { assert.equal(link.disabled, false); await link.onclick?.call(link, new win.MouseEvent('click') as any); }
function type(input: HTMLInputElement, value: string) { input.value = value; input.dispatchEvent(new win.Event('input', { bubbles: true })); }

test('predecessor and dependent links preserve target identity and remain read-only under view and note locks', async () => {
  const f = fixture(), before = structuredClone([...f.metadata]);
  for (const lock of ['view', 'note']) {
    if (lock === 'note') f.metadata.get(f.files[2].path).frozen = true;
    for (const target of [0, 1, 3]) {
      const modal = f.open(lock === 'view');
      assert.equal(button(modal, 'Save').disabled, true);
      assert.ok([...modal.contentEl.querySelectorAll('button')].filter(button => button.textContent === 'Remove').every(button => button.disabled));
      const choice = links(modal)[target === 3 ? 2 : target];
      await follow(choice);
      assert.equal(f.navigated.at(-1), f.files[target]);
      assert.equal(modal.contentEl.isConnected, false);
    }
  }
  delete f.metadata.get(f.files[2].path).frozen;
  assert.deepEqual([...f.metadata], before); assert.deepEqual(f.writes, []); assert.deepEqual(f.opened, []);
});

test('Close reflects actual draft changes, exact time reverts, ISO formatting and restored dependency identities', async () => {
  const f = fixture(), modal = f.open();
  const closeIcon = modal.modalEl.querySelector('.modal-close-button')!;
  assert.ok(button(modal, 'Close')); assert.equal(closeIcon.getAttribute('aria-label'), 'Close');
  assert.equal(modal.contentEl.querySelector('.sabidurian-editor-hint'), null);
  await press(modal, '+5 min'); assert.ok(button(modal, 'Discard changes')); assert.equal(closeIcon.getAttribute('title'), 'Discard changes');
  await press(modal, '−5 min'); assert.ok(button(modal, 'Close'));
  const input = modal.contentEl.querySelector('input')!, originalDisplay = input.value;
  type(input, '2026-11-26T17:56:13'); assert.ok(button(modal, 'Discard changes'));
  type(input, originalDisplay); assert.ok(button(modal, 'Close'));
  await press(modal, 'Use ISO times with UTC offsets');
  assert.equal(input.value, f.metadata.get(f.files[2].path).begin); assert.ok(button(modal, 'Close'));
  await press(modal, 'Remove'); assert.ok(button(modal, 'Discard changes'));
  await press(modal, 'Add predecessor…');
  const picker = Modal.opened.at(-1) as TaskPicker; picker.onChooseItem(f.files[0] as any); picker.close();
  assert.ok(button(modal, 'Close'), 're-adding the same file is not a change despite order and link spelling');
  assert.deepEqual(f.writes, []);
});

test('dirty dependency navigation and Open note preserve the visible draft until explicit discard', async () => {
  const f = fixture(), before = structuredClone([...f.metadata]), modal = f.open();
  const input = modal.contentEl.querySelector('input')!; type(input, '2026-11-26T17:56:13');
  await follow(links(modal)[0]); await press(modal, 'Open note');
  assert.match(modal.contentEl.querySelector('.sabidurian-editor-error')!.textContent!, /Save or discard/);
  assert.equal(modal.contentEl.isConnected, true); assert.equal(input.value, '2026-11-26T17:56:13');
  assert.deepEqual(f.navigated, []); assert.deepEqual(f.opened, []); assert.deepEqual(f.writes, []);
  await press(modal, 'Discard changes');
  assert.equal(modal.contentEl.isConnected, false); assert.deepEqual([...f.metadata], before);
});

test('native Modal x header control updates its intent without relabeling unrelated header actions', async () => {
  const f = fixture(), modal = f.open();
  modal.modalEl.querySelector('.modal-close-button')!.remove();
  const otherAction = modal.modalEl.createEl('button', { cls: 'modal-header-button mod-raised clickable-icon', attr: { 'aria-label': 'Pin', title: 'Pin' } });
  const close = modal.modalEl.createDiv({ cls: 'modal-header-button mod-raised clickable-icon' });
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('svg-icon', 'lucide-x'); close.append(icon);
  await press(modal, '+5 min');
  assert.equal(close.getAttribute('aria-label'), 'Discard changes'); assert.equal(close.title, 'Discard changes');
  await press(modal, '−5 min');
  assert.equal(close.getAttribute('aria-label'), 'Close'); assert.equal(close.title, 'Close');
  assert.equal(otherAction.getAttribute('aria-label'), 'Pin'); assert.equal(otherAction.title, 'Pin');
});

test('switching to ISO preserves typed edits and saving keeps untouched fractional precision', async () => {
  const f = fixture(), modal = f.open();
  const input = modal.contentEl.querySelector('input')!; type(input, '2026-11-26T17:56:13');
  await press(modal, 'Use ISO times with UTC offsets');
  assert.equal(input.type, 'text'); assert.equal(input.value, '2026-11-26T17:56:13-07:00');
  assert.ok(button(modal, 'Discard changes'));
  await press(modal, 'Save');
  assert.equal(f.metadata.get(f.files[2].path).begin, '2026-11-26T17:56:13-07:00');
  assert.equal(f.metadata.get(f.files[2].path).finish, '2026-11-26T18:00:17.500-07:00');
  assert.deepEqual(f.metadata.get(f.files[2].path).Prerequisites, ['[[Tasks/a|Rest potatoes]]', '[[Tasks/b|Rest turkey]]']);
});

test('unlock preserves task navigation; callers without a callback open the resolved note', async () => {
  const f = fixture(), modal = f.open(true);
  await press(modal, 'Unlock view to edit');
  assert.equal(f.unlocks(), 1);
  const unlocked = Modal.opened.at(-1)!; assert.equal(button(unlocked, 'Save').disabled, false);
  await follow(links(unlocked)[1]); assert.deepEqual(f.navigated, [f.files[1]]);
  const legacy = f.open(false, false); await follow(links(legacy)[0]);
  assert.deepEqual(f.opened, [f.files[0]]); assert.deepEqual(f.writes, []);
});

test('missing dependency targets remain visible and removable without a broken navigation action', async () => {
  const f = fixture(); f.metadata.get(f.files[2].path).Prerequisites = ['[[Tasks/missing]]'];
  const modal = f.open();
  assert.equal(modal.contentEl.querySelector('[title="Task unavailable"]')!.textContent, 'Tasks/missing');
  assert.equal(links(modal).length, 1, 'the existing dependent remains navigable');
  await press(modal, 'Remove'); assert.ok(button(modal, 'Discard changes'));
  assert.deepEqual(f.navigated, []); assert.deepEqual(f.writes, []);
});
