import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Modal } from './obsidian-mock';
import { NewTaskModal, type NewTaskOptions } from '../src/interaction/TaskInspector';

// Only Obsidian's DOM helpers and Modal host are replaced. These tests exercise
// the production form, validation, date defaults and async creation callback.
const win = new Window();
Object.assign(globalThis, { window: win, document: win.document });
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
proto.addClass = function(...names: string[]) { this.classList.add(...names); };
proto.empty = function() { this.replaceChildren(); };
proto.setText = function(text: string) { this.textContent = text; };

afterEach(() => {
  for (const modal of Modal.opened) modal.close();
  Modal.opened = [];
});

type CreatedTask = { name: string; start: string; end: string; properties: Record<string, string> };
function form(options?: NewTaskOptions, initialStart = '2026-11-26T17:55:00-07:00') {
  const created: CreatedTask[] = [];
  const modal = new NewTaskModal({} as any, 'America/Denver', initialStart,
    async (name, start, end, properties) => { created.push({ name, start, end, properties }); }, options);
  modal.open();
  const field = (name: string): HTMLInputElement | HTMLSelectElement => {
    const result = modal.contentEl.querySelector(`[aria-label="${name}"]`);
    assert.ok(result, `Missing field: ${name}`);
    return result as HTMLInputElement | HTMLSelectElement;
  };
  const click = async (label: string) => {
    const button = [...modal.contentEl.querySelectorAll('button')].find(el => el.textContent === label);
    assert.ok(button, `Missing button: ${label}`); assert.equal(button.disabled, false);
    await (button.onclick as any)(new win.MouseEvent('click'));
  };
  field('Step').value = 'Rest';
  return { modal, created, field, click };
}

for (const [property, choice, message] of [
  ['Active Chef', 'Alex', 'Choose a chef'],
  ['Oven Temp', '400', 'Choose an oven temperature'],
]) {
  test(`new task requires ${property} before creating a record in its filtered view`, async () => {
    const { modal, created, field, click } = form({ dishes: ['Gratin'], chefs: ['Alex'], ovens: ['400'], required: [property] });
    assert.equal((field(property) as HTMLSelectElement).required, true);
    await click('Create');
    assert.equal(created.length, 0);
    assert.ok(modal.contentEl.querySelector('[role="alert"]')!.textContent!.includes(message));
    assert.equal(document.activeElement, field(property));
    field(property).value = choice;
    await click('Create');
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].properties, { [property]: choice });
    assert.equal(created[0].start, '2026-11-26T17:55:00-07:00');
    assert.equal(created[0].end, '2026-11-26T18:00:00-07:00');
  });
}

test('new task leaves optional fields absent and starts with an empty Unassigned option', async () => {
  const { created, field, click } = form({ dishes: ['Gratin', 'Gratin', ''], chefs: [], ovens: [] });
  const dish = field('Dish') as HTMLSelectElement;
  assert.deepEqual([...dish.options].map(option => [option.value, option.textContent]), [['', 'Unassigned'], ['Gratin', 'Gratin']]);
  for (const property of ['Dish', 'Active Chef', 'Oven Temp']) assert.equal(field(property).value, '');
  await click('Create');
  assert.deepEqual(created[0].properties, {});
  assert.equal(Date.parse(created[0].end) - Date.parse(created[0].start), 5 * 60000);
});

test('new task passes selected values and preserves its five-minute default across midnight', async () => {
  const { created, field, click } = form({ dishes: ['Gratin'], chefs: ['Jordan'], ovens: ['375'] }, '2026-11-26T23:55:00-07:00');
  field('Step').value = '  Final bake  ';
  field('Dish').value = 'Gratin'; field('Active Chef').value = 'Jordan'; field('Oven Temp').value = '375';
  await click('Create');
  assert.deepEqual(created, [{
    name: 'Final bake', start: '2026-11-26T23:55:00-07:00', end: '2026-11-27T00:00:00-07:00',
    properties: { Dish: 'Gratin', 'Active Chef': 'Jordan', 'Oven Temp': '375' },
  }]);
});

test('cancelling a drafted new task creates nothing and removes the form', async () => {
  const { modal, created, field, click } = form({ dishes: ['Gratin'], chefs: ['Alex'], ovens: ['400'] });
  field('Dish').value = 'Gratin'; field('Active Chef').value = 'Alex'; field('Oven Temp').value = '400';
  field('Start').value = '2026-11-26T17:25';
  await click('Cancel');
  assert.equal(created.length, 0); assert.equal(modal.contentEl.isConnected, false);
  assert.equal(modal.contentEl.childElementCount, 0);
});
