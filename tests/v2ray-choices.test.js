import test from 'node:test';
import assert from 'node:assert/strict';
import {v2raySelectChoices} from '../apps/web/src/components/v2ray-choices.js';

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
