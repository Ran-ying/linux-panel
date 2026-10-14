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

  async loadAll() {
    const entries = await readdir(this.directory, { withFileTypes: true });
    const definitions = new Map();
    for (const item of entries.filter(e => e.isDirectory())) {
      const folder = join(this.directory, item.name);
      const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
      if (manifest.id !== item.name || manifest.entry !== './index.js') {
        throw new Error(`Invalid bundled module manifest: ${item.name}`);
      }
      if (definitions.has(manifest.id)) throw new Error(`Duplicate module: ${manifest.id}`);
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
    return this.loaded;
  }
}
