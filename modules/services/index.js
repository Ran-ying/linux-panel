import list from './actions/list.js';

export async function setup({ actions, moduleId }) {
  actions.register(moduleId, list);
}
