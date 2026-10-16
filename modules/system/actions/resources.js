import cpu from '../collectors/cpu.js';
import memory from '../collectors/memory.js';
import disk from '../collectors/disk.js';

async function readResources() {
  const [cpuResult,memoryResult,diskResult]=await Promise.all([cpu.execute(),memory.execute(),disk.execute()]);
  return {cpu:cpuResult,memory:memoryResult,disk:diskResult};
}
export default {
  id:'system.resources',title:'资源使用情况',
  description:'读取整体 CPU、内存和根文件系统磁盘使用情况。',
  explain:'CPU 默认间隔约 250 ms 采样，百分比表示整机忙碌比例；logicalCpus 为在线逻辑处理器数量，availableParallelism 为当前进程可用并行度，不是物理核心数；内存以 MemAvailable 估算可用空间，均为主机整体口径。磁盘通过 stat -f 采集，available 与 free 可能因保留块不同。',
  kind:'read',permission:'system:read',exposure:{web:true,mcp:true},
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  outputSchema:{type:'object',required:['cpu','memory','disk'],additionalProperties:false,
    properties:{cpu:cpu.outputSchema,memory:memory.outputSchema,disk:disk.outputSchema}},
  terminal:{
    fields:{...cpu.terminal.fields,...memory.terminal.fields,...disk.terminal.fields},
    migrateFrom:{filesystem:[{actionId:'system.info',key:'filesystem'},{actionId:'storage.usage',key:'filesystem'}],...Object.fromEntries([
      ...Object.keys(cpu.terminal.fields).map(key=>[key,{actionId:'system.cpu',key}]),
      ...Object.keys(memory.terminal.fields).map(key=>[key,{actionId:'system.memory',key}])
    ]),availableParallelism:{actionId:'system.info',key:'cpuCount'}},
    decode:(values,context)=>({cpu:cpu.terminal.decode(values,context),memory:memory.terminal.decode(values,context),disk:disk.terminal.decode(values,context)})
  },
  createPlan:async()=>[...await cpu.createPlan(),...await memory.createPlan(),...await disk.createPlan()],
  execute:readResources
};
