import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { addAudit } from '../../platform/state-store.js';
import { mcpPolicy, exposedReadActions } from '../../platform/mcp-policy.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const oauthData = state => {
  state.mcp ??= {};
  state.mcp.clients ??= [];
  state.mcp.grants ??= [];
  state.mcp.codes ??= [];
  state.mcp.tokens ??= [];
  return state.mcp;
};
const active = value => value && Date.parse(value) > Date.now();
const MAX_CLIENTS = 60, MAX_GRANTS = 100, MAX_CODES = 150, MAX_TOKENS = 500;

export function allowedScopes(registry, state) {
  if (!mcpPolicy(state).enabled) return [];
  const scopes = [...new Set(exposedReadActions(registry)
    .filter(a => mcpPolicy(state).tools[a.id] === true)
    .map(a => a.permission))];
  if (mcpPolicy(state).allowUpdates === true) scopes.push('panel:update');
  return scopes;
}
export function safeRedirectUri(value) {
  try {
    if (typeof value !== 'string' || value.length > 1024) return false;
    const parsed = new URL(value);
    if (parsed.hash || parsed.username || parsed.password) return false;
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]');
  } catch { return false; }
}

export class OAuthStore {
  constructor(store, registry, resourceUrl) {
    this.store = store; this.registry = registry; this.resourceUrl = resourceUrl;
  }
  async register(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
        typeof metadata.client_name !== 'string' ||
        metadata.client_name.length < 1 || metadata.client_name.length > 100 ||
        !Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length < 1 ||
        metadata.redirect_uris.length > 5 ||
        !metadata.redirect_uris.every(safeRedirectUri) ||
        (metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== 'none') ||
        (metadata.grant_types && (!Array.isArray(metadata.grant_types) ||
          metadata.grant_types.some(g => !['authorization_code', 'refresh_token'].includes(g)))) ||
        (metadata.response_types && (!Array.isArray(metadata.response_types) ||
          metadata.response_types.some(t => t !== 'code'))))
      throw Object.assign(new Error('Invalid public OAuth client metadata'), { statusCode: 400 });
    const client = {
      id: 'lp_' + secret(), name: metadata.client_name,
      redirectUris: [...new Set(metadata.redirect_uris)],
      grants: ['authorization_code', 'refresh_token'], accessTokenLifetime: 3600,
      refreshTokenLifetime: 60 * 60 * 24 * 14,
      createdAt: new Date().toISOString()
    };
    await this.store.mutate(state => {
      const mcp = oauthData(state);
      if (!mcpPolicy(state).enabled || !mcpPolicy(state).registrationEnabled)
        throw Object.assign(new Error('New OAuth clients registration disabled'), { statusCode: 403 });
      if (mcp.clients.length >= MAX_CLIENTS)
        throw Object.assign(new Error('OAuth client registration limit reached'), { statusCode: 429 });
      mcp.clients.push(client);
      addAudit(state, 'mcp.client.registered', null);
    });
    return client;
  }
  async client(id) {
    const state = await this.store.snapshot();
    const client = (state.mcp?.clients ?? []).find(c => c.id === id);
    return client ? {
      id: client.id, grants: client.grants, redirectUris: client.redirectUris,
      accessTokenLifetime: client.accessTokenLifetime,
      refreshTokenLifetime: client.refreshTokenLifetime
    } : null;
  }
  async clientInfo(id) {
    return (await this.store.snapshot()).mcp?.clients?.find(c => c.id === id) ?? null;
  }
  async createGrant(clientId, userId, scopes, resource) {
    if (resource !== this.resourceUrl)
      throw Object.assign(new Error('Invalid OAuth resource'), { statusCode: 400 });
    const state = await this.store.snapshot();
    const client = state.mcp?.clients?.find(c=>c.id===clientId);
    const allowed = new Set([...allowedScopes(this.registry,state), 'offline_access']);
    if (!client || !Array.isArray(scopes) || !scopes.some(s=>s!=='offline_access') ||
        scopes.some(s=>!allowed.has(s)))
      throw Object.assign(new Error('Requested scopes are not available'), { statusCode: 400 });
    const user=state.users.find(u=>u.id===userId);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode:401 });
    const grant = { id: randomUUID(), clientId, userId, resource,
      credentialEpoch:user.credentialEpoch??0,
      scopes: [...new Set(scopes)], revoked:false, createdAt:new Date().toISOString() };
    await this.store.mutate(current=>{
      const mcp=oauthData(current);
      if (!mcpPolicy(current).enabled) throw Object.assign(new Error('MCP disabled'), { statusCode:404 });
      if (mcp.grants.length >= MAX_GRANTS)
        throw Object.assign(new Error('OAuth grant limit reached'), { statusCode:429 });
      mcp.grants.push(grant);
      addAudit(current,'mcp.grant.approved',userId,clientId);
    });
    return grant;
  }
  async findCode(code) {
    return (await this.store.snapshot()).mcp?.codes?.find(v => v.digest === hash(code) && active(v.expiresAt)) ?? null;
  }
  async findRefresh(token) {
    return (await this.store.snapshot()).mcp?.tokens?.find(v=>v.refreshHash===hash(token) && active(v.refreshExpiresAt)) ?? null;
  }
  async verifyAccessToken(token) {
    if (typeof token !== 'string' || token.length < 40 || token.length > 256) return null;
    const state = await this.store.snapshot();
    if (!mcpPolicy(state).enabled) return null;
    const record=state.mcp?.tokens?.find(t=>t.accessHash===hash(token) && active(t.accessExpiresAt));
    const grant=record && state.mcp?.grants?.find(g=>g.id===record.grantId && !g.revoked);
    const user=grant && state.users.find(u=>u.id===grant.userId);
    if (!user || !grant || grant.resource!==this.resourceUrl ||
        (user.credentialEpoch??0)!==(grant.credentialEpoch??0) ||
        record.clientId!==grant.clientId) return null;
    const allowed = new Set(allowedScopes(this.registry,state));
    const scopes=record.scopes.filter(s=>grant.scopes.includes(s) && allowed.has(s));
    return { token, clientId:record.clientId, scopes, expiresAt:Math.floor(Date.parse(record.accessExpiresAt)/1000),
      userId:user.id, role:user.role, resource:new URL(this.resourceUrl), grantId:grant.id };
  }
  async grants(userId) {
    const state=await this.store.snapshot();
    return (state.mcp?.grants ?? []).filter(g=>g.userId===userId)
      .map(g=>({id:g.id,clientId:g.clientId,clientName:state.mcp.clients.find(c=>c.id===g.clientId)?.name??'Unknown client',
        scopes:g.scopes,revoked:g.revoked,createdAt:g.createdAt}));
  }
  async restrictGrant(id,userId,scopes) {
    await this.store.mutate(state=>{
      const mcp=oauthData(state),grant=mcp.grants.find(g=>g.id===id && g.userId===userId && !g.revoked);
      if (!grant) throw Object.assign(new Error('Grant not found'),{statusCode:404});
      if (!Array.isArray(scopes) || !scopes.some(s=>s!=='offline_access') ||
          scopes.some(s=>!grant.scopes.includes(s) || (s!=='offline_access' &&
          !allowedScopes(this.registry,state).includes(s))))
        throw Object.assign(new Error('Cannot add scopes to an existing grant'),{statusCode:400});
      grant.scopes=[...new Set(scopes)];
      addAudit(state,'mcp.grant.restricted',userId,grant.clientId);
    });
  }
  async revokeGrant(id,userId) {
    await this.store.mutate(state=>{
      const mcp=oauthData(state),grant=mcp.grants.find(g=>g.id===id && g.userId===userId);
      if (!grant) throw Object.assign(new Error('Grant not found'),{statusCode:404});
      grant.revoked=true;
      mcp.tokens=mcp.tokens.filter(t=>t.grantId!==id);
      mcp.codes=mcp.codes.filter(c=>c.grantId!==id);
      addAudit(state,'mcp.grant.revoked',userId,grant.clientId);
    });
  }
  async saveCode(code,client,user) {
    const record={
      digest:hash(code.authorizationCode),expiresAt:code.expiresAt.toISOString(),
      redirectUri:code.redirectUri,scope:code.scope, clientId:client.id,
      userId:user.id,grantId:user.grantId,resource:user.resource,
      codeChallenge:code.codeChallenge,codeChallengeMethod:code.codeChallengeMethod
    };
    await this.store.mutate(state=>{
      const mcp=oauthData(state);
      mcp.codes=mcp.codes.filter(c=>active(c.expiresAt));
      if (mcp.codes.length>=MAX_CODES)
        throw Object.assign(new Error('Authorization code capacity exceeded'), {statusCode:429});
      mcp.codes.push(record);
    });
    return {...code,client,user};
  }
  async getCode(token) {
    const record=await this.findCode(token);
    if (!record) return null;
    const state=await this.store.snapshot();
    const grant=state.mcp?.grants?.find(g=>g.id===record.grantId && !g.revoked);
    const client=await this.client(record.clientId);
    const user=grant && state.users.find(u=>u.id===record.userId);
    if (!grant || !client || !user || grant.resource!==record.resource ||
        (user.credentialEpoch??0)!==(grant.credentialEpoch??0)) return null;
    return {
      authorizationCode:token,expiresAt:new Date(record.expiresAt),redirectUri:record.redirectUri,
      scope:record.scope,codeChallenge:record.codeChallenge,codeChallengeMethod:record.codeChallengeMethod,
      client,user:{id:user.id,grantId:grant.id,resource:grant.resource}
    };
  }
  async consumeCode(token) {
    return this.store.mutate(state=>{
      const mcp=oauthData(state),before=mcp.codes.length;
      mcp.codes=mcp.codes.filter(c=>c.digest!==hash(token));
      return before!==mcp.codes.length;
    });
  }
  async saveToken(token,client,user) {
    const grantId=user.grantId;
    const value={
      accessHash:hash(token.accessToken),accessExpiresAt:token.accessTokenExpiresAt.toISOString(),
      refreshHash:token.refreshToken ? hash(token.refreshToken):null,
      refreshExpiresAt:token.refreshTokenExpiresAt?.toISOString()??null,
      scopes:Array.isArray(token.scope)?token.scope:[],clientId:client.id,grantId,userId:user.id
    };
    await this.store.mutate(state=>{
      const mcp=oauthData(state);
      const grant=mcp.grants.find(g=>g.id===grantId && !g.revoked);
      const currentUser=state.users.find(u=>u.id===user.id);
      if(!grant || grant.clientId!==client.id || grant.userId!==user.id ||
          grant.resource!==this.resourceUrl || !currentUser ||
          (currentUser.credentialEpoch??0)!==(grant.credentialEpoch??0))
        throw Object.assign(new Error('Grant invalid'),{statusCode:401});
      // Never persist or return permissions that have since been revoked.
      const currentScopes=new Set([...allowedScopes(this.registry,state),'offline_access']);
      value.scopes=value.scopes.filter(s=>grant.scopes.includes(s)&&currentScopes.has(s));
      token.scope=value.scopes;
      mcp.tokens=mcp.tokens.filter(t=>active(t.accessExpiresAt) ||
        (t.refreshExpiresAt && active(t.refreshExpiresAt)));
      if (mcp.tokens.length>=MAX_TOKENS)
        throw Object.assign(new Error('OAuth token capacity exceeded'), {statusCode:429});
      mcp.tokens.push(value);
      addAudit(state,'mcp.token.issued',user.id,client.id);
    });
    return {...token,client,user};
  }
  async getRefreshToken(token) {
    const record=await this.findRefresh(token);
    if(!record)return null;
    const state=await this.store.snapshot();
    const grant=state.mcp?.grants?.find(g=>g.id===record.grantId && !g.revoked);
    const user=grant && state.users.find(u=>u.id===record.userId);
    const client=await this.client(record.clientId);
    if(!grant||!user||!client||grant.resource!==this.resourceUrl ||
       (user.credentialEpoch??0)!==(grant.credentialEpoch??0))return null;
    return { refreshToken:token,refreshTokenExpiresAt:new Date(record.refreshExpiresAt),
      scope:record.scopes.filter(s=>grant.scopes.includes(s) &&
        (s==='offline_access' || allowedScopes(this.registry,state).includes(s))),
      client,user:{id:user.id,grantId:grant.id,resource:grant.resource} };
  }
  async revokeRefresh(token) {
    return this.store.mutate(state=>{
      const mcp=oauthData(state),record=mcp.tokens.find(t=>t.refreshHash===hash(token.refreshToken));
      if (!record) return false;
      record.refreshHash=null;record.refreshExpiresAt=null;
      return true;
    });
  }
}
