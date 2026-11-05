import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { NativeTableColors } from '../src/renderer/NativeTableColors';

const win = new Window();
const document = win.document;
const decorators: NativeTableColors[] = [];
afterEach(() => { for (const decorator of decorators.splice(0)) decorator.destroy(); document.body.replaceChildren(); });
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const color = (property: string, value: string) => ({ Dish: { Gratin: 'orange', Dressing: 'green' }, 'Oven Temp': { '400': 'yellow', '375': 'purple' } } as Record<string, Record<string, string>>)[property]?.[value];
function cell(property: string, value: string) {
  const element = document.createElement('div'); element.className = 'bases-td'; element.dataset.property = `note.${property}`;
  const content = element.appendChild(document.createElement('div')); content.className = 'bases-table-cell bases-metadata-value';
  const editor = content.appendChild(document.createElement('div')); editor.className = 'metadata-input-longtext'; editor.contentEditable = 'true'; editor.tabIndex = 0; editor.textContent = value;
  document.body.append(element); return { element, content, editor };
}
function decorate(resolve = color) {
  const decorator = new NativeTableColors(document.body as any, resolve); decorators.push(decorator); return decorator;
}

test('color decoration preserves native editors, focus, selection and input handlers', async () => {
  const { element, editor } = cell('Dish', 'Gratin');
  editor.focus();
  const range = document.createRange(); range.setStart(editor.firstChild!, 2); range.setEnd(editor.firstChild!, 4);
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
  let inputEvents = 0; editor.addEventListener('input', () => { inputEvents++; });
  const nativeHtml = editor.outerHTML;
  decorate();
  assert.equal(element.getAttribute('data-sabidurian-color'), 'orange');
  assert.equal(element.querySelector('.metadata-input-longtext'), editor);
  assert.equal(editor.outerHTML, nativeHtml); assert.equal(document.activeElement, editor);
  assert.equal(document.getSelection()!.toString(), 'at');
  editor.firstChild!.textContent = 'Dressing';
  editor.dispatchEvent(new win.Event('input', { bubbles: true })); await settle();
  assert.equal(inputEvents, 1); assert.equal(document.activeElement, editor);
  assert.equal(element.getAttribute('data-sabidurian-color'), 'green');
});

test('virtualized cell replacement, changed properties and palette refresh do not leave stale colors', async () => {
  const first = cell('Dish', 'Gratin'); const decorator = decorate();
  first.element.remove(); const next = cell('Oven Temp', '400'); await settle();
  assert.equal(first.element.hasAttribute('data-sabidurian-color'), false);
  assert.equal(next.element.getAttribute('data-sabidurian-color'), 'yellow');
  next.element.dataset.property = 'note.Unrelated'; await settle();
  assert.equal(next.element.hasAttribute('data-sabidurian-color'), false);
  next.element.dataset.property = 'note.Oven Temp'; next.editor.textContent = 'unknown'; await settle();
  assert.equal(next.element.hasAttribute('data-sabidurian-color'), false);
  next.editor.textContent = '375'; decorator.refresh();
  assert.equal(next.element.getAttribute('data-sabidurian-color'), 'purple');
});

test('native numeric inputs update via input events and unrelated or formula cells stay untouched', () => {
  const numeric = cell('Oven Temp', ''); numeric.editor.remove();
  const input = numeric.content.appendChild(document.createElement('input')); input.type = 'number'; input.value = '400';
  const unrelated = cell('Step', 'Gratin'); const formula = cell('Dish', 'Gratin'); formula.content.classList.remove('bases-metadata-value');
  const before = [unrelated.element.outerHTML, formula.element.outerHTML]; decorate();
  assert.equal(numeric.element.getAttribute('data-sabidurian-color'), 'yellow');
  input.value = '375'; input.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(numeric.element.getAttribute('data-sabidurian-color'), 'purple');
  assert.deepEqual([unrelated.element.outerHTML, formula.element.outerHTML], before);
});

test('existing list pills receive individual colors and stopping restores the native DOM', async () => {
  const { element, content, editor } = cell('Dish', ''); editor.remove();
  const pills = ['Gratin', 'Dressing'].map(value => {
    const pill = content.appendChild(document.createElement('div')); pill.className = 'multi-select-pill';
    const text = pill.appendChild(document.createElement('div')); text.className = 'multi-select-pill-content'; text.textContent = value;
    return pill;
  });
  const original = element.outerHTML; const decorator = decorate();
  assert.deepEqual(pills.map(pill => pill.getAttribute('data-sabidurian-color')), ['orange', 'green']);
  assert.equal(element.hasAttribute('data-sabidurian-color'), false);
  decorator.destroy(); assert.equal(element.outerHTML, original);
  pills[0].firstChild!.textContent = 'Dressing'; await settle();
  assert.equal(pills[0].hasAttribute('data-sabidurian-color'), false);
});
