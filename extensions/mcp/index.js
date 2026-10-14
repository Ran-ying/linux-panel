import { exposedReadActions, setMcpPolicy, actionAllowed, mcpPolicy } from '../../platform/mcp-policy.js';
import * as auditHelpers from '../../platform/state-store.js';
import { installOAuthRoutes } from './oauth-router.js';

/**
 * Optional transport extension. Never trust Web cookies on /mcp.
 * Authentication is injected by the OAuth module; no bearer = no MCP tools.
 */
export async function registerMcpExtension(app, { store, auth, registry, engine, updates, resourceUrl, origin, root=process.cwd() }) {
  const { data: tokens } = installOAuthRoutes(app, { store, auth, registry, resourceUrl, origin });
  app.get('/api/extensions/mcp/update',async request=>{
    auth.requirePermission(request.panelIdentity,'panel:read');
    return (await engine.run('panel.update.status', {}, 'web')).result;
  });
  app.post('/api/extensions/mcp/update/approve',async request=>{
    auth.requirePermission(request.panelIdentity,'panel:write');
    return updates.approve({identity:request.panelIdentity,id:request.body?.id,
      password:request.body?.currentPassword,code:request.body?.code});
  });
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
    const handler = createMcpHandler(async ({ authInfo } = {}) => {
    const snapshot = await store.snapshot();
    const permitted = new Set(authInfo?.scopes ?? []);
    const visible = exposedReadActions(registry).filter(a =>
      snapshot.mcp?.policy?.tools?.[a.id] === true && permitted.has(a.permission));

    const server = new McpServer({ name: 'linux-panel', version: '0.5.0' }, { capabilities: { tools: {} } });
    // Write proposals use the same Action registered in the platform registry.
    // The transport adapter performs OAuth+policy checks; ActionEngine enforces
    // schema and validates the returned shape. No parallel execute() path exists.
    const updateAction = registry.get('panel.update.request');
    if (updateAction?.exposure?.mcp === true &&
        updateAction.kind === 'write' && updateAction.permission === 'panel:update' &&
        process.env.PANEL_UPDATER_ENABLED === '1' &&
        mcpPolicy(snapshot).enabled && mcpPolicy(snapshot).allowUpdates &&
        permitted.has(updateAction.permission)) {
      server.registerTool(updateAction.id, {
        description:updateAction.description,
        inputSchema:z.object({targetSha:z.string().regex(/^[a-f0-9]{40}$/).optional()}).strict(),
        annotations:{readOnlyHint:false,destructiveHint:false}
      }, async (input,ctx) => {
        const verified=ctx.http?.authInfo??authInfo;
        const live=verified?.token?await tokens.verifyAccessToken(verified.token):null;
        const policy=mcpPolicy(await store.snapshot());
        if(!live || !live.scopes?.includes(updateAction.permission) ||
           !live.userId || !policy.enabled || !policy.allowUpdates ||
           process.env.PANEL_UPDATER_ENABLED !== '1')
          return {isError:true,content:[{type:'text',text:'Not authorized for update proposals'}]};
        const source=registry.get(updateAction.id);
        if(source!==updateAction || source.executionPolicy!=='proposal-only') {
          return {isError:true,content:[{type:'text',text:'Update proposal Action unavailable'}]};
        }
        try {
          auth.requirePermission({user:{id:live.userId,role:live.role}},updateAction.permission);
          const value=await engine.run(updateAction.id,input,'mcp',{
            authenticated:true,channel:'mcp',userId:live.userId,clientId:live.clientId
          });
          return {content:[{type:'text',text:JSON.stringify(value.result)}],structuredContent:value.result};
        }catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
      });
    }
    // Always register only the actions advertised for MCP. Runtime handler
    // rechecks the policy so revoking a grant or a tool applies immediately.
    for (const action of visible) {
      server.registerTool(action.id, {
        description: action.description || action.title,
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true, destructiveHint: false }
      }, async (_input, ctx) => {
        const verified = ctx.http?.authInfo ?? authInfo;
        const state = await store.snapshot();
        const source = registry.get(action.id);
        // Revalidate the bearer at the actual execution boundary.
        // This makes grant revocation, credential changes and policy changes
        // effective even if they happen after tools/list has been served.
        const live = verified?.token ? await tokens.verifyAccessToken(verified.token) : null;
        if (!live || !actionAllowed(state, source) ||
            !live.scopes?.includes(action.permission) || live.userId == null)
          return { isError: true, content: [{ type: 'text', text: 'This tool is not authorized' }] };
        // This is defense-in-depth; client credentials are not Web cookies.
        auth.requirePermission({ user: { id: live.userId, role: live.role } }, source.permission);
        const value = await engine.run(action.id, {}, 'mcp');
        await store.mutate(state => {
          const { addAudit } = auditHelpers;
          addAudit(state, 'mcp.action.execute', live.userId, action.id);
        });
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
    if (request.headers.origin && request.headers.origin !== origin)
      return reply.code(403).send({ error: 'MCP Origin not allowed' });
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
