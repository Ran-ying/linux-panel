import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Discover trusted, bundled modules. NOT a sandbox or arbitrary plugin loader. */
export class ModuleManager {
  constructor(directory, actions) {
    this.directory = directory;
    this.actions = actions;
    this.loaded = [];
  }

  async loadAll(savedOrder) {
    // Removing all optional business modules must not disable Auth or Panel Settings.
    let entries;
    try { entries = await readdir(this.directory, { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOENT') entries = [];
      else throw error;
    }
    const definitions = new Map();
    for (const item of entries.filter(e => e.isDirectory())) {
      const folder = join(this.directory, item.name);
      const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
      if (manifest.id !== item.name || manifest.entry !== './index.js') {
        throw new Error(`Invalid bundled module manifest: ${item.name}`);
      }
      if (definitions.has(manifest.id)) throw new Error(`Duplicate module: ${manifest.id}`);
      if (manifest.navigationOrder !== undefined && !Number.isFinite(manifest.navigationOrder))
        throw new Error(`Invalid navigationOrder: ${manifest.id}`);
      definitions.set(manifest.id, { manifest, folder });
    }

    const active = new Set();
    const visited = new Set();
    const visit = async (id) => {
      if (visited.has(id)) return;
      if (active.has(id)) throw new Error(`Circular dependency involving ${id}`);
      const def = definitions.get(id);
      if (!def) throw new Error(`Missing module dependency: ${id}`);
      active.add(id);
      for (const dependency of def.manifest.dependencies ?? []) await visit(dependency);
      const mod = await import(pathToFileURL(join(def.folder, 'index.js')).href);
      if (typeof mod.setup !== 'function') throw new Error(`No setup() for module ${id}`);
      try {
        await mod.setup({ actions: this.actions, moduleId: id });
      } catch (error) {
        this.actions.unregisterModule(id);
        throw error;
      }
      active.delete(id);
      visited.add(id);
      this.loaded.push({ id, name: def.manifest.name, version: def.manifest.version });
    };
    for (const id of definitions.keys()) await visit(id);
    // Persisted order wins. A newly discovered module always appends, even when
    // its manifest requests an earlier bootstrap position. Keep missing IDs in
    // the saved list so temporarily disabled modules retain their position.
    const initial=[...definitions.keys()].sort((a,b)=>
      (definitions.get(a).manifest.navigationOrder ?? Number.MAX_SAFE_INTEGER)-
      (definitions.get(b).manifest.navigationOrder ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b));
    this.order=Array.isArray(savedOrder)?[...new Set(savedOrder.filter(id=>typeof id==='string'))]:initial;
    for(const id of initial)if(!this.order.includes(id))this.order.push(id);
    this.loaded.sort((a,b)=>this.order.indexOf(a.id)-this.order.indexOf(b.id));
    return this.loaded;
  }
}
