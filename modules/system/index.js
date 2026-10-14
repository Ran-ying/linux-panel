import info from './actions/info.js';
import memory from './actions/memory.js';
import cpu from './actions/cpu.js';

export async function setup({ actions, moduleId }) {
  for (const action of [info, memory, cpu]) actions.register(moduleId, action);
}
