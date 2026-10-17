import test from 'node:test';
import assert from 'node:assert/strict';
import {v2raySelectChoices,v2rayRoutingTagChoices} from '../apps/web/src/components/v2ray-choices.js';

test('V2Ray visual selectors offer common protocols, addresses and transport choices',()=>{
  for(const [kind,wanted] of [
    ['inboundProtocol',['vmess','socks','shadowsocks']],
    ['outboundProtocol',['freedom','blackhole','vmess']],
    ['listen',['127.0.0.1','0.0.0.0','::1','::']],
    ['network',['tcp','ws','grpc','quic']],
    ['security',['none','tls','utls']]
  ]){
    const values=v2raySelectChoices(kind,'').map(x=>x.value);
    assert.equal(values[0],'','unset choice should never force a default or change existing JSON');
    for(const x of wanted)assert.ok(values.includes(x),kind+' missing '+x);
  }
});
test('existing custom protocol, external bind IP and transport values are preserved by the select UI',()=>{
  for(const [kind,custom] of [['inboundProtocol','future-protocol'],
    ['outboundProtocol','private-plugin'],['listen','192.0.2.99'],
    ['network','future-transport'],['security','custom-sec']]){
    const options=v2raySelectChoices(kind,custom);
    assert.equal(options.filter(x=>x.value===custom).length,1);
    assert.equal(options.at(-1).value,custom);
    assert.equal(options.at(-1).label,custom);
  }
  const original=v2raySelectChoices('listen','0.0.0.0');
  assert.equal(original.filter(x=>x.value==='0.0.0.0').length,1);
  assert.throws(()=>v2raySelectChoices('untrusted-kind','x'),/未知/);
});

test('routing selectors include active and legacy inbound/outbound tags without renaming unknown values',()=>{
  const config={
    inbounds:[{tag:'front'},{tag:'front'},{tag:''},null],
    inboundDetour:[{tag:'legacy-front'}],
    outbounds:[{tag:'direct'},{tag:'proxy'}],
    outboundDetour:[{tag:'legacy-out'}]
  };
  assert.deepEqual(v2rayRoutingTagChoices(config,'inbound','missing-front').map(x=>x.value),
    ['','front','legacy-front','missing-front']);
  assert.deepEqual(v2rayRoutingTagChoices(config,'outbound','retired-out').map(x=>x.value),
    ['','direct','proxy','legacy-out','retired-out']);
  assert.deepEqual(v2rayRoutingTagChoices(config,'outbound','proxy').map(x=>x.value),
    ['','direct','proxy','legacy-out']);
  assert.deepEqual(v2rayRoutingTagChoices({inbounds:null,outboundDetour:null},'inbound').map(x=>x.value),['']);
  assert.throws(()=>v2rayRoutingTagChoices(config,'unknown','x'),/未知/);
});
