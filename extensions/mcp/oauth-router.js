import { readSessionCookie } from '../../platform/auth/cookies.js';
import { addAudit } from '../../platform/state-store.js';
import { allowedScopes, OAuthStore } from './oauth-store.js';
import { mcpPolicy } from '../../platform/mcp-policy.js';

const escapeHtml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const supported = ['authorization_code','refresh_token'];
const fields = ['client_id','redirect_uri','response_type','code_challenge','code_challenge_method','scope','resource','state'];

export function installOAuthRoutes(app,{store,auth,registry,resourceUrl,origin}) {
  const data=new OAuthStore(store,registry,resourceUrl);
  const issuer=origin;
  let providerPromise;
  const provider=()=>providerPromise??=import('./oauth-provider.js')
    .then(({createOAuthProvider})=>createOAuthProvider(store,registry,resourceUrl))
    .catch(err=>{providerPromise=null;throw err;});
  app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(_req,body,done)=>{
    try {
      if (body.length > 8192) return done(error('OAuth body too large',413));
      const parsed=new URLSearchParams(body);
      const value=Object.create(null);
      for (const [key,item] of parsed) {
        if (Object.hasOwn(value,key)) return done(error('Duplicate OAuth parameter: '+key));
        value[key]=item;
      }
      done(null,value);
    } catch(e) { done(e); }
  });
  const ensureEnabled=async()=>{
    if (!mcpPolicy(await store.snapshot()).enabled) throw error('MCP disabled',404);
  };
  const oauthMetadata=()=>({
    issuer,
    authorization_endpoint: issuer+'/oauth/authorize',
    token_endpoint: issuer+'/oauth/token',
    registration_endpoint: issuer+'/oauth/register',
    response_types_supported:['code'],
    grant_types_supported:supported,
    token_endpoint_auth_methods_supported:['none'],
    code_challenge_methods_supported:['S256'],
    scopes_supported:['system:read','storage:read','services:read'],
    authorization_response_iss_parameter_supported:true
  });
  const sendMetadata=(request,reply,data)=>{
    reply.header('Cache-Control','no-store');
    reply.header('Access-Control-Allow-Origin','*');
    return data;
  };
  app.get('/.well-known/oauth-authorization-server',async(request,reply)=>{
    await ensureEnabled();
    return sendMetadata(request,reply,oauthMetadata());
  });
  app.get('/.well-known/oauth-protected-resource/mcp',async(request,reply)=>{
    await ensureEnabled();
    return sendMetadata(request,reply,{
      resource:resourceUrl,authorization_servers:[issuer],
      scopes_supported:allowedScopes(registry,await store.snapshot())
    });
  });
  app.post('/oauth/register',async(request,reply)=>{
    await ensureEnabled();
    const client=await data.register(request.body);
    reply.code(201).header('Cache-Control','no-store');
    return {
      client_id:client.id,client_name:client.name,redirect_uris:client.redirectUris,
      grant_types:client.grants,response_types:['code'],
      token_endpoint_auth_method:'none',client_id_issued_at:Math.floor(Date.now()/1000)
    };
  });

  const validateAuthorize=async params=>{
    await ensureEnabled();
    if(!params || Object.keys(params).some(k=>!fields.includes(k)) ||
        params.response_type!=='code' ||
        typeof params.state!=='string' || params.state.length<8 || params.state.length>512 ||
        params.code_challenge_method!=='S256' ||
        typeof params.code_challenge!=='string' ||
        !/^[a-zA-Z0-9_-]{43,128}$/.test(params.code_challenge) ||
        params.resource!==resourceUrl)
      throw error('Invalid OAuth authorization request');
    const client=await data.clientInfo(params.client_id);
    if(!client || !client.redirectUris.includes(params.redirect_uri))
      throw error('Invalid OAuth client or redirect_uri');
    const scopes=typeof params.scope==='string' ? [...new Set(params.scope.split(/\s+/).filter(Boolean))] : [];
    const allowed=new Set(allowedScopes(registry,await store.snapshot()));
    if(!scopes.length || scopes.some(s=>!allowed.has(s))) throw error('Unavailable OAuth scope');
    return {client,scopes};
  };

  app.get('/oauth/authorize',async(request,reply)=>{
    const {client,scopes}=await validateAuthorize(request.query);
    let identity;
    try { identity=await auth.authenticate(readSessionCookie(request.headers.cookie)); }
    catch { return reply.redirect('/?next='+encodeURIComponent(request.url)); }
    auth.requirePermission(identity,'mcp:authorize');
    const csrf=identity.session.csrf;
    const hidden=fields.map(key=>`<input type="hidden" name="${key}" value="${escapeHtml(request.query[key])}">`).join('');
    // Client-supplied display names are UNVERIFIED. Show its exact callback origin.
    const redirectHost=new URL(request.query.redirect_uri).origin;
    const scopeLabels=scopes.map(s=>`<li><code>${escapeHtml(s)}</code></li>`).join('');
    reply.type('text/html; charset=utf-8').header('Cache-Control','no-store');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Linux Panel · MCP 授权</title></head>
<body><main><h1>授权 MCP 客户端</h1><p>当前用户：${escapeHtml(identity.user.username)}</p>
<p>客户端自称：<strong>${escapeHtml(client.name)}</strong>（名称未经验证）</p>
<p>客户端 ID：<code>${escapeHtml(client.id)}</code></p>
<p>授权码接收地址：<code>${escapeHtml(request.query.redirect_uri)}</code></p>
<p>回调来源：${escapeHtml(redirectHost)}</p>
<p>客户端请求以下权限：</p><ul>${scopeLabels}</ul>
<p>仅在你主动发起连接并确认客户端与回调地址可信时授权。</p>
<form method="POST" action="/oauth/authorize">${hidden}
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<button type="submit" name="decision" value="approve">确认授权</button>
<button type="submit" name="decision" value="deny">拒绝</button></form></main></body></html>`;
  });

  app.post('/oauth/authorize',async(request,reply)=>{
    if(request.headers.origin!==issuer)throw error('Origin not allowed',403);
    const identity=await auth.authenticate(readSessionCookie(request.headers.cookie));
    auth.requirePermission(identity,'mcp:authorize');
    if(request.body?.csrf!==identity.session.csrf)throw error('CSRF failed',403);
    const params=Object.fromEntries(fields.map(k=>[k,request.body?.[k]]));
    const {scopes}=await validateAuthorize(params);
    const callback=new URL(params.redirect_uri);
    if(request.body.decision!=='approve') {
      callback.searchParams.set('error','access_denied');
      callback.searchParams.set('state',params.state);
      callback.searchParams.set('iss',issuer);
      return reply.redirect(callback.toString());
    }
    const grant=await data.createGrant(params.client_id,identity.user.id,scopes,resourceUrl);
    try {
      const {oauth,Request,Response}=await provider();
      const incoming=new Request({
        headers:request.headers,method:'GET',query:params,body:{}
      });
      const outgoing=new Response({headers:{}});
      const code=await oauth.authorize(incoming,outgoing,{
        authenticateHandler:{handle:async()=>({
          id:identity.user.id,grantId:grant.id,resource:resourceUrl
        })}
      });
      callback.searchParams.set('code',code.authorizationCode);
      callback.searchParams.set('state',params.state);
      callback.searchParams.set('iss',issuer);
      return reply.redirect(callback.toString());
    } catch (cause) {
      await data.revokeGrant(grant.id,identity.user.id);
      throw cause;
    }
  });

  app.post('/oauth/token',async(request,reply)=>{
    await ensureEnabled();
    const input=request.body;
    if(!input || input.resource!==resourceUrl ||
        !supported.includes(input.grant_type) ||
        typeof input.client_id!=='string')
      throw error('Invalid resource or grant type');
    if(input.grant_type==='authorization_code') {
      const code=typeof input.code==='string'?await data.findCode(input.code):null;
      if (!code || code.resource!==resourceUrl ||
          code.clientId!==input.client_id || code.redirectUri!==input.redirect_uri)
        throw error('Invalid OAuth authorization code',400);
    }
    if(input.grant_type==='refresh_token') {
      const token=typeof input.refresh_token==='string'?await data.findRefresh(input.refresh_token):null;
      if(!token || token.clientId!==input.client_id)throw error('Invalid refresh token',400);
    }
    const {oauth,Request,Response}=await provider();
    const incoming=new Request({
      headers:request.headers,method:'POST',query:{},body:input
    });
    const outgoing=new Response({headers:{}});
    try {
      const result=await oauth.token(incoming,outgoing);
      reply.header('Cache-Control','no-store').header('Pragma','no-cache');
      return {
        access_token:result.accessToken,token_type:'Bearer',
        expires_in:Math.max(1,Math.floor((result.accessTokenExpiresAt-Date.now())/1000)),
        refresh_token:result.refreshToken,
        scope:(Array.isArray(result.scope)?result.scope:[]).join(' ')
      };
    } catch (cause) {
      if (cause.statusCode >= 400 && cause.statusCode < 500)
        return reply.code(cause.statusCode).send({error:cause.name||'invalid_grant'});
      throw cause;
    }
  });

  app.get('/api/extensions/mcp/grants',async request=>{
    auth.requirePermission(request.panelIdentity,'mcp:manage');
    return {grants:await data.grants(request.panelIdentity.user.id)};
  });
  app.put('/api/extensions/mcp/grants/:id',async request=>{
    auth.requirePermission(request.panelIdentity,'mcp:manage');
    await data.restrictGrant(request.params.id,request.panelIdentity.user.id,request.body?.scopes);
    return {ok:true};
  });
  app.delete('/api/extensions/mcp/grants/:id',async request=>{
    auth.requirePermission(request.panelIdentity,'mcp:manage');
    await data.revokeGrant(request.params.id,request.panelIdentity.user.id);
    return {ok:true};
  });
  return { data };
}
