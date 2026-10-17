import test from 'node:test';
import assert from 'node:assert/strict';
import {VISUAL_SECTIONS,visualBasePath,visualEntries,supportsVisual,patchVisual,formatList} from '../apps/web/src/components/v2ray-visual.js';

const fixture=()=>({
  inbounds:[{tag:'public',protocol:'vmess',port:443,settings:{clients:[{id:'private-id',level:2}]},
    streamSettings:{network:'ws',wsSettings:{path:'/secret'}}}],
  outbounds:[{tag:'direct',protocol:'freedom',settings:{}}],
  outboundDetour:[{tag:'remote',protocol:'vmess',settings:{vnext:[{address:'example.test',port:8443,
    users:[{id:'private-uuid',security:'auto'}]}]},streamSettings:{security:'tls'}}],
  routing:{strategy:'rules',settings:{rules:[{type:'field',outboundTag:'direct',
    domain:['domain:example.test'],otherUndocumentedField:7}],unknown:'keep'}},
  personalExtension:{secret:'unrelated-opaque-data'}
});
test('all V2Ray inbound/outbound including legacy and both routing layouts support visual editing',()=>{
  const base=fixture();
  assert.equal(VISUAL_SECTIONS.has('routing'),true);
  assert.deepEqual(visualBasePath(base,'routing'),['routing','settings','rules']);
  assert.equal(visualEntries(base,'outboundDetour').length,1);
  assert.ok(supportsVisual(base,'routing'));
  assert.deepEqual(visualBasePath({routing:{rules:[]}},'routing'),['routing','rules']);
  assert.equal(supportsVisual(base,'full'),false);
  assert.equal(supportsVisual({...base,inbounds:{}},'inbounds'),false);
  assert.equal(formatList(['a','b']),'a\nb');
});
test('visual field edits keep unrelated secrets and unknown fields verbatim',()=>{
  const base=fixture();
  const a=patchVisual(base,'inbounds',{action:'set',path:[0,'port'],value:'8443',kind:'number'});
  assert.equal(a.inbounds[0].port,8443);
  assert.equal(a.inbounds[0].settings.clients[0].id,'private-id');
  assert.deepEqual(a.personalExtension,base.personalExtension);
  assert.deepEqual(a.outboundDetour,base.outboundDetour);
  const b=patchVisual(a,'outboundDetour',{action:'set',path:[0,'settings','vnext',0,'address'],value:'new.example'});
  assert.equal(b.outboundDetour[0].settings.vnext[0].address,'new.example');
  assert.equal(b.outboundDetour[0].settings.vnext[0].users[0].id,'private-uuid');
  assert.equal(base.outboundDetour[0].settings.vnext[0].address,'example.test');
});
test('routing visual changes preserve legacy settings and work with direct rules',()=>{
  const a=patchVisual(fixture(),'routing',{action:'set',path:[0,'domain'],value:'domain:a.test\ndomain:b.test',kind:'list'});
  assert.deepEqual(a.routing.settings.rules[0].domain,['domain:a.test','domain:b.test']);
  assert.equal(a.routing.settings.rules[0].otherUndocumentedField,7);
  assert.equal(a.routing.settings.unknown,'keep');
  const b=patchVisual({routing:{rules:[]}},'routing',{action:'add',item:{type:'field',outboundTag:''}});
  assert.equal(b.routing.rules.length,1);
  assert.equal(b.routing.settings,undefined);
});
test('visual list edits modify only target arrays and protect against invalid paths and numbers',()=>{
  let a=patchVisual(fixture(),'inbounds',{action:'add',item:{tag:'new',protocol:'socks'}});
  assert.equal(a.inbounds.length,2);
  a=patchVisual(a,'inbounds',{action:'remove',path:[1]});
  assert.deepEqual(a,fixture());
  const b=patchVisual(a,'outboundDetour',{action:'add',path:[0,'settings','vnext',0,'users'],item:{id:'new-user'}});
  assert.equal(b.outboundDetour[0].settings.vnext[0].users.length,2);
  assert.equal(a.outboundDetour[0].settings.vnext[0].users.length,1);
  const c=patchVisual({outbounds:[{tag:'x',protocol:'freedom'}]},'outbounds',
    {action:'set',path:[0,'sendThrough'],value:''});
  assert.equal(Object.hasOwn(c.outbounds[0],'sendThrough'),false);
  assert.throws(()=>patchVisual(a,'inbounds',{action:'set',path:[0,'port'],value:'NaN',kind:'number'}));
  assert.throws(()=>patchVisual(a,'inbounds',{action:'set',path:[0,'__proto__'],value:'x'}));
  assert.throws(()=>patchVisual(a,'routing',{action:'remove',path:[999]}));
});
