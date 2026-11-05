import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Menu, Modal } from './obsidian-mock';
import { ContextMenuManager } from '../src/interaction/ContextMenuManager';
import { ArrowDragManager } from '../src/interaction/ArrowDragManager';
import { NumericAxis } from '../src/scale/NumericAxis';
import { DayScale } from '../src/scale/scales/DayScale';

const win = new Window();Object.assign(globalThis,{window:win,document:win.document});
let shown: any;
// Record only the host menu API seam; all lock checks and handlers are production code.
(Menu.prototype as any).addItem = function(fill: any) {
  const item: any={disabled:false,setTitle(text:string){this.title=text;return this;},setIcon(){return this;},setDisabled(value:boolean){this.disabled=value;return this;},onClick(fn:any){this.click=fn;return this;}};
  fill(item); (this.items??=[]).push(item);return this;
};
(Menu.prototype as any).addSeparator=function(){return this;};
(Menu.prototype as any).showAtMouseEvent=function(){shown=this;};
function setup() {
  const file={path:'Tasks/Rest.md',basename:'Rest',parent:{path:'Tasks'}};
  const entry: any={file,label:'Rest',locked:false,dependencies:[],row:0,x:100,width:40,isPoint:false};
  const operations: string[]=[];
  const app: any={vault:{read:async()=>{operations.push('read');return 'task';},getAbstractFileByPath:()=>null,create:async()=>operations.push('create'),trash:async()=>operations.push('trash')}};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  const manager:any=new ContextMenuManager(svg,app,new NumericAxis(2026,2027,1200),DayScale);
  return {entry,operations,app,svg,manager};
}

test('locked views and locked tasks disable duplicate/delete and guard direct invocation', async()=>{
  for (const mode of ['view','task']) {
    const f=setup(); if(mode==='view')f.manager.viewLocked=true;else f.entry.locked=true;
    f.manager.showBarMenu(f.entry,new win.MouseEvent('contextmenu'));
    for(const title of ['Duplicate','Delete'])assert.equal(shown.items.find((i:any)=>i.title===title).disabled,true);
    const openCount=Modal.opened.length;
    await f.manager.duplicateEntry(f.entry);await f.manager.deleteEntry(f.entry);
    assert.deepEqual(f.operations,[]);assert.equal(Modal.opened.length,openCount);
  }
});

test('default unlocked context menu retains Sequence duplicate behavior',async()=>{
  const f=setup();f.manager.showBarMenu(f.entry,new win.MouseEvent('contextmenu'));
  for(const title of ['Duplicate','Delete'])assert.equal(shown.items.find((i:any)=>i.title===title).disabled,false);
  await f.manager.duplicateEntry(f.entry);assert.deepEqual(f.operations,['read','create']);
});

test('dependency drop handles failed asynchronous persistence and clears drag state',async()=>{
  const f=setup();const drag:any=new ArrowDragManager(f.svg,f.app);
  const source={...f.entry,file:{path:'Tasks/Prep.md'}};
  let attempts=0;drag.connect=async()=>{attempts++;throw new Error('Vault write failed');};
  drag.entries=[f.entry];drag.getRowY=()=>0;drag.isDragging=true;drag.sourceEntry=source;
  document.body.classList.add('sabidurian-arrow-dragging');
  await assert.doesNotReject(drag.onMouseUp(new win.MouseEvent('mouseup',{clientX:110,clientY:10})));
  assert.equal(attempts,1);assert.equal(drag.isDragging,false);assert.equal(drag.sourceEntry,null);
  assert.equal(document.body.classList.contains('sabidurian-arrow-dragging'),false);
});
