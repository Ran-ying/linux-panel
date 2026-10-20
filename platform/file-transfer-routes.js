import * as fs from 'node:fs/promises';
import {Readable} from 'node:stream';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {addAudit} from './state-store.js';
import {
  TRANSFER_CHUNK,TRANSFER_MAX_BYTES,contentDisposition,createFileTransfer,parseByteRange
} from './privileged/file-transfer.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_TTL_MS=24*60*60*1000;
const MAX_GRANTS=64;
const badRequest=message=>Object.assign(new Error(message),{statusCode:400});
const ACTION={id:'files.transfer',privileged:{channels:['web']}};

function context(request){
  return {authenticated:true,channel:'web',userId:request.panelIdentity.user.id};
}
function integerHeader(value,maximum){
  if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value))return null;
  const number=Number(value);
  return Number.isSafeInteger(number)&&number<=maximum?number:null;
}
function onlyKeys(body,allowed){
  return !!body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(key=>allowed.includes(key));
}
async function readJson(path){
  try{return JSON.parse(await fs.readFile(path,'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}

export function registerFileTransferRoutes(app,{auth,store,privilegedClient,uploadDir}){
  const local=createFileTransfer({privileged:false,uploadDir});
  const grants=join(uploadDir,'grants');
  app.addContentTypeParser('application/octet-stream',{bodyLimit:TRANSFER_CHUNK},(_request,payload,done)=>done(null,payload));
  const elevated=()=>privilegedClient?.enabled===true;
  async function audit(request,op){
    await store.mutate(state=>addAudit(state,'files.transfer',request.panelIdentity.user.id,op));
  }
  async function invoke(request,input,stream){
    if(elevated()){
      const transferred=await privilegedClient.transfer(ACTION,input,context(request),
        stream?{body:stream,length:input.length}:{});
      return transferred.result;
    }
    return (await local.dispatch(input,stream)).result;
  }
  async function sweepGrants(){
    await fs.mkdir(grants,{recursive:true,mode:0o700});
    const now=Date.now();
    let live=0;
    for(const name of await fs.readdir(grants)){
      if(!name.endsWith('.json'))continue;
      const path=join(grants,name);
      const grant=await readJson(path);
      if(!grant||Date.parse(grant.expiresAt)<=now)await fs.unlink(path).catch(()=>{});
      else live++;
    }
    return live;
  }
  function grantFile(token){
    if(!UUID.test(token))throw badRequest('下载凭证无效');
    return join(grants,token+'.json');
  }

  app.post('/api/files/uploads',async request=>{
    auth.requirePermission(request.panelIdentity,'files:write');
    const body=request.body;
    if(!onlyKeys(body,['path','size','uploadId'])||typeof body.path!=='string'||!Number.isInteger(body.size))
      throw badRequest('上传请求无效');
    if(body.uploadId!==undefined&&typeof body.uploadId!=='string')throw badRequest('上传请求无效');
    const result=await invoke(request,{op:'open',path:body.path,size:body.size,...(body.uploadId?{uploadId:body.uploadId}:{})});
    await audit(request,'open');
    return result;
  });
  app.get('/api/files/uploads/:uploadId',async request=>{
    auth.requirePermission(request.panelIdentity,'files:write');
    if(!UUID.test(request.params.uploadId))throw badRequest('上传会话无效');
    return invoke(request,{op:'status',uploadId:request.params.uploadId});
  });
  app.patch('/api/files/uploads/:uploadId',{bodyLimit:TRANSFER_CHUNK},async(request,reply)=>{
    auth.requirePermission(request.panelIdentity,'files:write');
    const offset=integerHeader(request.headers['upload-offset'],TRANSFER_MAX_BYTES);
    const length=integerHeader(request.headers['content-length'],TRANSFER_MAX_BYTES);
    if(!UUID.test(request.params.uploadId)||request.headers['content-type']!=='application/octet-stream'||offset===null||length===null){
      request.raw.destroy();throw badRequest('分块偏移或长度无效');
    }
    if(length<1||length>TRANSFER_CHUNK){
      request.raw.destroy();throw Object.assign(new Error('分块超过限制'),{statusCode:413});
    }
    try{
      return await invoke(request,{op:'write',uploadId:request.params.uploadId,offset,length},request.body);
    }catch(error){
      if(error.statusCode===409&&Number.isInteger(error.offset))
        return reply.code(409).send({error:error.message,offset:error.offset,
          ...(Number.isInteger(error.receivedBytes)?{receivedBytes:error.receivedBytes}:{})});
      throw error;
    }
  });
  app.post('/api/files/uploads/:uploadId/complete',async request=>{
    auth.requirePermission(request.panelIdentity,'files:write');
    if(!UUID.test(request.params.uploadId))throw badRequest('上传会话无效');
    const result=await invoke(request,{op:'commit',uploadId:request.params.uploadId});
    await audit(request,'commit');
    return result;
  });
  app.delete('/api/files/uploads/:uploadId',async request=>{
    auth.requirePermission(request.panelIdentity,'files:write');
    if(!UUID.test(request.params.uploadId))throw badRequest('上传会话无效');
    const result=await invoke(request,{op:'abort',uploadId:request.params.uploadId});
    await audit(request,'abort');
    return result;
  });
  app.post('/api/files/directories',async request=>{
    auth.requirePermission(request.panelIdentity,'files:write');
    if(!onlyKeys(request.body,['path'])||typeof request.body.path!=='string')throw badRequest('目录请求无效');
    const result=await invoke(request,{op:'mkdir',path:request.body.path});
    await audit(request,'mkdir');
    return result;
  });
  app.post('/api/files/downloads',async request=>{
    auth.requirePermission(request.panelIdentity,'files:read');
    if(!onlyKeys(request.body,['path'])||typeof request.body.path!=='string')throw badRequest('下载请求无效');
    const info=await invoke(request,{op:'stat',path:request.body.path});
    if(await sweepGrants()>=MAX_GRANTS)throw Object.assign(new Error('下载凭证过多，请稍后再试'),{statusCode:429});
    const token=randomUUID();
    const expiresAt=new Date(Date.now()+GRANT_TTL_MS).toISOString();
    const handle=await fs.open(grantFile(token),'wx',0o600);
    try{await handle.writeFile(JSON.stringify({version:1,path:request.body.path,expiresAt}));}
    finally{await handle.close();}
    await audit(request,'download');
    return {token,size:info.size,name:info.name,expiresAt};
  });
  app.get('/api/files/downloads/:token',async(request,reply)=>{
    auth.requirePermission(request.panelIdentity,'files:read');
    const path=grantFile(request.params.token);
    const grant=await readJson(path);
    if(!grant||grant.version!==1||typeof grant.path!=='string'||Date.parse(grant.expiresAt)<=Date.now()){
      if(grant)await fs.unlink(path).catch(()=>{});
      throw Object.assign(new Error('下载凭证不存在或已过期'),{statusCode:404});
    }
    const info=await invoke(request,{op:'stat',path:grant.path});
    let range;
    try{range=parseByteRange(request.headers.range,info.size);}
    catch(error){
      if(error.statusCode===416)return reply.code(416).header('Content-Range','bytes */'+info.size).send({error:error.message});
      throw error;
    }
    const expiresAt=new Date(Date.now()+GRANT_TTL_MS).toISOString();
    await fs.writeFile(path,JSON.stringify({version:1,path:grant.path,expiresAt}),{mode:0o600});
    reply.header('Accept-Ranges','bytes');
    reply.header('Content-Type','application/octet-stream');
    reply.header('Content-Disposition',contentDisposition(info.name));
    reply.header('Content-Length',String(range.length));
    reply.header('Last-Modified',new Date(info.modifiedAt).toUTCString());
    reply.header('ETag','W/"'+info.size+'-'+Date.parse(info.modifiedAt)+'"');
    if(range.partial){
      reply.code(206);
      reply.header('Content-Range','bytes '+range.start+'-'+range.end+'/'+info.size);
    }
    if(range.length===0)return reply.send(Buffer.alloc(0));
    if(!elevated())return reply.send((await local.streamRange(info.path,range)).stream);
    return reply.send(privilegedReadStream(privilegedClient,context(request),info.path,range.start,range.end));
  });
}

function privilegedReadStream(client,caller,path,start,end){
  let position=start,pending=Buffer.alloc(0),busy=false;
  return new Readable({
    async read(){
      if(busy)return;
      busy=true;
      try{
        while(position<=end){
          if(!pending.length){
            const length=Math.min(TRANSFER_CHUNK,end-position+1);
            const opened=await client.transfer(ACTION,{op:'read',path,offset:position,length},caller,{});
            const parts=[];
            for await(const chunk of opened.stream)parts.push(chunk);
            pending=Buffer.concat(parts);
            if(pending.length!==length)throw Object.assign(new Error('下载分块长度不正确'),{statusCode:502});
          }
          const take=pending.subarray(0,Math.min(pending.length,64*1024));
          pending=pending.subarray(take.length);
          position+=take.length;
          if(!this.push(take))return;
        }
        this.push(null);
      }catch(error){
        this.destroy(error.statusCode?error:Object.assign(new Error('下载失败'),{statusCode:502}));
      }finally{busy=false;}
    }
  });
}
