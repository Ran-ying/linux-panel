// Real, bounded self-repair exercise ONLY on disposable GitHub-hosted CI.
import assert from 'node:assert/strict';
import {PrivilegedActionClient} from '../platform/privileged/client.js';
if(process.env.CI!=='true'||process.env.PANEL_NGINX_UNIT_REPAIR_ACCEPTANCE!=='1')
 throw new Error('Only permitted in disposable CI fixture');
if(process.getuid?.()===0)throw new Error('Must request through unprivileged client');
const c=new PrivilegedActionClient({socketPath:'/run/linux-panel-privileged/executor.sock'});
const ctx={authenticated:true,userId:'disposable-unit-acceptance',channel:'web'};
const action=(id,input)=>c.execute({id,privileged:{channels:['web']}},input,ctx);
const confirm='APPLY_REVIEWED_NGINX_UNIT';
// systemd Type=simple can report active before Node re-creates and chowns
// the Unix socket after the deliberately simulated legacy-unit restart.
let initial;
for(let attempt=0;attempt<100;attempt++){
  try{initial=await action('nginx.check',{});break;}
  catch(error){
    if(![503,502].includes(error.statusCode))throw error;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
}
assert.ok(initial,'root socket must be accessible again');
assert.equal(initial.ok,false,'initial Nginx check must be blocked by legacy AF_UNIX unit');
assert.match(initial.output,/Address family not supported by protocol/i);
const status=await action('nginx.repairExecutor',{mode:'status',confirmation:confirm});
assert.equal(status.ready,false);
const staged=await action('nginx.repairExecutor',{mode:'stage',confirmation:confirm});
assert.equal(staged.ready,true);assert.equal(staged.restartScheduled,false);
const duplicate=await action('nginx.repairExecutor',{mode:'stage',confirmation:confirm});
assert.equal(duplicate.ready,true);
try{
  await action('nginx.repairExecutor',{mode:'restart',confirmation:confirm});
}catch(error){
  // The reviewed fixed service is restarting itself and may close its socket
  // before serializing its acknowledgement; verify actual health below.
  console.log('Self-restart closed initial socket:',error.message);
}
let ok=false;
for(let attempt=0;attempt<100;attempt++){
 try{
   const checked=await action('nginx.check',{});
   if(checked.ok){ok=true;break;}
 }catch{}
 await new Promise(resolve=>setTimeout(resolve,100));
}
assert.equal(ok,true,'real systemd self-restart must restore Nginx configuration check');
console.log('PASS root socket -> fixed unit stage, daemon-reload and self-restart -> nginx -t');
