import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/upgrade-update-broker.sh',import.meta.url),'utf8');
const start=script.indexOf('web_guard_loaded(){');
const end=script.indexOf('\ninstalled_verify(){',start);
assert.ok(start>=0&&end>start,'guard implementation must exist');
const guard=script.slice(start,end);
const first='ConditionPathExists=|!/var/lib/linux-panel-update-root/active-transaction';
const second='ConditionPathExists=|/run/linux-panel-root-updater/allow-panel-start';

function check(mode){
 const runner=[
  'set -Eeuo pipefail',
  'MODE='+JSON.stringify(mode),
  'systemctl(){',
  '  [[ "$1" == cat && "$2" == linux-panel.service ]] || return 19',
  '  case "$MODE" in',
  '    both|error)',
  '      printf "%s\\n" '+JSON.stringify(first)+' '+JSON.stringify(second),
  '      ;;',
  '    first_only) printf "%s\\n" '+JSON.stringify(first)+' ;;',
  '    second_only) printf "%s\\n" '+JSON.stringify(second)+' ;;',
  '    partial) printf "%s\\n" '+JSON.stringify(first+'-missing')+' '+JSON.stringify(second)+' ;;',
  '  esac',
  '  # Make the old pipe-to-grep -q implementation hit SIGPIPE reliably',
  '  # while testing an early match in a multi-drop-in service definition.',
  '  if [[ "$MODE" == both ]];then',
  '    for ((i=0;i<8000;i++));do printf "After=network-%05d.target\\n" "$i";done',
  '  fi',
  '  [[ "$MODE" != error ]]',
  '}',
  guard,
  'if web_guard_loaded;then echo GUARD_PASS;else echo GUARD_BLOCK;fi'
 ].join('\n');
 return spawnSync('bash',['-c',runner],{encoding:'utf8',timeout:10000});
}
test('two loaded guard directives pass despite large later systemctl output and pipefail',()=>{
 const out=check('both');
 assert.equal(out.status,0,out.stderr);
 assert.match(out.stdout,/GUARD_PASS/);
});
test('each missing or partially matching directive blocks migration',()=>{
 for(const mode of ['first_only','second_only','partial']){
  const out=check(mode);
  assert.equal(out.status,0,out.stderr);
  assert.match(out.stdout,/GUARD_BLOCK/,mode);
 }
});
test('a failed systemctl cat blocks even if it emitted both directives',()=>{
 const out=check('error');
 assert.equal(out.status,0,out.stderr);
 assert.match(out.stdout,/GUARD_BLOCK/);
});
test('migration verification avoids grep -q pipefail false negatives',()=>{
 assert.doesNotMatch(script,/systemctl cat linux-panel\.service\s*\|\s*grep -Fq/);
 assert.match(script,/if web_guard_loaded;then/);
});
