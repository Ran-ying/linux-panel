import {createServer} from 'node:net';
import {chmod,chown,lstat,unlink} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {createPrivilegedHandlers} from './handlers.js';
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
export async function startPrivilegedServer({socketPath,groupId,handlers=createPrivilegedHandlers(),audit=()=>{}}){
  // The parent directory is root-owned; never unlink a non-socket path.
  try{const stats=await lstat(socketPath);if(!stats.isSocket())throw Error('Executor path is not a socket');await unlink(socketPath);}
  catch(error){if(error.code!=='ENOENT')throw error;}
  let connections=0;
  const server=createServer(socket=>{
    connections++;socket.on('close',()=>connections--);
    if(connections>4){socket.destroy();return;}
    let buffer='',bytes=0,started=false;
    socket.on('error',()=>{});socket.setTimeout(35000,()=>socket.destroy());socket.setEncoding('utf8');
    socket.on('data',async chunk=>{
      if(started)return;
      bytes+=Buffer.byteLength(chunk);
      if(bytes>12*1024*1024){started=true;socket.end(JSON.stringify({ok:false,error:'root 请求超过限制',statusCode:413})+'\n');return;}
      buffer+=chunk;const end=buffer.indexOf('\n');if(end<0)return;started=true;
      let action='invalid';
      try{
        const request=JSON.parse(buffer.slice(0,end));action=request.action;
        // The one fixed official-release installation can take longer than a
        // filesystem Action; it is still a schema-checked root handler.
        if(['v2ray.install','nginx.renew','nginx.reconfigureRenewal'].includes(request.action))socket.setTimeout(210000,()=>socket.destroy());
        const result=await dispatchPrivileged(request,handlers);
        audit({event:'privileged.execute',action,ok:true});socket.end(JSON.stringify({ok:true,result})+'\n');
      }catch(error){
        const statusCode=error.statusCode || 500;
        audit({event:'privileged.execute',action:handlers.has(action)?action:'unknown',ok:false,statusCode});
        socket.end(JSON.stringify({ok:false,error:error.statusCode?error.message:'root 操作失败',statusCode})+'\n');
      }
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
