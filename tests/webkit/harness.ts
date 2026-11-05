import { installHostDom, Modal, Notice } from './host';
import { seed, configs, zone } from './fixtures';
import { SabidurianView } from '../../src/SabidurianView';
import { EditHistory } from '../../src/model/EditHistory';
import { Scheduling } from '../../src/model/Scheduling';
import { parseExactTime } from '../../src/utils/timezone';
import { dependencyLinks } from '../../src/model/labels';

installHostDom();
type RecordRow = {path:string;frontmatter:Record<string,any>};
const KEY = 'time-line-webkit-fixture-v1';
const state = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })();
let records: RecordRow[] = state?.records ?? structuredClone(seed);
let views = state?.views ?? structuredClone(configs);
let selected = state?.selected in views ? state.selected : 'Timeline';
let view: any;
const host = document.querySelector('#host') as HTMLElement;
const status = document.querySelector('#status') as HTMLElement;
const selector = document.querySelector('#view') as HTMLSelectElement;
const files = () => records.map(row=>({path:row.path,basename:row.path.split('/').pop()!.replace(/\.md$/,''),parent:{path:'Tasks'}}));
const rowFor = (file:any) => records.find(row=>row.path===file.path)!;
const rawNote = (row:RecordRow) => '---\n'+Object.entries(row.frontmatter).map(([key,value])=>`${JSON.stringify(key)}: ${JSON.stringify(value)}`).join('\n')+'\n---\n';
function persist() { localStorage.setItem(KEY,JSON.stringify({records,views,selected})); }
const app: any = {
  metadataCache: {
    getFileCache:(file:any)=>({frontmatter:rowFor(file)?.frontmatter}),
    getFirstLinkpathDest:(path:string)=>files().find(file=>file.path===path||file.path===path+'.md'||file.basename===path),
  },
  fileManager:{processFrontMatter:async(file:any,mutate:(fm:any)=>void)=>{
    const row=rowFor(file); const next=structuredClone(row.frontmatter); mutate(next); row.frontmatter=next; persist();
  }},
  vault:{
    getMarkdownFiles:files,
    getAbstractFileByPath:(path:string)=>files().find(file=>file.path===path),
    create:async(path:string,content:string)=>{
      const fm:Record<string,any>={};
      for(const line of content.split('\n').slice(1,-2)) {const split=line.indexOf(': ');if(split>0)fm[JSON.parse(line.slice(0,split))]=JSON.parse(line.slice(split+2));}
      records.push({path,frontmatter:fm}); persist(); return files().find(file=>file.path===path);
    },
    read:async(file:any)=>rawNote(rowFor(file)),
    trash:async(file:any)=>{records=records.filter(row=>row.path!==file.path);persist();},
    modify:async()=>{throw new Error('Harness supports frontmatter transactions only.');},
  },
  workspace:{trigger:()=>{},getLeaf:()=>({openFile:async(file:any)=>{
    const modal=new Modal(app); const title=document.createElement('h2');title.textContent=rowFor(file).frontmatter.Step;modal.contentEl.append(title);
    const pre=document.createElement('pre');pre.textContent=rawNote(rowFor(file));modal.contentEl.append(pre);modal.open();
  }})},
};
const makeHistory=()=>new EditHistory((file,mutate)=>app.fileManager.processFrontMatter(file,mutate));
const plugin:any={app,history:makeHistory(),settings:{maxEntries:5000,lockOnMobile:false,dependencyProperty:'Blocked by',lockedProperty:'locked',showBarProperties:true,barPropertyMinWidth:80,markers:[],propertyColors:{Dish:{'Potato gratin':'orange',Turkey:'brown','Rosemary carrots':'green',Gravy:'purple'},'Oven Temp':{'400':'yellow','375':'orange'}}}};
function queriedRows() {
  let rows=records.filter(row=>selected!=='Oven'||Boolean(row.frontmatter['Oven Temp']));
  if(selected==='Chef')rows=rows.filter(row=>Boolean(row.frontmatter['Active Chef']));
  rows=[...rows].sort((a,b)=>String(a.frontmatter.start).localeCompare(String(b.frontmatter.start)));
  const entries=rows.map(row=>({file:files().find(file=>file.path===row.path),getValue:(id:string)=>id==='formula.Label'?row.frontmatter.Step:row.frontmatter[id.replace(/^note\./,'')]}));
  return {data:entries,groupedData:selected==='Chef'?['Alex','Maya'].map(key=>({key,hasKey:()=>true,entries:entries.filter(entry=>entry.getValue('note.Active Chef')===key)})):[]};
}
function openView(name=selected) {
  selected=name;selector.value=name;persist();
  view?.onunload();view=new SabidurianView({} as any,host,plugin);
  const values=views[name];
  view.config={get:(key:string)=>values[key],set:(key:string,value:any)=>{values[key]=value;persist();},getAsPropertyId:(key:string)=>values[key]??null,getOrder:()=>['note.Step','note.start','note.end'],getDisplayName:(id:string)=>id.replace(/^note\./,'')};
  view.allProperties=['note.Step','note.Dish','note.Active Chef','note.Oven Temp','note.start','note.end','note.Blocked by'];
  Object.defineProperty(view,'data',{get:queriedRows});view.onDataUpdated();
}
function reset() {
  for(const modal of [...Modal.opened])modal.close();
  records=structuredClone(seed);views=structuredClone(configs);selected='Timeline';plugin.history=makeHistory();persist();openView();
}
const pause=(ms=25)=>new Promise(resolve=>setTimeout(resolve,ms));
const frames=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
const assert=(value:any,message:string)=>{if(!value)throw new Error(message);};
const eq=(actual:any,expected:any,message:string)=>assert(JSON.stringify(actual)===JSON.stringify(expected),`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
function button(root:ParentNode,label:string):HTMLButtonElement {
  const found=[...root.querySelectorAll('button')].find(button=>button.textContent?.trim()===label);assert(found,`Missing ${label}`);return found!;
}
async function press(root:ParentNode,label:string) {const el=button(root,label);assert(!el.disabled,`${label} disabled`);el.click();await pause();await frames();}
function bar(path:string):SVGGElement {const el=host.querySelector(`[data-file-path="${CSS.escape(path)}"].sabidurian-bar-group`);assert(el,`Missing task ${path}`);return el as SVGGElement;}
async function inspect(path='Tasks/Gratin rest.md') {bar(path).dispatchEvent(new MouseEvent('click',{bubbles:true}));await pause();return Modal.opened[Modal.opened.length-1];}
function current() {const modal=Modal.opened[Modal.opened.length-1];assert(modal,'Missing modal');return modal;}
function dependency(modal:Modal,name:string):HTMLButtonElement {
  const link=[...modal.contentEl.querySelectorAll<HTMLButtonElement>('.sabidurian-dependency-link')].find(el=>el.textContent?.startsWith(name));
  assert(link,`Missing dependency ${name}`);assert(!link!.disabled,`Dependency ${name} disabled`);return link!;
}
function geometry() {
  const toolbar=host.querySelector('.sabidurian-controls')!.getBoundingClientRect();
  const canvas=host.querySelector('.sabidurian-timeline-body') as HTMLElement;
  return {viewport:{width:innerWidth,height:innerHeight,visualWidth:visualViewport?.width,visualHeight:visualViewport?.height},orientation:screen.orientation?.type??'unknown',touchPoints:navigator.maxTouchPoints,userAgent:navigator.userAgent,toolbar:{left:toolbar.left,right:toolbar.right,height:toolbar.height},canvas:{width:canvas.clientWidth,height:canvas.clientHeight,scrollWidth:canvas.scrollWidth,scrollHeight:canvas.scrollHeight},bodyScrollWidth:document.body.scrollWidth};
}
async function sendReport(report:any) {
  (window as any).webkitTestReport=report;
  await fetch('/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
}
type Check={name:string;passed:boolean;error?:string};
async function runChecks(reload=true) {
  status.textContent='Running production UI checks in this browser…';
  const checks:Check[]=[];
  const check=async(name:string,run:()=>any)=>{
    reset();await frames();
    try {await run();checks.push({name,passed:true});} catch(error) {checks.push({name,passed:false,error:String(error)});}
  };
  await check('Production view renders all synthetic tasks, full short label and AM/PM hour tier',()=>{
    eq(host.querySelectorAll('.sabidurian-bar-group').length,12,'task count');
    const text=bar('Tasks/Gratin rest.md').textContent!;assert(text.includes('Rest')&&text.includes('Potato gratin'),'full short-bar label');
    assert(host.querySelector('.sabidurian-header-tier-top')?.textContent?.includes('4 PM'),'non-padded 4 PM hour label');
    assert(host.querySelector('.sabidurian-header-tier-bottom')?.textContent?.includes(':15'),'separate minute tier');
    assert((host.querySelector('.sabidurian-bar') as SVGRectElement).width.baseVal.value>0,'SVG geometry');
  });
  await check('Lock guards the exact editor; +5, Save, view reopen and Undo preserve five-minute duration',async()=>{
    let modal=await inspect();assert(button(modal.contentEl,'Save').disabled,'locked save');
    assert(button(modal.contentEl,'Close'),'clean inspector says Close');
    eq(modal.modalEl.querySelector('.modal-close-button')?.getAttribute('aria-label'),'Close','clean close icon label');
    await press(modal.contentEl,'Unlock view to edit');modal=current();
    await press(modal.contentEl,'+5 min');assert(button(modal.contentEl,'Discard changes'),'dirty inspector says Discard changes');
    eq(modal.modalEl.querySelector('.modal-close-button')?.getAttribute('aria-label'),'Discard changes','dirty close icon label');
    await press(modal.contentEl,'−5 min');assert(button(modal.contentEl,'Close'),'reverted draft says Close');
    await press(modal.contentEl,'+5 min');eq(rowFor({path:'Tasks/Gratin rest.md'}).frontmatter.start,'2026-11-26T17:55:00-07:00','draft is not persisted');
    await press(modal.contentEl,'Save');
    let fm=rowFor({path:'Tasks/Gratin rest.md'}).frontmatter;eq(fm.start,'2026-11-26T18:00:00-07:00','saved start');eq(fm.end,'2026-11-26T18:05:00-07:00','saved end');
    openView();await frames();modal=await inspect();eq((modal.contentEl.querySelector('input') as HTMLInputElement).value.slice(0,16),'2026-11-26T18:00','reopened exact input');modal.close();
    await press(host,'Undo');fm=rowFor({path:'Tasks/Gratin rest.md'}).frontmatter;eq(fm.start,'2026-11-26T17:55:00-07:00','undo start');
  });
  await check('Exact native datetime inputs accept 17:25 and 17:55 without 15-minute rounding',async()=>{
    views.Timeline.locked=false;openView();await frames();const modal=await inspect();
    const inputs=modal.contentEl.querySelectorAll('input');inputs[0].value='2026-11-26T17:25';inputs[1].value='2026-11-26T17:55';
    await press(modal.contentEl,'Save');const fm=rowFor({path:'Tasks/Gratin rest.md'}).frontmatter;
    eq(fm.start,'2026-11-26T17:25:00-07:00','exact start');eq(fm.end,'2026-11-26T17:55:00-07:00','exact end');
  });
  await check('Picker adds another predecessor by human label; inverse links remain derived and dates do not shift',async()=>{
    views.Timeline.locked=false;openView();await frames();const modal=await inspect();
    const before=structuredClone(rowFor({path:'Tasks/Gratin rest.md'}).frontmatter);
    await press(modal.contentEl,'Add predecessor…');const picker=current();
    const choice=[...picker.contentEl.querySelectorAll('button')].find(el=>el.textContent?.includes('Rosemary carrots'));assert(choice,'real TaskPicker item');choice!.click();await pause();
    await press(modal.contentEl,'Save');const fm=rowFor({path:'Tasks/Gratin rest.md'}).frontmatter;
    eq(dependencyLinks(fm['Blocked by']),['Tasks/Final bake','Tasks/Bake carrots'],'multiple stable predecessors');eq(fm.start,before.start,'no automatic shifting');
    await press(host,'Undo');eq(rowFor({path:'Tasks/Gratin rest.md'}).frontmatter,before,'dependency undo');
  });
  await check('Locked predecessor and successor links open their tasks without editing dates or dependencies',async()=>{
    const before=JSON.stringify(records);let modal=await inspect();
    dependency(modal,'Final bake').click();await pause();await frames();modal=current();
    eq(modal.contentEl.querySelector('h2')?.textContent,'Final bake','predecessor opened');assert(button(modal.contentEl,'Save').disabled,'navigation stays locked');
    dependency(modal,'Rest').click();await pause();await frames();modal=current();
    eq(modal.contentEl.querySelector('h2')?.textContent,'Rest','blocking task opened');
    dependency(modal,'Serve dinner').click();await pause();await frames();modal=current();
    eq(modal.contentEl.querySelector('h2')?.textContent,'Serve dinner','next blocking task opened');assert(button(modal.contentEl,'Save').disabled,'successor stays locked');
    eq(JSON.stringify(records),before,'locked navigation is read-only');assert(button(host,'Undo').disabled,'navigation adds no undo operation');
  });
  await check('Dirty dependency and note navigation preserve the draft until explicit Discard changes',async()=>{
    views.Timeline.locked=false;openView();await frames();const before=JSON.stringify(records);const modal=await inspect();
    const fields=modal.contentEl.querySelectorAll('input');fields[0].value='2026-11-26T18:00';fields[1].value='2026-11-26T18:05';
    fields[0].dispatchEvent(new Event('input',{bubbles:true}));fields[1].dispatchEvent(new Event('change',{bubbles:true}));
    assert(button(modal.contentEl,'Discard changes'),'native field changes mark draft dirty');const draft=fields[0].value;
    dependency(modal,'Final bake').click();await pause();await frames();
    assert(current()===modal,'dirty dependency navigation leaves inspector open');
    assert(modal.contentEl.querySelector('[role="alert"]')?.textContent?.includes('Save or discard'),'navigation explains required action');
    await press(modal.contentEl,'Open note');assert(current()===modal&&Modal.opened.length===1,'dirty Open note leaves inspector open');
    eq((modal.contentEl.querySelector('input') as HTMLInputElement).value,draft,'unsaved input retained');eq(JSON.stringify(records),before,'no implicit save');
    await press(modal.contentEl,'Discard changes');eq(Modal.opened.length,0,'explicit discard closes inspector');eq(JSON.stringify(records),before,'discard changes no stored data');
    const reopened=await inspect();eq((reopened.contentEl.querySelector('input') as HTMLInputElement).value.slice(0,16),'2026-11-26T17:55','original exact time restored');assert(button(reopened.contentEl,'Close'),'reopened clean state');
  });
  await check('Chef group arrows cross groups; collapsed endpoints disappear and Find task expands the selected group',async()=>{
    openView('Chef');await frames();
    eq(view.currentGroups.map((group:any)=>group.name),['Alex','Maya'],'group order');
    assert(view.arrowRenderer.getEdges().some((edge:any)=>edge.from.groupKey!==edge.to.groupKey),'cross-group arrow');
    const group=host.querySelector('[data-group-name="Maya"]')!;group.dispatchEvent(new MouseEvent('click',{bubbles:true}));await frames();
    assert(!host.querySelector('[data-file-path="Tasks/Roast turkey.md"].sabidurian-bar-group'),'collapsed task hidden');
    await press(host,'Find task…');const picker=current();const item=[...picker.contentEl.querySelectorAll('button')].find(el=>el.textContent?.startsWith('Roast ·'));assert(item,'collapsed item in picker');item!.click();await frames();
    assert(host.querySelector('[data-file-path="Tasks/Roast turkey.md"].sabidurian-bar-group'),'Find expands group');assert(current().contentEl.querySelector('h2')?.textContent==='Roast','inspector opened');
  });
  await check('Touch-mode scrolling and synthetic touch events leave all stored times unchanged',async()=>{
    views.Timeline.locked=false;openView();await frames();const before=JSON.stringify(records);
    if(navigator.maxTouchPoints>0) {assert(!view.dragManager&&!view.touchManager,'native pan mode uses no rescheduling drag manager');}
    const canvas=host.querySelector('.sabidurian-timeline-body') as HTMLElement;
    canvas.scrollLeft+=100;canvas.scrollTop=120;canvas.dispatchEvent(new Event('scroll'));
    bar('Tasks/Gratin rest.md').dispatchEvent(new Event('touchstart',{bubbles:true}));bar('Tasks/Gratin rest.md').dispatchEvent(new Event('touchmove',{bubbles:true}));bar('Tasks/Gratin rest.md').dispatchEvent(new Event('touchend',{bubbles:true}));await pause();
    eq(JSON.stringify(records),before,'scroll is read-only');
  });
  await check('Task start/end edge buttons reveal exact boundaries without moving the row or editing stored times',async()=>{
    const before=JSON.stringify(records);
    for(const locked of [true,false]) {
      views.Timeline.locked=locked;openView();await frames();
      const entry=view.allVisibleEntries.find((entry:any)=>entry.file.path==='Tasks/Defrost turkey.md');assert(entry,'multi-day fixture');
      const canvas=host.querySelector('.sabidurian-timeline-body') as HTMLElement;
      const middle=entry.x+entry.width/2-canvas.clientWidth/2;canvas.scrollTop=7;
      const top=canvas.scrollTop;assert(top>0,'nonzero vertical position exercises scroll preservation');
      for(const boundary of ['start','end']) {
        canvas.scrollLeft=middle;canvas.dispatchEvent(new Event('scroll'));await frames();
        const edge=host.querySelector<HTMLButtonElement>(`.sabidurian-task-edge[data-file-path="Tasks/Defrost turkey.md"][data-boundary="${boundary}"]`);
        assert(edge&&!edge.disabled,`${boundary} edge reachable while ${locked?'locked':'unlocked'}`);
        const bounds=edge!.getBoundingClientRect();assert(bounds.width>=30&&bounds.height>=30,'visible edge hit target');
        if(matchMedia('(pointer: coarse)').matches)assert(bounds.width>=44&&bounds.height>=44,'touch edge target');
        const hit=document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2);assert(hit===edge||edge!.contains(hit),`${boundary} edge is not covered by another layer`);
        edge!.click();await pause();await frames();
        const x=boundary==='start'?entry.x:entry.x+entry.width;
        assert(x>=canvas.scrollLeft-1&&x<=canvas.scrollLeft+canvas.clientWidth+1,`${boundary} is now visible`);
        eq(canvas.scrollTop,top,'vertical row position preserved');eq(Modal.opened.length,0,'edge jump does not open inspector');
        eq(JSON.stringify(records),before,'edge jump does not reschedule');assert(button(host,'Undo').disabled,'edge jump adds no undo operation');
      }
    }
  });
  await check('New task dialog creates a five-minute task and creation Undo removes only that task',async()=>{
    views.Timeline.locked=false;openView();await frames();await press(host,'New task');const modal=current();
    const name=modal.contentEl.querySelector('[aria-label="Step"]') as HTMLInputElement;name.value='Warm plates';
    await press(modal.contentEl,'Create');eq(records.length,13,'new task count');
    const fm=records.find(row=>row.frontmatter.Step==='Warm plates')!.frontmatter;eq(Date.parse(fm.end)-Date.parse(fm.start),300000,'five-minute duration');
    await press(host,'Undo');eq(records.length,12,'creation undo');
  });
  await check('WebKit Intl preserves Denver offsets and rejects missing or ambiguous DST wall times',()=>{
    eq(parseExactTime('2026-11-01T01:30:00-06:00',zone),Date.parse('2026-11-01T01:30:00-06:00'),'explicit DST offset');
    for(const input of ['2026-03-08T02:30','2026-11-01T01:30']) {let failed=false;try{parseExactTime(input,zone);}catch{failed=true;}assert(failed,`DST rejected ${input}`);}
    const s=new Scheduling(5,zone);eq(s.nudge('2026-12-31T23:55:00-07:00','2027-01-01T00:00:00-07:00',5).end,'2027-01-01T00:05:00-07:00','year boundary');
  });
  await check('Current viewport has reachable toolbar, vertical canvas space, and no document-width overflow',()=>{
    const info=geometry();assert(info.toolbar.left>=-1&&info.toolbar.right<=innerWidth+1,'toolbar inside viewport');
    assert(info.canvas.height>80,'scrollable canvas has usable height');assert(info.bodyScrollWidth<=innerWidth+1,'body does not overflow horizontally');
    const hour=host.querySelector('.sabidurian-header-tier-top') as HTMLElement;assert(getComputedStyle(hour).display!=='none','hour tier visible');
  });
  await check('Inspector and New task native fields fit their containers without horizontal scrolling',async()=>{
    views.Timeline.locked=false;openView();await frames();
    const checkFields=(modal:Modal)=>{
      const el=modal.contentEl;const bounds=el.getBoundingClientRect();
      const overflow=[...el.querySelectorAll('*')].map(node=>({node,rect:node.getBoundingClientRect()})).filter(({rect})=>rect.right>bounds.left+el.clientWidth+1||rect.left<bounds.left-1).map(({node,rect})=>{const css=getComputedStyle(node);return {tag:node.tagName,cls:node.className,type:(node as HTMLInputElement).type,left:rect.left,right:rect.right,width:rect.width,parentWidth:node.parentElement?.getBoundingClientRect().width,cssWidth:css.width,boxSizing:css.boxSizing,padding:css.padding,minWidth:css.minWidth,maxWidth:css.maxWidth,appearance:css.appearance};});
      assert(el.scrollWidth<=el.clientWidth+1,`form overflow: ${el.scrollWidth} > ${el.clientWidth}; ${JSON.stringify(overflow)}`);
      for(const field of el.querySelectorAll('input,select')) {
        const rect=field.getBoundingClientRect();
        assert(rect.left>=bounds.left-1&&rect.right<=bounds.left+el.clientWidth+1,`field exceeds form: ${rect.left}–${rect.right} vs ${bounds.left}–${bounds.left+el.clientWidth}`);
      }
    };
    const inspector=await inspect();checkFields(inspector);inspector.close();
    await press(host,'New task');checkFields(current());
  });
  await check('Inspector close control is circular and Hours text fits beside a compact single chevron',async()=>{
    const modal=await inspect();const close=modal.modalEl.querySelector('.modal-close-button') as HTMLElement;
    const closeBox=close.getBoundingClientRect(),closeStyle=getComputedStyle(close);
    assert(Math.abs(closeBox.width-closeBox.height)<1&&closeBox.width>=30,'square close hit area');
    const radius=closeStyle.borderTopLeftRadius;assert(radius.endsWith('%')?parseFloat(radius)>=50:parseFloat(radius)>=closeBox.width/2,'circular close radius');
    modal.close();
    const select=host.querySelector('.sabidurian-scale-select') as HTMLSelectElement;
    const css=getComputedStyle(select),chevron=getComputedStyle(select.parentElement!,'::after');
    eq(select.selectedOptions[0].textContent,'Hours','Hours option selected');assert(css.appearance==='none','only custom chevron is drawn');
    const ctx=document.createElement('canvas').getContext('2d')!;ctx.font=css.font||`${css.fontSize} ${css.fontFamily}`;
    const textWidth=ctx.measureText('Hours').width;
    const width=select.getBoundingClientRect().width,left=parseFloat(css.paddingLeft),right=parseFloat(css.paddingRight);
    const borders=parseFloat(css.borderLeftWidth)+parseFloat(css.borderRightWidth);
    assert(width-left-right-borders>=textWidth-1,`Hours text fits: available ${width-left-right-borders}, measured ${textWidth}`);
    const gap=width-parseFloat(chevron.right)-parseFloat(chevron.width)-left-textWidth;
    assert(gap>=4&&gap<=24,`compact text/chevron gap: ${gap}`);assert(chevron.pointerEvents==='none','chevron keeps native select touch target');
  });
  await check('Light and dark themes render finite SVG geometry and readable label nodes',async()=>{
    for(const theme of ['theme-light','theme-dark']) {
      document.body.classList.remove('theme-light','theme-dark');document.body.classList.add(theme);view.onDataUpdated();await frames();
      const short=bar('Tasks/Gratin rest.md');const label=short.querySelector('.sabidurian-bar-label-flow') as SVGTextElement;assert(label?.textContent==='Rest','short task label exists');
      const rect=short.querySelector('.sabidurian-bar') as SVGRectElement;assert(rect.width.baseVal.value>0&&Number.isFinite(rect.x.baseVal.value),'finite geometry');
      assert(label.x.baseVal[0].value>=rect.x.baseVal.value&&label.x.baseVal[0].value<rect.x.baseVal.value+rect.width.baseVal.value,'short label begins in actual bar');
      const badge=short.querySelector('.sabidurian-property-badge[data-property="Dish"]')!;
      eq((badge as SVGGElement).dataset.sabidurianColor,'orange','configured dish color');
      const badgeBox=badge.querySelector('rect') as SVGRectElement;
      assert(badgeBox.x.baseVal.value>label.getBBox().x+label.getBBox().width,'badge clears measured WebKit label');
      assert(badgeBox.x.baseVal.value+badgeBox.width.baseVal.value>rect.x.baseVal.value+rect.width.baseVal.value,'short label continues beyond actual duration');
      assert(getComputedStyle(badgeBox).fill!==getComputedStyle(badge.querySelector('text')!).fill,'badge foreground differs from fill');
      const oven=bar('Tasks/Final bake.md').querySelector('.sabidurian-property-badge[data-property="Oven Temp"]') as SVGGElement;
      eq(oven.dataset.sabidurianColor,'yellow','temperature color independent of dish');
    }
    document.body.classList.replace('theme-dark','theme-light');
  });
  reset();await frames();
  const report={startedAt:new Date().toISOString(),environment:geometry(),checks,passed:checks.every(check=>check.passed),scope:'Production plugin UI in standalone Safari host; Obsidian host APIs and storage are adapters. Touch events in automated checks are synthetic; trusted gestures require manual acceptance.'};
  if(reload) {
    // Cross an actual page navigation to test browser storage, not merely reconstructing the view.
    const modal=await inspect();await press(modal.contentEl,'Unlock view to edit');
    await press(current().contentEl,'+5 min');await press(current().contentEl,'Save');openView('Chef');
    sessionStorage.setItem('time-line-webkit-reload',JSON.stringify(report));location.replace('/?resume=1');return;
  }
  await finish(report);
}
async function finish(report:any) {
  await sendReport(report);status.textContent=`${report.checks.filter((c:Check)=>c.passed).length}/${report.checks.length} checks passed · ${innerWidth} × ${innerHeight} · WebKit host test`;
  if(!report.passed)new Notice('Some WebKit checks failed. Open Checks for details.');
}
selector.onchange=()=>openView(selector.value);
document.querySelector('#reset')!.addEventListener('click',()=>{reset();status.textContent='Synthetic tasks reset. No personal vault is connected.';});
document.querySelector('#theme')!.addEventListener('click',()=>{const dark=document.body.classList.toggle('theme-dark');document.body.classList.toggle('theme-light',!dark);view.onDataUpdated();});
document.querySelector('#checks')!.addEventListener('click',()=>{
  const report=(window as any).webkitTestReport;if(!report){void runChecks(false);return;}
  const modal=new Modal(app);const pre=document.createElement('pre');pre.className='harness-check-results';pre.textContent=report.checks.map((check:Check)=>`${check.passed?'PASS':'FAIL'} ${check.name}${check.error?'\n'+check.error:''}`).join('\n\n');modal.contentEl.append(pre);modal.open();
});
window.addEventListener('resize',()=>{view?.onDataUpdated();});
window.addEventListener('error',event=>{status.textContent=String(event.message);void fetch('/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'error',message:event.message,stack:event.error?.stack})});});
window.addEventListener('unhandledrejection',event=>{status.textContent=String(event.reason);void fetch('/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'rejection',message:String(event.reason),stack:event.reason?.stack})});});
window.addEventListener('visibilitychange',()=>{void fetch('/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'visibility',state:document.visibilityState,at:new Date().toISOString()})});});
(window as any).timeLineHarness={runChecks,reset,openView,get view(){return view;},get records(){return records;},geometry};
openView();status.textContent='Standalone WebKit host · tap a task to inspect; Unlock to edit.';
if(new URLSearchParams(location.search).has('resume')) {
  const report=JSON.parse(sessionStorage.getItem('time-line-webkit-reload')||'null');
  if(report){const fm=rowFor({path:'Tasks/Gratin rest.md'}).frontmatter;const passed=selected==='Chef'&&fm.start==='2026-11-26T18:00:00-07:00'&&fm.end==='2026-11-26T18:05:00-07:00';report.checks.push({name:'Actual Safari page reload preserves a saved edit and selected view',passed});report.passed=report.passed&&passed;reset();void frames().then(()=>finish(report));}
} else if(new URLSearchParams(location.search).has('run')) {void frames().then(()=>runChecks());}
