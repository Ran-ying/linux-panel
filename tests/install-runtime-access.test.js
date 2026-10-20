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

test('first-install root option enables fixed executor only after Web starts',()=>{
  const source=read('../scripts/install.sh');
  const active=source.indexOf('systemctl is-active --quiet linux-panel.service');
  const optin=source.indexOf('if ((LP_ENABLE_PRIVILEGED));then');
  const install=source.indexOf('bash /opt/linux-panel/scripts/install-privileged-executor.sh --enable');
  assert.ok(active>=0 && active<optin && optin<install);
  assert.match(source,/--privileged-node-bin requires --enable-privileged/);
  assert.match(source,/Root file Actions OFF by default/);
  const workflow=read('../.github/workflows/fresh-install.yml');
  assert.match(workflow,/--enable-privileged --privileged-node-bin \/usr\/lib\/linux-panel-root-test-runtime\/node/);
  assert.doesNotMatch(workflow,/sudo bash \/opt\/linux-panel\/scripts\/install-privileged-executor.sh --enable/);
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

test('manual updater runs runtime-dependent tests as unprivileged Web UID with clean env',()=>{
  const script=read('../scripts/update.sh');
  const install=script.indexOf('npm ci --no-audit --no-fund');
  const earlyPermissions=script.indexOf('chmod -R -- g+rX,g-w,o-w /opt/linux-panel');
  const tests=script.indexOf('runuser -u linuxpanel -- env -i');
  const build=script.indexOf('npm run build:web');
  assert.ok(install>=0 && earlyPermissions>install && tests>earlyPermissions && build>tests,
    'dependencies must be readable to ordinary Web account before running tests');
  assert.match(script,/NODE_ENV=test/);
  assert.match(script,/HOME=\/var\/lib\/linux-panel/);
  assert.match(script,/\/opt\/node24\/bin\/npm test/);
  assert.doesNotMatch(script,/^npm test$/m,'root execution of runtime-sensitive tests must be forbidden');
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
