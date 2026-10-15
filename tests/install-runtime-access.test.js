// Regression: installing or updating on behalf of one UID must not leave
// generated runtime files invisible to the unprivileged Web service UID.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url),'utf8');

test('first install normalizes generated files and imports dependencies as Web identity before bootstrap',()=>{
  const script=read('../scripts/install.sh');
  const permissions=script.indexOf('chmod -R g+rX,g-w,o-w /opt/linux-panel');
  const fastify=script.indexOf('runuser -u linuxpanel -- test -r /opt/linux-panel/node_modules/fastify/package.json');
  const importCheck=script.indexOf('runuser -u linuxpanel -- "$NODE_BIN" --input-type=module');
  const init=script.indexOf("log 'Initialize admin credentials interactively (only once)'");
  assert.ok(permissions>=0 && permissions<fastify && fastify<importCheck && importCheck<init,
    'Web permissions/imports must be checked before initializing production admin credentials');
  assert.match(script,/runuser -u linuxpanel -- test -r \/opt\/linux-panel\/apps\/web\/dist\/index\.html/);
});

test('manual updater refuses any installed Broker and restores Web access after npm ci',()=>{
  const script=read('../scripts/update.sh');
  const guard=script.indexOf('Installed update Broker detected');
  const stop=script.indexOf('systemctl stop linux-panel.service');
  const npm=script.indexOf('npm ci --no-audit --no-fund');
  const build=script.indexOf('npm run build:web');
  const permissions=script.indexOf('chmod -R g+rX,g-w,o-w /opt/linux-panel');
  const importCheck=script.indexOf('await import(\'fastify\')');
  const start=script.indexOf('systemctl start linux-panel.service');
  assert.ok(guard>=0 && guard<stop && npm<build && build<permissions &&
    permissions<importCheck && importCheck<start);
  assert.match(script,/chown -R root:linuxpanel \/opt\/linux-panel/);
});

test('privileged Broker does not enlarge root capabilities to chmod updater files',()=>{
  const worker=read('../scripts/update-worker.sh');
  assert.match(worker,/as_updater chmod -R -- g\+rX,g-w,o-w "\$d"/);
  assert.match(worker,/chgrp -R -- linuxpanel "\$d"/);
  assert.match(worker,/if ! ensure_web_read_access;then rollback;exit 1;fi/);
  assert.match(worker,/if ! ensure_web_read_access \|\| ! start_panel/);
  const unit=read('../deployment/systemd/linux-panel-update.service');
  assert.doesNotMatch(unit,/CAP_FOWNER/);
});
