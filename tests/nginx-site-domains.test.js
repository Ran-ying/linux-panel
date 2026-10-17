import test from 'node:test';
import assert from 'node:assert/strict';
import {validNginxDomain,updateNginxSiteDomain} from '../apps/web/src/nginx-site-domains.js';

test('Nginx domain add/remove changes only matching literal server_name values',()=>{
  const original=`# server_name skip.example.com;
map $host $foo { default "server_name also.skip.example.com;"; }
server {
    listen 80;
    server_name ai.rany.ing www.ai.rany.ing; # no configuration change outside names
    location / { proxy_pass http://127.0.0.1:8080; }
}
server {
    listen 443 ssl;
    server_name ai.rany.ing www.ai.rany.ing;
    ssl_certificate /etc/letsencrypt/live/ai.rany.ing/fullchain.pem;
}
`;
  const added=updateNginxSiteDomain(original,'add','STATIC.RANY.ING');
  assert.equal((added.match(/server_name ai.rany.ing www.ai.rany.ing static.rany.ing;/g)||[]).length,2);
  assert.ok(added.includes('server_name skip.example.com;'));
  assert.ok(added.includes('"server_name also.skip.example.com;"'));
  assert.ok(added.includes('proxy_pass http://127.0.0.1:8080;'));
  assert.ok(added.includes('ssl_certificate /etc/letsencrypt/live/ai.rany.ing/fullchain.pem;'));
  const removed=updateNginxSiteDomain(added,'remove','STATIC.RANY.ING');
  assert.equal(removed,original);
  assert.equal(updateNginxSiteDomain('server { server_name foo.test bar.test; }',
    'remove','bar.test'),'server { server_name foo.test; }');
});

test('Nginx domain operations refuse injection, duplicates, last removal and ambiguous setups',()=>{
  for(const bad of ['','_','bad name.test','bad;include /tmp/x;','a.test\nserver_name b.test',
    'bad#.test','x.test/anything','https://foo.test','..foo.test','a'.repeat(64)+'.test']){
    assert.equal(validNginxDomain(bad),false,bad);
  }
  for(const good of ['ai.rany.ing','WWW.EXAMPLE.COM','*.example.com','a-b.test']){
    assert.equal(validNginxDomain(good),true,good);
  }
  const simple='server { server_name foo.test bar.test; }';
  assert.throws(()=>updateNginxSiteDomain(simple,'add','FOO.test'),/已经存在/);
  assert.throws(()=>updateNginxSiteDomain(simple,'remove','missing.test'),/不在当前配置/);
  assert.throws(()=>updateNginxSiteDomain('server { server_name foo.test; }','remove','foo.test'),/最后一个/);
  assert.throws(()=>updateNginxSiteDomain(simple,'add','bad; root /;'),/合法域名/);
  assert.throws(()=>updateNginxSiteDomain('server { server_name foo.test; }server { server_name bar.test; }',
    'add','baz.test'),/不同域名/);
  assert.throws(()=>updateNginxSiteDomain('server { server_name ~^foo.*$; }','add','bar.test'),/特殊|复杂/);
  assert.throws(()=>updateNginxSiteDomain('server { server_name $dynamic; }','add','bar.test'),/特殊|复杂/);
  assert.throws(()=>updateNginxSiteDomain('# server_name foo.test;','add','bar.test'),/未找到/);
  assert.throws(()=>updateNginxSiteDomain('server { server_name "foo.test"; }',
    'add','bar.test'),/复杂/);
  assert.throws(()=>updateNginxSiteDomain('server { listen 80; }','add','bar.test'),/未找到/);
});
