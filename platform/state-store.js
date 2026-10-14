import { mkdir, readFile, open, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_SETTINGS = Object.freeze({ panelName: 'Linux Panel', language: 'zh-CN', theme: 'dark' });
const emptyState = () => ({
  version: 1, users: [], sessions: [], settings: { ...DEFAULT_SETTINGS }, audit: []
});

/**
 * A small, local single-process store. Every mutation is serialized and written
 * via atomic rename, permissions 0600. Never put it in the Git checkout's public
 * static assets directory. A single active API process is required.
 */
export class StateStore {
  #tail = Promise.resolve();
  constructor(filePath) { this.filePath = filePath; }

  async read() {
    try {
      const info = await stat(this.filePath);
      if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077)))
        throw new Error('Panel state file must be a private regular file (0600)');
      const state = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.users) ||
          !Array.isArray(state.sessions) || !Array.isArray(state.audit) ||
          !state.settings || typeof state.settings !== 'object')
        throw new Error('Invalid panel state format');
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState();
      throw error;
    }
  }

  async snapshot() {
    await this.#tail;
    return this.read();
  }

  async mutate(transform) {
    const task = this.#tail.then(async () => {
      const state = await this.read();
      const result = await transform(state);
      const folder = dirname(this.filePath);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const temp = join(folder, `.panel-${randomBytes(12).toString('hex')}.tmp`);
      let handle;
      try {
        handle = await open(temp, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(state, null, 2) + '\n', 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temp, this.filePath);
      } finally {
        await handle?.close();
        await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; });
      }
      return result;
    });
    this.#tail = task.catch(() => {});
    return task;
  }
}

export function addAudit(state, event, actor = null, detail = null) {
  state.audit.push({ id: randomBytes(8).toString('hex'), at: new Date().toISOString(), event, actor, detail });
  if (state.audit.length > 500) state.audit.splice(0, state.audit.length - 500);
}
