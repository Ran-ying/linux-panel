import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './create-app.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const app = await createApp({
  root,
  statePath: resolve(process.env.PANEL_DATA_DIR || resolve(root, 'data'), 'panel-state.json'),
  logger: true
});

// Nginx may forward HTTPS, but direct API access always remains loopback-only.
// Public preview requires the documented TLS reverse-proxy and security checklist.
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT || 4188) });
