import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,lstat,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createConnection} from 'node:net';
import {Readable} from 'node:stream';
import {once} from 'node:events';
import {File} from 'node:buffer';
import {createFileTransfer,parseByteRange} from '../platform/privileged/file-transfer.js';
import {ByteQueue} from '../platform/privileged/socket-frame.js';
import {uploadFile as uploadChunks,ensureDirectory,runUploadPlan} from '../apps/web/src/file-transfer.js';
import {uploadFile} from '../modules/files/fs.js';
import {createApp} from '../apps/api/src/create-app.js';
import {StateStore} from '../platform/state-store.js';
import {AuthService} from '../platform/auth/service.js';
import {PrivilegedActionClient} from '../platform/privileged/client.js';
import {startPrivilegedServer} from '../platform/privileged/server.js';
import {createPrivilegedHandlers} from '../platform/privileged/handlers.js';

const asRoot=process.getuid?.()===0;
async function fixture(t,options={}){
  const folder=await mkdtemp(join(tmpdir(),'panel-transfer-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const uploadDir=join(folder,'staging');
  const transfer=createFileTransfer({privileged:asRoot,uploadDir,...options});
  return {folder,uploadDir,transfer};
}
function stream(buffer){return Readable.from([buffer]);}
async function put(transfer,uploadId,offset,buffer){
  return transfer.write({uploadId,offset,length:buffer.length},stream(buffer));
}
async function login(app){
  const response=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-panel-client':'web'},
    payload:{username:'admin',password:'transfer-fixture-password'}});
  assert.equal(response.statusCode,200,response.body);
  return {cookie:response.headers['set-cookie'].split(';')[0],'x-panel-csrf':response.json().csrf};
}

test('byte queue keeps a binary body attached to a split header',async()=>{
  const queue=new ByteQueue();
  const header=queue.readLine(32);
  queue.push(Buffer.from('{"a":1'));
  queue.push(Buffer.from('}\n'));
  queue.push(Buffer.from([0,255,10]));
  assert.equal((await header).toString(),'{"a":1}');
  assert.deepEqual(await queue.readExactly(3),Buffer.from([0,255,10]));
});

test('range parser accepts open, closed and suffix ranges',()=>{
  assert.deepEqual(parseByteRange(undefined,5),{start:0,end:4,length:5,partial:false});
  assert.deepEqual(parseByteRange('bytes=1-2',5),{start:1,end:2,length:2,partial:true});
  assert.deepEqual(parseByteRange('bytes=3-',5),{start:3,end:4,length:2,partial:true});
  assert.deepEqual(parseByteRange('bytes=-2',5),{start:3,end:4,length:2,partial:true});
  assert.throws(()=>parseByteRange('bytes=9-10',5),{statusCode:416});
  assert.throws(()=>parseByteRange('bytes=0-1,2-3',5),{statusCode:416});
});

test('chunked upload resumes after a new process and a torn chunk',async t=>{
  const {folder,uploadDir,transfer}=await fixture(t,{chunkSize:4});
  const path=join(folder,'payload.bin');
  const bytes=Buffer.from('abcdefghij');
  const session=await transfer.open({path,size:bytes.length});
  assert.equal((await put(transfer,session.uploadId,0,bytes.subarray(0,4))).offset,4);
  const resumed=createFileTransfer({privileged:asRoot,uploadDir,chunkSize:4});
  assert.equal((await resumed.status({uploadId:session.uploadId})).offset,4);
  const partial=join(uploadDir,asRoot?'root':'user','sessions',session.uploadId,'partial');
  await appendFile(partial,bytes.subarray(4,6));
  assert.equal((await resumed.status({uploadId:session.uploadId})).offset,6);
  await assert.rejects(put(resumed,session.uploadId,4,bytes.subarray(4,8)),error=>{
    assert.equal(error.statusCode,409);assert.equal(error.offset,6);return true;
  });
  assert.equal((await put(resumed,session.uploadId,6,bytes.subarray(6))).offset,10);
  assert.deepEqual(await readFile((await resumed.commit({uploadId:session.uploadId})).path),bytes);
  await assert.rejects(resumed.status({uploadId:session.uploadId}),{statusCode:404});
});

test('same-named files are overwritten and directories merge without dropping existing files',async t=>{
  const {folder,transfer}=await fixture(t);
  const dir=join(folder,'folder');
  await mkdir(dir);
  await writeFile(join(dir,'keep.txt'),'keep');
  await writeFile(join(dir,'replace.txt'),'old');
  assert.deepEqual(await transfer.mkdir({path:dir}),{path:dir,created:false});
  const replaced=await transfer.open({path:join(dir,'replace.txt'),size:3});
  await put(transfer,replaced.uploadId,0,Buffer.from('new'));
  await transfer.commit({uploadId:replaced.uploadId});
  const added=await transfer.open({path:join(dir,'added.txt'),size:5});
  await put(transfer,added.uploadId,0,Buffer.from('added'));
  await transfer.commit({uploadId:added.uploadId});
  assert.equal(await readFile(join(dir,'keep.txt'),'utf8'),'keep');
  assert.equal(await readFile(join(dir,'replace.txt'),'utf8'),'new');
  assert.equal(await readFile(join(dir,'added.txt'),'utf8'),'added');
  const empty=await transfer.open({path:join(dir,'empty.txt'),size:0});
  assert.deepEqual(await readFile((await transfer.commit({uploadId:empty.uploadId})).path),Buffer.alloc(0));
  await assert.rejects(transfer.mkdir({path:join(dir,'keep.txt')}),{statusCode:409});
  const blocked=await transfer.open({path:dir,size:1});
  await put(transfer,blocked.uploadId,0,Buffer.from('x'));
  await assert.rejects(transfer.commit({uploadId:blocked.uploadId}),{statusCode:409});
  assert.equal((await lstat(dir)).isDirectory(),true);
});

test('writes refuse symlink escape and traversal while overwrite replaces a symlink node',async t=>{
  const {folder,uploadDir,transfer}=await fixture(t);
  const target=join(folder,'target'),link=join(folder,'link');
  await writeFile(target,'safe');
  await symlink(target,link);
  const session=await transfer.open({path:link,size:3});
  await put(transfer,session.uploadId,0,Buffer.from('new'));
  await transfer.commit({uploadId:session.uploadId});
  assert.equal(await readFile(target,'utf8'),'safe');
  assert.equal((await lstat(link)).isSymbolicLink(),false);
  assert.equal(await readFile(link,'utf8'),'new');
  await symlink(folder,join(folder,'via'));
  await assert.rejects(transfer.open({path:join(folder,'via','escaped'),size:1}),{statusCode:400});
  await assert.rejects(transfer.mkdir({path:join(folder,'via')}),{statusCode:400});
  await assert.rejects(transfer.open({path:'relative/file',size:1}),{statusCode:400});
  await assert.rejects(transfer.open({path:'/tmp/bad\0name',size:1}),{statusCode:400});
  await assert.rejects(transfer.status({uploadId:'../etc/passwd'}),{statusCode:400});
  const limited=createFileTransfer({privileged:asRoot,uploadDir,maxBytes:4});
  await assert.rejects(limited.open({path:join(folder,'too-big'),size:8}),{statusCode:413});
});

test('expired upload sessions are removed instead of being resumed',async t=>{
  const {folder,transfer}=await fixture(t,{ttlMs:-1,maxBytes:4});
  const opened=await transfer.open({path:join(folder,'gone'),size:1});
  await assert.rejects(transfer.status({uploadId:opened.uploadId}),{statusCode:404});
  await assert.rejects(transfer.open({path:join(folder,'later'),size:1,uploadId:opened.uploadId}),{statusCode:404});
});

test('small Base64 upload now overwrites a regular file and still rejects a directory',async t=>{
  if(asRoot){t.skip('legacy upload runs as the service account');return;}
  const folder=await mkdtemp(join(tmpdir(),'panel-legacy-upload-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const path=join(folder,'note.bin');
  await uploadFile({path,contentBase64:Buffer.from('one').toString('base64')});
  await uploadFile({path,contentBase64:Buffer.from('two').toString('base64')});
  assert.equal(await readFile(path,'utf8'),'two');
  const dir=join(folder,'dir');await mkdir(dir);
  await assert.rejects(uploadFile({path:dir,contentBase64:Buffer.from('no').toString('base64')}),{statusCode:409});
});

test('HTTP upload is authenticated, chunked, resumable and does not audit paths or bytes',async t=>{
  if(asRoot){t.skip('service-account transfer route');return;}
  const folder=await mkdtemp(join(tmpdir(),'panel-http-transfer-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const statePath=join(folder,'state.json');
  const store=new StateStore(statePath),auth=new AuthService(store);
  await auth.bootstrap('admin','transfer-fixture-password');
  const options={root:process.cwd(),statePath,modulesPath:join(process.cwd(),'modules'),production:false,
    privilegedClient:new PrivilegedActionClient({socketPath:''})};
  const app=await createApp(options);
  const headers=await login(app);
  const path=join(folder,'secret-marker.bin');
  assert.equal((await app.inject({method:'POST',url:'/api/files/uploads',payload:{path,size:5}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/files/uploads',headers:{cookie:headers.cookie},payload:{path,size:5}})).statusCode,403);
  const opened=await app.inject({method:'POST',url:'/api/files/uploads',headers,payload:{path,size:5}});
  assert.equal(opened.statusCode,200,opened.body);
  const uploadId=opened.json().uploadId;
  const part=await app.inject({method:'PATCH',url:'/api/files/uploads/'+uploadId,headers:{
    ...headers,'content-type':'application/octet-stream','upload-offset':'0'
  },payload:Buffer.from('ab')});
  assert.equal(part.statusCode,200,part.body);
  assert.equal(part.json().offset,2);
  const mismatch=await app.inject({method:'PATCH',url:'/api/files/uploads/'+uploadId,headers:{
    ...headers,'content-type':'application/octet-stream','upload-offset':'0'
  },payload:Buffer.from('ZZ')});
  assert.equal(mismatch.statusCode,200,mismatch.body);
  assert.equal(mismatch.json().offset,2);
  await app.close();
  const restarted=await createApp(options);
  t.after(()=>restarted.close());
  const status=await restarted.inject({method:'GET',url:'/api/files/uploads/'+uploadId,headers});
  assert.equal(status.statusCode,200,status.body);
  assert.equal(status.json().offset,2);
  const rest=await restarted.inject({method:'PATCH',url:'/api/files/uploads/'+uploadId,headers:{
    ...headers,'content-type':'application/octet-stream','upload-offset':'2'
  },payload:Buffer.from('cde')});
  assert.equal(rest.statusCode,200,rest.body);
  const early=await restarted.inject({method:'POST',url:'/api/files/uploads/'+uploadId+'/complete',headers,payload:{}});
  // The previous assertion may already have completed the bytes. Commit once.
  assert.equal(early.statusCode,200,early.body);
  assert.equal(await readFile(path,'utf8'),'abcde');
  const directory=join(folder,'merged');
  await mkdir(directory);await writeFile(join(directory,'stay.txt'),'stay');
  const again=await restarted.inject({method:'POST',url:'/api/files/directories',headers,payload:{path:directory}});
  assert.equal(again.json().created,false);
  const nested=await restarted.inject({method:'POST',url:'/api/files/uploads',headers,
    payload:{path:join(directory,'fresh.txt'),size:3}});
  const nestedId=nested.json().uploadId;
  assert.equal((await restarted.inject({method:'PATCH',url:'/api/files/uploads/'+nestedId,headers:{
    ...headers,'content-type':'application/octet-stream','upload-offset':'0'
  },payload:Buffer.from('yes')})).statusCode,200);
  assert.equal((await restarted.inject({method:'POST',url:'/api/files/uploads/'+nestedId+'/complete',headers,payload:{}})).statusCode,200);
  assert.equal(await readFile(join(directory,'stay.txt'),'utf8'),'stay');
  assert.equal(await readFile(join(directory,'fresh.txt'),'utf8'),'yes');
  const link=join(folder,'linked');await symlink(folder,link);
  const escaped=await restarted.inject({method:'POST',url:'/api/files/uploads',headers,
    payload:{path:join(link,'nope'),size:1}});
  assert.equal(escaped.statusCode,400,escaped.body);
  const tooBig=await restarted.inject({method:'PATCH',url:'/api/files/uploads/'+uploadId,headers:{
    ...headers,'content-type':'application/octet-stream','upload-offset':'0'
  },payload:Buffer.alloc(1024*1024+1)});
  assert.equal(tooBig.statusCode,413);
  const tokenResponse=await restarted.inject({method:'POST',url:'/api/files/downloads',headers,payload:{path}});
  assert.equal(tokenResponse.statusCode,200,tokenResponse.body);
  const token=tokenResponse.json().token;
  const full=await restarted.inject({method:'GET',url:'/api/files/downloads/'+token,headers:{cookie:headers.cookie}});
  assert.equal(full.statusCode,200,full.body);
  assert.equal(full.headers['accept-ranges'],'bytes');
  assert.equal(full.headers['content-length'],'5');
  assert.equal(full.body,'abcde');
  const partialDownload=await restarted.inject({method:'GET',url:'/api/files/downloads/'+token,
    headers:{cookie:headers.cookie,range:'bytes=1-3'}});
  assert.equal(partialDownload.statusCode,206);
  assert.equal(partialDownload.headers['content-range'],'bytes 1-3/5');
  assert.equal(partialDownload.body,'bcd');
  const unavailable=await restarted.inject({method:'GET',url:'/api/files/downloads/'+token,
    headers:{cookie:headers.cookie,range:'bytes=20-30'}});
  assert.equal(unavailable.statusCode,416);
  assert.equal((await restarted.inject({method:'GET',url:'/api/files/downloads/'+token})).statusCode,401);
  const audit=JSON.stringify((await store.snapshot()).audit);
  assert.equal(audit.includes('secret-marker'),false);
  assert.equal(audit.includes('abcde'),false);
  assert.match(audit,/files\.transfer/);
});

test('browser uploader slices chunks, resumes and does not read the whole file',async()=>{
  const data=Uint8Array.from([1,2,3,4,5,6,7]);
  const file=new File([data],'piece.bin',{lastModified:9});
  file.arrayBuffer=()=>{throw Error('whole file was buffered');};
  const storage={value:null,getItem(){return this.value;},setItem(_key,value){this.value=value;},removeItem(){this.value=null;}};
  const sent=[];
  let offset=0;
  const fetchImpl=async(url,options={})=>{
    if(url==='/api/files/uploads'&&options.method==='POST'){
      const payload=JSON.parse(options.body);
      if(payload.uploadId==='stale')return {status:404,ok:false,json:async()=>({error:'missing'})};
      return {status:200,ok:true,json:async()=>({uploadId:'11111111-1111-4111-8111-111111111111',offset,size:7,chunkSize:3})};
    }
    if(options.method==='PATCH'){
      const bytes=Buffer.from(await options.body.arrayBuffer());
      sent.push([...bytes]);
      const at=Number(options.headers['Upload-Offset']);
      return {status:200,ok:true,json:async()=>({offset:at+bytes.length})};
    }
    if(String(url).endsWith('/complete'))return {status:200,ok:true,json:async()=>({path:'/tmp/piece.bin',size:7})};
    throw Error('unexpected '+url);
  };
  const progress=[];
  storage.value='stale';
  await uploadChunks({file,path:'/tmp/piece.bin',csrf:'token',storage,fetchImpl,onProgress:value=>progress.push(value.loaded)});
  assert.deepEqual(sent.map(chunk=>chunk.join(',')).sort(),['1,2,3','4,5,6','7']);
  assert.equal(progress[0],0);
  assert.equal(progress.at(-1),7);
  assert.equal(storage.value,null);
  offset=4;
  storage.value='11111111-1111-4111-8111-111111111111';
  sent.length=0;
  const fetchResume=async(url,options={})=>{
    if(options.method==='POST')return {status:200,ok:true,json:async()=>({uploadId:storage.value,offset:4,size:7,chunkSize:3})};
    return fetchImpl(url,options);
  };
  await uploadChunks({file,path:'/tmp/piece.bin',csrf:'token',storage,fetchImpl:fetchResume});
  assert.deepEqual(sent,[[5,6],[7]]);
  await ensureDirectory({path:'/tmp/folder',csrf:'token',fetchImpl:async()=>({status:200,ok:true,json:async()=>({path:'/tmp/folder',created:false})})});
});

test('privileged socket streams binary chunks and a ranged read without a JSON body',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-transfer-root-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const socketPath=join(folder,'executor.sock');
  const handlers=createPrivilegedHandlers({privileged:asRoot,uploadDir:join(folder,'staging')});
  const server=await startPrivilegedServer({socketPath,handlers,audit:()=>{}});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const client=new PrivilegedActionClient({socketPath});
  const action={id:'files.transfer',privileged:{channels:['web']}};
  const caller={authenticated:true,userId:'fixture-admin',channel:'web'};
  const path=join(folder,'binary.bin');
  const bytes=Buffer.from([0,255,10,13,7]);
  const opened=await client.transfer(action,{op:'open',path,size:bytes.length},caller);
  const wrote=await client.transfer(action,{op:'write',uploadId:opened.result.uploadId,offset:0,length:bytes.length},caller,{
    body:Readable.from([bytes.subarray(0,2),bytes.subarray(2)]),length:bytes.length
  });
  assert.equal(wrote.result.offset,bytes.length);
  await client.transfer(action,{op:'commit',uploadId:opened.result.uploadId},caller);
  assert.deepEqual(await readFile(path),bytes);
  const read=await client.transfer(action,{op:'read',path,offset:1,length:3},caller);
  const parts=[];
  for await(const part of read.stream)parts.push(part);
  assert.deepEqual(Buffer.concat(parts),Buffer.from([255,10,13]));
  await assert.rejects(client.transfer(action,{op:'stat',path},{...caller,channel:'mcp'}),{statusCode:403});
  const raw=createConnection(socketPath);
  raw.write(JSON.stringify({version:2,channel:'mcp',action:'files.transfer',input:{op:'stat',path}})+'\n');
  const response=await once(raw,'data');
  assert.equal(JSON.parse(response[0].toString()).statusCode,403);
  raw.destroy();
  await client.execute({id:'files.create',privileged:{channels:['web']}},{path:join(folder,'plain.txt'),type:'file'},caller);
  assert.equal(await readFile(join(folder,'plain.txt'),'utf8'),'');
});

test('out-of-order and concurrent chunks commit only when the file has no holes',async t=>{
  const {folder,transfer}=await fixture(t,{chunkSize:4});
  const path=join(folder,'wide.bin');
  const bytes=Buffer.from('abcdefghij');
  const session=await transfer.open({path,size:bytes.length});
  await put(transfer,session.uploadId,4,bytes.subarray(4,8));
  const early=await transfer.status({uploadId:session.uploadId});
  assert.equal(early.offset,0);
  assert.equal(early.receivedBytes,4);
  await assert.rejects(transfer.commit({uploadId:session.uploadId}),error=>{
    assert.equal(error.statusCode,409);assert.equal(error.message,'上传尚未完成');return true;
  });
  await Promise.all([
    put(transfer,session.uploadId,8,bytes.subarray(8)),
    put(transfer,session.uploadId,0,bytes.subarray(0,4))
  ]);
  const duplicate=await put(transfer,session.uploadId,0,Buffer.from('XXXX'));
  assert.equal(duplicate.offset,bytes.length);
  assert.equal(duplicate.receivedBytes,bytes.length);
  assert.deepEqual(await readFile((await transfer.commit({uploadId:session.uploadId})).path),bytes);
});

test('in-flight chunk limit rejects another write and commit waits for the active chunk',async t=>{
  const {folder,transfer}=await fixture(t,{chunkSize:4,maxInflight:1});
  const path=join(folder,'slow.bin');
  const bytes=Buffer.from('abcdefgh');
  const session=await transfer.open({path,size:bytes.length});
  let push=null;
  const started=new Promise(resolve=>{
    const blocked=new Readable({read(){if(!push){push=chunk=>this.push(chunk);resolve();}}});
    transfer.write({uploadId:session.uploadId,offset:0,length:4},blocked).then(result=>{
      assert.equal(result.offset,4);
    });
  });
  await started;
  await assert.rejects(put(transfer,session.uploadId,4,bytes.subarray(4)),{statusCode:429});
  const commit=transfer.commit({uploadId:session.uploadId});
  push(bytes.subarray(0,4));
  push(null);
  await assert.rejects(commit,error=>{
    assert.equal(error.statusCode,409);assert.equal(error.message,'上传尚未完成');return true;
  });
  await put(transfer,session.uploadId,4,bytes.subarray(4));
  assert.deepEqual(await readFile((await transfer.commit({uploadId:session.uploadId})).path),bytes);
});

test('browser keeps several chunks of one file in flight',async()=>{
  const data=Uint8Array.from({length:9},(_,index)=>index+1);
  const file=new File([data],'wide.bin',{lastModified:3});
  let inflight=0,max=0;
  const fetchImpl=async(url,options={})=>{
    if(url==='/api/files/uploads'&&options.method==='POST')
      return {status:200,ok:true,json:async()=>({uploadId:'11111111-1111-4111-8111-111111111111',offset:0,receivedBytes:0,size:9,chunkSize:3})};
    if(options.method==='PATCH'){
      inflight++;max=Math.max(max,inflight);
      await new Promise(resolve=>setTimeout(resolve,20));
      inflight--;
      const at=Number(options.headers['Upload-Offset']);
      const length=options.body.size;
      return {status:200,ok:true,json:async()=>({offset:at+length,receivedBytes:at+length})};
    }
    if(String(url).endsWith('/complete'))return {status:200,ok:true,json:async()=>({size:9})};
    throw Error('unexpected '+url);
  };
  await uploadChunks({file,path:'/tmp/wide.bin',csrf:'token',fetchImpl,concurrency:2});
  assert.equal(max,2);
});

test('folder upload continues sibling files when a parent directory fails',async()=>{
  const created=[],uploaded=[];
  let inflight=0,max=0;
  const entries=[
    {type:'directory',relativePath:'a'},
    {type:'directory',relativePath:'a/b'},
    {type:'file',relativePath:'a/b/c.txt'},
    {type:'file',relativePath:'alone.txt'},
    {type:'file',relativePath:'other.txt'}
  ];
  const plan=await runUploadPlan({entries,concurrency:2,
    createDirectory:async relative=>{
      created.push(relative);
      if(relative==='a')throw Error('mkdir failed');
    },
    upload:async(entry,limiter)=>limiter(async()=>{
      inflight++;max=Math.max(max,inflight);
      await new Promise(resolve=>setTimeout(resolve,20));
      inflight--;
      uploaded.push(entry.relativePath);
    })});
  assert.deepEqual(created,['a']);
  assert.deepEqual(uploaded.sort(),['alone.txt','other.txt']);
  assert.equal(max,2);
  assert.equal(plan.results.find(result=>result.entry.relativePath==='a/b/c.txt').skipped,true);
  assert.equal(plan.results.find(result=>result.entry.relativePath==='a/b').ok,false);
});
