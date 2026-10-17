import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Ajv from 'ajv';
import {NGINX_RECONFIGURE_CONTRACT,createNginxRenewalReconfigure} from '../platform/privileged/nginx-renewal-reconfigure.js';
import {createPrivilegedHandlers} from '../platform/privileged/handlers.js';
import {dispatchPrivileged} from '../platform/privileged/server.js';
import {ActionRegistry} from '../core/action-registry.js';
import {ActionEngine} from '../core/action-engine.js';
import {setup} from '../modules/nginx/index.js';
import {exposedMcpActions,actionAllowed} from '../platform/mcp-policy.js';
const schema=new Ajv({strict:false}).compile(NGINX_RECONFIGURE_CONTRACT.inputSchema);
const fixture='version = 2.9.0\narchive_dir = /tmp/fake\ncert = /tmp/fake.pem\n[renewalparams]\naccount = fake\nauthenticator = standalone\ninstaller = nginx\n';
async function environment(t){
  const root=await mkdtemp(join(tmpdir(),'panel-certbot-migrate-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'test.example.conf');
  await writeFile(path,fixture);
  return {root,path};
}
test('migrate Action validates exact safe cert name, rejects hooks/symlink/non-standalone',async t=>{
  for(const name of ['test.example','vc.rany.ing','a'])assert.equal(schema({name}),true);
  for(const name of ['../etc/passwd','-nginx','a/b','', 'abc;id','../root'])assert.equal(schema({name}),false);
  assert.equal(schema({name:'test.example',command:'sudo sh'}),false);
  const f=await environment(t);
  let ran=0;
  const operation=createNginxRenewalReconfigure({root:f.root,requireRoot:false,run:async()=>{ran++;}});
  await assert.rejects(operation.reconfigure({name:'../escape'}),{statusCode:400});
  await assert.rejects(operation.reconfigure({name:'not-there'}),{statusCode:404});
  await writeFile(f.path,fixture+'pre_hook = /bin/true\n');
  await assert.rejects(operation.reconfigure({name:'test.example'}),{statusCode:409});
  await writeFile(f.path,fixture.replace('standalone','manual'));
  await assert.rejects(operation.reconfigure({name:'test.example'}),{statusCode:409});
  await rm(f.path);
  await symlink('/etc/passwd',f.path);
  await assert.rejects(operation.reconfigure({name:'test.example'}),{statusCode:403});
  assert.equal(ran,0);
});
test('reconfigure uses fixed certbot argv, retains backup and confirms saved authenticator',async t=>{
  const f=await environment(t);let called;
  const runner=async(binary,args,options)=>{
    called={binary,args,options};
    await writeFile(f.path,fixture.replace('authenticator = standalone','authenticator = nginx'));
    return {stdout:'ok',stderr:''};
  };
  const result=await createNginxRenewalReconfigure({root:f.root,requireRoot:false,run:runner})
    .reconfigure({name:'test.example'});
  assert.equal(called.binary,'/usr/bin/certbot');
  assert.deepEqual(called.args,['reconfigure','--cert-name','test.example','--nginx','--non-interactive']);
  assert.equal(called.options.timeout,180000);
  assert.equal(result.ok,true);
  assert.equal(result.before,'standalone');assert.equal(result.after,'nginx');
  const backups=(await readdir(f.root)).filter(name=>name.endsWith('.bak'));
  assert.equal(backups.length,1);
  assert.equal(await readFile(join(f.root,backups[0]),'utf8'),fixture);
  const already=await createNginxRenewalReconfigure({root:f.root,requireRoot:false,run:async()=>{throw Error('should not call')}})
    .reconfigure({name:'test.example'});
  assert.equal(already.ok,true);assert.equal(already.before,'nginx');
});
test('Certbot staging failure returns no success, preserves original renewal configuration',async t=>{
  const f=await environment(t);
  const migrate=createNginxRenewalReconfigure({root:f.root,requireRoot:false,
    run:async()=>{const e=new Error('bad');e.code=1;e.stderr='staging certificate validation failed';throw e;}});
  const result=await migrate.reconfigure({name:'test.example'});
  assert.equal(result.ok,false);
  assert.equal(result.after,'standalone');
  assert.match(result.output,/staging certificate/);
  assert.equal(await readFile(f.path,'utf8'),fixture);
});
test('MCP-only root write admission stays scoped to one preapproved certbot Action',async()=>{
  const handlers=createPrivilegedHandlers({privileged:false});
  assert.equal(handlers.get('nginx.reconfigureRenewal').channels.includes('mcp'),true);
  const malformed=dispatchPrivileged({version:1,channel:'mcp',action:'nginx.reconfigureRenewal',
    input:{name:'../../etc/shadow'}},handlers);
  await assert.rejects(malformed,{statusCode:400});
  await assert.rejects(dispatchPrivileged({version:1,channel:'mcp',action:'nginx.apply',
    input:{name:'test',operation:'delete',revision:''}},handlers),{statusCode:403});
  const registry=new ActionRegistry();await setup({actions:registry,moduleId:'nginx'});
  const action=registry.get('nginx.reconfigureRenewal');
  assert.equal(action.kind,'write');assert.equal(action.exposure.web,false);
  assert.equal(action.privileged.channels.includes('mcp'),true);
  assert.equal(exposedMcpActions(registry).filter(a=>a.kind==='write').map(a=>a.id).join(','),
    'nginx.reconfigureRenewal');
  assert.equal(actionAllowed({mcp:{policy:{enabled:true}}},action),true);
  const noPrivilege=new ActionEngine(registry,{});
  await assert.rejects(noPrivilege.run('nginx.reconfigureRenewal',{name:'test.example'},
    'mcp',{authenticated:true,userId:'owner',channel:'mcp'}),{statusCode:503});
  await assert.rejects(noPrivilege.run('nginx.reconfigureRenewal',{name:'test.example'},
    'web',{authenticated:true,userId:'owner',channel:'web'}),{statusCode:404});
  assert.equal(actionAllowed({mcp:{policy:{enabled:false}}},action),false);
});
