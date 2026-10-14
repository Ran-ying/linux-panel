import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as cb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuthService } from '../platform/auth/service.js';
import { StateStore } from '../platform/state-store.js';
import { totp } from '../platform/auth/totp.js';
import { createUpdateController } from '../extensions/mcp/update-controller.js';
import { setMcpPolicy } from '../platform/mcp-policy.js';
import { ActionRegistry } from '../core/action-registry.js';

const execFile=promisify(cb);
const cmd=async(...args)=>(await execFile('git',args,{env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();

test('updater disabled unless explicitly opted in',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lp-no-update-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new StateStore(join(root,'state.json'));
  const controller=createUpdateController({store,root,auth:new AuthService(store),enabled:false});
  await assert.rejects(controller.request({userId:'u',clientId:'c'}),{statusCode:404});
});
test('MCP may only propose the pinned origin/main SHA; approval requires Web password and optional TOTP',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lp-update-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const bare=join(dir,'remote.git'),repo=join(dir,'checkout');
  await cmd('init','--bare',bare);
  await cmd('clone',bare,repo);
  await cmd('-C',repo,'switch','-c','main');
  await cmd('-C',repo,'config','user.name','test');
  await cmd('-C',repo,'config','user.email','test@example.invalid');
  await cmd('-C',repo,'commit','--allow-empty','-m','initial');
  await cmd('-C',repo,'push','-u','origin','main');
  const initial=await cmd('-C',repo,'rev-parse','HEAD');
  const other=join(dir,'other');
  await cmd('clone','-b','main',bare,other);
  await cmd('-C',other,'config','user.name','test');
  await cmd('-C',other,'config','user.email','test@example.invalid');
  await cmd('-C',other,'commit','--allow-empty','-m','upgrade');
  await cmd('-C',other,'push','origin','main');
  const target=await cmd('-C',other,'rev-parse','HEAD');
  const store=new StateStore(join(dir,'private.json'));
  const auth=new AuthService(store);
  await auth.bootstrap('admin','long-test-password-123!');
  const login=await auth.login('admin','long-test-password-123!','127.0.0.1');
  const identity=await auth.authenticate(login.token);
  const pending=await auth.beginTotp(identity,'long-test-password-123!');
  await auth.enableTotp(identity,totp(pending.secret,Math.floor(Date.now()/30000)));
  await store.mutate(s=>{s.users[0].totp.lastCounter=-1;});
  await setMcpPolicy(store,new ActionRegistry(),{enabled:true,registrationEnabled:false,
    allowUpdates:true,tools:{}},identity.user.id);
  const trigger=join(dir,'trigger'),result=join(dir,'result');
  const ctrl=createUpdateController({store,auth,root:repo,enabled:true,
    triggerPath:trigger,resultPath:result});
  await assert.rejects(ctrl.request({userId:identity.user.id,clientId:'client-test',targetSha:'not-a-sha'}),{statusCode:400});
  const response=await ctrl.request({userId:identity.user.id,clientId:'client-test',targetSha:target});
  assert.deepEqual({from:response.from,target:response.target,status:response.status},
    {from:initial,target,status:'approval_required'});
  await assert.rejects(ctrl.request({userId:identity.user.id,clientId:'client-test'}),{statusCode:409});
  await assert.rejects(ctrl.approve({identity,id:'bogus',password:'long-test-password-123!',code:'000000'}),{statusCode:400});
  await assert.rejects(ctrl.approve({identity,id:response.id,password:'bad',code:'000000'}),{statusCode:403});
  const good=totp(pending.secret,Math.floor(Date.now()/30000));
  const approved=await ctrl.approve({identity,id:response.id,password:'long-test-password-123!',code:good});
  assert.equal(approved.status,'queued');
  assert.equal(await readFile(trigger,'utf8'),'id='+response.id+'\nsha='+target+'\n');
  assert.equal((await ctrl.status()).pending.approved,true);
  await assert.rejects(ctrl.approve({identity,id:response.id,password:'long-test-password-123!',code:good}),{statusCode:409});
  assert.equal(await cmd('-C',repo,'rev-parse','HEAD'),initial,'controller never changes the repository');
  await store.mutate(s=>{s.mcp.policy.allowUpdates=false;s.mcp.policy.enabled=false;});
  assert.equal((await ctrl.status()).pending.approved,true,
    'Web update status remains available when MCP is disabled');
});

test('Web-only cancellation rejects approved/stale proposals and is independent of MCP',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lp-cancel-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new StateStore(join(dir,'state.json'));
  const auth=new AuthService(store);
  await auth.bootstrap('admin','safe test password for cancel');
  const login=await auth.login('admin','safe test password for cancel','127.0.0.1');
  const identity=await auth.authenticate(login.token);
  const ctrl=createUpdateController({store,auth,root:dir,enabled:true,
    triggerPath:join(dir,'trigger'),resultPath:join(dir,'result')});
  const id='f'.repeat(32);
  await store.mutate(s=>{s.updateRequest={id,from:'a'.repeat(40),target:'b'.repeat(40),
    createdAt:new Date().toISOString(),expiresAt:Date.now()+60000,
    userId:identity.user.id,clientId:'web',approved:false};});
  await assert.rejects(ctrl.cancel({identity,id:'not-an-id'}),{statusCode:400});
  await assert.rejects(ctrl.cancel({identity:{user:{id:'someone-else'}},id}),{statusCode:409});
  assert.equal((await ctrl.cancel({identity,id})).status,'cancelled');
  assert.equal((await ctrl.status()).pending,null);
  await assert.rejects(ctrl.cancel({identity,id}),{statusCode:409});
  await store.mutate(s=>{s.updateRequest={id,from:'a'.repeat(40),target:'b'.repeat(40),
    createdAt:new Date().toISOString(),expiresAt:Date.now()+60000,
    userId:identity.user.id,clientId:'web',approved:true};});
  await assert.rejects(ctrl.cancel({identity,id}),{statusCode:409});
});
