import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDroppedItems,collectSelectedFiles,safeRelativePath,walkDropSources}
  from '../apps/web/src/file-drop-upload.js';

const file=(name,size=1)=>({name,size,arrayBuffer:async()=>new Uint8Array(size).buffer});
const fileEntry=(name)=>({name,isFile:true,isDirectory:false,file:success=>success(file(name))});
function directory(name,children,batchSize=2){
  return {name,isDirectory:true,isFile:false,createReader(){
    let offset=0;
    return {readEntries(success){
      const batch=children.slice(offset,offset+batchSize);
      offset+=batch.length;
      success(batch);
    }};
  }};
}
test('multi-file drop captures all files as separate upload items',async()=>{
  const files=[file('one.txt'),file('two.txt'),file('three.png')];
  const transfer={items:files.map(f=>({kind:'file',webkitGetAsEntry:()=>null,getAsFile:()=>f})),
    files};
  const entries=await collectDroppedItems(transfer);
  assert.deepEqual(entries.map(e=>e.relativePath),['one.txt','two.txt','three.png']);
  assert.ok(entries.every(e=>e.type==='file'));
});
test('recursive folder drop retains empty directories and reads multiple batches',async()=>{
  const nested=directory('nested',[fileEntry('a.txt'),fileEntry('b.txt'),fileEntry('c.txt')],1);
  const folder=directory('docs',[fileEntry('README.md'),nested,directory('empty',[],1)]);
  const transfer={items:[
    {kind:'file',webkitGetAsEntry:()=>folder},
    {kind:'file',webkitGetAsEntry:()=>fileEntry('root.txt')}
  ]};
  const actual=await collectDroppedItems(transfer);
  assert.deepEqual(actual.map(e=>[e.type,e.relativePath]),[
    ['directory','docs'],['file','docs/README.md'],
    ['directory','docs/nested'],['file','docs/nested/a.txt'],
    ['file','docs/nested/b.txt'],['file','docs/nested/c.txt'],
    ['directory','docs/empty'],['file','root.txt']
  ]);
});
test('File System Access folder handles are supported if WebKit entries are absent',async()=>{
  const handle={kind:'directory',name:'folder',async *values(){
    yield {kind:'file',name:'inside.txt',getFile:async()=>file('inside.txt')};
  }};
  const transfer={items:[{kind:'file',getAsFileSystemHandle:()=>Promise.resolve(handle)}]};
  assert.deepEqual((await collectDroppedItems(transfer)).map(x=>x.relativePath),
    ['folder','folder/inside.txt']);
});
test('modern drag API returning null falls back to the captured ordinary File',async()=>{
  const original=file('safari-compatible.txt');
  const entries=await collectDroppedItems({items:[{kind:'file',
    webkitGetAsEntry:()=>null,
    getAsFileSystemHandle:async()=>null,
    getAsFile:()=>original}],files:[original]});
  assert.deepEqual(entries.map(x=>x.relativePath),['safari-compatible.txt']);
});
test('unavailable modern drag API exceptions still preserve ordinary files',async()=>{
  const original=file('fallback.txt');
  for(const api of [()=>{throw Error('not supported');},async()=>{throw Error('denied');}]){
    const items=await collectDroppedItems({items:[{kind:'file',
      webkitGetAsEntry:()=>null,getAsFileSystemHandle:api,
      getAsFile:()=>original}]});
    assert.deepEqual(items.map(x=>x.relativePath),['fallback.txt']);
  }
});
test('plain DataTransfer.files fallback and multi-file picker are supported',async()=>{
  const picked=[file('alpha.txt'),file('beta.txt')];
  assert.deepEqual((await collectDroppedItems({files:picked})).map(x=>x.relativePath),
    ['alpha.txt','beta.txt']);
  assert.deepEqual(collectSelectedFiles(picked).map(x=>x.relativePath),
    ['alpha.txt','beta.txt']);
  assert.equal(collectSelectedFiles([{...file('nested.txt'),
    webkitRelativePath:'folder/nested.txt'}])[0].relativePath,'folder/nested.txt');
});
test('invalid relative paths, duplicates, oversized batches and depth fail closed',async()=>{
  for(const path of ['/etc/passwd','../escape','a/../escape','x\\y','a//b','a/.','x\u0000a','']){
    assert.throws(()=>safeRelativePath(path));
  }
  await assert.rejects(walkDropSources([{type:'file',name:'same',file:file('same')},
    {type:'file',name:'same',file:file('same')}]),/重复/);
  await assert.rejects(walkDropSources([{type:'file',name:'a',file:file('a')},
    {type:'file',name:'b',file:file('b')}],{maxEntries:1}),/项目过多/);
  await assert.rejects(walkDropSources([{type:'directory',name:'a',
    entry:directory('a',[directory('b',[])])}],{maxDepth:0}),/嵌套层级/);
});
