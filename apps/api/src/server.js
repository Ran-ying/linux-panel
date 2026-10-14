import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './create-app.js';
import { StateStore } from '../../../platform/state-store.js';
import { resolveListener, resolvePublicOrigin } from '../../../platform/listener.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const statePath=resolve(process.env.PANEL_DATA_DIR || resolve(root,'data'),'panel-state.json');
const listener=resolveListener(await new StateStore(statePath).snapshot());
const publicOrigin=resolvePublicOrigin(listener,process.env.PANEL_PUBLIC_ORIGIN || '');
const app = await createApp({root,statePath,publicOrigin,listener,logger:true});
await app.listen(listener);
