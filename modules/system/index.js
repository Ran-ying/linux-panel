import info from './actions/info.js';

export async function setup({ actions, moduleId }) {
  actions.register(moduleId, info);
}
