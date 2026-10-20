import {createConnection} from 'node:net';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {ByteQueue,byteReadable} from './socket-frame.js';
import {TRANSFER_CHUNK} from './file-transfer.js';
const failure=(message,statusCode=503)=>Object.assign(new Error(message),{statusCode});
export class PrivilegedActionClient {
  constructor({socketPath=process.env.PANEL_PRIVILEGED_SOCKET || '',timeoutMs=30000}={}){
    this.socketPath=socketPath;this.timeoutMs=timeoutMs;
  }
  get enabled(){return !!this.socketPath;}
  async execute(action,input,context){
    const {result}=await this.#roundtrip(action,input,context,{version:1,timeout:this.timeoutMs});
    return result;
  }
  // Counted binary body for files.transfer. The JSON header stays small; the
  // caller streams `length` bytes and, for a read, receives a byte stream.
  async transfer(action,input,context,{body,length=0}={}){
    if(length&&!body)throw failure('分块长度不完整',400);
    if(length>TRANSFER_CHUNK)throw failure('分块超过限制',413);
    return this.#roundtrip(action,input,context,{version:2,body,length,timeout:120000});
  }
  #authorize(action,context){
    if(!this.enabled)throw failure('root 执行通道未启用');
    if(context?.authenticated!==true||!context.userId||!action.privileged?.channels?.includes(context.channel))
      throw failure('没有此 root Action 的通道授权',403);
  }
  #roundtrip(action,input,context,{version,body,length=0,timeout}){
    this.#authorize(action,context);
    return new Promise((resolve,reject)=>{
      const socket=createConnection(this.socketPath);
      const queue=new ByteQueue();
      let settled=false;
      const done=(error,value)=>{
        if(settled)return;
        settled=true;
        socket.destroy();
        error?reject(error):resolve(value);
      };
      socket.setTimeout(timeout,()=>{if(settled)socket.destroy();else done(failure('root 执行通道超时'));});
      socket.on('error',cause=>done(failure('root 执行通道不可用（'+cause.code+'），请检查独立执行服务')));
      socket.on('data',chunk=>queue.push(chunk));
      socket.on('end',()=>queue.end());
      socket.on('connect',async()=>{
        try{
          socket.write(JSON.stringify({version,action:action.id,input,channel:context.channel})+'\n');
          if(length){
            let sent=0;
            const counter=new Transform({
              transform(chunk,encoding,callback){
                sent+=chunk.length;
                if(sent>length)callback(failure('分块超过限制',413));
                else callback(null,chunk);
              },
              flush(callback){callback(sent===length?null:failure('分块长度不完整',400));}
            });
            await pipeline(body,counter,socket,{end:false});
          }
          const limit=version===1?8*1024*1024:64*1024;
          const line=await queue.readLine(limit);
          const value=JSON.parse(line.toString('utf8'));
          if(value.ok!==true){
            const error=failure(value.error||'root 操作失败',value.statusCode||500);
            if(Number.isInteger(value.offset))error.offset=value.offset;
            if(Number.isInteger(value.receivedBytes))error.receivedBytes=value.receivedBytes;
            done(error);
            return;
          }
          if(version===2&&input?.op==='read'){
            const bytes=value.result?.length;
            if(!Number.isInteger(bytes)||bytes<1||bytes>TRANSFER_CHUNK){done(failure('root 响应超过限制'));return;}
            const stream=byteReadable(queue,bytes);
            stream.on('close',()=>socket.destroy());
            settled=true;
            resolve({result:value.result,stream});
            return;
          }
          done(null,{result:value.result});
        }catch(error){
          if(error?.code==='LIMIT')done(failure(version===1?'root 响应超过限制':'root 执行通道返回无效响应'));
          else if(error?.code==='CLOSED')done(failure('root 执行通道意外关闭'));
          else if(error?.statusCode)done(error);
          else done(failure('root 执行通道返回无效响应'));
        }
      });
    });
  }
}
