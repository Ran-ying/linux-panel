import {executeShell} from '../../../platform/terminal.js';

export default {
  id:'terminal.execute',title:'执行命令',
  description:'以面板服务账户执行一条 Shell 命令并返回结果。',
  explain:'每次执行使用独立 Shell；可在一条命令中组合操作。需要保留目录或交互状态时，使用下方终端。',
  kind:'write',permission:'terminal:execute',executionPolicy:'user-shell',exposure:{web:true,mcp:true},
  inputSchema:{type:'object',required:['command'],additionalProperties:false,properties:{
    command:{type:'string',minLength:1,maxLength:16384,pattern:'^[^\\u0000]*$',description:'要执行的 Shell 命令'},
    timeoutSeconds:{type:'integer',minimum:1,maximum:60,description:'超时秒数，默认 30 秒'}
  }},
  outputSchema:{type:'object',additionalProperties:false,required:['stdout','stderr','exitCode','signal','timedOut','truncated','durationMs'],properties:{
    stdout:{type:'string'},stderr:{type:'string'},exitCode:{type:['integer','null']},
    signal:{type:['string','null']},timedOut:{type:'boolean'},truncated:{type:'boolean'},durationMs:{type:'integer',minimum:0}
  }},
  createPlan:async input=>[{type:'shell',command:input.command}],
  execute:executeShell
};
