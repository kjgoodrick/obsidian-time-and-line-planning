import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Modal } from './obsidian-mock';
import { TaskInspector, TaskPicker } from '../src/interaction/TaskInspector';
import { BarRenderer } from '../src/renderer/BarRenderer';
import { ArrowRenderer } from '../src/renderer/ArrowRenderer';
import { HeaderRenderer } from '../src/renderer/HeaderRenderer';
import { GroupHeaderRenderer } from '../src/renderer/GroupHeaderRenderer';
import { DragManager } from '../src/interaction/DragManager';
import { EditHistory } from '../src/model/EditHistory';
import { Scheduling } from '../src/model/Scheduling';
import { SabidurianView } from '../src/SabidurianView';
import { resolveTaskIcon, iconLabel } from '../src/model/taskIcons';
import { NumericAxis } from '../src/scale/NumericAxis';
import { DayScale } from '../src/scale/scales/DayScale';
import { parseSabidurianDate, sabidurianDateToYear, yearToYAMLString } from '../src/utils/dateUtils';

const win = new Window();
Object.assign(globalThis, { window: win, document: win.document, MouseEvent: win.MouseEvent, CSS: win.CSS });
const proto = win.HTMLElement.prototype as any;
proto.createEl = function(tag: string, opts: any = {}) {
  const el = win.document.createElement(tag); if (opts.text != null) el.textContent = opts.text;
  if (opts.cls) el.className = opts.cls;
  for (const [k,v] of Object.entries(opts.attr ?? {})) el.setAttribute(k, String(v));
  for (const k of ['type', 'value', 'placeholder']) if (opts[k] != null) (el as any)[k] = opts[k];
  this.append(el); return el;
};
proto.createDiv = function(opts: any) { return this.createEl('div', opts); };
proto.createSpan = function(opts: any) { return this.createEl('span', opts); };
proto.addClass = function(...names: string[]) { this.classList.add(...names); };
proto.empty = function() { this.replaceChildren(); };
proto.setText = function(text: string) { this.textContent = text; };
proto.appendText = function(text: string) { this.append(document.createTextNode(text)); };
const zone = 'America/Denver';
const axis = (s: string) => sabidurianDateToYear(parseSabidurianDate(s, zone)!);
const iso = (n: number) => yearToYAMLString(n, 'minute', zone);
const fields = { start: 'begin', end: 'finish', label: 'Step', dependencies: 'Prerequisites', zone, folder: 'Tasks' };
function fixture() {
  const files = ['a', 'b', 'c'].map(id => ({ path: `Tasks/${id}.md`, basename: id }));
  const meta = new Map(files.map((f, i) => [f.path, { Step: i ? 'Bake' : 'Rest', Dish: i ? 'Pie' : 'Gratin', begin: '2026-11-26T17:55:00-07:00', finish: '2026-11-26T18:00:00-07:00', Prerequisites: i ? ['[[Tasks/a]]'] : [] } as any]));
  const app: any = {
    vault: { getMarkdownFiles: () => files },
    metadataCache: { getFileCache: (f: any) => ({ frontmatter: meta.get(f.path) }), getFirstLinkpathDest: (p: string) => files.find(f => f.path === p || f.path === p + '.md') },
    workspace: { getLeaf: () => ({ openFile: () => {} }) },
  };
  const history = new EditHistory(async (file, edit) => { edit(meta.get(file.path)); });
  return { files, meta, app, history };
}
const button = (el: any, label: string) => [...el.querySelectorAll('button')].find((b: any) => b.textContent === label) as any;
const invoke = async (el: any, text: string) => { const b = button(el, text); assert.ok(b, text); assert.equal(b.disabled, false, text); await b.onclick(); };
function entry(path: string, start: string, end: string, deps: string[] = [], groupKey = 'Alex'): any {
  return { file: { path, basename: 'stable-identity' }, label: 'Rest', displayLabel: 'Rest · Gratin', start: parseSabidurianDate(start, zone), end: parseSabidurianDate(end, zone), startYear: axis(start), endYear: axis(end), dependencies: deps, groupKey, row: 0, x: 100, width: 5, properties: {}, color: '#007aff', colorValue: '', isPoint: false, isOngoing: false, locked: false };
}

test('task icons resolve original emoji and local images without changing task identity or stored data', async () => {
  const {files, meta, app, history} = fixture();
  const imageFile = {path:'Assets/Task icons/Sauce.png'};
  const resolve = app.metadataCache.getFirstLinkpathDest;
  app.metadataCache.getFirstLinkpathDest = (path: string) => path === imageFile.path ? imageFile : resolve(path);
  app.vault.getResourcePath = (file: any) => `app://vault/${file.path}`;
  const fm = meta.get(files[0].path); fm.icon = '🥶';
  assert.equal(iconLabel('Defrost', resolveTaskIcon(fm.icon, app, files[0].path)), '🥶 Defrost');
  assert.equal(iconLabel('🥶 Defrost', resolveTaskIcon(fm.icon, app, files[0].path)), '🥶 Defrost');
  for (const value of [null, {}, 'none', 'https://example.com/🥧.png', '[[https://example.com/icon.png]]', '[[missing.png]]', '[[unsafe.svg]]'])
    assert.equal(resolveTaskIcon(value, app, files[0].path), undefined);
  const picker = new TaskPicker(app, files as any, fields, () => {});
  assert.match(picker.getItemText(files[0] as any), /^🥶 Rest/);
  fm.icon = '[[Assets/Task icons/Sauce.png]]';
  const before = structuredClone([...meta]);
  const icon = resolveTaskIcon(fm.icon, app, files[0].path);
  assert.deepEqual(icon, {kind:'image',url:'app://vault/Assets/Task icons/Sauce.png'});
  const suggestion = document.createElement('div'); picker.renderSuggestion({item:files[0]} as any, suggestion);
  assert.equal(suggestion.querySelectorAll('img').length, 1); assert.equal(suggestion.textContent, picker.getItemText(files[0] as any));
  const modal = new TaskInspector(app, files[0] as any, fields, history, false, () => {}, () => {}); modal.open();
  assert.equal(modal.contentEl.querySelector('h2 img')?.getAttribute('alt'), '');
  await invoke(modal.contentEl, 'Save');
  assert.deepEqual([...meta], before); assert.equal(history.canUndo, false);
  const parent = document.createElement('div'), svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  document.body.append(parent); parent.append(svg);
  const bars = new BarRenderer(svg,app,parent);
  const task = entry(files[0].path,'2026-11-26T17:55','2026-11-26T18:00'); task.icon = icon;
  for (const point of [false,true]) {
    task.isPoint = point; bars.render([task],()=>10);
    const image = svg.querySelector('image')!, text = svg.querySelector('.sabidurian-bar-label')!;
    assert.equal(image.getAttribute('href'), 'app://vault/Assets/Task icons/Sauce.png');
    assert.equal(Number(text.getAttribute('x'))-Number(image.getAttribute('x')),20);
    assert.equal(task.width,5); assert.equal(task.file.path,files[0].path);
  }
  bars.destroy(); parent.remove();
});

test('exact controls stage five-minute edits; cancel is read-only; save/reopen/undo use mapped fields', async () => {
  const {files,meta,app,history} = fixture(), before = structuredClone(meta.get(files[0].path));
  const open = () => { const m = new TaskInspector(app, files[0] as any, fields, history, false, () => {}, () => {}); m.open(); return m; };
  let m = open(); await invoke(m.contentEl, '+5 min'); assert.deepEqual(meta.get(files[0].path), before);
  await invoke(m.contentEl, 'Discard changes'); assert.deepEqual(meta.get(files[0].path), before);
  m = open(); await invoke(m.contentEl, '+5 min'); await invoke(m.contentEl, 'Save');
  assert.equal(meta.get(files[0].path).begin, '2026-11-26T18:00:00-07:00');
  m = open(); assert.equal(m.contentEl.querySelector('input')!.value, '2026-11-26T18:00'); m.close();
  await history.undo(); assert.deepEqual(meta.get(files[0].path), before);
});

test('locked inspector disables writes; custom lock key and exact off-grid values survive', async () => {
  const {files,meta,app,history} = fixture(); const fm = meta.get(files[0].path);
  fm.begin = '2026-11-26T17:55:13-07:00'; fm.finish = '2026-11-26T18:00:17-07:00';
  let m = new TaskInspector(app, files[0] as any, fields, history, true, () => {}, () => {}); m.open();
  assert.ok(button(m.contentEl, 'Save').disabled); assert.ok(button(m.contentEl, '+5 min').disabled); m.close();
  m = new TaskInspector(app, files[0] as any, fields, history, false, () => {}, () => {}); m.open();
  await invoke(m.contentEl, 'Save'); assert.equal(fm.begin, '2026-11-26T17:55:13-07:00'); assert.equal(fm.finish, '2026-11-26T18:00:17-07:00'); assert.equal(history.canUndo, false);
  fm.frozen = true; m = new TaskInspector(app, files[0] as any, {...fields, locked: 'frozen'}, history, false, () => {}, () => {}); m.open(); assert.ok(button(m.contentEl, 'Save').disabled); m.close();
});

test('mobile dependency picker handles duplicate labels, multiple predecessors, inverse links and mapped writes without shifting dates', async () => {
  const {files,meta,app,history} = fixture();
  const m = new TaskInspector(app, files[2] as any, fields, history, false, () => {}, () => {}); m.open();
  await invoke(m.contentEl, 'Add predecessor…'); const picker: any = Modal.opened.at(-1);
  assert.ok(picker instanceof TaskPicker); assert.deepEqual(picker.getItems(), [files[1]]);
  picker.onChooseItem(files[1]); picker.close(); await invoke(m.contentEl, 'Save');
  assert.deepEqual(meta.get(files[2].path).Prerequisites, ['[[Tasks/a]]', '[[Tasks/b]]']);
  assert.equal(meta.get(files[2].path).begin, '2026-11-26T17:55:00-07:00');
  assert.equal(meta.get(files[2].path)['blocked-by'], undefined);
  const source = new TaskInspector(app, files[0] as any, fields, history, false, () => {}, () => {}); source.open();
  assert.match(source.contentEl.textContent!, /Blocking.*Bake.*Bake/s); source.close();
  await history.undo(); assert.deepEqual(meta.get(files[2].path).Prerequisites, ['[[Tasks/a]]']);
});

test('five-minute bar keeps its true width and starts its overflowing label inside the bar', () => {
  const { app } = fixture(); const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const parent = document.createElement('div'); document.body.append(parent); parent.append(svg);
  const renderer = new BarRenderer(svg, app, parent); const task = entry('Tasks/a.md', '2026-11-26T17:55', '2026-11-26T18:00');
  let selected: any; renderer.inspect = e => selected = e; renderer.render([task], () => 10);
  assert.equal(svg.querySelector('.sabidurian-bar')!.getAttribute('width'), '5');
  assert.equal(svg.querySelector('.sabidurian-bar-label-flow')!.textContent, 'Rest · Gratin');
  assert.equal(Number(svg.querySelector('.sabidurian-bar-label-flow')!.getAttribute('x')), task.x + task.width / 2);
  assert.ok(Number(svg.querySelector('.sabidurian-task-hit')!.getAttribute('width')) >= 44);
  svg.querySelector('.sabidurian-bar-group')!.dispatchEvent(new win.MouseEvent('click', {bubbles: true}) as any);
  assert.equal(selected.file.path, 'Tasks/a.md'); renderer.destroy(); parent.remove();
});

test('arrows cross groups, deduplicate predecessors, preserve overlaps and hide absent/collapsed endpoints', () => {
  const {app} = fixture(); const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const a = entry('Tasks/a.md', '2026-11-26T17:25', '2026-11-26T17:55', [], 'Alex');
  const b = entry('Tasks/b.md', '2026-11-26T17:45', '2026-11-26T18:00', [], 'Jordan'); b.row = 1;
  const c = entry('Tasks/c.md', '2026-11-26T17:55', '2026-11-26T18:00', [a.file.path, b.file.path, a.file.path], 'Maya'); c.row = 2;
  const renderer = new ArrowRenderer(svg, app); renderer.locked = true;
  assert.deepEqual(renderer.render([a,b,c], n => n*44).map(e => e.satisfied), [true,false]);
  assert.equal(svg.querySelectorAll('.sabidurian-arrow-group').length, 2);
  assert.equal(renderer.render([a,c], n => n*44).length, 1);
  a.row = -1; assert.equal(renderer.render([a,c], n => n*44).length, 0);
  assert.deepEqual(c.dependencies, [a.file.path,b.file.path,a.file.path]); renderer.destroy();
});

test('saved configuration reopens property/formula labels, ordered extras and unambiguous dependencies', () => {
  const {files,meta,app} = fixture();
  let saved: any = {labelProp:'note.Step',barDisplayProp1:'note.Dish',timeZone:zone,snapMinutes:5,tickMinutes:15,oneTaskPerRow:true,groupOrder:['Alex','Jordan','Maya']};
  const parse = () => {
    const view: any = Object.create(SabidurianView.prototype); view.plugin = {app,settings:{}}; view.timeZone = saved.timeZone;
    view.config = {get:(k:string)=>saved[k],getAsPropertyId:(k:string)=>saved[k]};
    const rows = files.map(file=>({file,getValue:(id:string)=>id==='formula.Label' ? 'Full formula label' : meta.get(file.path)[id.replace(/^note\./,'')]}));
    return view.parseEntries(rows,'note.begin','note.finish',null,'Prerequisites');
  };
  const initial = parse(); saved = JSON.parse(JSON.stringify(saved)); const reopened = parse();
  assert.deepEqual(reopened, initial); assert.equal(reopened[0].displayLabel, 'Rest · Gratin');
  assert.equal(reopened[1].file.path, 'Tasks/b.md'); assert.equal(reopened[2].file.path, 'Tasks/c.md');
  assert.deepEqual(reopened[2].dependencies, ['Tasks/a.md']);
  saved.labelProp = 'formula.Label'; assert.equal(parse()[0].displayLabel, 'Full formula label · Gratin');
});

test('mouse events move a five-minute task through shared persistence; synthetic touch mouse events cannot reschedule', async () => {
  const {app,history,files,meta} = fixture(); const parent = document.createElement('div'); document.body.append(parent);
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); parent.append(svg);
  const task = entry(files[0].path, '2026-11-26T17:55','2026-11-26T18:00');
  const scale = new NumericAxis(axis('2026-11-26T17:00'),axis('2026-11-26T19:00'),1200);
  task.x = scale.yearToPixel(task.startYear); task.width = scale.yearToPixel(task.endYear)-task.x;
  const bars = new BarRenderer(svg,app,parent); bars.render([task],()=>10);
  const drag = new DragManager(svg,parent,app,scale,DayScale); drag.scheduling = new Scheduling(5,zone);
  drag.persist = (e,s,t) => history.patch(files[0],{begin:iso(s),finish:iso(t)}); drag.attachToBarGroups([task],()=>10);
  const group = svg.querySelector('.sabidurian-bar-group')!; const startX=task.x+task.width/2;
  const event = (type:string,x:number) => new win.MouseEvent(type,{clientX:x,clientY:20,bubbles:true,button:0});
  const touchMouse = event('mousedown',startX); Object.defineProperty(touchMouse,'sourceCapabilities',{value:{firesTouchEvents:true}});
  group.dispatchEvent(touchMouse as any); document.dispatchEvent(event('mousemove',startX+50) as any); document.dispatchEvent(event('mouseup',startX+50) as any);
  assert.equal(history.canUndo,false);
  group.dispatchEvent(event('mousedown',startX) as any); document.dispatchEvent(event('mousemove',startX+50) as any); document.dispatchEvent(event('mouseup',startX+50) as any);
  await new Promise(resolve=>setTimeout(resolve,0)); assert.equal(meta.get(files[0].path).begin,'2026-11-26T18:00:00-07:00');
  await history.undo(); assert.equal(meta.get(files[0].path).begin,'2026-11-26T17:55:00-07:00'); drag.destroy(); bars.destroy(); parent.remove();
});

test('creation undo guards subsequent edits and uses recoverable removal', async () => {
  const history = new EditHistory(async()=>{}); let content='original', trashed=false;
  history.recordCreation({},content,async()=>content,async()=>{trashed=true;}); content='edited';
  await assert.rejects(history.undo(),/modified/); assert.equal(trashed,false);
  content='original'; await history.undo(); assert.equal(trashed,true);
});

test('hour headers retain day context across midnight and horizontal scrolling', () => {
  const parent = document.createElement('div');
  const start = axis('2026-11-26T23:00'), end = axis('2026-11-27T02:00');
  const scale = new NumericAxis(start,end,1200);
  const header = new HeaderRenderer(parent); header.render(DayScale.getColumnBoundaries(start,end,15),scale);
  assert.equal(parent.querySelector('.sabidurian-header-context')!.textContent,'Thursday, November 26, 2026');
  header.setScrollLeft(scale.yearToPixel(axis('2026-11-27T01:00')));
  assert.equal(parent.querySelector('.sabidurian-header-context')!.textContent,'Friday, November 27, 2026');
  assert.match(parent.querySelector('.sabidurian-header-tier-top')!.textContent!,/1 AM/);
});

test('group controls stay at the viewport edge and remain keyboard-accessible', () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  const headers = new GroupHeaderRenderer(svg); let chosen=''; headers.setToggleCallback(name=>chosen=name);
  headers.render([{name:'Alex',entries:[],collapsed:false,headerY:0,totalHeight:44}],1200);
  headers.setScrollLeft(800);
  assert.equal(svg.querySelector('.sabidurian-group-name')!.getAttribute('transform'),'translate(800, 0)');
  const group=svg.querySelector('[role="button"]')!; assert.equal(group.getAttribute('aria-expanded'),'true');
  group.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}) as any); assert.equal(chosen,'Alex'); headers.destroy();
});


test('overflowing property badges keep their order, colors and hit area without changing duration', () => {
  const { app } = fixture(); const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const parent = document.createElement('div'); document.body.append(parent); parent.append(svg);
  const renderer = new BarRenderer(svg, app, parent);
  renderer.setDisplayProps(['Oven Temp', 'Empty', 'Dish'], 80, true);
  renderer.propertyColors = { 'Oven Temp': { '400': 'yellow' }, Dish: { Gratin: 'orange' } };
  const task = entry('Tasks/a.md', '2026-11-26T17:55', '2026-11-26T18:00');
  task.properties = { 'Oven Temp': '400', Dish: 'Gratin', Empty: '' };
  renderer.render([task], () => 10);
  const badges = Array.from(svg.querySelectorAll<SVGGElement>('.sabidurian-property-badge'));
  assert.deepEqual(badges.map(b => [b.dataset.property, b.textContent, b.dataset.sabidurianColor]), [['Oven Temp', '400', 'yellow'], ['Dish', 'Gratin', 'orange']]);
  assert.equal(svg.querySelector('.sabidurian-bar')!.getAttribute('width'), '5');
  const last = badges.at(-1)!.querySelector('rect')!;
  const labelEnd = Number(last.getAttribute('x')) + Number(last.getAttribute('width'));
  assert.ok(labelEnd > task.x + task.width);
  assert.ok(Number(svg.querySelector('.sabidurian-task-hit')!.getAttribute('width')) >= labelEnd - task.x);
  renderer.destroy(); parent.remove();
});
