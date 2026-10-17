import test from 'node:test';
import assert from 'node:assert/strict';
import {certificateCoversSite,matchingCertificates} from '../apps/web/src/nginx-certificates.js';

test('matching certificates stays in the selected website and respects DNS wildcards',()=>{
  assert.equal(certificateCoversSite('fixture.test','FIXTURE.TEST.'),true);
  assert.equal(certificateCoversSite('*.fixture.test','www.fixture.test'),true);
  assert.equal(certificateCoversSite('*.fixture.test','a.b.fixture.test'),false);
  assert.equal(certificateCoversSite('*.fixture.test','fixture.test'),false);
  assert.equal(certificateCoversSite('*.fixture.test','*.fixture.test'),true);
  assert.equal(certificateCoversSite('other.test','fixture.test'),false);
  assert.equal(certificateCoversSite('fixture.test','_'),false);
  assert.equal(certificateCoversSite('fixture.test','~^regex'),false);
  assert.equal(certificateCoversSite('', 'fixture.test'),false);
  const all=[{name:'a',domains:['fixture.test']},{name:'b',domains:['*.example.test']},
    {name:'c',domains:['other.test']},{name:'no-san',domains:[]}];
  assert.deepEqual(matchingCertificates(all,['fixture.test']).map(c=>c.name),['a']);
  assert.deepEqual(matchingCertificates(all,['sub.example.test']).map(c=>c.name),['b']);
  assert.deepEqual(matchingCertificates(all,['deep.sub.example.test']),[]);
  assert.deepEqual(matchingCertificates(all,['nonexistent.test']),[]);
  assert.deepEqual(matchingCertificates(all,['~^.*$']),[]);
  assert.deepEqual(matchingCertificates(null,['fixture.test']),[]);
});
