import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { TaskEdgeNavigation } from '../src/renderer/TaskEdgeNavigation';
import type { SabidurianEntry } from '../src/model/SabidurianEntry';
import { displayedTooltips } from './obsidian-mock';

const win = new Window();
Object.assign(globalThis, { window: win, document: win.document });
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
globalThis.cancelAnimationFrame = id => { frames.delete(id); };
const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(0)); };
let resized: () => void;
(win as any).ResizeObserver = class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} };
const renderers: TaskEdgeNavigation[] = [];
afterEach(() => { renderers.splice(0).forEach(r => r.destroy()); frames.clear(); displayedTooltips.length = 0; document.body.replaceChildren(); });
const entry = (path: string, x: number, width: number, row: number, extra = {}) => ({ file: { path }, label: path, x, width, row, ...extra } as SabidurianEntry);

function fixture(entries: SabidurianEntry[]) {
  const host = document.createElement('div'), body = document.createElement('div');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  body.append(svg); host.append(body); document.body.append(host);
  const size = { width: 300, height: 200 };
  Object.defineProperties(body, { clientWidth: { get: () => size.width }, clientHeight: { get: () => size.height } });
  body.scrollLeft = 100; body.scrollTop = 40;
  const jumps: { path: string; boundary: string }[] = [];
  const nav = new TaskEdgeNavigation(body as any, host as any, entries, row => 50 + row * 44,
    (task, boundary) => jumps.push({ path: task.file.path, boundary }));
  renderers.push(nav); flush();
  return { host, body, svg, size, jumps, nav, buttons: () => [...host.querySelectorAll<HTMLButtonElement>('button')] };
}

test('edge navigation uses actual boundaries, grouped row positions and all rows even when tasks are horizontally absent', () => {
  const tasks = [entry('spanning', 50, 500, 0), entry('left', -300, 40, 1), entry('right', 700, 20, 2),
    entry('long label only', 120, 5, 3, { displayLabel: 'A very long overflow label'.repeat(30) }),
    entry('collapsed', 10, 500, -1), entry('below', 10, 500, 20)];
  const { buttons, jumps, svg } = fixture(tasks);
  assert.deepEqual(buttons().map(b => [b.dataset.filePath, b.dataset.boundary]), [['spanning','start'],['spanning','end'],['left','start'],['right','end']]);
  assert.equal(buttons()[0].style.top, '24px', 'grouped layout offset minus vertical scrolling');
  let intercepted = 0; svg.addEventListener('mousedown', () => intercepted++); svg.addEventListener('click', () => intercepted++);
  const original = JSON.stringify(tasks);
  buttons()[2].dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true })); buttons()[2].click();
  assert.deepEqual(jumps, [{ path: 'left', boundary: 'start' }]);
  assert.equal(intercepted, 0); assert.equal(JSON.stringify(tasks), original);
});

test('edge buttons retain focus during one-pixel scrolling, react to resize and clean up', () => {
  const { host, body, size, nav, buttons } = fixture([entry('wide', 0, 600, 0)]);
  const original = buttons()[0]; original.focus();
  body.scrollTop++; body.dispatchEvent(new win.Event('scroll')); flush();
  assert.equal(buttons()[0], original); assert.equal(document.activeElement, original); assert.equal(original.style.top, '23px');
  size.width = 600; resized(); flush(); assert.deepEqual(buttons().map(b => b.dataset.boundary), ['start']);
  nav.destroy(); body.dispatchEvent(new win.Event('scroll')); flush();
  assert.equal(host.querySelector('.sabidurian-task-edges'), null);
});

test('packed rows choose the nearest task on each side and ongoing tasks have no invented end control', () => {
  const { buttons } = fixture([entry('far left', -400, 20, 0), entry('near left', 20, 20, 0),
    entry('far right', 900, 20, 0), entry('near right', 420, 20, 0), entry('ongoing', 140, 600, 1, { isOngoing: true })]);
  assert.deepEqual(buttons().map(b => b.dataset.filePath), ['near left','near right']);
});

test('both navigation tooltips include local image icons, retain fast timing and suppress the duplicate text tooltip', () => {
  const task = entry('sauce',0,600,0,{label:'Make',displayLabel:'Make · Sauce',icon:{kind:'image',url:'app://vault/Assets/Sauce.png'}});
  const original = JSON.stringify(task);
  const {host, buttons, jumps} = fixture([task]);
  let defaultTooltips = 0;
  host.addEventListener('pointerover',()=>defaultTooltips++);
  for (const button of buttons()) {
    assert.equal(button.getAttribute('aria-label'),'Make · Sauce');
    assert.equal(button.hasAttribute('title'),false);
    button.dispatchEvent(new win.PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));
    const tooltip = displayedTooltips.at(-1)!;
    assert.equal(tooltip.target,button); assert.equal(tooltip.options?.delay,100);
    const content = tooltip.content as DocumentFragment;
    assert.equal(content.textContent,'Make · Sauce');
    assert.equal(content.querySelector('img')?.getAttribute('src'),'app://vault/Assets/Sauce.png');
    assert.equal(content.querySelector('img')?.getAttribute('alt'),'');
    const count = displayedTooltips.length;
    button.querySelector('span')!.dispatchEvent(new win.PointerEvent('pointerover',{bubbles:true,pointerType:'mouse',relatedTarget:button}));
    button.dispatchEvent(new win.PointerEvent('pointerover',{bubbles:true,pointerType:'touch'}));
    button.dispatchEvent(new win.PointerEvent('pointerover',{bubbles:true,pointerType:'pen'}));
    assert.equal(displayedTooltips.length,count,'moving inside the button and non-mouse pointers do not restart the tooltip');
  }
  assert.equal(displayedTooltips.length,2); assert.equal(defaultTooltips,0);
  assert.deepEqual(jumps,[]); assert.equal(JSON.stringify(task),original);
});
