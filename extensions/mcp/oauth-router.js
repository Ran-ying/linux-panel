import { randomBytes } from 'node:crypto';
import { readSessionCookie } from '../../platform/auth/cookies.js';
import { addAudit } from '../../platform/state-store.js';
import { allowedScopes, OAuthStore } from './oauth-store.js';
import { mcpPolicy } from '../../platform/mcp-policy.js';

const escapeHtml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const supported = ['authorization_code','refresh_token'];
const OFFLINE_SCOPE = 'offline_access';
const fields = ['client_id','redirect_uri','response_type','code_challenge','code_challenge_method','scope','resource','state'];

export function installOAuthRoutes(app,{store,auth,registry,resourceUrl,origin}) {
  const data=new OAuthStore(store,registry,resourceUrl);
  const issuer=origin;
  // Registration is temporarily open only by an explicit administrator toggle.
  // Throttle by the IP resolved from the trusted local Nginx proxy.
  const registrationAttempts=new Map();
  const REGISTRATION_WINDOW_MS=10*60*1000;
  const MAX_REGISTRATION_ATTEMPTS=5;
  function checkRegistrationThrottle(ip) {
    const now=Date.now();
    const key=String(ip).slice(0,120);
    for(const [address,times] of registrationAttempts) {
      const live=times.filter(time=>now-time<REGISTRATION_WINDOW_MS);
      if(live.length) registrationAttempts.set(address,live);
      else registrationAttempts.delete(address);
    }
    if(registrationAttempts.size>=2048 && !registrationAttempts.has(key))
      throw error('Client registration temporarily unavailable',429);
    const times=registrationAttempts.get(key)??[];
    if(times.length>=MAX_REGISTRATION_ATTEMPTS)
      throw error('Too many client registration attempts',429);
    registrationAttempts.set(key,[...times,now]);
  }
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
    scopes_supported:['system:read','storage:read','services:read', OFFLINE_SCOPE],
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
    checkRegistrationThrottle(request.ip);
    const client=await data.register(request.body);
    reply.code(201).header('Cache-Control','no-store');
    return {
      client_id:client.id,client_name:client.name,redirect_uris:client.redirectUris,
      grant_types:client.grants,response_types:['code'],
      token_endpoint_auth_method:'none',client_id_issued_at:Math.floor(Date.now()/1000)
    };
  });

  // ChatGPT may send OAuth extensions such as login_hint, prompt and target_flow.
  // RFC 6749 §3.1: ignore unknown parameters, but NEVER relax PKCE,
  // registered redirect URI matching, or the resource audience binding.
  // Clients sometimes identify this one MCP server by its origin instead
  // of its /mcp path; map only this exact origin to the /mcp audience.
  const normalizeResource = value => {
    if (value === resourceUrl) return resourceUrl;
    if (typeof value !== 'string') return null;
    try {
      const requested = new URL(value);
      const canonical = new URL(resourceUrl);
      if (requested.origin === canonical.origin && requested.pathname === '/' &&
          !requested.search && !requested.hash && !requested.username && !requested.password)
        return resourceUrl;
    } catch { /* Invalid resource identifier */ }
    return null;
  };
  const validateAuthorize=async input=>{
    await ensureEnabled();
    if(!input || typeof input !== 'object' || Array.isArray(input))
      throw error('Invalid OAuth authorization request: missing parameters');
    // Reject duplicate critical query keys (Fastify represents duplicates as arrays).
    for (const key of fields) {
      if (input[key] !== undefined && typeof input[key] !== 'string')
        throw error('Invalid OAuth authorization request: duplicate or invalid '+key);
    }
    if(input.response_type!=='code')
      throw error('Invalid OAuth authorization request: response_type');
    if(input.state !== undefined && input.state.length > 1024)
      throw error('Invalid OAuth authorization request: state');
    if(input.code_challenge_method!=='S256' ||
       typeof input.code_challenge!=='string' ||
       !/^[a-zA-Z0-9_-]{43,128}$/.test(input.code_challenge))
      throw error('Invalid OAuth authorization request: PKCE S256 required');
    if(normalizeResource(input.resource)!==resourceUrl)
      throw error('Invalid OAuth authorization request: resource audience mismatch');
    // prompt=none forbids interaction and must not silently produce a consent screen.
    if(typeof input.prompt==='string' && input.prompt.split(/\s+/).includes('none'))
      throw error('OAuth prompt=none is not supported');
    const client=await data.clientInfo(input.client_id);
    if(!client || !client.redirectUris.includes(input.redirect_uri))
      throw error('Invalid OAuth client or redirect_uri');
    const allowed=new Set(allowedScopes(registry,await store.snapshot()));
    // OAuth scope and state are optional. Without scope, explicitly present
    // the currently permitted read-only scopes on the consent page.
    const scopes=typeof input.scope==='string' && input.scope.trim()
      ? [...new Set(input.scope.split(/\s+/).filter(Boolean))]
      : [...allowed];
    if((input.scope?.length??0)>1024 || scopes.length>12 ||
       !scopes.some(s=>s!==OFFLINE_SCOPE) ||
       scopes.some(s=>s!==OFFLINE_SCOPE && !allowed.has(s)))
      throw error('Unavailable OAuth scope');
    const params={...Object.fromEntries(fields.filter(key=>typeof input[key]==='string')
      .map(key=>[key,input[key]])),resource:resourceUrl,scope:scopes.join(' ')};
    return {client,scopes,params};
  };

  app.get('/oauth/authorize',async(request,reply)=>{
    const {client,scopes,params}=await validateAuthorize(request.query);
    let identity;
    try { identity=await auth.authenticate(readSessionCookie(request.headers.cookie)); }
    catch { return reply.redirect('/?next='+encodeURIComponent(request.url)); }
    auth.requirePermission(identity,'mcp:authorize');
    const csrf=identity.session.csrf;
    const hidden=fields.filter(key=>typeof params[key]==='string')
      .map(key=>`<input type="hidden" name="${key}" value="${escapeHtml(params[key])}">`).join('');
    // Client-supplied display names are UNVERIFIED. Show its exact callback origin.
    const redirectHost=new URL(request.query.redirect_uri).origin;
    const scopeLabels=scopes.map(s=>`<li><code>${escapeHtml(s)}</code>${s===OFFLINE_SCOPE?'（允许连接在 Access Token 到期后继续刷新）':''}</li>`).join('');
    // The app globally uses Referrer-Policy: no-referrer, which causes browsers
    // to send Origin: null on ordinary navigation-mode HTML form POSTs.
    // For this OAuth consent document alone, origin sends a canonical Origin
    // while limiting Referer to the public origin (not the OAuth query string).
    // Keep the strict Origin/CSRF checks on POST unchanged.
    reply.type('text/html; charset=utf-8').header('Cache-Control','no-store')
      .header('Referrer-Policy','origin');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="origin"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Linux Panel · MCP 授权</title></head>
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
    const validated=await validateAuthorize(params);
    const scopes=validated.scopes;
    const normalized=validated.params;
    const callback=new URL(normalized.redirect_uri);
    if(request.body.decision!=='approve') {
      callback.searchParams.set('error','access_denied');
      if (typeof normalized.state==='string') callback.searchParams.set('state',normalized.state);
      callback.searchParams.set('iss',issuer);
      return reply.redirect(callback.toString());
    }
    const grant=await data.createGrant(normalized.client_id,identity.user.id,scopes,resourceUrl);
    try {
      const {oauth,Request,Response}=await provider();
      const incoming=new Request({
        // The OAuth library internally requires state even though OAuth clients
        // may omit it. Generate an internal nonce solely for the library;
        // do not return a fabricated state to the client.
        headers:request.headers,method:'GET',
        query:{...normalized,state:normalized.state ?? randomBytes(24).toString('base64url')},body:{}
      });
      const outgoing=new Response({headers:{}});
      const code=await oauth.authorize(incoming,outgoing,{
        authenticateHandler:{handle:async()=>({
          id:identity.user.id,grantId:grant.id,resource:resourceUrl
        })}
      });
      callback.searchParams.set('code',code.authorizationCode);
      if (typeof normalized.state==='string') callback.searchParams.set('state',normalized.state);
      callback.searchParams.set('iss',issuer);
      return reply.redirect(callback.toString());
    } catch (cause) {
      await data.revokeGrant(grant.id,identity.user.id);
      throw cause;
    }
  });

  app.post('/oauth/token',async(request,reply)=>{
    await ensureEnabled();
    const input=request.body && typeof request.body==='object'
      ? {...request.body, resource:normalizeResource(request.body.resource)}
      : null;
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
