/**
 * Module-owned actions, shared discovery. This registry contains metadata and
 * function implementations; the UI and future MCP adapter only see metadata.
 */
export class ActionRegistry {
  #actions = new Map();

  register(moduleId, action) {
    if (!moduleId || typeof moduleId !== 'string') throw new Error('Invalid module ID');
    if (!action?.id?.startsWith(`${moduleId}.`)) {
      throw new Error(`Action ID must start with ${moduleId}.`);
    }
    if (this.#actions.has(action.id)) throw new Error(`Duplicate action: ${action.id}`);
    if (typeof action.execute !== 'function') throw new Error(`Missing execute(): ${action.id}`);
    if (!action.inputSchema || action.inputSchema.type !== 'object') {
      throw new Error(`Action must define an object inputSchema: ${action.id}`);
    }
    if (!['read', 'write'].includes(action.kind)) throw new Error(`Invalid kind: ${action.id}`);
    const stored = Object.freeze({ ...action, moduleId });
    this.#actions.set(action.id, stored);
  }

  get(id) { return this.#actions.get(id); }

  list(channel = 'web') {
    if (!['web', 'mcp'].includes(channel)) throw new Error('Unknown channel');
    return [...this.#actions.values()]
      .filter(a => a.exposure?.[channel] === true)
      .map(({ id, moduleId, title, description, inputSchema, kind, permission, explain }) => ({
        id, moduleId, title, description, inputSchema, kind, permission, explain
      }));
  }

  unregisterModule(moduleId) {
    for (const [id, action] of this.#actions) {
      if (action.moduleId === moduleId) this.#actions.delete(id);
    }
  }
}
