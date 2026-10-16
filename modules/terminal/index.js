import execute from './actions/execute.js';
export async function setup({actions,moduleId}){actions.register(moduleId,execute);}
