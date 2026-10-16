// Explicit disposable-server acceptance. Run as linuxpanel after root installation.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrivilegedActionClient} from '../platform/privileged/client.js';
if(process.getuid?.()===0)throw Error('Run acceptance as the ordinary panel service identity');
const client=new PrivilegedActionClient({socketPath:process.env.PANEL_PRIVILEGED_SOCKET || '/run/linux-panel-privileged/executor.sock'});
const call=(name,input)=>client.execute({id:'files.'+name,privileged:{channels:['web']}},input,
  {authenticated:true,userId:'operator-acceptance',channel:'web'});
for(const parent of ['/etc','/root']){
  const path=parent+'/.linux-panel-acceptance-'+randomUUID();let created=false;
  try{
    await call('create',{path,type:'directory'});created=true;
    const file=path+'/note';await call('upload',{path:file,contentBase64:Buffer.from('fixture').toString('base64')});
    const original=await call('read',{path:file});
    await call('write',{path:file,content:'root-channel-verified',revision:original.revision});
    await assert.rejects(call('write',{path:file,content:'stale',revision:original.revision}),{statusCode:409});
    await call('chown',{path:file,owner:'nobody',group:'nogroup'});
    await call('chmod',{path:file,mode:'0600'});
    const result=await call('list',{path});assert.equal(result.accessMode,'root');assert.equal(result.writeAccess,'allowed');
    assert.equal(result.entries[0].permissions,'0600');assert.equal(result.entries[0].owner,'nobody:nogroup');
    assert.equal((await call('read',{path:file})).content,'root-channel-verified');
    await call('chown',{path:file,owner:'0',group:'0'});
    await call('rename',{path:file,newPath:path+'/renamed'});
  }finally{if(created)await call('delete',{path});}
}
console.log('PASS ordinary service identity -> root executor: /etc and /root temporary file operations, mode/owner, conflicts and cleanup');
