import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, copyFile, appendFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const out=resolve(root,'dist/webkit');await mkdir(out,{recursive:true});
await build({entryPoints:[resolve(root,'tests/webkit/harness.ts')],outfile:resolve(out,'harness.js'),bundle:true,platform:'browser',format:'iife',target:'es2020',sourcemap:true,alias:{obsidian:resolve(root,'tests/webkit/host.ts')}});
await Promise.all(['index.html','host.css'].map(name=>copyFile(resolve(root,'tests/webkit',name),resolve(out,name))));
await copyFile(resolve(root,'styles.css'),resolve(out,'plugin.css'));
const port=Number(process.env.WEBKIT_TEST_PORT||4177);
const names=new Map([['/','index.html'],['/index.html','index.html'],['/harness.js','harness.js'],['/harness.js.map','harness.js.map'],['/host.css','host.css'],['/plugin.css','plugin.css']]);
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  try {
    if(req.method==='POST'&&['/results','/events'].includes(pathname)){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>500000)throw Error('Report too large');}
      const parsed=JSON.parse(body);
      if(pathname==='/results'){await writeFile(resolve(out,'results.json'),JSON.stringify(parsed,null,2)+'\n');console.log(`WebKit results: ${parsed.checks.filter(c=>c.passed).length}/${parsed.checks.length} passed (${parsed.environment.viewport.width}×${parsed.environment.viewport.height})`);}
      else{await appendFile(resolve(out,'events.jsonl'),JSON.stringify(parsed)+'\n');console.log('WebKit event:',parsed.type,parsed.message||parsed.state);}
      res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;
    }
    const file=names.get(pathname);if(!file){res.writeHead(404);res.end('Not found');return;}
    const ext=file.split('.').pop();res.writeHead(200,{'Content-Type':ext==='html'?'text/html':ext==='css'?'text/css':ext==='map'?'application/json':'text/javascript','Cache-Control':'no-store'});res.end(await readFile(resolve(out,file)));
  }catch(error){res.writeHead(500);res.end(String(error));}
});
server.listen(port,'127.0.0.1',()=>console.log(`WebKit harness: http://127.0.0.1:${port}/?run=1\nReports: ${out}/results.json\nStop with Ctrl+C. This serves only the synthetic harness.`));
