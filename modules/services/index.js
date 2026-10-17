import list from './actions/list.js';
import logs from './actions/logs.js';

export async function setup({ actions, moduleId }) {
  actions.register(moduleId, list);
  actions.register(moduleId, logs);
}
