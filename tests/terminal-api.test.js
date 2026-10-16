import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../apps/api/src/create-app.js';
import {StateStore} from '../platform/state-store.js';
import {AuthService} from '../platform/auth/service.js';

test('terminal routes require session, Origin/CSRF and execute a validated command',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-terminal-api-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const statePath=join(folder,'state.json');
  await new AuthService(new StateStore(statePath)).bootstrap('admin','terminal test password long');
  const app=await createApp({root:process.cwd(),statePath,production:false});t.after(()=>app.close());
  const url='/api/actions/terminal.execute/execute';
  assert.equal((await app.inject({method:'POST',url,payload:{input:{command:'id'}}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/terminal/sessions',payload:{actionId:'terminal.execute'}})).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-panel-client':'web'},
    payload:{username:'admin',password:'terminal test password long'}});
  const cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-panel-csrf':login.json().csrf};
  assert.equal((await app.inject({method:'POST',url,headers:{cookie},payload:{input:{command:'id'}}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/terminal/sessions',headers:{...headers,origin:'https://evil.example'},payload:{actionId:'terminal.execute'}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url,headers,payload:{input:{command:'x',extra:true}}})).statusCode,400);
  if(process.platform!=='linux' || process.getuid?.()===0){
    assert.equal((await app.inject({method:'POST',url,headers,payload:{input:{command:'printf x'}}})).statusCode,503);
    return;
  }
  const result=await app.inject({method:'POST',url,headers,payload:{input:{command:"printf 'api-out\\n'; printf 'api-err\\n' >&2; exit 3"}}});
  assert.equal(result.statusCode,200,result.body);
  assert.equal(result.json().result.stdout,'api-out\n');assert.equal(result.json().result.exitCode,3);
  assert.equal(result.json().raw.command.stderr,'api-err\n');
  const opened=await app.inject({method:'POST',url:'/api/terminal/sessions',headers,payload:{actionId:'terminal.execute'}});
  assert.equal(opened.statusCode,200,opened.body);
  const id=opened.json().id;
  assert.equal((await app.inject({method:'POST',url:'/api/terminal/sessions/'+id+'/input',headers:{cookie},payload:{data:'x'}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/terminal/sessions/'+id+'/output',headers:{cookie}})).statusCode,200);
  assert.equal((await app.inject({method:'DELETE',url:'/api/terminal/sessions/'+id,headers})).statusCode,200);
  assert.equal((await app.inject({url:'/api/terminal/sessions/'+id+'/output',headers:{cookie}})).statusCode,404);
});
