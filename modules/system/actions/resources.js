import cpu from '../collectors/cpu.js';
import memory from '../collectors/memory.js';

async function readResources() {
  const [cpuResult,memoryResult]=await Promise.all([cpu.execute(),memory.execute()]);
  return {cpu:cpuResult,memory:memoryResult};
}
export default {
  id:'system.resources',title:'资源使用情况',
  description:'读取整体 CPU 使用率和内存使用情况。',
  explain:'CPU 默认间隔约 250 ms 采样；内存以 MemAvailable 估算可用空间，均为主机整体口径。',
  kind:'read',permission:'system:read',exposure:{web:true,mcp:true},
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  outputSchema:{type:'object',required:['cpu','memory'],additionalProperties:false,
    properties:{cpu:cpu.outputSchema,memory:memory.outputSchema}},
  terminal:{
    fields:{...cpu.terminal.fields,...memory.terminal.fields},
    migrateFrom:Object.fromEntries([
      ...Object.keys(cpu.terminal.fields).map(key=>[key,{actionId:'system.cpu',key}]),
      ...Object.keys(memory.terminal.fields).map(key=>[key,{actionId:'system.memory',key}])
    ]),
    decode:(values,context)=>({cpu:cpu.terminal.decode(values,context),memory:memory.terminal.decode(values,context)})
  },
  createPlan:async()=>[...await cpu.createPlan(),...await memory.createPlan()],
  execute:readResources
};
