import info from './actions/info.js';
import resources from './actions/resources.js';

export async function setup({actions,moduleId}) {
  for(const action of [resources,info])actions.register(moduleId,action);
}
