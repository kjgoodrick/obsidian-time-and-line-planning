import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { KeyboardManager } from '../src/interaction/KeyboardManager';

const win = new Window();
const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
Object.assign(globalThis, {
  window: win, document: win.document,
  requestAnimationFrame: (cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame; },
  cancelAnimationFrame: (id: number) => frames.delete(id),
});
function setup() {
  const container = document.createElement('div'); document.body.append(container);
  const entry: any = {file: {path:'Tasks/Rest.md'},startYear:2026,row:0,x:0};
  let opened=0, selected=0;
  const selection: any = {getSelectedEntry:()=>entry,getSelectedIndex:()=>-1,select:()=>selected++,clear:()=>{},selectAll:()=>{}};
  const app: any = {workspace:{getLeaf:()=>({openFile:()=>opened++})}};
  const keys = new KeyboardManager(container,app,selection,'day'); keys.attach([entry]);
  return {container,entry,keys,getOpened:()=>opened,getSelected:()=>selected};
}
const key = (target: any, name: string) => {
  const event = new win.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true});
  target.dispatchEvent(event); return event;
};

test('toolbar controls retain Enter/Space/Tab and do not move timeline selection', () => {
  const f=setup(); const button=document.createElement('button'); f.container.append(button);
  const icon=document.createElement('span');button.append(icon);
  for (const name of ['Enter',' ','Tab','ArrowRight']) assert.equal(key(icon,name).defaultPrevented,false);
  assert.equal(f.getOpened(),0); assert.equal(f.getSelected(),0);
  button.focus(); icon.dispatchEvent(new win.MouseEvent('mousedown',{bubbles:true}) as any);
  assert.equal(frames.size,0); assert.equal(document.activeElement,button);
  f.keys.destroy();f.container.remove();
});

test('SVG task and group buttons retain their own keyboard handler without a second open', () => {
  const f=setup(); const group=document.createElementNS('http://www.w3.org/2000/svg','g'); group.setAttribute('role','button');f.container.append(group);
  let inspected=0;group.addEventListener('keydown',()=>inspected++);
  assert.equal(key(group,'Enter').defaultPrevented,false);assert.equal(inspected,1);assert.equal(f.getOpened(),0);
  f.keys.destroy();f.container.remove();
});

test('background keyboard navigation can inspect a task and defaults to the legacy Sequence note action', () => {
  const f=setup();assert.equal(key(f.container,'Enter').defaultPrevented,true);assert.equal(f.getOpened(),1);
  let inspected:any;f.keys.setOpenEntryCallback(entry=>inspected=entry);key(f.container,'Enter');
  assert.equal(inspected,f.entry);assert.equal(f.getOpened(),1);key(f.container,'ArrowRight');assert.equal(f.getSelected(),1);
  f.keys.destroy();f.container.remove();
});

test('destroy cancels deferred focus and removes capture listener', () => {
  const f=setup();f.container.dispatchEvent(new win.MouseEvent('mousedown',{bubbles:true}) as any);assert.equal(frames.size,1);
  f.keys.destroy();assert.equal(frames.size,0);f.container.dispatchEvent(new win.MouseEvent('mousedown',{bubbles:true}) as any);assert.equal(frames.size,0);f.container.remove();
});
