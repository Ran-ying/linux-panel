import test from 'node:test';
import assert from 'node:assert/strict';
import {ActionRegistry} from '../core/action-registry.js';
import {ActionEngine} from '../core/action-engine.js';
import {setup} from '../modules/telegram/index.js';
import {callTelegram} from '../platform/telegram-mcp-client.js';
import {actionAllowed,exposedMcpActions} from '../platform/mcp-policy.js';

const reply=(payload, status=200, headers={})=>new Response(status===202?null:JSON.stringify(payload),
  {status,headers:{'content-type':'application/json',...headers}});
const ok=result=>({jsonrpc:'2.0',id:2,result:{content:[{type:'text',text:result}]}});
function mockFetch(calls) {
  return async (url,options)=>{
    calls.push({url:String(url),method:options.method,body:options.body?JSON.parse(options.body):null});
    if(options.method==='DELETE')return new Response(null,{status:200});
    if(options.body) {
      const data=JSON.parse(options.body);
      if(data.method==='initialize')
        return reply({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-03-26'}},200,{'mcp-session-id':'test-session'});
      if(data.method==='notifications/initialized')return new Response(null,{status:202});
      if(data.method==='tools/call')return reply(ok(JSON.stringify({tool:data.params.name,
        args:data.params.arguments})));
    }
    throw new Error('Unexpected MCP request');
  };
}

test('local-only MCP initialize → initialized → tools/call, never remote URL',async()=>{
  const calls=[];
  const previous=process.env.PANEL_TELEGRAM_MCP_URL;
  try {
    delete process.env.PANEL_TELEGRAM_MCP_URL;
    const result=await callTelegram('get_me',{}, {fetchImpl:mockFetch(calls)});
    assert.match(result.text,/"get_me"/);
    assert.deepEqual(calls.map(x=>x.method),['POST','POST','POST','DELETE']);
    assert.ok(calls.every(x=>x.url==='http://127.0.0.1:8765/mcp'));
    process.env.PANEL_TELEGRAM_MCP_URL='https://example.com/mcp';
    await assert.rejects(()=>callTelegram('get_me',{}, {fetchImpl:mockFetch([])}),/loopback/);
  } finally {if(previous===undefined) delete process.env.PANEL_TELEGRAM_MCP_URL;else process.env.PANEL_TELEGRAM_MCP_URL=previous;}
});

test('Telegram writes require proper Action classification and trusted context',async()=>{
  const registry=new ActionRegistry();
  await setup({actions:registry,moduleId:'telegram'});
  const ids=exposedMcpActions(registry).map(x=>x.id);
  assert.deepEqual(ids, ['telegram.status','telegram.botInfo','telegram.messages',
    'telegram.buttons','telegram.send','telegram.press']);
  const policy={mcp:{policy:{enabled:true}}};
  assert.equal(actionAllowed(policy,registry.get('telegram.send')),true);
  assert.equal(actionAllowed(policy,registry.get('telegram.press')),true);
  assert.equal(actionAllowed(policy,{...registry.get('telegram.send'),executionPolicy:'proposal-only'}),false);

  const engine=new ActionEngine(registry);
  await assert.rejects(()=>engine.run('telegram.send',{chat_id:'@mybot1',message:'Hi'},'mcp'),{statusCode:403});
  const prev=process.env.PANEL_TELEGRAM_ALLOWED_BOTS;
  const fetchBefore=globalThis.fetch;
  globalThis.fetch=mockFetch([]);
  process.env.PANEL_TELEGRAM_ALLOWED_BOTS='@mybot1';
  try {
    await assert.rejects(()=>engine.run('telegram.send',{chat_id:'@outsider',message:'Hi'},'mcp',{
      authenticated:true,userId:'test',channel:'mcp'}),{statusCode:403});
    await assert.rejects(()=>engine.run('telegram.press',{chat_id:'@mybot1'},'mcp',{
      authenticated:true,userId:'test',channel:'mcp'}),{statusCode:400});
    const sent=await engine.run('telegram.send',{chat_id:'@mybot1',message:'/start'},'mcp',{
      authenticated:true,userId:'test',channel:'mcp'});
    assert.match(sent.result.text,/"send_message"/);
    const clicked=await engine.run('telegram.press',{chat_id:'@mybot1',button_index:0},'mcp',{
      authenticated:true,userId:'test',channel:'mcp'});
    assert.match(clicked.result.text,/"press_inline_button"/);
    const read=await engine.run('telegram.messages',{chat_id:'@mybot1',page_size:5},'mcp');
    assert.match(read.result.text,/"get_messages"/);
  } finally {
    globalThis.fetch=fetchBefore;
    if(prev===undefined)delete process.env.PANEL_TELEGRAM_ALLOWED_BOTS;
    else process.env.PANEL_TELEGRAM_ALLOWED_BOTS=prev;
  }
});

test('SSE tool results are accepted and errors are never reinterpreted as success',async()=>{
  const f=async(url,options)=>{
    if(options.method==='DELETE')return new Response(null,{status:200});
    const body=JSON.parse(options.body);
    if(body.method==='initialize')return reply({jsonrpc:'2.0',id:1,
      result:{protocolVersion:'2025-03-26'}});
    if(body.method==='notifications/initialized')return new Response(null,{status:202});
    return new Response('event: message\ndata: '+JSON.stringify(ok('SSE success'))+'\n\n',
      {headers:{'content-type':'text/event-stream'}});
  };
  assert.deepEqual(await callTelegram('get_me',{}, {fetchImpl:f}),{text:'SSE success'});
  const failure=async(url,options)=>{
    if(options.method==='DELETE')return new Response(null,{status:200});
    const body=JSON.parse(options.body);
    if(body.method==='initialize')return reply({jsonrpc:'2.0',id:1,
      result:{protocolVersion:'2025-03-26'}});
    if(body.method==='notifications/initialized')return new Response(null,{status:202});
    return reply({jsonrpc:'2.0',id:2,result:{isError:true,content:[{type:'text',text:'refused'}]}});
  };
  await assert.rejects(()=>callTelegram('send_message',{}, {fetchImpl:failure}),{statusCode:503});
});
