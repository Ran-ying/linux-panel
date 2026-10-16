import info from './actions/info.js';
import resources from './actions/resources.js';

export async function setup({actions,moduleId}) {
  for(const action of [info,resources])actions.register(moduleId,action);
}
