import {createServer} from 'node:net';
import {pipeline} from 'node:stream/promises';
import {chmod,chown,lstat,unlink} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {createPrivilegedHandlers} from './handlers.js';
import {ByteQueue,byteReadable} from './socket-frame.js';
import {TRANSFER_CHUNK} from './file-transfer.js';
const failure=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export async function dispatchPrivileged(request,handlers){
  if(!request || request.version!==1 || !['web','mcp'].includes(request.channel) || typeof request.action!=='string' ||
    Object.keys(request).some(key=>!['version','channel','action','input'].includes(key)))throw failure('无效的 root 请求',403);
  const handler=handlers.get(request.action);
  if(!handler)throw failure('root 操作未注册',404);
  // Explicit per-handler MCP admission; all existing root actions stay Web-only.
  if(!(handler.channels??['web']).includes(request.channel))throw failure('root Action 不允许此通道',403);
  if(!handler.validate(request.input))throw failure('root 操作参数无效');
  return handler.execute(request.input);
}
async function handleTransfer(request,handlers,queue){
  if(!request||request.version!==2||request.action!=='files.transfer'||request.channel!=='web'||
    Object.keys(request).some(key=>!['version','channel','action','input'].includes(key)))throw failure('无效的 root 请求',403);
  const handler=handlers.get('files.transfer');
  if(!handler)throw failure('root 操作未注册',404);
  if(!(handler.channels??['web']).includes(request.channel))throw failure('root Action 不允许此通道',403);
  if(!handler.validate(request.input))throw failure('root 操作参数无效');
  const length=request.input.length??0;
  if(request.input.op==='write'){
    if(!Number.isInteger(length)||length<1||length>TRANSFER_CHUNK)throw failure('root 操作参数无效');
    return handler.execute(request.input,byteReadable(queue,length));
  }
  if(request.input.op==='read'){
    if(!Number.isInteger(length)||length<1||length>TRANSFER_CHUNK)throw failure('root 操作参数无效');
    return handler.execute(request.input);
  }
  if(length)throw failure('root 操作参数无效');
  return handler.execute(request.input);
}
export async function startPrivilegedServer({socketPath,groupId,handlers=createPrivilegedHandlers(),audit=()=>{}}){
  // The parent directory is root-owned; never unlink a non-socket path.
  try{const stats=await lstat(socketPath);if(!stats.isSocket())throw Error('Executor path is not a socket');await unlink(socketPath);}
  catch(error){if(error.code!=='ENOENT')throw error;}
  let connections=0;
  const server=createServer(socket=>{
    connections++;socket.on('close',()=>connections--);
    if(connections>4){socket.destroy();return;}
    const queue=new ByteQueue();
    const timeOut=ms=>socket.setTimeout(ms,()=>{
      queue.fail(Object.assign(new Error('root 执行通道超时'),{statusCode:503}));
      socket.destroy();
    });
    socket.on('error',()=>{});timeOut(35000);
    socket.on('data',chunk=>queue.push(chunk));
    socket.on('end',()=>queue.end());
    socket.on('close',()=>queue.end());
    let action='invalid',responded=false;
    const finish=(payload,stream)=>{
      if(responded)return Promise.resolve();
      responded=true;
      socket.write(JSON.stringify(payload)+'\n');
      if(!stream){socket.end();return Promise.resolve();}
      return pipeline(stream,socket,{end:false}).then(()=>socket.end());
    };
    (async()=>{
      const line=await queue.readLine(12*1024*1024);
      const request=JSON.parse(line.toString('utf8'));
      action=typeof request?.action==='string'?request.action:'invalid';
      if(['v2ray.install','nginx.renew','nginx.reconfigureRenewal'].includes(request.action))timeOut(210000);
      if(request.version===2){
        if(line.length>16*1024)throw failure('root 请求超过限制',413);
        timeOut(120000);
        const outcome=await handleTransfer(request,handlers,queue);
        await finish({ok:true,result:outcome.result},outcome.stream);
        audit({event:'privileged.execute',action,ok:true});
        return;
      }
      const result=await dispatchPrivileged(request,handlers);
      await finish({ok:true,result});
      audit({event:'privileged.execute',action,ok:true});
    })().catch(error=>{
      const statusCode=error.statusCode||(error.code==='LIMIT'?413:500);
      const message=error.code==='LIMIT'?'root 请求超过限制':error.code==='CLOSED'?'root 执行通道意外关闭':
        error.statusCode?error.message:'root 操作失败';
      audit({event:'privileged.execute',action:handlers.has(action)?action:'unknown',ok:false,statusCode});
      const payload={ok:false,error:message,statusCode};
      if(Number.isInteger(error.offset))payload.offset=error.offset;
      finish(payload).catch(()=>socket.destroy());
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  try{if(groupId!==undefined)await chown(socketPath,0,groupId);await chmod(socketPath,groupId===undefined?0o600:0o660);}
  catch(error){server.close();throw error;}
  return server;
}
// Node resolves symlinked ESM entrypoints to real paths. The service launches
// current/server.js while import.meta.url points into releases/<SHA>/server.js.
if(process.argv[1] && realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.getuid?.()!==0)throw Error('Privileged executor requires root');
  const groupId=Number(process.env.PANEL_CLIENT_GID);
  if(!Number.isSafeInteger(groupId)||groupId<0)throw Error('PANEL_CLIENT_GID is required');
  // systemd reapplies RuntimeDirectory ownership for each Exec command. Set the
  // admitted group from the main process, after its service sandbox is ready.
  await chown('/run/linux-panel-privileged',0,groupId);
  await chmod('/run/linux-panel-privileged',0o750);
  const server=await startPrivilegedServer({socketPath:'/run/linux-panel-privileged/executor.sock',groupId,
    audit:entry=>console.log(JSON.stringify(entry))});
  process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
}
