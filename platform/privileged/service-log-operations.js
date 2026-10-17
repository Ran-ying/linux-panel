import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import Ajv from 'ajv';
import {SERVICE_LOGS_CONTRACT} from './service-log-contracts.js';
const execFileAsync=promisify(execFile);
const validate=new Ajv({strict:false}).compile(SERVICE_LOGS_CONTRACT.inputSchema);
const failure=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const MAX_OUTPUT=48000;

// Fixed binary + fixed flags only; never use a shell, sudo, caller paths or
// configurable terminal collectors for root journal access.
export function createServiceLogOperations({run=execFileAsync,requireLinux=true}={}){
  return {async logs(input){
    if(!validate(input))throw failure('无效的 systemd 服务名或日志行数');
    if(requireLinux&&process.platform!=='linux')throw failure('日志功能仅支持 Linux systemd',503);
    const lines=input.lines??80;
    let stdout;
    try{
      ({stdout}=await run('/usr/bin/journalctl',
        ['--no-pager','--quiet','--no-hostname','--output=short-iso','--unit',input.unit,'--lines',String(lines)],
        {timeout:10000,maxBuffer:128*1024,env:{PATH:'/usr/bin:/bin',LANG:'C'}}));
    }catch(cause){
      if(cause.killed||cause.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
        throw failure('日志查询超时或输出过大，请减少行数',503);
      throw failure('无法读取 systemd 日志，请检查服务名及 journald 状态',503);
    }
    const clean=String(stdout).replace(/[^\x09\x0A\x0D\x20-\x7E\u0080-\uFFFF]/g,'');
    let output=clean,truncated=false;
    if(Buffer.byteLength(output,'utf8')>MAX_OUTPUT){
      output=Buffer.from(output,'utf8').subarray(0,MAX_OUTPUT).toString('utf8').replace(/\uFFFD$/,'');
      truncated=true;
    }
    return {unit:input.unit,source:'journalctl',
      lines:output?output.trimEnd().split('\n').length:0,output,truncated};
  }};
}
