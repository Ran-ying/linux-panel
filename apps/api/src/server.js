import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ActionRegistry } from '../../../core/action-registry.js';
import { ActionEngine } from '../../../core/action-engine.js';
import { ModuleManager } from '../../../core/module-manager.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const app = Fastify({ logger: true, bodyLimit: 32 * 1024 });
const actions = new ActionRegistry();
const modules = new ModuleManager(resolve(root, 'modules'), actions);
await modules.loadAll();
const engine = new ActionEngine(actions);

app.get('/api/health', async () => ({ status: 'ok', version: '0.2.0', modules: modules.loaded }));
app.get('/api/actions', async () => ({ actions: actions.list('web') }));

app.post('/api/actions/:id/preview', async (request) => {
  return engine.preview(request.params.id, request.body?.input ?? {}, 'web');
});
app.post('/api/actions/:id/execute', async (request) => {
  return engine.run(request.params.id, request.body?.input ?? {}, 'web');
});

app.setErrorHandler((error, request, reply) => {
  const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
  request.log.error(error);
  reply.code(status).send({ error: status === 500 ? 'Internal error' : error.message, details: status === 400 ? error.details : undefined });
});

const staticRoot = resolve(root, 'apps/web/dist');
if (existsSync(resolve(staticRoot, 'index.html'))) {
  await app.register(fastifyStatic, { root: staticRoot, prefix: '/' });
} else {
  app.get('/', async () => ({ message: 'UI not built: run npm run build:web (or Vite dev server)' }));
}

// Intentionally hard-coded to loopback until real authentication is implemented.
// Do not publish through Nginx / Cloudflare yet.
const port = Number(process.env.PORT || 4188);
await app.listen({ host: '127.0.0.1', port });
