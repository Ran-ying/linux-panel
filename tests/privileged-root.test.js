// Run as root ONLY in a disposable test host/CI: sudo node --test tests/privileged-root.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startPrivilegedServer} from '../platform/privileged/server.js';
import {PrivilegedActionClient} from '../platform/privileged/client.js';
test('real root executor manages isolated /etc and /root fixtures including mode and ownership',async t=>{
  if(process.getuid?.()!==0 || process.env.PANEL_ROOT_ACCEPTANCE!=='1'){t.skip('explicit disposable root acceptance step');return;}
  const runtime=await fs.mkdtemp('/tmp/panel-root-socket-');t.after(()=>fs.rm(runtime,{recursive:true,force:true}));
  await fs.chown(runtime,0,65534);await fs.chmod(runtime,0o750);
  await fs.copyFile(new URL('../platform/privileged/client.js',import.meta.url),join(runtime,'client.mjs'));
  await fs.copyFile(new URL('../platform/privileged/socket-frame.js',import.meta.url),join(runtime,'socket-frame.js'));
  await fs.copyFile(new URL('../platform/privileged/file-transfer.js',import.meta.url),join(runtime,'file-transfer.js'));
  await fs.chmod(join(runtime,'file-transfer.js'),0o644);
  await fs.chmod(join(runtime,'client.mjs'),0o644);
  await fs.chmod(join(runtime,'socket-frame.js'),0o644);
  await fs.writeFile(join(runtime,'package.json'),'{"type":"module"}\n',{mode:0o644});
  const server=await startPrivilegedServer({socketPath:join(runtime,'executor.sock'),groupId:65534});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const client=new PrivilegedActionClient({socketPath:join(runtime,'executor.sock')});
  const deniedScript='import net from "node:net";const s=net.createConnection('+JSON.stringify(join(runtime,'executor.sock'))+');'+
    's.on("connect",()=>{process.exitCode=1;s.destroy()});s.on("error",e=>{if(e.code!=="EACCES")process.exitCode=1;console.log("DENIED nonmember")});';
  assert.match((await promisify(execFile)('/usr/sbin/runuser',['-u','daemon','--',process.execPath,'--input-type=module','-e',deniedScript],{timeout:10000})).stdout,/DENIED nonmember/);
  const call=(name,input)=>client.execute({id:'files.'+name,privileged:{channels:['web']}},input,{authenticated:true,userId:'acceptance',channel:'web'});
  for(const parent of ['/etc','/root']){
    const folder=await fs.mkdtemp(join(parent,'.linux-panel-acceptance-'));
    try{
      assert.equal((await call('list',{path:folder})).accessMode,'root');
      const dir=join(folder,'child');await call('create',{path:dir,type:'directory'});
      const path=join(dir,'file');await call('upload',{path,contentBase64:Buffer.from('root-fixture').toString('base64')});
      // A different ordinary UID can use the admitted group socket even though
      // it cannot read this root-owned directory itself. No root HTTP process.
      const script='import {PrivilegedActionClient} from '+JSON.stringify('file://'+join(runtime,'client.mjs'))+';'+
        'const c=new PrivilegedActionClient({socketPath:'+JSON.stringify(join(runtime,'executor.sock'))+'});'+
        'const r=await c.execute({id:"files.read",privileged:{channels:["web"]}},{path:'+JSON.stringify(path)+'},{authenticated:true,userId:"fixture",channel:"web"});'+
        'if(r.content!=="root-fixture")process.exit(1);console.log("PASS admitted ordinary identity");';
      const child=await promisify(execFile)('/usr/sbin/runuser',['-u','nobody','--',process.execPath,'--input-type=module','-e',script],{timeout:10000});
      assert.match(child.stdout,/PASS admitted ordinary identity/);
      const original=await call('read',{path});await call('write',{path,content:'root-edited',revision:original.revision});
      await assert.rejects(call('write',{path,content:'stale',revision:original.revision}),{statusCode:409});
      await call('chown',{path,owner:'nobody',group:'nogroup'});
      assert.equal((await fs.stat(path)).uid,65534);assert.equal((await fs.stat(path)).gid,65534);
      await call('chmod',{path,mode:'0600'});assert.equal((await fs.stat(path)).mode & 0o777,0o600);
      // Root may edit a file after ownership has been transferred and preserve it.
      const next=await call('read',{path});await call('write',{path,content:'after-chown',revision:next.revision});
      assert.equal((await fs.stat(path)).uid,65534);
      await call('chown',{path,owner:'0',group:'0'});
      const renamed=join(dir,'renamed');await call('rename',{path,newPath:renamed});
      assert.equal(await fs.readFile(renamed,'utf8'),'after-chown');
      await call('delete',{path:dir});await assert.rejects(fs.stat(dir),{code:'ENOENT'});
    }finally{await fs.rm(folder,{recursive:true,force:true});}
  }
});
