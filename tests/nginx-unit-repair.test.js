import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readlink,symlink,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNginxUnitOperations} from '../platform/privileged/nginx-unit-operations.js';
const confirmation='APPLY_REVIEWED_NGINX_UNIT';
const baseUnit='[Unit]\nDescription=Root action executor\n[Service]\n'+
 'User=root\nGroup=root\nExecStart=/opt/node24/bin/node /usr/local/lib/linux-panel-privileged/current/server.js\n'+
 'NoNewPrivileges=true\nRestrictAddressFamilies=AF_UNIX\n'+
 'CapabilityBoundingSet=CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_FOWNER CAP_CHOWN CAP_FSETID\n';
async function fixture(t,{unit=baseUnit}={}){
 const base=await mkdtemp(join(tmpdir(),'nginx-unit-fixture-'));
 t.after(()=>rm(base,{recursive:true,force:true}));
 await writeFile(join(base,'linux-panel-privileged.service'),unit);
 let ready=false,restartCount=0,failReload=false;
 const calls=[];
 const runner=async(command,args)=>{
  calls.push([command,...args]);
  if(args[0]==='daemon-reload'){
    if(failReload)throw Object.assign(new Error('simulated D-Bus rejection'),{stderr:'simulated D-Bus rejection'});
    ready=true;
    return {stdout:''};
  }
  if(args[0]==='show')return {stdout:args[2]==='RestrictAddressFamilies'
    ?ready?'AF_UNIX AF_INET AF_INET6\n':'AF_UNIX\n'
    :ready?'cap_chown cap_dac_override cap_net_bind_service\n':'cap_chown cap_dac_override\n'};
  if(args[0]==='--no-block'){
    restartCount++;return {stdout:''};
  }
  throw Error('Unexpected argv');
 };
 const ops=createNginxUnitOperations({base,requireRoot:false,runner});
 return {base,ops,calls,fail(){failReload=true;},get restartCount(){return restartCount;}};
}
test('fixed unit repair stages only an approved drop-in and separates restart',async t=>{
 const f=await fixture(t);
 assert.equal((await f.ops.repair({mode:'status',confirmation})).ready,false);
 const result=await f.ops.repair({mode:'stage',confirmation});
 assert.equal(result.ready,true);assert.equal(result.restartScheduled,false);
 assert.equal(f.restartCount,0,'no restart during staging');
 const file=join(f.base,'linux-panel-privileged.service.d','50-nginx-config-validation.conf');
 const bytes=await readFile(file,'utf8');
 assert.match(bytes,/^RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6$/m);
 assert.match(bytes,/CAP_NET_BIND_SERVICE/);
 assert.doesNotMatch(bytes,/ExecStart|\/bin\/sh|SYSTEMD_EDITOR/);
 const scheduled=await f.ops.repair({mode:'restart',confirmation});
 assert.equal(scheduled.restartScheduled,true);assert.equal(f.restartCount,1);
 assert.deepEqual(f.calls.filter(e=>e[1]==='--no-block'),[['/bin/systemctl','--no-block','restart','linux-panel-privileged.service']]);
 assert.equal((await f.ops.repair({mode:'stage',confirmation})).ready,true,'staging is idempotent');
});
test('reject unknown unit template and symlinked drop-in, never restart',async t=>{
 const f=await fixture(t,{unit:baseUnit.replace('User=root','User=linuxpanel')});
 await assert.rejects(f.ops.repair({mode:'stage',confirmation}),{statusCode:409});
 assert.equal(f.calls.length,0);
 const g=await fixture(t);
 await assert.rejects(g.ops.repair({mode:'stage',confirmation:'not-approved'}),{statusCode:409});
 const dir=join(g.base,'linux-panel-privileged.service.d');
 const {mkdir}=await import('node:fs/promises');
 await mkdir(dir);
 const outside=join(g.base,'unrelated');
 await writeFile(outside,'trusted unrelated content');
 await symlink(outside,join(dir,'50-nginx-config-validation.conf'));
 await assert.rejects(g.ops.repair({mode:'stage',confirmation}),{statusCode:409});
 assert.equal(await readFile(outside,'utf8'),'trusted unrelated content');
 await assert.rejects(g.ops.repair({mode:'restart',confirmation}),{statusCode:409});
 assert.equal(g.restartCount,0);
});
test('systemd reload rejection restores staged file and original loaded unit',async t=>{
 const f=await fixture(t);f.fail();
 await assert.rejects(f.ops.repair({mode:'stage',confirmation}),{statusCode:503});
 await assert.rejects(stat(join(f.base,'linux-panel-privileged.service.d','50-nginx-config-validation.conf')),{code:'ENOENT'});
 assert.equal(f.restartCount,0);
});
