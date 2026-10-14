import OAuth2Server from '@node-oauth/oauth2-server';
import { OAuthStore, secret, allowedScopes } from './oauth-store.js';

export function createOAuthProvider(store, registry, resourceUrl) {
  const data=new OAuthStore(store,registry,resourceUrl);
  const model={
    getClient: async (id,secretValue) => secretValue ? null : data.client(id),
    getAuthorizationCode: code=>data.getCode(code),
    saveAuthorizationCode: (code,client,user)=>data.saveCode(code,client,user),
    revokeAuthorizationCode: code=>data.consumeCode(code.authorizationCode),
    getRefreshToken:token=>data.getRefreshToken(token),
    revokeToken:token=>data.revokeRefresh(token),
    getAccessToken:async token=>{
      const verified=await data.verifyAccessToken(token);
      if(!verified)return null;
      return {accessToken:token,accessTokenExpiresAt:new Date(verified.expiresAt*1000),
        client:{id:verified.clientId},user:{id:verified.userId},scope:verified.scopes};
    },
    saveToken:(token,client,user)=>data.saveToken(token,client,user),
    generateAccessToken:()=>secret(),
    generateRefreshToken:()=>secret(),
    generateAuthorizationCode:()=>secret(),
    validateScope:async (user,client,scopes)=>{
      const state = await store.snapshot();
      const available = new Set([...allowedScopes(registry, state), 'offline_access']);
      return scopes?.length && scopes.every(s=>available.has(s))?scopes:false;
    },
    verifyScope:(token,scopes)=>scopes.every(s=>token.scope.includes(s))
  };
  const oauth=new OAuth2Server({
    model,requirePKCE:true,enablePlainPKCE:false,authorizationCodeLifetime:300,
    accessTokenLifetime:3600,refreshTokenLifetime:1209600,
    requireClientAuthentication:{authorization_code:false,refresh_token:false}
  });
  return {oauth,data,Request:OAuth2Server.Request,Response:OAuth2Server.Response};
}
