import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../apps/api/src/create-app.js';
import {StateStore} from '../platform/state-store.js';
import {AuthService} from '../platform/auth/service.js';
import {ActionRegistry} from '../core/action-registry.js';
import {ModuleManager} from '../core/module-manager.js';
import {OAuthStore,secret} from '../extensions/mcp/oauth-store.js';
import {setMcpPolicy} from '../platform/mcp-policy.js';

function parseRPC(text){
  const events=text.split('\n').filter(line=>line.startsWith('data:'));
  return JSON.parse(events.length?events.at(-1).slice(5):text);
}
test('MCP advertises original nested input schema and forwards validated arguments unchanged',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-mcp-inputs-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const modulesPath=join(folder,'modules'),modulePath=join(modulesPath,'fixture');
  await mkdir(modulePath,{recursive:true});
  await writeFile(join(folder,'package.json'),'{"type":"module"}');
  await writeFile(join(modulePath,'manifest.json'),JSON.stringify({id:'fixture',name:'Fixture',version:'0.1.0',entry:'./index.js',dependencies:[]}));
  const schema={type:'object',required:['message','options'],additionalProperties:false,properties:{
    message:{type:'string',minLength:1,maxLength:20},times:{type:'integer',minimum:1,maximum:3},
    options:{type:'object',additionalProperties:false,required:['flags'],properties:{
      flags:{type:'array',items:{type:'boolean'},minItems:1,maxItems:3},mode:{type:'string',enum:['a','b']}
    }}
  }};
  await writeFile(join(modulePath,'index.js'),
    "export function setup({actions,moduleId}){actions.register(moduleId,{id:'fixture.echo',title:'Echo',description:'Input contract fixture',kind:'read',permission:'fixture:read',exposure:{web:true,mcp:true},inputSchema:"+JSON.stringify(schema)+",outputSchema:"+JSON.stringify(schema)+",execute:async input=>input});}");
  const statePath=join(folder,'state.json'),store=new StateStore(statePath),auth=new AuthService(store);
  const user=await auth.bootstrap('admin','fixture long password for testing');
  const registry=new ActionRegistry();await new ModuleManager(modulesPath,registry).loadAll();
  await setMcpPolicy(store,registry,{enabled:true,registrationEnabled:true},user.id);
  const resource='http://127.0.0.1:4188/mcp',oauth=new OAuthStore(store,registry,resource);
  const client=await oauth.register({client_name:'Fixture',redirect_uris:['https://client.example/cb']});
  const grant=await oauth.createGrant(client.id,user.id,['fixture:read'],resource),access=secret();
  await oauth.saveToken({accessToken:access,accessTokenExpiresAt:new Date(Date.now()+3600000),refreshToken:secret(),
    refreshTokenExpiresAt:new Date(Date.now()+7200000),scope:['fixture:read']},await oauth.client(client.id),
    {id:user.id,grantId:grant.id,resource});
  const app=await createApp({root:process.cwd(),statePath,modulesPath,production:false});
  await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
  const rpc=async method=>parseRPC(await (await fetch('http://127.0.0.1:'+app.server.address().port+'/mcp',{
    method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+access},
    body:JSON.stringify({jsonrpc:'2.0',id:1,...method})})).text());
  const found=(await rpc({method:'tools/list'})).result.tools.find(tool=>tool.name==='fixture.echo');
  assert.deepEqual(found.inputSchema.required,schema.required);
  assert.deepEqual(found.inputSchema.properties,schema.properties);
  const input={message:'fixture',times:2,options:{flags:[true,false],mode:'b'}};
  const result=await rpc({method:'tools/call',params:{name:'fixture.echo',arguments:input}});
  assert.deepEqual(result.result.structuredContent,input);
  for(const bad of [{},{...input,times:'2'},{...input,times:4},{...input,extra:true},
    {...input,options:{flags:['x']}},{...input,options:{flags:[],mode:'c'}}]){
    const rejected=await rpc({method:'tools/call',params:{name:'fixture.echo',arguments:bad}});
    assert.ok(rejected.error || rejected.result?.isError,'invalid input must not execute successfully');
  }
  const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-panel-client':'web'},
    payload:{username:'admin',password:'fixture long password for testing'}});
  const cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-panel-csrf':login.json().csrf};
  const web=await app.inject({method:'POST',url:'/api/actions/fixture.echo/execute',headers,payload:{input}});
  assert.equal(web.statusCode,200);assert.deepEqual(web.json().result,input);
  assert.equal((await app.inject({method:'POST',url:'/api/actions/fixture.echo/execute',headers,payload:{input:{...input,extra:true}}})).statusCode,400);
});
