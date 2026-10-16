import {createConnection} from 'node:net';
const failure=(message,statusCode=503)=>Object.assign(new Error(message),{statusCode});
export class PrivilegedActionClient {
  constructor({socketPath=process.env.PANEL_PRIVILEGED_SOCKET || '',timeoutMs=30000}={}){
    this.socketPath=socketPath;this.timeoutMs=timeoutMs;
  }
  get enabled(){return !!this.socketPath;}
  async execute(action,input,context){
    if(!this.enabled)throw failure('root 执行通道未启用');
    if(context?.authenticated!==true || !context.userId || !action.privileged?.channels?.includes(context.channel))
      throw failure('没有此 root Action 的通道授权',403);
    return new Promise((resolve,reject)=>{
      const socket=createConnection(this.socketPath);let bytes=0,buffer='',finished=false;
      const done=(error,result)=>{if(finished)return;finished=true;socket.destroy();error?reject(error):resolve(result);};
      socket.setTimeout(this.timeoutMs,()=>done(failure('root 执行通道超时')));
      socket.on('error',cause=>done(failure('root 执行通道不可用（'+cause.code+'），请检查独立执行服务')));
      socket.on('connect',()=>socket.write(JSON.stringify({version:1,action:action.id,input,channel:context.channel})+'\n'));
      socket.setEncoding('utf8');
      socket.on('data',chunk=>{
        bytes+=Buffer.byteLength(chunk);if(bytes>8*1024*1024)return done(failure('root 响应超过限制'));
        buffer+=chunk;const end=buffer.indexOf('\n');if(end<0)return;
        try{const value=JSON.parse(buffer.slice(0,end));
          if(value.ok===true)done(null,value.result);
          else done(failure(value.error || 'root 操作失败',value.statusCode || 500));
        }catch{done(failure('root 执行通道返回无效响应'));}
      });
      socket.on('end',()=>{if(!finished)done(failure('root 执行通道意外关闭'));});
    });
  }
}
