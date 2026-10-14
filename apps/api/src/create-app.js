import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ActionRegistry } from '../../../core/action-registry.js';
import { ActionEngine } from '../../../core/action-engine.js';
import { ModuleManager } from '../../../core/module-manager.js';
import { loadWebPresentations } from './web-presentations.js';
import { StateStore, addAudit, DEFAULT_SETTINGS } from '../../../platform/state-store.js';
import { AuthService } from '../../../platform/auth/service.js';
import { readSessionCookie, sessionCookie, clearSessionCookie } from '../../../platform/auth/cookies.js';

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
  logger = false
} = {}) {
  if (publicOrigin && (!/^https?:\/\//.test(publicOrigin) || new URL(publicOrigin).origin !== publicOrigin))
    throw new Error('PANEL_PUBLIC_ORIGIN must be an exact origin, with no trailing slash or path');
  if (production && (!publicOrigin || !publicOrigin.startsWith('https://')))
    throw new Error('Production requires PANEL_PUBLIC_ORIGIN=https://your-panel-domain');
  // Only local Nginx may supply forwarding headers. NEVER use trustProxy:true:
  // otherwise remote callers can forge their source IP and evade login limits.
  const app = Fastify({
    logger, bodyLimit: 32 * 1024,
    trustProxy: production ? ['127.0.0.1', '::1', '::ffff:127.0.0.1'] : false
  });
  const store = new StateStore(statePath);
  const auth = new AuthService(store);
  const registry = new ActionRegistry();
  const modules = new ModuleManager(modulesPath, registry);
  await modules.loadAll();
  const engine = new ActionEngine(registry);
  const presentations = await loadWebPresentations(modulesPath, modules.loaded, registry);
  const secure = production || publicOrigin.startsWith('https://');

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (production) {
      reply.header('Content-Security-Policy',
        "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
        "form-action 'self'; script-src 'self'; style-src 'self'; " +
        "img-src 'self' data:; font-src 'self'; connect-src 'self'");
      reply.header('Strict-Transport-Security', 'max-age=31536000');
      // Defense in depth. A public Nginx vhost must forward the canonical host.
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
    const { username, password } = request.body ?? {};
    const loggedIn = await auth.login(username, password, request.ip);
    reply.header('Set-Cookie', sessionCookie(loggedIn.token, { secure }));
    return { user: loggedIn.user, csrf: loggedIn.csrf, expiresAt: loggedIn.expiresAt };
  });
  app.get('/api/auth/session', async request => ({
    user: request.panelIdentity.user,
    csrf: request.panelIdentity.session.csrf,
    expiresAt: request.panelIdentity.session.expiresAt
  }));
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
  app.get('/api/auth/sessions', async request => ({
    sessions: await auth.listSessions(request.panelIdentity)
  }));
  app.delete('/api/auth/sessions/:id', async (request, reply) => {
    await auth.revokeSession(request.panelIdentity, request.params.id);
    if (request.panelIdentity.session.id === request.params.id)
      reply.header('Set-Cookie', clearSessionCookie({ secure }));
    return { ok: true };
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
    return { status: 'ok', version: '0.3.0', modules: modules.loaded };
  });
  app.get('/api/modules', async request => {
    auth.requirePermission(request.panelIdentity, 'modules:read');
    return { modules: modules.loaded };
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
  app.post('/api/actions/:id/preview', async request => {
    const action = registry.get(request.params.id);
    if (!action || action.exposure?.web !== true)
      throw Object.assign(new Error('Action unavailable'), { statusCode: 404 });
    auth.requirePermission(request.panelIdentity, action.permission);
    return engine.preview(request.params.id, request.body?.input ?? {}, 'web');
  });
  app.post('/api/actions/:id/execute', async request => {
    const action = registry.get(request.params.id);
    if (!action || action.exposure?.web !== true)
      throw Object.assign(new Error('Action unavailable'), { statusCode: 404 });
    auth.requirePermission(request.panelIdentity, action.permission);
    const result = await engine.run(request.params.id, request.body?.input ?? {}, 'web');
    // Store only metadata, never input parameters, raw outputs or secrets.
    await store.mutate(state => addAudit(state, 'action.execute', request.panelIdentity.user.id, action.id));
    return result;
  });

  app.setErrorHandler((error, request, reply) => {
    const status = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
    request.log.error(error);
    reply.code(status).send({ error: status === 500 ? 'Internal error' : error.message });
  });

  const dist = resolve(root, 'apps/web/dist');
  if (existsSync(join(dist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dist, prefix: '/' });
  } else {
    app.get('/', async () => ({ message: 'UI not built; run npm run dev:web or npm run build:web' }));
  }
  return app;
}
