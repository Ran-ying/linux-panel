import {isUserShellAction} from '../../../core/action-policy.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = new Set(['metrics', 'progress', 'table', 'sections', 'terminal', 'gauge']);
const FORMATS = new Set(['bytes', 'duration', 'milliseconds', 'integer', 'number']);

function validateView(view,schema,actionId,depth=0) {
  if(!TYPES.has(view.renderer))throw new Error('Unsupported UI renderer');
      const checkField = (f, available) => {
        if (!f || typeof f.key !== 'string' || !Object.hasOwn(available, f.key))
          throw new Error(`UI references an unknown result field: ${actionId}`);
        if (f.format && !FORMATS.has(f.format)) throw new Error(`Unsupported field format: ${f.format}`);
        if (typeof f.label !== 'string' || f.label.length > 100) throw new Error('Invalid field label');
      };
      if (view.renderer === 'sections') {
        if(view.layout!==undefined && view.layout!=='grid')throw new Error('Invalid sections layout');
        if(depth>=3 || !Array.isArray(view.sections) || !view.sections.length || view.sections.length>12)
          throw new Error('Invalid sections');
        for(const section of view.sections) {
          if(!section || typeof section!=='object')throw new Error('Invalid section');
          if(section.key!==undefined && typeof section.key!=='string')throw new Error('Invalid section key');
          const nested=section.key===undefined?schema:schema[section.key]?.properties;
          if(!nested)throw new Error('Section must reference an object result field');
          validateView(section,nested,actionId,depth+1);
        }
      } else if (view.renderer === 'metrics') {
        if (!Array.isArray(view.fields) || !view.fields.length) throw new Error('Missing metric fields');
        view.fields.forEach(f => checkField(f, schema));
      } else if (view.renderer === 'table') {
        const nested = schema[view.rowsKey]?.items?.properties;
        if (!nested || !Array.isArray(view.columns) || !view.columns.length)
          throw new Error('Invalid table fields');
        view.columns.forEach(f => checkField(f, nested));
      } else if(view.renderer==='terminal') {
        for(const key of ['stdout','stderr'])
          if(schema[key]?.type!=='string')throw new Error('Terminal renderer requires text output fields');
      } else {
        if (typeof view.valueKey !== 'string' || schema[view.valueKey]?.type !== 'number')
          throw new Error(`Invalid progress value field: ${actionId}`);
        for (const key of ['totalKey', 'usedKey', 'availableKey']) {
          if (view[key] && !['number','integer'].includes(schema[view[key]]?.type))
            throw new Error(`Invalid progress quantity field: ${actionId}`);
        }
        if(view.renderer==='gauge'){
          if(!view.totalKey && !view.details?.length)throw new Error('Gauge requires a total quantity or detail fields');
          if(view.quantityFormat!==undefined && !['bytes','number'].includes(view.quantityFormat))
            throw new Error('Invalid gauge quantity format');
          if(view.unit!==undefined && (typeof view.unit!=='string' || view.unit.length>20))
            throw new Error('Invalid gauge unit');
        }
        if (view.details) {
          if (!Array.isArray(view.details)) throw new Error('Invalid detail fields');
          view.details.forEach(f => checkField(f, schema));
        }
      }

}

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
      const schema=action.outputSchema?.properties;
      if(!schema)throw new Error('Web UI requires an outputSchema: '+item.actionId);
      validateView(item,schema,item.actionId);
      if(item.console!==undefined && (item.console!=='terminal' || !isUserShellAction(registry.get(item.actionId))))
        throw new Error('Interactive terminal requires an approved user-shell Action');
      if(item.inputsLabel!==undefined && (typeof item.inputsLabel!=='string' || item.inputsLabel.length>100))
        throw new Error('Invalid input section label');
      if(item.inputs!==undefined){
        if(!Array.isArray(item.inputs) || !item.inputs.length || item.inputs.length>12)throw new Error('Invalid input descriptors');
        const keys=new Set();
        for(const field of item.inputs){
          const property=action.inputSchema?.properties?.[field.key];
          if(!field || typeof field.key!=='string' || keys.has(field.key) || !property ||
            property.type!=='string' || !['textarea','text','select'].includes(field.type) ||
            typeof field.label!=='string' || field.label.length>100 ||
            field.placeholder!==undefined && typeof field.placeholder!=='string')
            throw new Error('Invalid input descriptor');
          if(field.type==='select'){
            const options=schema[field.optionsKey];
            if(typeof field.optionsKey!=='string' || options?.type!=='array' || options.items?.type!=='string')
              throw new Error('Select options must reference a string array result field');
          }
          keys.add(field.key);
        }
      }
      // UI values must be inert JSON, with no executable callbacks exposed.
      presentations.push(JSON.parse(JSON.stringify(item)));
      seen.add(item.actionId);
    }
  }
  return presentations;
}
