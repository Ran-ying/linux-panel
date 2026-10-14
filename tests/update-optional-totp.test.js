import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as cb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthService } from '../platform/auth/service.js';
import { StateStore } from '../platform/state-store.js';
import { totp } from '../platform/auth/totp.js';
import { createUpdateController } from '../extensions/mcp/update-controller.js';
import { setMcpPolicy } from '../platform/mcp-policy.js';
import { ActionRegistry } from '../core/action-registry.js';

const execFile=promisify(cb);
const git=async (...args)=>(await execFile('git',args,{env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();
const password='high-entropy-local-test-password-12345';

test('TOTP is opt-in for password step-up; enabling it upgrades the requirement',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lp-optional-totp-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const auth=new AuthService(new StateStore(join(dir,'state.json')));
  await auth.bootstrap('admin',password);
  const login=await auth.login('admin',password,'127.0.0.1');
  const identity=await auth.authenticate(login.token);
  await assert.rejects(auth.verifyStepUp(identity,'bad',undefined),{statusCode:403});
  await auth.verifyStepUp(identity,password,undefined);
  const pending=await auth.beginTotp(identity,password);
  const counter=Math.floor(Date.now()/30000);
  await auth.enableTotp(identity,totp(pending.secret,counter));
  await assert.rejects(auth.verifyStepUp(identity,password,undefined),{statusCode:403});
  await assert.rejects(auth.verifyStepUp(identity,password,'000000'),{statusCode:403});
  // Enabling a second factor also revokes prior OAuth grants: see OAuth suite.
  const fresh=await auth.authenticate(login.token);
  await assert.rejects(auth.verifyStepUp(fresh,password,undefined),{statusCode:403});
  await auth.store.mutate(state=>{state.users[0].totp.lastCounter=-1;});
  await auth.verifyStepUp(fresh,password,totp(pending.secret,Math.floor(Date.now()/30000)));
});
test('MCP update proposal still requires Web password when TOTP is off',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lp-password-update-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const remote=join(dir,'remote.git'),checkout=join(dir,'checkout'),other=join(dir,'other');
  await git('init','--bare',remote);
  await git('clone',remote,checkout);
  await git('-C',checkout,'switch','-c','main');
  await git('-C',checkout,'config','user.name','test');
  await git('-C',checkout,'config','user.email','test@example.invalid');
  await git('-C',checkout,'commit','--allow-empty','-m','original');
  await git('-C',checkout,'push','-u','origin','main');
  const from=await git('-C',checkout,'rev-parse','HEAD');
  await git('clone','-b','main',remote,other);
  await git('-C',other,'config','user.name','test');
  await git('-C',other,'config','user.email','test@example.invalid');
  await git('-C',other,'commit','--allow-empty','-m','update');
  await git('-C',other,'push','origin','main');
  const target=await git('-C',other,'rev-parse','HEAD');
  const store=new StateStore(join(dir,'private.json')),auth=new AuthService(store);
  await auth.bootstrap('admin',password);
  const login=await auth.login('admin',password,'127.0.0.1');
  const identity=await auth.authenticate(login.token);
  await setMcpPolicy(store,new ActionRegistry(),
    {enabled:true,registrationEnabled:false,allowUpdates:true,tools:{}},identity.user.id);
  const marker=join(dir,'trigger');
  const update=createUpdateController({store,auth,root:checkout,enabled:true,
    triggerPath:marker,resultPath:join(dir,'result')});
  const proposed=await update.request({userId:identity.user.id,clientId:'client',targetSha:target});
  assert.equal(proposed.status,'approval_required');
  assert.equal(proposed.from,from);
  assert.equal((await auth.totpStatus(identity)).enabled,false);
  await assert.rejects(update.approve({identity,id:proposed.id,password:'incorrect'}),{statusCode:403});
  const approved=await update.approve({identity,id:proposed.id,password});
  assert.equal(approved.status,'queued');
  assert.equal(await readFile(marker,'utf8'),`id=${proposed.id}\nsha=${target}\n`);
  assert.equal(await git('-C',checkout,'rev-parse','HEAD'),from,'MCP approval cannot directly perform a git update');
});
