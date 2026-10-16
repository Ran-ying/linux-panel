import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../apps/api/src/create-app.js';
import {StateStore} from '../platform/state-store.js';
import {AuthService} from '../platform/auth/service.js';
import {filePath,listFiles,readText,writeText,uploadFile,createEntry,renameEntry,deleteEntry} from '../modules/files/fs.js';
test('file paths must be absolute and root runtime refuses filesystem operations',async()=>{
  assert.throws(()=>filePath('relative'),{statusCode:400});
  assert.throws(()=>filePath('/bad\0path'),{statusCode:400});
  assert.equal(filePath('/tmp/a/../b'),'/tmp/b');
  if(process.getuid?.()===0){
    for(const operation of [listFiles,createEntry,renameEntry,deleteEntry])await assert.rejects(operation({path:'/'}),{statusCode:503});
  }
});
test('file listing, text revisions, UTF-8 bounds, uploads and HTTP write guards',async t=>{
  if(process.getuid?.()===0){t.skip('requires ordinary service user');return;}
  const previousMask=process.umask(0o077);t.after(()=>process.umask(previousMask));
  const folder=await mkdtemp(join(tmpdir(),'panel-files-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const dir=join(folder,'data');await mkdir(dir);
  const path=join(dir,'note.txt');await writeFile(path,'original',{mode:0o640});
  await mkdir(join(dir,'child'));
  const listing=await listFiles({path:dir,limit:1});
  assert.equal(listing.total,2);assert.equal(listing.nextOffset,1);
  assert.equal((await listFiles({path:dir,offset:1})).entries.length,1);
  await assert.rejects(readText({path:join(dir,'missing')}),{statusCode:404});
  const originalMode=(await stat(path)).mode & 0o777;
  const initial=await readText({path});
  await writeText({path,content:'edited',revision:initial.revision});
  assert.equal(await readFile(path,'utf8'),'edited');
  assert.equal((await stat(path)).mode & 0o777,originalMode);
  await assert.rejects(writeText({path,content:'stale',revision:initial.revision}),{statusCode:409});
  const binary=join(dir,'binary');await writeFile(binary,Buffer.from([0,255]));
  await assert.rejects(readText({path:binary}),{statusCode:415});
  const large=join(dir,'large');await writeFile(large,Buffer.alloc(1024*1024+1,65));
  await assert.rejects(readText({path:large}),{statusCode:413});
  const statePath=join(folder,'state.json'),store=new StateStore(statePath),auth=new AuthService(store);
  await auth.bootstrap('admin','file-fixture-long-password');
  const app=await createApp({root:process.cwd(),statePath,modulesPath:join(process.cwd(),'modules'),production:false});
  t.after(()=>app.close());
  const endpoint='/api/actions/files.upload/execute';
  assert.equal((await app.inject({method:'POST',url:endpoint,payload:{input:{}}})).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-panel-client':'web'},
    payload:{username:'admin',password:'file-fixture-long-password'}});
  const cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-panel-csrf':login.json().csrf};
  const uploadPath=join(dir,'upload.bin'),bytes=Buffer.alloc(70000,123);
  const payload={input:{path:uploadPath,contentBase64:bytes.toString('base64')}};
  assert.equal((await app.inject({method:'POST',url:endpoint,headers:{cookie},payload})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:endpoint,headers:{...headers,origin:'https://evil.example'},payload})).statusCode,403);
  const uploaded=await app.inject({method:'POST',url:endpoint,headers,payload});
  assert.equal(uploaded.statusCode,200,uploaded.body);
  assert.deepEqual(await readFile(uploadPath),bytes);
  assert.equal((await app.inject({method:'POST',url:endpoint,headers,payload})).statusCode,409);
  const loaded=await readText({path});
  const saved=await app.inject({method:'POST',url:'/api/actions/files.write/execute',headers,
    payload:{input:{path,content:'http-edited',revision:loaded.revision}}});
  assert.equal(saved.statusCode,200,saved.body);
  assert.equal(await readFile(path,'utf8'),'http-edited');
  const audit=(await store.snapshot()).audit.filter(e=>e.event==='action.execute');
  assert.ok(!JSON.stringify(audit).includes('http-edited'));
  await assert.rejects(uploadFile({path:join(dir,'invalid'),contentBase64:'??'}),{statusCode:400});
  for(const id of ['create','rename','delete']){
    const url='/api/actions/files.'+id+'/execute';
    assert.equal((await app.inject({method:'POST',url,payload:{input:{}}})).statusCode,401);
    assert.equal((await app.inject({method:'POST',url,headers:{cookie},payload:{input:{}}})).statusCode,403);
  }
  const created=join(dir,'created');
  const execute=(id,input)=>app.inject({method:'POST',url:'/api/actions/files.'+id+'/execute',headers,payload:{input}});
  assert.equal((await execute('create',{path:created,type:'directory'})).statusCode,200);
  assert.equal((await execute('create',{path:join(created,'empty'),type:'file'})).statusCode,200);
  assert.equal((await execute('rename',{path:created,newPath:join(dir,'renamed')})).statusCode,200);
  assert.equal((await execute('delete',{path:join(dir,'renamed')})).statusCode,200);
  assert.deepEqual((await store.snapshot()).moduleOrder,['system','services','terminal','files']);
});

test('recursive directory sizes, ownership, creation, rename collisions and symlink deletion',async t=>{
  if(process.getuid?.()===0){t.skip('requires ordinary service user');return;}
  const folder=await mkdtemp(join(tmpdir(),'panel-files-ops-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const dir=join(folder,'nested');await createEntry({path:dir,type:'directory'});
  const file=join(dir,'note');await createEntry({path:file,type:'file'});await writeFile(file,Buffer.alloc(1500000));
  await mkdir(join(dir,'child'));await writeFile(join(dir,'child','data'),Buffer.alloc(500000));
  // A symlink into a parent must not recurse or count its target twice.
  await symlink(folder,join(dir,'loop'));
  const entry=(await listFiles({path:folder})).entries.find(e=>e.name==='nested');
  assert.equal(entry.size,2000000);assert.equal(entry.sizeComplete,true);
  assert.match(entry.permissions,/^[0-7]{4}$/);assert.match(entry.owner,/^.+:.+$/);
  assert.equal((await listFiles({path:dir})).entries.find(e=>e.name==='note').size,1500000);
  await assert.rejects(createEntry({path:file,type:'file'}),{statusCode:409});
  await assert.rejects(renameEntry({path:file,newPath:join(dir,'child')}),{statusCode:409});
  await assert.rejects(renameEntry({path:file,newPath:join(folder,'elsewhere')}),{statusCode:400});
  const renamed=join(dir,'renamed');await renameEntry({path:file,newPath:renamed});
  assert.equal((await stat(renamed)).size,1500000);
  await deleteEntry({path:join(dir,'loop')});assert.ok((await stat(folder)).isDirectory());
  await deleteEntry({path:renamed});await assert.rejects(stat(renamed),{code:'ENOENT'});
  await deleteEntry({path:dir});await assert.rejects(stat(dir),{code:'ENOENT'});
  await assert.rejects(deleteEntry({path:'/'}),{statusCode:403});
});
