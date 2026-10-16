// Only run on disposable CI hosts with explicitly installed Nginx + root executor.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrivilegedActionClient} from '../platform/privileged/client.js';
if(process.env.PANEL_NGINX_ACCEPTANCE!=='1'||process.env.CI!=='true')
  throw new Error('Nginx root acceptance is reserved for disposable CI hosts');
if(process.getuid?.()===0)throw new Error('Client must run as ordinary Web identity');
const client=new PrivilegedActionClient({socketPath:'/run/linux-panel-privileged/executor.sock'});
const context={authenticated:true,userId:'disposable-ci-test',channel:'web'};
const call=(name,input={})=>client.execute({id:'nginx.'+name,privileged:{channels:['web']}},input,context);
const name='lp-accept-'+randomUUID().slice(0,8);
let created=false;
try{
  const initial=await call('check');assert.equal(initial.ok,true,initial.output);
  const before=await call('sites');assert.ok(Array.isArray(before.sites));
  const content='server {\n  listen 127.0.0.1:49597;\n  server_name example.invalid;\n  return 204;\n}\n';
  const create=await call('apply',{name,operation:'create',revision:'',content});
  assert.equal(create.ok,true,create.status);created=true;
  const loaded=await call('read',{name});assert.equal(loaded.content,content);
  assert.equal(loaded.enabled,false);
  const enabled=await call('apply',{name,operation:'enable',revision:loaded.revision});
  assert.equal(enabled.ok,true,enabled.status);assert.equal(enabled.reloaded,true);
  let responded=false;
  for(let i=0;i<30;i++){
    try{const response=await fetch('http://127.0.0.1:49597/',{signal:AbortSignal.timeout(1000)});
      if(response.status===204){responded=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(responded,true,'Nginx must serve the activated site after real systemd reload');
  const ready=await call('read',{name});
  assert.equal(ready.enabled,true);
  const bad=await call('apply',{name,operation:'edit',revision:ready.revision,
    content:'server { this_directive_does_not_exist on; }\n'});
  assert.equal(bad.ok,false,'invalid syntax must not remain installed');
  assert.equal((await call('read',{name})).content,content,'failed change must restore original bytes');
  const off=await call('apply',{name,operation:'disable',revision:ready.revision});
  assert.equal(off.ok,true,off.status);
  const after=await call('read',{name});assert.equal(after.enabled,false);
  const remove=await call('apply',{name,operation:'remove',revision:after.revision});
  assert.equal(remove.ok,true,remove.status);created=false;
  console.log('PASS installed root Nginx handler: read, create, activate/reload/HTTP 204, syntax rollback, deactivate, remove');
}finally{
  if(created){
    try{
      const state=await call('read',{name});
      if(state.enabled)await call('apply',{name,operation:'disable',revision:state.revision});
      const now=await call('read',{name});
      await call('apply',{name,operation:'remove',revision:now.revision});
    }catch(error){console.error('Nginx cleanup requires disposable-runner cleanup:',error.message);}
  }
}
