import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNginxSiteConfig,defaultSiteFilename,isIPv4,parseServerNames,validServerName,validateProxyTarget} from '../apps/web/src/nginx-site-create.js';

const allowed=['0.0.0.0','127.0.0.1','195.80.51.188','192.168.0.4','10.77.0.1'];

test('visual proxy site binds to actual server interface and does not generate root',()=>{
  const actual=buildNginxSiteConfig({hosts:'example.com, 195.80.51.188',
    bindAddress:'195.80.51.188',port:8080,kind:'proxy',proxyTarget:'http://127.0.0.1:3000'},
  {availableAddresses:allowed});
  assert.match(actual,/listen 195\.80\.51\.188:8080;/);
  assert.match(actual,/server_name example\.com 195\.80\.51\.188;/);
  assert.match(actual,/proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.match(actual,/proxy_set_header Host \$host;/);
  assert.match(actual,/proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
  assert.doesNotMatch(actual,/\broot\s+/);
  assert.equal(actual.at(-1),'\n');
});
test('visual static sites use root but never generate reverse proxy directives',()=>{
  const result=buildNginxSiteConfig({hosts:'static.example.test',
    bindAddress:'127.0.0.1',port:8888,kind:'static',root:'/var/www/html'},
  {availableAddresses:allowed});
  assert.match(result,/listen 127\.0\.0\.1:8888;/);
  assert.match(result,/root \/var\/www\/html;/);
  assert.match(result,/index index\.html;/);
  assert.doesNotMatch(result,/proxy_pass/);
});
test('visual hostname parser supports public IPv4, wildcards and multiple hosts',()=>{
  assert.deepEqual(parseServerNames('EXAMPLE.COM www.example.com, 198.51.100.7  example.com'),
    ['example.com','www.example.com','198.51.100.7']);
  assert.equal(defaultSiteFilename('*.EXAMPLE.COM'),'example.com');
  assert.equal(isIPv4('192.168.0.4'),true);
  assert.equal(isIPv4('999.99.0.2'),false);
  assert.equal(validServerName('*.sub.example.com'),true);
  assert.equal(validServerName('example.com;root /tmp'),false);
  assert.equal(validServerName('999.777.555.333'),false);
});
test('visual creation rejects non-host addresses, invalid ports and template injection',()=>{
  const base={hosts:'example.test',bindAddress:'0.0.0.0',port:80,
    kind:'proxy',proxyTarget:'http://127.0.0.1:3000'};
  for(const input of [
    {hosts:'example.test; include /etc/passwd;'},
    {hosts:'example.test\n} root /tmp;'},
    {hosts:'not_good_domain'},
    {hosts:'999.777.555.333'},
    {bindAddress:'198.51.100.20'},
    {bindAddress:'127.0.0.99'},
    {port:0},{port:65536},{port:1.1},{port:'80; add'},
    {kind:'bad'},
    {proxyTarget:'http://127.0.0.1:3000;\ninclude /etc/passwd'},
    {proxyTarget:'file:///etc/passwd'},
    {proxyTarget:'https://u:p@localhost/'},
    {proxyTarget:'http://localhost/a?bad=yes'},
    {proxyTarget:'http://localhost/foo#x'}
  ])assert.throws(()=>buildNginxSiteConfig({...base,...input},
    {availableAddresses:allowed}),undefined,JSON.stringify(input));
  assert.throws(()=>buildNginxSiteConfig({...base,kind:'static',root:'/var/www/html;\ninclude /etc/passwd'},
    {availableAddresses:allowed}));
  assert.throws(()=>buildNginxSiteConfig({...base,kind:'static',root:'relative/path'},
    {availableAddresses:allowed}));
  assert.equal(validateProxyTarget('https://backend.example.test:443/path'),'https://backend.example.test:443/path');
});
