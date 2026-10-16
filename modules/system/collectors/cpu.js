import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

export function cpuSnapshot(cpus) {
  return cpus.reduce((acc, cpu) => {
    const values = Object.values(cpu.times);
    acc.total += values.reduce((sum, value) => sum + value, 0);
    acc.idle += cpu.times.idle;
    return acc;
  }, { total: 0, idle: 0 });
}

export function cpuUsageBetween(before, after) {
  const elapsed = after.total - before.total;
  if (elapsed <= 0) return 0;
  return Number((Math.max(0, Math.min(1, 1 - (after.idle - before.idle) / elapsed)) * 100).toFixed(1));
}

async function readCpuUsage() {
const initial = os.cpus();
  const start = cpuSnapshot(initial);
  await delay(250);
  const end = cpuSnapshot(os.cpus());
  return {
    usagePercent: cpuUsageBetween(start, end),
    logicalCpus: initial.length,
    availableParallelism: os.availableParallelism(),
    sampleWindowMs: 250,
    model: initial[0]?.model ?? 'Unknown',
    source: 'node-os-sample'
  };
}

// Internal collector; only system.resources is registered as an Action.
export default {
  outputSchema: {
    type: 'object',
    required: ['usagePercent', 'logicalCpus', 'availableParallelism', 'sampleWindowMs', 'model', 'source'],
    properties: {
      usagePercent: { type: 'number', minimum: 0, maximum: 100 },
      logicalCpus: { type: 'integer', minimum: 1 },
      availableParallelism: { type: 'integer', minimum: 1 },
      sampleWindowMs: { type: 'integer', minimum: 1 },
      model: { type: 'string' }, source: { type: 'string' }
    },
    additionalProperties: false
  },
  explain: 'Linux 通过两次 /proc/stat 计数器快照估算整体 CPU 忙碌比例，默认间隔约 250 ms；它不是当前进程占用或 load average。',
  terminal:{
    fields:{
      sample:'head -n 1 /proc/stat; sleep 0.25; head -n 1 /proc/stat',
      logicalCpus:'getconf _NPROCESSORS_ONLN',
      availableParallelism:'nproc',
      model:"awk -F ': ' '/^model name/ {print $2; exit}' /proc/cpuinfo"
    },
    decode: (values,{durations}) => {
      const samples=values.sample.split('\n').filter(Boolean).map(line=>{
        const numbers=line.trim().split(/\s+/).slice(1,9).map(Number);
        if (numbers.length!==8 || numbers.some(value=>!Number.isFinite(value))) throw new Error('Invalid CPU counters');
        return {total:numbers.reduce((sum,value)=>sum+value,0),idle:numbers[3]+numbers[4]};
      });
      if (samples.length!==2) throw new Error('Expected two CPU snapshots');
      return {usagePercent:cpuUsageBetween(samples[0],samples[1]),logicalCpus:Number(values.logicalCpus),availableParallelism:Number(values.availableParallelism),
        sampleWindowMs:Math.max(1,Math.round(durations.sample)),model:values.model || 'Unknown',source:'proc-stat-command'};
    }
  },
  createPlan: async () => [{ type: 'node-api', code: readCpuUsage.toString() }],
  execute: readCpuUsage
};
