import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectNginxSites,parseNginxDirectives,checkNginx} from '../platform/privileged/nginx-operations.js';
import {NGINX_CONTRACTS} from '../platform/privileged/nginx-contracts.js';
import {createPrivilegedHandlers} from '../platform/privileged/handlers.js';
import {dispatchPrivileged} from '../platform/privileged/server.js';
import {ActionRegistry} from '../core/action-registry.js';
import {ActionEngine} from '../core/action-engine.js';
import {setup} from '../modules/nginx/index.js';

test('Nginx site discovery: available, enabled symlink, standalone and conf.d',async t=>{
  const root=await mkdtemp(join(tmpdir(),'nginx-site-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const dir of ['sites-enabled','sites-available','conf.d'])await mkdir(join(root,dir));
  await writeFile(join(root,'sites-available','alpha'),'server {\n# listen 99;\nlisten 443 ssl;\nserver_name example.test www.example.test;\n}');
  await writeFile(join(root,'sites-available','unused'),'server { server_name unused.test; }');
  await symlink('../sites-available/alpha',join(root,'sites-enabled','alpha'));
  await writeFile(join(root,'sites-enabled','standalone'),'server {\n server_name extra.test;\n}');
  await writeFile(join(root,'conf.d','extra.conf'),'server {\nlisten 8080;\n}');
  await writeFile(join(root,'conf.d','ignored.txt'),'listen 1234;');
  const result=await collectNginxSites({root});
  assert.equal(result.count,4);
  assert.equal(result.enabledCount,3);
  assert.equal(result.sites.find(s=>s.name==='alpha').enabled,'启用链接');
  assert.match(result.sites.find(s=>s.name==='alpha').serverNames,/example\.test/);
  assert.equal(result.sites.find(s=>s.name==='unused').enabled,'未启用');
  assert.equal(result.sites.find(s=>s.name==='extra.conf').enabled,'配置候选');
  assert.ok(result.sites.every(site=>!Object.hasOwn(site,'content')));
  assert.deepEqual(result.warnings,[]);
});

test('Nginx inventory rejects root symlinks outside configured tree and oversized files',async t=>{
  const root=await mkdtemp(join(tmpdir(),'nginx-bounds-'));
  const outside=await mkdtemp(join(tmpdir(),'nginx-outside-'));
  t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});});
  await mkdir(join(root,'sites-available'));
  await writeFile(join(outside,'secret'),'server_name secret.test;');
  await symlink(join(outside,'secret'),join(root,'sites-available','escape'));
  await writeFile(join(root,'sites-available','large'),'x'.repeat(256*1024+1));
  const result=await collectNginxSites({root});
  assert.equal(result.count,0);
  assert.ok(result.warnings.some(w=>w.includes('已跳过')));
  assert.ok(result.warnings.some(w=>w.includes('小文件')));
  assert.equal((await collectNginxSites({root:join(root,'no-such-dir')})).count,0);
});

test('Nginx directive summary is advisory and ignores unquoted comments',()=>{
  const parsed=parseNginxDirectives('server {\n # listen 999;\n server_name one.test two.test; # server_name bad.test;\n listen [::]:443 ssl;\n}');
  assert.equal(parsed.serverNames,'one.test, two.test');
  assert.equal(parsed.listens,'[::]:443, ssl');
});

test('Nginx config test uses fixed argv and reports failures without throwing',async()=>{
  const success=await checkNginx({runner:async(command,args)=>{assert.equal(command,'/usr/sbin/nginx');assert.deepEqual(args,['-t']);return {stdout:'',stderr:'syntax ok'};}});
  assert.equal(success.ok,true);
  const failed=await checkNginx({runner:async()=>{throw Object.assign(new Error('failure'),{code:1,stderr:'permission denied'});}});
  assert.equal(failed.ok,false);assert.match(failed.output,/permission denied/);
  const missing=await checkNginx({runner:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});}});
  assert.equal(missing.status,'Nginx 未安装');
});

test('Nginx root handler has strict empty schemas and read MCP never elevates',async()=>{
  const handlers=createPrivilegedHandlers({privileged:false});
  for(const key of ['sites','check']){
    assert.ok(handlers.has('nginx.'+key));
    assert.equal(NGINX_CONTRACTS[key].inputSchema.additionalProperties,false);
    await assert.rejects(dispatchPrivileged({version:1,channel:'web',action:'nginx.'+key,input:{command:'cat /etc/shadow'}},handlers),{statusCode:400});
    await assert.rejects(dispatchPrivileged({version:1,channel:'mcp',action:'nginx.'+key,input:{}},handlers),{statusCode:403});
  }
  const registry=new ActionRegistry();
  await setup({actions:registry,moduleId:'nginx'});
  const calls=[];
  const engine=new ActionEngine(registry,{privilegedClient:{enabled:true,execute:async(action)=>{calls.push(action.id);return action.id==='nginx.sites'
    ?{source:'fixture',count:0,enabledCount:0,sites:[],warnings:[]}
    :{ok:true,status:'pass',exitCode:0,output:'',identity:'root'};}}});
  const context={authenticated:true,userId:'fixture',channel:'web'};
  assert.equal((await engine.run('nginx.sites',{},'web',context)).result.count,0);
  assert.deepEqual(calls,['nginx.sites']);
  assert.equal(registry.get('nginx.check').exposure.mcp,true);
});
