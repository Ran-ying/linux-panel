import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/create-app.js';
import { AuthService } from '../platform/auth/service.js';
import { StateStore } from '../platform/state-store.js';

test('MCP settings are session and CSRF protected; /mcp remains fail-closed', async t => {
  const root = process.cwd();
  const folder = await mkdtemp(join(tmpdir(), 'linuxpanel-ext-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const statePath = join(folder, 'panel-state.json');
  const auth = new AuthService(new StateStore(statePath));
  await auth.bootstrap('admin', 'a very long and safe password for testing');
  const app = await createApp({ root, statePath, modulesPath: join(root,'modules'), production:false });
  t.after(() => app.close());
  assert.equal((await app.inject('/api/extensions/mcp/settings')).statusCode,401);
  const login = await app.inject({
    method:'POST',url:'/api/auth/login',headers:{'x-panel-client':'web'},
    payload:{username:'admin',password:'a very long and safe password for testing'}
  });
  assert.equal(login.statusCode,200);
  const cookie=login.headers['set-cookie'].split(';')[0],csrf=login.json().csrf;
  const target='/api/extensions/mcp/settings';
  const loaded=await app.inject({url:target,headers:{cookie}});
  assert.equal(loaded.statusCode,200);
  assert.equal(loaded.json().policy.enabled,false);
  assert.equal(loaded.json().tools.length,5);
  assert.ok(loaded.json().tools.some(tool=>tool.id==='panel.update.status'));
  assert.equal(loaded.json().policy.tools['panel.update.status'],undefined);
  const policy={enabled:true,registrationEnabled:true,tools:{'system.info':true,'system.resources':true}};
  assert.equal((await app.inject({method:'PUT',url:target,headers:{cookie},payload:policy})).statusCode,403);
  assert.equal((await app.inject({method:'PUT',url:target,headers:{cookie,'x-panel-csrf':csrf},
    payload:{enabled:true,registrationEnabled:true,tools:{'service.hack':true}}})).statusCode,400);
  assert.equal((await app.inject({method:'PUT',url:target,headers:{cookie,'x-panel-csrf':csrf},
    payload:policy})).statusCode,200);
  const enabled=await app.inject({url:target,headers:{cookie}});
  assert.deepEqual(enabled.json().policy.tools,{},
    'legacy per-action selections are discarded');
  const unauthenticated=await app.inject({method:'POST',url:'/mcp',
    headers:{'content-type':'application/json','accept':'application/json, text/event-stream'},
    payload:{jsonrpc:'2.0',id:1,method:'tools/list'}});
  assert.equal(unauthenticated.statusCode,401);
  assert.ok(!JSON.stringify(unauthenticated.json()).includes('system.info'));
  await app.close();
  const restarted=await createApp({root,statePath,modulesPath:join(root,'modules'),production:false});
  t.after(()=>restarted.close());
  assert.equal((await restarted.inject({method:'POST',url:'/mcp',headers:{'content-type':'application/json'},
    payload:{jsonrpc:'2.0',id:1,method:'tools/list'}})).statusCode,401);
  assert.deepEqual((await restarted.inject({url:target,headers:{cookie}})).json().policy.tools,{});
});
