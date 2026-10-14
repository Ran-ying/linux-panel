import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = new Set(['metrics', 'progress', 'table']);
const FORMATS = new Set(['bytes', 'duration', 'milliseconds', 'integer']);

/**
 * The Web adapter owns UI descriptors. It imports only trusted, bundled module
 * files after ModuleManager has loaded the corresponding module.
 * It NEVER registers Actions, changes permissions or schedules background jobs.
 */
export async function loadWebPresentations(modulesPath, loadedModules, registry) {
  const visible = new Map(registry.list('web').map(action => [action.id, action]));
  const presentations = [];
  const seen = new Set();

  for (const module of loadedModules) {
    const path = join(modulesPath, module.id, 'ui', 'presentations.js');
    try {
      await access(path);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const imported = await import(pathToFileURL(path).href);
    if (!Array.isArray(imported.default)) throw new Error(`Invalid UI descriptors for ${module.id}`);

    for (const item of imported.default) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid UI descriptor');
      if (typeof item.actionId !== 'string' || !item.actionId.startsWith(`${module.id}.`))
        throw new Error(`UI descriptor must refer to its own module: ${module.id}`);
      if (seen.has(item.actionId)) throw new Error(`Duplicate UI descriptor: ${item.actionId}`);
      const action = visible.get(item.actionId);
      if (!action) throw new Error(`UI references an unavailable Web Action: ${item.actionId}`);
      if (!TYPES.has(item.renderer)) throw new Error(`Unsupported UI renderer: ${item.renderer}`);
      // A page may opt into a one-shot initial read, but never auto-run a write
      // Action or an Action requiring parameters. The Engine remains authoritative.
      if (item.loadOnEnter !== undefined && typeof item.loadOnEnter !== 'boolean')
        throw new Error(`Invalid loadOnEnter flag: ${item.actionId}`);
      if (item.loadOnEnter && (action.kind !== 'read' || (action.inputSchema?.required?.length ?? 0) > 0))
        throw new Error(`Unsafe automatic initial read: ${item.actionId}`);
      const interval = item.refreshIntervalMs ?? 0;
      if (!Number.isInteger(interval) || (interval !== 0 && (interval < 3000 || interval > 60000)))
        throw new Error(`Unsafe refresh interval: ${item.actionId}`);
      // Show only fields declared by the Action output contract, not arbitrary paths.
      const schema = action.outputSchema?.properties;
      if (!schema) throw new Error(`Web UI requires an outputSchema: ${item.actionId}`);
      const checkField = (f, available) => {
        if (!f || typeof f.key !== 'string' || !Object.hasOwn(available, f.key))
          throw new Error(`UI references an unknown result field: ${item.actionId}`);
        if (f.format && !FORMATS.has(f.format)) throw new Error(`Unsupported field format: ${f.format}`);
        if (typeof f.label !== 'string' || f.label.length > 100) throw new Error('Invalid field label');
      };
      if (item.renderer === 'metrics') {
        if (!Array.isArray(item.fields) || !item.fields.length) throw new Error('Missing metric fields');
        item.fields.forEach(f => checkField(f, schema));
      } else if (item.renderer === 'table') {
        const nested = schema[item.rowsKey]?.items?.properties;
        if (!nested || !Array.isArray(item.columns) || !item.columns.length)
          throw new Error('Invalid table fields');
        item.columns.forEach(f => checkField(f, nested));
      } else {
        if (typeof item.valueKey !== 'string' || schema[item.valueKey]?.type !== 'number')
          throw new Error(`Invalid progress value field: ${item.actionId}`);
        for (const key of ['totalKey', 'usedKey', 'availableKey']) {
          if (item[key] && schema[item[key]]?.type !== 'number')
            throw new Error(`Invalid progress quantity field: ${item.actionId}`);
        }
        if (item.details) {
          if (!Array.isArray(item.details)) throw new Error('Invalid detail fields');
          item.details.forEach(f => checkField(f, schema));
        }
      }
      // UI values must be inert JSON, with no executable callbacks exposed.
      presentations.push(JSON.parse(JSON.stringify(item)));
      seen.add(item.actionId);
    }
  }
  return presentations;
}
