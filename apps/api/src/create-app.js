import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {TerminalSessions} from '../../../platform/terminal.js';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ActionRegistry } from '../../../core/action-registry.js';
import { ActionEngine } from '../../../core/action-engine.js';
import { PrivilegedActionClient } from '../../../platform/privileged/client.js';
import { ActionCommands } from '../../../platform/action-commands.js';
import { ModuleManager } from '../../../core/module-manager.js';
import { loadWebPresentations } from './web-presentations.js';
import { StateStore, addAudit, DEFAULT_SETTINGS } from '../../../platform/state-store.js';
import { AuthService } from '../../../platform/auth/service.js';
import { readSessionCookie, sessionCookie, clearSessionCookie } from '../../../platform/auth/cookies.js';
import { panelContentSecurityPolicy } from '../../../platform/http-security.js';
import { createUpdateController } from '../../../platform/update-controller.js';
import { registerUpdateActions } from '../../../platform/update-actions.js';
import { createListenerController, registerListenerActions, listenerDefaults, validateListener } from '../../../platform/listener.js';
import { registerFileTransferRoutes } from '../../../platform/file-transfer-routes.js';

const badRequest = message => Object.assign(new Error(message), { statusCode: 400 });
const forbidden = message => Object.assign(new Error(message), { statusCode: 403 });
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(k => !['panelName', 'language', 'theme'].includes(k)))
    throw badRequest('Invalid panel settings');
  const { panelName, language, theme } = input;
  if (typeof panelName !== 'string' || panelName.trim().length < 1 || panelName.length > 60 ||
      !['zh-CN', 'en-US', 'ru-RU'].includes(language) ||
      !['dark', 'light', 'system'].includes(theme))
    throw badRequest('Invalid panel settings');
  return { panelName: panelName.trim(), language, theme };
}

/**
 * A single application for the Web and future OAuth/MCP adapters.
 * This factory is testable with Fastify.inject() even with zero business modules.
 */
export async function createApp({
  root = resolve(import.meta.dirname, '../../..'),
  modulesPath = join(root, 'modules'),
  statePath = join(root, 'data', 'panel-state.json'),
  publicOrigin = process.env.PANEL_PUBLIC_ORIGIN || '',
  production = process.env.NODE_ENV === 'production',
  listener = listenerDefaults(),
  logger = false,
  privilegedClient = new PrivilegedActionClient()
} = {}) {
  if (publicOrigin && (!/^https?:\/\//.test(publicOrigin) || new URL(publicOrigin).origin !== publicOrigin))
    throw new Error('PANEL_PUBLIC_ORIGIN must be an exact origin, with no trailing slash or path');
  const activeListener=validateListener(listener);
  const loopbackHttp=activeListener.host==='127.0.0.1' &&
    publicOrigin===`http://127.0.0.1:${activeListener.port}`;
  if (production && (!publicOrigin || (!publicOrigin.startsWith('https://') && !loopbackHttp)))
    throw new Error('Production requires HTTPS PANEL_PUBLIC_ORIGIN, or HTTP loopback bound to 127.0.0.1 only');
  // Trust only loopback proxies (Nginx, Caddy, Traefik etc.), never the
  // headers of a directly connected external user.
  const app = Fastify({
    logger, bodyLimit: 32 * 1024,
    trustProxy: production ? ['127.0.0.1', '::1', '::ffff:127.0.0.1'] : false
  });
  const store = new StateStore(statePath);
  const auth = new AuthService(store);
  const registry = new ActionRegistry();
  const modules = new ModuleManager(modulesPath, registry);
  const savedOrder=(await store.snapshot()).moduleOrder;
  await modules.loadAll(savedOrder);
  if(JSON.stringify(savedOrder)!==JSON.stringify(modules.order))
    await store.mutate(state=>{state.moduleOrder=modules.order;});
  const updates = createUpdateController({store, root, auth});
  registerUpdateActions(registry, updates);
  const listenerController=createListenerController({store,auth,active:activeListener,publicOrigin});
  registerListenerActions(registry,listenerController);
  // Platform capabilities are first-class Actions, not transport extensions.
  modules.loaded.push({ id:'panel', name:'面板维护', version:'0.5.0' });
  const commands = new ActionCommands(store);
  const engine = new ActionEngine(registry, {commands,privilegedClient});
  registerFileTransferRoutes(app, {auth, store, privilegedClient, uploadDir: join(dirname(statePath), 'upload-staging')});
  const presentations = await loadWebPresentations(modulesPath, modules.loaded, registry);
  const secure = publicOrigin.startsWith('https://');
  // Optional transport extensions are a separate lifecycle from business Actions.
  // Old v0.3 state remains valid and MCP starts disabled. Auth is platform-owned.
  const mcpPath = resolve(root, 'extensions/mcp/index.js');
  if (existsSync(mcpPath)) {
    const { registerMcpExtension } = await import(pathToFileURL(mcpPath).href);
    await registerMcpExtension(app, {
      store, auth, registry, engine, updates, root,
      origin: publicOrigin || 'http://127.0.0.1:4188',
      resourceUrl: (publicOrigin || 'http://127.0.0.1:4188') + '/mcp'
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (production) {
      reply.header('Content-Security-Policy', panelContentSecurityPolicy());
      if (secure) reply.header('Strict-Transport-Security', 'max-age=31536000');
      // Defense in depth: every configured proxy or direct request must use the canonical Host.
      const requestedHost = request.headers.host;
      if (requestedHost !== new URL(publicOrigin).host)
        throw Object.assign(new Error('Unrecognized public host'), { statusCode: 421 });
    }
    if (!path.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const openRoute = (path === '/api/auth/status' && request.method === 'GET') ||
      (path === '/api/auth/login' && request.method === 'POST');

    if (MUTATING.has(request.method)) {
      const origin = request.headers.origin;
      const allowed = new Set([publicOrigin]);
      if (!production) {
        allowed.add('http://127.0.0.1:4188');
        allowed.add('http://127.0.0.1:5173');
        allowed.add('http://localhost:5173');
        allowed.add('http://localhost:4188');
      }
      // In production all state-changing requests must be same-origin, including
      // login. A missing Origin is rejected, not silently treated as trusted.
      if ((production && origin !== publicOrigin) || (origin && !allowed.has(origin)))
        throw forbidden('Origin not allowed');
    }
    if (path === '/api/auth/login') {
      // Custom request header prevents cross-origin HTML forms from signing in.
      if (request.headers['x-panel-client'] !== 'web')
        throw forbidden('Missing required client header');
      return;
    }
    if (openRoute) return;
    const token = readSessionCookie(request.headers.cookie);
    request.panelIdentity = await auth.authenticate(token);
    if (MUTATING.has(request.method)) {
      const csrf = request.headers['x-panel-csrf'];
      if (typeof csrf !== 'string' || csrf !== request.panelIdentity.session.csrf)
        throw forbidden('CSRF token missing or invalid');
    }
  });

  app.get('/api/auth/status', async () => ({ initialized: await auth.isInitialized() }));
  app.post('/api/auth/login', async (request, reply) => {
    const { username, password, secondFactor } = request.body ?? {};
    const loggedIn = await auth.login(username, password, request.ip, secondFactor);
    reply.header('Set-Cookie', sessionCookie(loggedIn.token, { secure, maxAge: (Date.parse(loggedIn.expiresAt) - Date.now()) / 1000 }));
    return { user: loggedIn.user, csrf: loggedIn.csrf, expiresAt: loggedIn.expiresAt };
  });
  app.get('/api/auth/session', async (request, reply) => {
    const session = await auth.sessionInfo(request.panelIdentity);
    reply.header('Set-Cookie', sessionCookie(readSessionCookie(request.headers.cookie), {
      secure, maxAge: (Date.parse(session.expiresAt) - Date.now()) / 1000
    }));
    return { user: request.panelIdentity.user, csrf: session.csrf, expiresAt: session.expiresAt };
  });
  app.get('/api/auth/session-policy', async () => auth.sessionPolicy());
  app.put('/api/auth/session-policy', async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !Object.hasOwn(body, 'days'))
      throw badRequest('Invalid session policy');
    const result = await auth.setSessionPolicy(request.panelIdentity, body.days);
    reply.header('Set-Cookie', sessionCookie(readSessionCookie(request.headers.cookie), {
      secure, maxAge: (Date.parse(result.expiresAt) - Date.now()) / 1000
    }));
    return result;
  });
  app.post('/api/auth/logout', async (request, reply) => {
    await auth.logout(request.panelIdentity);
    reply.header('Set-Cookie', clearSessionCookie({ secure }));
    return { ok: true };
  });
  app.post('/api/auth/password', async (request, reply) => {
    auth.requirePermission(request.panelIdentity, 'account:write');
    const { currentPassword, newPassword } = request.body ?? {};
    await auth.changePassword(request.panelIdentity, currentPassword, newPassword);
    reply.header('Set-Cookie', clearSessionCookie({ secure }));
    return { ok: true, signedOut: true };
  });
  app.get('/api/auth/totp', async request => auth.totpStatus(request.panelIdentity));
  app.post('/api/auth/totp/setup', async request => {
    auth.requirePermission(request.panelIdentity,'account:write');
    return auth.beginTotp(request.panelIdentity,request.body?.currentPassword);
  });
  app.post('/api/auth/totp/enable', async request => {
    auth.requirePermission(request.panelIdentity,'account:write');
    return auth.enableTotp(request.panelIdentity,request.body?.code);
  });
  app.post('/api/auth/totp/disable', async request => {
    auth.requirePermission(request.panelIdentity,'account:write');
    await auth.disableTotp(request.panelIdentity,request.body?.currentPassword,request.body?.code);
    return {ok:true};
  });
  app.get('/api/auth/sessions', async request => ({
    sessions: await auth.listSessions(request.panelIdentity)
  }));
  app.delete('/api/auth/sessions/:id', async (request, reply) => {
    await auth.revokeSession(request.panelIdentity, request.params.id);
    if (request.panelIdentity.session.id === request.params.id)
      reply.header('Set-Cookie', clearSessionCookie({ secure }));
    return { ok: true };
  });
  app.post('/api/panel/listener/approve', async request => {
    auth.requirePermission(request.panelIdentity,'panel:write');
    return listenerController.approve({identity:request.panelIdentity,id:request.body?.id,
      password:request.body?.currentPassword,code:request.body?.code});
  });
  app.post('/api/panel/listener/cancel', async request => {
    auth.requirePermission(request.panelIdentity,'panel:write');
    return listenerController.cancel({identity:request.panelIdentity,id:request.body?.id});
  });
  // Platform-owned approval/cancellation never pass through the MCP transport.
  // Both endpoints use the existing Web session, Origin and CSRF defenses.
  app.post('/api/panel/update/approve', async request => {
    auth.requirePermission(request.panelIdentity,'panel:write');
    return updates.approve({identity:request.panelIdentity,id:request.body?.id,
      password:request.body?.currentPassword,code:request.body?.code});
  });
  app.post('/api/panel/update/cancel', async request => {
    auth.requirePermission(request.panelIdentity,'panel:write');
    return updates.cancel({identity:request.panelIdentity,id:request.body?.id});
  });
  app.get('/api/panel/audit', async request => ({
    events: await auth.audit(request.panelIdentity)
  }));
  app.get('/api/panel/settings', async request => {
    auth.requirePermission(request.panelIdentity, 'panel:read');
    const state = await store.snapshot();
    return { settings: { ...DEFAULT_SETTINGS, ...state.settings } };
  });
  app.put('/api/panel/settings', async request => {
    auth.requirePermission(request.panelIdentity, 'panel:write');
    const next = validateSettings(request.body);
    await store.mutate(state => {
      state.settings = next;
      addAudit(state, 'panel.settings.updated', request.panelIdentity.user.id);
    });
    return { settings: next };
  });

  // All existing endpoints pass through the same login/CSRF policy.
  app.get('/api/health', async request => {
    auth.requirePermission(request.panelIdentity, 'system:read');
    return { status: 'ok', version: '0.5.0', modules: modules.loaded };
  });
  app.get('/api/modules', async request => {
    auth.requirePermission(request.panelIdentity, 'modules:read');
    return { modules: modules.loaded };
  });
  app.put('/api/modules/order', async request => {
    auth.requirePermission(request.panelIdentity,'panel:write');
    const body=request.body;
    if(!body || typeof body!=='object' || Array.isArray(body) ||
       Object.keys(body).length!==1 || !Object.hasOwn(body,'order'))
      throw badRequest('Invalid module order request');
    const order=modules.planOrder(body.order);
    await store.mutate(state=>{
      state.moduleOrder=order;
      addAudit(state,'panel.modules.reordered',request.panelIdentity.user.id);
    });
    modules.applyOrder(order);
    return {modules:modules.loaded};
  });
  app.get('/api/actions', async request => {
    auth.requirePermission(request.panelIdentity, 'actions:discover');
    return { actions: registry.list('web').filter(a => {
      try { auth.requirePermission(request.panelIdentity, a.permission); return true; }
      catch { return false; }
    }) };
  });
  app.get('/api/web/presentations', async request => {
    auth.requirePermission(request.panelIdentity, 'actions:discover');
    const visible = new Set(registry.list('web').filter(a => {
      try { auth.requirePermission(request.panelIdentity, a.permission); return true; }
      catch { return false; }
    }).map(a => a.id));
    return { presentations: presentations.filter(p => visible.has(p.actionId)) };
  });
  app.get('/api/actions/:id/commands', async request => {
    const action=registry.get(request.params.id);
    if (!action || action.exposure?.web!==true) throw Object.assign(new Error('Action unavailable'),{statusCode:404});
    auth.requirePermission(request.panelIdentity,action.permission);
    return commands.config(action);
  });
  app.put('/api/actions/:id/commands', async request => {
    const action=registry.get(request.params.id);
    if (!action || action.exposure?.web!==true) throw Object.assign(new Error('Action unavailable'),{statusCode:404});
    auth.requirePermission(request.panelIdentity,'account:write');
    auth.requirePermission(request.panelIdentity,action.permission);
    const body=request.body;
    if (!body || Object.keys(body).length!==1 || !Object.hasOwn(body,'commands'))
      throw badRequest('Invalid command configuration');
    return commands.save(action,body.commands,request.panelIdentity.user.id);
  });
  app.post('/api/actions/:id/preview', async request => {
    const action = registry.get(request.params.id);
    if (!action || action.exposure?.web !== true)
      throw Object.assign(new Error('Action unavailable'), { statusCode: 404 });
    auth.requirePermission(request.panelIdentity, action.permission);
    return engine.preview(request.params.id, request.body?.input ?? {}, 'web', {
      authenticated:true,channel:'web',userId:request.panelIdentity.user.id
    });
  });
  app.post('/api/actions/:id/execute', {bodyLimit:12*1024*1024}, async request => {
    const action = registry.get(request.params.id);
    if (!action || action.exposure?.web !== true)
      throw Object.assign(new Error('Action unavailable'), { statusCode: 404 });
    auth.requirePermission(request.panelIdentity, action.permission);
    const result = await engine.run(request.params.id, request.body?.input ?? {}, 'web', {
      authenticated:true,channel:'web',userId:request.panelIdentity.user.id
    });
    // Store only metadata, never input parameters, raw outputs or secrets.
    await store.mutate(state => addAudit(state, 'action.execute', request.panelIdentity.user.id, action.id));
    return result;
  });

  const terminals=new TerminalSessions({registry,auth,presentations});
  app.addHook('onClose',async()=>terminals.shutdown());
  app.post('/api/terminal/sessions',async request=>{
    const body=request.body;
    if(!body || Object.keys(body).some(key=>!['actionId','cols','rows'].includes(key)))throw badRequest('Invalid terminal request');
    const result=await terminals.open(request.panelIdentity,readSessionCookie(request.headers.cookie),body);
    await store.mutate(state=>addAudit(state,'terminal.open',request.panelIdentity.user.id,body.actionId));
    return result;
  });
  app.get('/api/terminal/sessions/:id/output',async request=>
    terminals.output(request.panelIdentity,request.params.id,Number(request.query.after ?? 0)));
  app.post('/api/terminal/sessions/:id/input',async request=>{
    if(!request.body || Object.keys(request.body).length!==1)throw badRequest('Invalid terminal input');
    terminals.input(request.panelIdentity,request.params.id,request.body.data);return {ok:true};
  });
  app.post('/api/terminal/sessions/:id/resize',async request=>{
    if(!request.body || Object.keys(request.body).some(key=>!['cols','rows'].includes(key)))throw badRequest('Invalid terminal resize');
    terminals.resize(request.panelIdentity,request.params.id,request.body.cols,request.body.rows);return {ok:true};
  });
  app.delete('/api/terminal/sessions/:id',async request=>{
    terminals.close(request.panelIdentity,request.params.id);return {ok:true};
  });

  app.setErrorHandler((error, request, reply) => {
    const status = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
    request.log.error(error);
    reply.code(status).send({ error: status === 500 ? 'Internal error' : error.message });
  });

  const dist = resolve(root, 'apps/web/dist');
  if (existsSync(join(dist, 'index.html'))) {
    const indexHtml=await readFile(join(dist,'index.html'),'utf8');
    const serveIndex=async(request,reply)=>{
      const nonce=randomBytes(24).toString('base64url');
      reply.header('Cache-Control','no-store');
      if(production)reply.header('Content-Security-Policy',panelContentSecurityPolicy(null,nonce));
      return reply.type('text/html; charset=utf-8').send(indexHtml.replace('<head>','<head><meta name="panel-style-nonce" content="'+nonce+'">'));
    };
    app.get('/',serveIndex);app.get('/index.html',serveIndex);
    await app.register(fastifyStatic, { root: dist, prefix: '/' });
  } else {
    app.get('/', async () => ({ message: 'UI not built; run npm run dev:web or npm run build:web' }));
  }
  return app;
}
