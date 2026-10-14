import usage from './actions/usage.js';

export async function setup({ actions, moduleId }) {
  actions.register(moduleId, usage);
}
