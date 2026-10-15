import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';

const read = path => readFileSync(new URL(path,import.meta.url),'utf8');
const manifest = JSON.parse(read('../apps/web/public/manifest.webmanifest'));
const sw = read('../apps/web/public/sw.js');

test('installable standalone manifest has scoped entry and real raster icons',()=>{
  assert.equal(manifest.start_url,'/');
  assert.equal(manifest.scope,'/');
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.id,'/');
  for(const dimension of [192,512]){
    const icon=manifest.icons.find(i=>i.sizes===`${dimension}x${dimension}`);
    assert.ok(icon,`missing ${dimension} icon`);
    assert.equal(icon.type,'image/png');
    assert.match(icon.purpose,/maskable/);
    const file=readFileSync(new URL(`../apps/web/public${icon.src}`,import.meta.url));
    assert.deepEqual([...file.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.equal(file.readUInt32BE(16),dimension);
    assert.equal(file.readUInt32BE(20),dimension);
    assert.ok(file.length>1000);
    // Validate the complete image data, not just a fake header.
    let offset=8,idat=[];
    while(offset<file.length){
      const len=file.readUInt32BE(offset);
      const type=file.toString('ascii',offset+4,offset+8);
      if(type==='IDAT')idat.push(file.subarray(offset+8,offset+8+len));
      offset+=12+len;
      if(type==='IEND')break;
    }
    assert.equal(inflateSync(Buffer.concat(idat)).length,dimension*(1+dimension/4));
  }
});

test('viewport locking, safe areas, home-screen metadata and mobile navigation present',()=>{
  const html=read('../apps/web/index.html');
  const css=read('../apps/web/src/style.css');
  const entry=read('../apps/web/src/main.js');
  assert.match(html,/maximum-scale=1/);
  assert.match(html,/user-scalable=no/);
  assert.match(html,/viewport-fit=cover/);
  assert.match(html,/rel="manifest"/);
  assert.match(html,/rel="apple-touch-icon"/);
  assert.match(css,/env\(safe-area-inset-bottom/);
  assert.match(css,/@media\(max-width:730px\)/);
  assert.match(css,/\.module-nav\{[\s\S]*?overflow-x:auto/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/font-size:16px/);
  assert.match(entry,/registerPanelServiceWorker\(\)/);
});

test('service worker never caches auth/API/OAuth/MCP responses or HTML navigation',async()=>{
  const handlers=new Map();
  const storage=new Map();
  const cache={
    async addAll(urls){for(const url of urls)storage.set(url,new Response('public offline content',{status:200}));},
    async match(request){return storage.get(typeof request==='string'?request:new URL(request.url).pathname);},
    async put(request,response){storage.set(new URL(request.url).pathname,response);}
  };
  const caches={
    async open(){return cache;},
    async keys(){return ['linux-panel-public-v1'];},
    async delete(){return true;}
  };
  const fetchCalls=[];
  let broken=false;
  const fetch=async request=>{
    fetchCalls.push(request.url);
    if(broken)throw Error('offline');
    const response = new Response('NETWORK:'+request.url,{status:200});
    // Node's Response constructor has type=default; actual same-origin
    // browser fetch responses have type=basic.
    Object.defineProperty(response,'type',{value:'basic'});
    return response;
  };
  const scope={
    self:{
      location:{origin:'https://example.invalid'},
      addEventListener(type,cb){handlers.set(type,cb);},
      skipWaiting(){return Promise.resolve();},
      clients:{claim(){return Promise.resolve();}}
    },
    caches,fetch,URL,Response,Promise
  };
  runInNewContext(sw,scope,{filename:'sw.js',timeout:1000});
  assert.ok(handlers.has('install'));
  assert.ok(handlers.has('fetch'));
  let installed;
  handlers.get('install')({waitUntil(p){installed=p;}});
  await installed;
  assert.ok(storage.has('/offline.html'));
  for(const path of ['/api/auth/session','/api/actions/test/execute','/oauth/authorize',
                      '/mcp','/mcp/sse']){
    let intercepted=false;
    handlers.get('fetch')({request:{method:'GET',url:'https://example.invalid'+path,
      mode:'cors',destination:''},respondWith(){intercepted=true;}});
    assert.equal(intercepted,false,`private ${path} was intercepted`);
    assert.ok(!storage.has(path));
  }
  const nav={method:'GET',url:'https://example.invalid/',mode:'navigate',destination:'document'};
  let result;
  handlers.get('fetch')({request:nav,respondWith(p){result=p;}});
  assert.match(await (await result).text(),/^NETWORK:/);
  assert.ok(!storage.has('/'), 'authenticated index must never be cached');
  broken=true;
  handlers.get('fetch')({request:nav,respondWith(p){result=p;}});
  assert.match(await (await result).text(),/offline content/);
  // Hash assets are the only runtime responses the SW may store.
  broken=false;
  const asset={method:'GET',url:'https://example.invalid/assets/index-A123.js',
    mode:'cors',destination:'script'};
  handlers.get('fetch')({request:asset,respondWith(p){result=p;}});
  await result;
  assert.ok(storage.has('/assets/index-A123.js'));
  handlers.get('fetch')({request:{...asset,url:'https://example.invalid/account/private.json'},
    respondWith(){throw Error('private path should not be intercepted');}});
});
