// Ephemeral GitHub-hosted Ubuntu acceptance: real HTTP Web + interactive
// OAuth/PKCE + MCP → actual systemd Broker. No production credentials.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';

const origin='http://127.0.0.1:49377';
const callback='https://chatgpt.com/connector_platform_oauth_redirect';
const password=process.env.STAGE_PASSWORD;
const positivePath=process.env.STAGE_POSITIVE_PATH;
const targetSha=process.env.STAGE_TARGET_SHA;
const oldSha=process.env.STAGE_OLD_SHA;
assert.ok(['web','mcp'].includes(positivePath),'Only explicit positive staging scenarios');
assert.match(targetSha??'',/^[a-f0-9]{40}$/,'Staging target must be an exact commit');
assert.match(oldSha??'',/^[a-f0-9]{40}$/,'Staging old revision must be an exact commit');
assert.notEqual(targetSha,oldSha,'Staging positive update must change the revision');
assert.match(password??'',/^[0-9a-f]{64}$/,'Only ephemeral generated admin secret is allowed');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const getText=async(r)=>({response:r,text:await r.text()});
let cookie='',csrf='';
async function req(path,{method='GET',body,headers={},form=false}={}){
  const result=await fetch(origin+path,{method,redirect:'manual',
    signal:AbortSignal.timeout(10000),headers:{
      ...(body?{'content-type':form?'application/x-www-form-urlencoded':'application/json'}:{}),
      ...(cookie?{cookie}:{}),
      ...headers
    },body:body===undefined?undefined:(form?new URLSearchParams(body).toString():JSON.stringify(body))});
  const text=await result.text();
  let json;
  try{json=JSON.parse(text);}catch{}
  return {status:result.status,text,json,headers:result.headers};
}
const write=async(path,body,extra={})=>req(path,{method:'POST',body,
 headers:{origin,'x-panel-csrf':csrf,...extra}});
function ok(r,code=200){assert.equal(r.status,code,JSON.stringify({status:r.status,body:r.text.slice(0,1200)}));return r;}
function note(s){process.stdout.write('[web-mcp-stage] '+s+'\n');}
async function status(){
 const r=ok(await write('/api/actions/panel.update.status/execute',{input:{}}));
 return r.json.result;
}
async function waitResult(id,expected){
 let lastNetworkError;
 for(let i=0;i<240;i++){
   try{
     const s=await status();
     if(s.lastResult?.id===id){
       assert.equal(s.lastResult.status,expected,JSON.stringify(s));
       assert.equal(s.pending,null,'Broker result must clear matching queued request');
       return;
     }
   }catch(e){
     // Fastify deliberately restarts mid-deployment. Never suppress API errors.
     if(e?.name==='AssertionError')throw e;
     lastNetworkError=e;
   }
   await pause(1000);
 }
 throw new Error('Broker result timeout for '+id+(lastNetworkError?': '+lastNetworkError:''));
}
function parseRpc(t){
 const d=t.split('\n').filter(v=>v.startsWith('data:'));
 return JSON.parse(d.length?d.at(-1).slice(5).trim():t);
}
async function rpc(token,method,params){
 const res=await fetch(origin+'/mcp',{method:'POST',
  signal:AbortSignal.timeout(12000),
  headers:{authorization:'Bearer '+token,
    'content-type':'application/json',accept:'application/json, text/event-stream'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})})});
 return {status:res.status,json:parseRpc(await res.text())};
}
async function consent(clientId,scope){
 const verifier=randomBytes(32).toString('base64url');
 const query={client_id:clientId,response_type:'code',redirect_uri:callback,
  code_challenge_method:'S256',
  code_challenge:createHash('sha256').update(verifier).digest('base64url'),
  resource:origin,state:randomBytes(12).toString('hex')};
 if(scope!==undefined)query.scope=scope;
 const url='/oauth/authorize?'+new URLSearchParams(query);
 const page=ok(await req(url));
 if(scope?.includes('panel:update:execute'))
    assert.match(page.text,/panel:update:execute/);
 if(scope===undefined)
    assert.match(page.text,/<code>panel:update:execute<\/code>/);
 const post=ok(await req('/oauth/authorize',{method:'POST',
  body:{...query,csrf,decision:'approve'},form:true,headers:{origin}}),302);
 const returnUrl=new URL(post.headers.get('location'));
 assert.equal(returnUrl.origin,'https://chatgpt.com');
 assert.equal(returnUrl.searchParams.get('state'),query.state);
 const code=returnUrl.searchParams.get('code');
 assert.ok(code);
 const token=ok(await req('/oauth/token',{method:'POST',form:true,
  body:{client_id:clientId,grant_type:'authorization_code',
    redirect_uri:callback,code,code_verifier:verifier,resource:origin}}));
 assert.ok(token.json.access_token);
 return token.json.access_token;
}

note('Live Web login, cookies and CSRF');
const login=ok(await req('/api/auth/login',{method:'POST',
 body:{username:'staging',password},headers:{origin,'x-panel-client':'web'}}));
cookie=login.headers.get('set-cookie')?.split(';')[0]??'';
csrf=login.json.csrf;
assert.ok(cookie&&csrf);
const live=ok(await req('/api/extensions/mcp/settings'));
assert.ok(live.json);
const policy={
 enabled:true,registrationEnabled:true,allowUpdates:true,allowDirectUpdates:true,
 tools:{'system.info':true,'panel.update.status':true}
};
ok(await req('/api/extensions/mcp/settings',{method:'PUT',body:policy,
 headers:{origin,'x-panel-csrf':csrf}}));
note('Web update approval must reject missing CSRF and incorrect password');
const target='a'.repeat(40);
const proposed=ok(await write('/api/actions/panel.update.request/execute',
 {input:{targetSha:target}}));
assert.equal(proposed.json.result.status,'approval_required');
const id=proposed.json.result.id;
const blockedCsrf=await req('/api/panel/update/approve',{method:'POST',
  body:{id,currentPassword:password},headers:{origin}});
assert.equal(blockedCsrf.status,403);
const wrong=await write('/api/panel/update/approve',
 {id,currentPassword:'incorrect-staging-password'});
assert.equal(wrong.status,403);

note('Concurrent Web step-up approvals must enqueue exactly once');
const webRace=await Promise.all([
  write('/api/panel/update/approve',{id,currentPassword:password}),
  write('/api/panel/update/approve',{id,currentPassword:password})
]);
const webQueued=webRace.filter(r=>r.status===200 && r.json?.status==='queued');
const webDenied=webRace.filter(r=>r.status===409);
assert.equal(webQueued.length,1,JSON.stringify(webRace.map(r=>({status:r.status,body:r.text}))));
assert.equal(webDenied.length,1,JSON.stringify(webRace.map(r=>({status:r.status,body:r.text}))));
assert.equal(webQueued[0].json.id,id);
await waitResult(id,'failed');  // Real root Broker rejects target not origin/main.
note('PASS: parallel Web approvals produced one Broker request');
note('Web → systemd Broker rejected invalid target and reported failed, no false success');

note('Real OAuth dynamic registration + user consent + PKCE S256 token');
const reg=ok(await req('/oauth/register',{method:'POST',
 body:{client_name:'Ephemeral staged ChatGPT connector',redirect_uris:[callback]}}),201);
const clientId=reg.json.client_id;
const defaultToken=await consent(clientId);
const defaultTools=await rpc(defaultToken,'tools/list');
assert.equal(defaultTools.status,200);
assert.ok(defaultTools.json.result.tools.some(t=>t.name==='panel.update.execute'),
 'Trusted client without explicit update Scope receives globally enabled Action');
const reader=await consent(clientId,'panel:read');
const direct=await consent(clientId,'panel:update:execute');
const directList=await rpc(direct,'tools/list');
assert.ok(directList.json.result.tools.some(t=>t.name==='panel.update.execute'));
assert.deepEqual(directList.json.result.tools.map(t=>t.name),
 defaultTools.json.result.tools.map(t=>t.name));
const directResult=await rpc(direct,'tools/call',
 {name:'panel.update.execute',arguments:{targetSha:'b'.repeat(40)}});
assert.equal(directResult.status,200);
assert.notEqual(directResult.json.result?.isError,true,
 JSON.stringify(directResult.json)); // require successful enqueue, not deployment
const receipt=directResult.json.result?.structuredContent;
assert.equal(receipt?.status,'queued',JSON.stringify(directResult));
assert.match(receipt.id,/^[a-f0-9]{32}$/);
await waitResult(receipt.id,'failed');
const readStatus=await rpc(reader,'tools/call',
 {name:'panel.update.status',arguments:{}});
assert.equal(readStatus.status,200);
assert.equal(readStatus.json.result?.structuredContent?.lastResult?.id,receipt.id);
assert.equal(readStatus.json.result?.structuredContent?.lastResult?.status,'failed');
note('Trusted MCP OAuth → globally permitted direct enqueue → systemd rejection → status succeeded');

note('Concurrent OAuth clients must not double-enqueue one Broker target');
const reg2=ok(await req('/oauth/register',{method:'POST',
 body:{client_name:'Second isolated staging OAuth client',redirect_uris:[callback]}}),201);
const direct2=await consent(reg2.json.client_id,'panel:update:execute');
const duplicateTarget='c'.repeat(40);
const mcpRace=await Promise.all([
 rpc(direct,'tools/call',{name:'panel.update.execute',arguments:{targetSha:duplicateTarget}}),
 rpc(direct2,'tools/call',{name:'panel.update.execute',arguments:{targetSha:duplicateTarget}})
]);
const mcpQueued=mcpRace.filter(r=>r.status===200 &&
 r.json.result?.structuredContent?.status==='queued' &&
 r.json.result?.isError!==true);
const mcpDenied=mcpRace.filter(r=>r.json.error || r.json.result?.isError===true);
assert.equal(mcpQueued.length,1,JSON.stringify(mcpRace));
assert.equal(mcpDenied.length,1,JSON.stringify(mcpRace));
const raceId=mcpQueued[0].json.result.structuredContent.id;
assert.match(raceId,/^[a-f0-9]{32}$/);
await waitResult(raceId,'failed');
note('PASS: two independent OAuth clients produced one fixed Broker enqueue');

note('Positive '+positivePath+' path: valid SHA reaches root Broker');
const initialCheck=ok(await write('/api/actions/panel.update.check/execute',
  {input:{targetSha}}));
assert.equal(initialCheck.json.result.currentSha,oldSha);
assert.equal(initialCheck.json.result.targetSha,targetSha);
let positiveId;
if(positivePath==='web'){
  const proposal=ok(await write('/api/actions/panel.update.request/execute',
    {input:{targetSha}}));
  assert.equal(proposal.json.result.status,'approval_required');
  positiveId=proposal.json.result.id;
  const approval=ok(await write('/api/panel/update/approve',
    {id:positiveId,currentPassword:password}));
  assert.equal(approval.json.status,'queued');
  assert.equal(approval.json.id,positiveId);
}else{
  const execution=await rpc(direct,'tools/call',
    {name:'panel.update.execute',arguments:{targetSha}});
  assert.equal(execution.status,200);
  assert.equal(execution.json.result?.structuredContent?.status,'queued',
    JSON.stringify(execution));
  positiveId=execution.json.result.structuredContent.id;
}
assert.match(positiveId,/^[a-f0-9]{32}$/);
await waitResult(positiveId,'success');
const after=ok(await write('/api/actions/panel.update.check/execute',
  {input:{targetSha}}));
assert.equal(after.json.result.currentSha,targetSha);
assert.equal(after.json.result.status,'up_to_date');
assert.equal(ok(await req('/api/auth/status')).json.initialized,true);
const afterMcp=await rpc(reader,'tools/call',
  {name:'panel.update.status',arguments:{}});
assert.equal(afterMcp.status,200,'Prior OAuth bearer must reconnect after restart');
assert.equal(afterMcp.json.result?.structuredContent?.lastResult?.id,positiveId);
assert.equal(afterMcp.json.result?.structuredContent?.lastResult?.status,'success');
const afterDirect=await rpc(direct,'tools/list');
assert.equal(afterDirect.status,200);
assert.ok(afterDirect.json.result.tools.some(t=>t.name==='panel.update.execute'));
note('Valid SHA deployed; Web and OAuth MCP resumed with correct status');

note('Revoke policy and grant; old bearer must fail without deployment');
const current=ok(await req('/api/extensions/mcp/settings')).json.policy;
ok(await req('/api/extensions/mcp/settings',{method:'PUT',body:{
 ...current,allowDirectUpdates:false
 },headers:{origin,'x-panel-csrf':csrf}}));
const noTool=await rpc(direct,'tools/list');
assert.equal(noTool.json.result.tools.some(t=>t.name==='panel.update.execute'),false);
assert.equal(noTool.json.result.tools.some(t=>t.name==='panel.update.status'),true);
const grantList=ok(await req('/api/extensions/mcp/grants')).json.grants;
const directGrant=grantList.filter(g=>g.clientId===clientId).at(-1);
assert.ok(directGrant);
ok(await req('/api/extensions/mcp/grants/'+directGrant.id,{method:'DELETE',
 headers:{origin,'x-panel-csrf':csrf}}));
const revoked=await rpc(direct,'tools/list');
assert.equal(revoked.status,401);
note('PASS: real Web+OAuth+MCP+systemd Broker integration');
