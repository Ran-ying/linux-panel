/**
 * Local-only Streamable HTTP client for the separately isolated Telegram MCP.
 * Deliberately never accepts URLs supplied by an Action caller.
 */
const DEFAULT_URL = 'http://127.0.0.1:8765/mcp';
const VERSION = '2025-03-26';

function endpoint() {
  const url = new URL(process.env.PANEL_TELEGRAM_MCP_URL || DEFAULT_URL);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/mcp' || url.search || url.hash || url.username || url.password) {
    throw new Error('Telegram MCP endpoint must be a loopback HTTP /mcp URL');
  }
  return url;
}

function decode(body, contentType, id) {
  if (contentType.includes('application/json')) return JSON.parse(body);
  if (!contentType.includes('text/event-stream')) throw new Error('Unexpected Telegram MCP content type');
  for (const frame of body.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    const parsed = JSON.parse(data);
    if (parsed.id === id) return parsed;
  }
  throw new Error('Telegram MCP returned no matching response');
}

async function exchange(url, data, session, version, timeoutMs, fetchImpl) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(session ? {'mcp-session-id':session} : {}),
    ...(version ? {'mcp-protocol-version':version} : {})
  };
  const response = await fetchImpl(url, {
    method:'POST', headers, body:JSON.stringify(data), signal:AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw Object.assign(new Error('Telegram MCP returned HTTP '+response.status),{statusCode:503});
  return {session:response.headers.get('mcp-session-id') || session,
    payload:data.id===undefined?null:decode(await response.text(),response.headers.get('content-type')||'',data.id)};
}

export async function callTelegram(tool, args = {}, {fetchImpl=fetch} = {}) {
  const url=endpoint();
  let session=null, version=VERSION;
  try {
    const init=await exchange(url,{
      jsonrpc:'2.0',id:1,method:'initialize',
      params:{protocolVersion:VERSION,capabilities:{},clientInfo:{name:'linux-panel-telegram',version:'0.1.0'}}
    },null,null,10000,fetchImpl);
    session=init.session;
    if(init.payload?.error || !init.payload?.result?.protocolVersion)
      throw new Error('Telegram MCP initialization failed');
    version=init.payload.result.protocolVersion;
    await exchange(url,{jsonrpc:'2.0',method:'notifications/initialized'},session,version,10000,fetchImpl);
    const result=await exchange(url,{
      jsonrpc:'2.0',id:2,method:'tools/call',params:{name:tool,arguments:args}
    },session,version,60000,fetchImpl);
    if(result.payload?.error || result.payload?.result?.isError)
      throw new Error('Telegram MCP tool failed: '+JSON.stringify(result.payload?.error ||
        result.payload?.result?.content || []).slice(0,1000));
    const content=result.payload?.result?.content;
    if(!Array.isArray(content)) throw new Error('Telegram MCP returned an invalid tool response');
    const text=content.filter(item=>item.type==='text').map(item=>item.text).join('\n');
    return {text:text.slice(0,32000)};
  } catch (error) {
    if(error?.name==='TimeoutError') throw Object.assign(new Error(
      'Telegram MCP timed out; check chat before retrying a write'),{statusCode:504});
    if(error.statusCode)throw error;
    throw Object.assign(new Error('Telegram MCP unavailable or operation failed: '+error.message),{statusCode:503});
  } finally {
    if(session) {
      // Streamable HTTP sessions are optional; upstream may return 405.
      try {
        await fetchImpl(url,{method:'DELETE',headers:{'mcp-session-id':session,
          'mcp-protocol-version':version},signal:AbortSignal.timeout(2000)});
      } catch { /* session cleanup is best effort */ }
    }
  }
}
