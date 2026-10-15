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
    sampleWindowMs: 250,
    model: initial[0]?.model ?? 'Unknown',
    source: 'node-os-sample'
  };
}

export default {
  id: 'system.cpu',
  title: 'CPU 使用情况',
  description: '短时采样 CPU 累积计数器，估算整个主机的忙碌比例。',
  kind: 'read', permission: 'system:read', exposure: { web: true, mcp: true },
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['usagePercent', 'logicalCpus', 'sampleWindowMs', 'model', 'source'],
    properties: {
      usagePercent: { type: 'number', minimum: 0, maximum: 100 },
      logicalCpus: { type: 'integer', minimum: 1 },
      sampleWindowMs: { type: 'integer', minimum: 1 },
      model: { type: 'string' }, source: { type: 'string' }
    },
    additionalProperties: false
  },
  explain: '对 os.cpus() 两次快照取差值。它是主机整体 CPU 忙碌比例的短时间近似值，不是当前 Node.js 进程 CPU 占用，也不是 load average。',
  createPlan: async () => [{ type: 'node-api', code: readCpuUsage.toString() }],
  execute: readCpuUsage
};
