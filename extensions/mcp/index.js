import { exposedReadActions, setMcpPolicy, actionAllowed, mcpPolicy } from '../../platform/mcp-policy.js';
import { installOAuthRoutes } from './oauth-router.js';

/**
 * Optional transport extension. Never trust Web cookies on /mcp.
 * Authentication is injected by the OAuth module; no bearer = no MCP tools.
 */
export async function registerMcpExtension(app, { store, auth, registry, engine, resourceUrl, origin }) {
  const { data: tokens } = installOAuthRoutes(app, { store, auth, registry, resourceUrl, origin });
  app.get('/api/extensions/mcp/settings', async request => {
    auth.requirePermission(request.panelIdentity, 'mcp:manage');
    const state = await store.snapshot();
    return {
      policy: mcpPolicy(state),
      endpoint: resourceUrl ?? null,
      tools: exposedReadActions(registry).map(({ id, title, description, permission, kind }) =>
        ({ id, title, description, permission, kind }))
    };
  });
  app.put('/api/extensions/mcp/settings', async request => {
    auth.requirePermission(request.panelIdentity, 'mcp:manage');
    const policy = await setMcpPolicy(store, registry, request.body, request.panelIdentity.user.id);
    return { policy };
  });

  // Lazy-loading avoids breaking an existing v0.3 deployment when the optional
  // extension's separate npm dependencies have not yet been installed.
  let nodePromise;
  const getNodeHandler = () => (nodePromise ??= (async () => {
    const [{ createMcpHandler, McpServer }, { toNodeHandler }, z] = await Promise.all([
      import('@modelcontextprotocol/server'), import('@modelcontextprotocol/node'), import('zod/v4')
    ]);
    const handler = createMcpHandler(({ authInfo } = {}) => {
    const server = new McpServer({ name: 'linux-panel', version: '0.4.0' });
    // Always register only the actions advertised for MCP. Runtime handler
    // rechecks the policy so revoking a grant or a tool applies immediately.
    for (const action of exposedReadActions(registry)) {
      server.registerTool(action.id, {
        description: action.description || action.title,
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true, destructiveHint: false }
      }, async (_input, ctx) => {
        const verified = ctx.http?.authInfo ?? authInfo;
        const state = await store.snapshot();
        const source = registry.get(action.id);
        if (!verified || !actionAllowed(state, source) ||
            !verified.scopes?.includes(action.permission) ||
            verified.userId == null)
          return { isError: true, content: [{ type: 'text', text: 'This tool is not authorized' }] };
        // This is defense-in-depth; client credentials are not Web cookies.
        auth.requirePermission({ user: { id: verified.userId, role: verified.role } }, source.permission);
        const value = await engine.run(action.id, {}, 'mcp');
        return { content: [{ type: 'text', text: JSON.stringify(value.result) }], structuredContent: value.result };
      });
    }
    return server;
  });
    return toNodeHandler(handler);
  })().catch(error => { nodePromise = undefined; throw error; }));

  app.all('/mcp', async (request, reply) => {
    const state = await store.snapshot();
    if (!mcpPolicy(state).enabled) return reply.code(404).send({ error: 'MCP module disabled' });
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '');
    const verified = bearer ? await tokens.verifyAccessToken(bearer[1]) : null;
    if (!verified) {
      reply.header('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`);
      return reply.code(401).send({ error: 'MCP bearer authorization required' });
    }
    // MCP SDK sees AuthInfo attached directly to raw incoming Node request.
    request.raw.auth = verified;
    const node = await getNodeHandler();
    reply.hijack();
    await node(request.raw, reply.raw, request.body);
  });
}
