import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginUpdater } from '../src/updates/PluginUpdater';
import { UpdateFiles } from '../src/updates/UpdateFiles';
import { RELEASES_URL, RUNTIME_FILES, assetUrl, selectRelease, sha256, downloadBundle, validateManifest, type Bundle } from '../src/updates/releases';
const bytes = (v: string) => new TextEncoder().encode(v).buffer as ArrayBuffer;
const dir = '.custom/plugins/timeline-gantt-view';
class Storage {
  data = new Map<string, ArrayBuffer>(); dirs = new Set<string>(); writes: string[] = [];
  fault?: (p: string) => void;
  async exists(p: string) { return this.data.has(p) || this.dirs.has(p); }
  async mkdir(p: string) { this.dirs.add(p); }
  async readBinary(p: string) { const v = this.data.get(p); if (!v) throw Error('Missing file'); return v.slice(0); }
  async writeBinary(p: string, v: ArrayBuffer) { this.fault?.(p); this.writes.push(p); this.data.set(p,v.slice(0)); }
  async process(p: string, fn: (s: string) => string) { await this.writeBinary(p, bytes(fn(new TextDecoder().decode(await this.readBinary(p))))); }
}
async function fixture() {
  const storage = new Storage();
  const manifest = (version: string) => bytes(JSON.stringify({id:'timeline-gantt-view',name:'Time & Line',version,minAppVersion:'1.10.0',isDesktopOnly:false}));
  const old: Bundle = {'main.js':bytes('old code'),'styles.css':bytes('old css'),'manifest.json':manifest('1.0.1')};
  const bundle: Bundle = {'main.js':bytes('new code'),'styles.css':bytes('new css'),'manifest.json':manifest('1.0.2')};
  for(const f of RUNTIME_FILES) storage.data.set(`${dir}/${f}`,old[f]);
  storage.data.set(`${dir}/data.json`,bytes('{"markers":"keep"}'));
  storage.data.set('Notes/plan.md',bytes('keep notes'));
  const downloads: Record<string,ArrayBuffer> = {...bundle,SHA256SUMS:bytes((await Promise.all(RUNTIME_FILES.map(async f=>`${await sha256(bundle[f])}  ${f}`))).join('\n')+'\n')};
  const release = {tag_name:'1.0.2',draft:false,prerelease:true,published_at:'2026-11-09',assets:Object.entries(downloads).map(([name,b])=>({name,size:b.byteLength,state:'uploaded',browser_download_url:assetUrl('1.0.2',name)}))};
  const calls: string[] = [];
  const request = async (url: string) => { calls.push(url); return {status:200,arrayBuffer:url===RELEASES_URL?bytes(JSON.stringify([release])):downloads[url.split('/').pop()!]}; };
  const files = new UpdateFiles(storage,dir);
  return {storage,old,bundle,downloads,release,request,calls,files};
}
test('accepts only complete releases from this fork, with numeric version ordering',async()=>{
 const f=await fixture();const foreign={...f.release,assets:f.release.assets.map(a=>({...a,browser_download_url:a.browser_download_url.replace('obsidian-time-and-line-planning','evc-team-relay-obsidian')}))};
 assert.equal(selectRelease([foreign,{...f.release,draft:true},{...f.release,tag_name:'9.0.0',assets:[]},f.release],'1.0.1')?.version,'1.0.2');
 assert.equal(selectRelease([foreign],'1.0.1'),undefined);assert.equal(selectRelease([f.release],'1.0.2'),undefined);
});
test('checks automatically without installing, persists preference, and installs only explicitly',async()=>{
 const f=await fixture();const u=new PluginUpdater(f.files,'1.0.1',f.request,()=>true,false,()=>{},()=>100000000);
 assert.equal(await u.initialize(),true);await u.check(false);assert.equal(u.snapshot().release?.version,'1.0.2');
 assert.deepEqual(await f.storage.readBinary(`${dir}/main.js`),f.old['main.js']);
 await u.setAutomatic(false);u.dispose();const next=new PluginUpdater(f.files,'1.0.1',f.request,()=>true,false);await next.initialize();
 assert.equal(next.snapshot().automatic,false);const before=f.calls.length;await next.check(false);assert.equal(f.calls.length,before);
 await next.check();await next.install();assert.equal(next.snapshot().installedVersion,'1.0.2');
 for(const name of RUNTIME_FILES)assert.deepEqual(await f.storage.readBinary(`${dir}/${name}`),f.bundle[name]);
 assert.equal(new TextDecoder().decode(await f.storage.readBinary(`${dir}/data.json`)),'{"markers":"keep"}');
 assert(!f.storage.writes.some(p=>p.endsWith('data.json')||p.startsWith('Notes/')));next.dispose();
});
test('rejects tampered download before writing any runtime file',async()=>{
 const f=await fixture();f.downloads['main.js']=bytes('bad code');
 const u=new PluginUpdater(f.files,'1.0.1',f.request,()=>true,false);await u.initialize();await u.check();await u.install();
 assert(u.snapshot().error);assert.deepEqual(await f.storage.readBinary(`${dir}/main.js`),f.old['main.js']);u.dispose();
});
test('rejects wrong plugin and incompatible desktop/mobile manifests',async()=>{
 const f=await fixture();assert.throws(()=>validateManifest(f.bundle['manifest.json'],'1.0.2',()=>false,false));
 const d=JSON.parse(new TextDecoder().decode(f.bundle['manifest.json']));d.id='team-relay-sync';assert.throws(()=>validateManifest(bytes(JSON.stringify(d)),'1.0.2',()=>true,false));
 d.id='timeline-gantt-view';d.isDesktopOnly=true;assert.throws(()=>validateManifest(bytes(JSON.stringify(d)),'1.0.2',()=>true,true));
});
test('restores prior runtime after a recoverable write failure',async()=>{
 const f=await fixture();let failed=false;f.storage.fault=p=>{if(p===`${dir}/styles.css`&&!failed){failed=true;throw Error('disk error');}};
 await assert.rejects(f.files.install(f.bundle,'1.0.1','1.0.2'),/restored/);
 for(const name of RUNTIME_FILES)assert.deepEqual(await f.storage.readBinary(`${dir}/${name}`),f.old[name]);
});
test('recovers interrupted publication on next launch and requires restart',async()=>{
 const f=await fixture();let crash=false;f.storage.fault=p=>{if(p===`${dir}/styles.css`)crash=true;if(crash)throw Error('unavailable');};
 await assert.rejects(f.files.install(f.bundle,'1.0.1','1.0.2'));f.storage.fault=undefined;
 const u=new PluginUpdater(f.files,'1.0.1',f.request,()=>true,false);assert.equal(await u.initialize(),false);
 for(const name of RUNTIME_FILES)assert.deepEqual(await f.storage.readBinary(`${dir}/${name}`),f.old[name]);u.dispose();
});
test('completed update does not undo a later manual installation',async()=>{
 const f=await fixture();await f.files.install(f.bundle,'1.0.1','1.0.2');
 f.storage.data.set(`${dir}/manifest.json`,bytes(JSON.stringify({id:'timeline-gantt-view',version:'1.0.3'})));f.storage.data.set(`${dir}/main.js`,bytes('manual'));
 assert.deepEqual(await f.files.recover(),{});assert.equal(new TextDecoder().decode(await f.storage.readBinary(`${dir}/main.js`)),'manual');
});
test('download errors leave existing runtime intact',async()=>{
 const f=await fixture();const u=new PluginUpdater(f.files,'1.0.1',async()=>({status:429,arrayBuffer:bytes('')}),()=>true,false);
 await u.initialize();await u.check();assert.match(u.snapshot().error!,/limiting/);assert.deepEqual(await f.storage.readBinary(`${dir}/main.js`),f.old['main.js']);u.dispose();
});
