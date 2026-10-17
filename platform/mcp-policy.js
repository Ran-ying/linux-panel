import {isUserShellAction,isTelegramInteractionAction,isCertbotReconfigureAction} from '../core/action-policy.js';
import { addAudit } from './state-store.js';

// A missing v0.4 policy always fails closed. v0.3 state files need no migration.
export const defaultMcpPolicy = () => ({ enabled: false, registrationEnabled: false, allowUpdates: false, allowDirectUpdates: false, tools: {} });
export const forbidden = message => Object.assign(new Error(message), { statusCode: 403 });
export const missing = message => Object.assign(new Error(message), { statusCode: 404 });

export function exposedReadActions(registry) {
  return registry.list('mcp').filter(action =>
    action.kind === 'read' && typeof action.permission === 'string' && action.permission.length > 0
  );
}
export function exposedMcpActions(registry) {
  return registry.list('mcp').filter(action=>
    action.kind==='read' && typeof action.permission==='string' && action.permission.length>0 ||
    isUserShellAction(registry.get(action.id)) || isTelegramInteractionAction(registry.get(action.id)) || isCertbotReconfigureAction(registry.get(action.id)));
}
export function mcpPolicy(state) {
  return state.mcp?.policy ?? defaultMcpPolicy();
}
// This is a personal-panel, trusted-client model: every explicitly MCP-exposed
// read Action is available to an authenticated client while MCP is enabled.
// Legacy per-Action checkboxes in saved state are intentionally ignored.
export function actionAllowed(state, action) {
  return mcpPolicy(state).enabled === true &&
    (action?.kind === 'read' || isUserShellAction(action) || isTelegramInteractionAction(action) || isCertbotReconfigureAction(action)) &&
    action?.exposure?.mcp === true &&
    typeof action.permission === 'string' &&
    action.permission.length > 0;
}

/**
 * Legacy tool selections are validated then discarded; global source-declared capabilities govern access.
 */
export async function setMcpPolicy(store, registry, input, actor) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.enabled !== 'boolean' || typeof input.registrationEnabled !== 'boolean' ||
      (input.tools !== undefined && (!input.tools || typeof input.tools !== 'object' || Array.isArray(input.tools))) ||
      Object.keys(input).some(key => !['enabled','registrationEnabled','allowUpdates','allowDirectUpdates','tools'].includes(key)) ||
      (input.allowUpdates !== undefined && typeof input.allowUpdates !== 'boolean') ||
      (input.allowDirectUpdates !== undefined && typeof input.allowDirectUpdates !== 'boolean'))
    throw Object.assign(new Error('Invalid MCP policy'), { statusCode: 400 });
  const known = new Set(exposedMcpActions(registry).map(a => a.id));
  for (const [id, enabled] of Object.entries(input.tools ?? {})) {
    if (!known.has(id) || typeof enabled !== 'boolean')
      throw Object.assign(new Error('Unknown or invalid MCP tool: ' + id), { statusCode: 400 });
  }
  const cleaned = { enabled: input.enabled, registrationEnabled: input.enabled && input.registrationEnabled,
    allowUpdates: input.enabled && input.allowUpdates === true,
    allowDirectUpdates: input.enabled && input.allowDirectUpdates === true,
    // Clear obsolete per-Action policy. Future MCP-exposed read Actions are
    // automatically discoverable, with write actions still separately gated.
    tools: {} };
  await store.mutate(state => {
    state.mcp ??= {};
    state.mcp.policy = cleaned;
    addAudit(state, 'mcp.policy.updated', actor);
  });
  return cleaned;
}
