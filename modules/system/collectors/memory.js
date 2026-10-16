import os from 'node:os';
import { readFile } from 'node:fs/promises';

export function parseMeminfo(content) {
  const values = new Map();
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  return values;
}

async function readMemoryUsage() {
let totalBytes = os.totalmem();
  let freeBytes = os.freemem();
  let availableBytes = freeBytes;
  let source = 'node-os-estimate';
  if (process.platform === 'linux') {
    const info = parseMeminfo(await readFile('/proc/meminfo', 'utf8'));
    if (info.has('MemTotal')) totalBytes = info.get('MemTotal');
    if (info.has('MemFree')) freeBytes = info.get('MemFree');
    if (info.has('MemAvailable')) {
      availableBytes = info.get('MemAvailable');
      source = 'proc-meminfo';
    }
  }
  availableBytes = Math.max(0, Math.min(totalBytes, availableBytes));
  const usedBytes = totalBytes - availableBytes;
  const usagePercent = totalBytes > 0 ? Number((usedBytes / totalBytes * 100).toFixed(1)) : 0;
  return { totalBytes, freeBytes, availableBytes, usedBytes, usagePercent, source };
}

// Internal collector; only system.resources is registered as an Action.
export default {
  outputSchema: {
    type: 'object',
    required: ['totalBytes', 'freeBytes', 'availableBytes', 'usedBytes', 'usagePercent', 'source'],
    properties: {
      totalBytes: { type: 'number', minimum: 0 }, freeBytes: { type: 'number', minimum: 0 },
      availableBytes: { type: 'number', minimum: 0 }, usedBytes: { type: 'number', minimum: 0 },
      usagePercent: { type: 'number', minimum: 0, maximum: 100 }, source: { type: 'string' }
    },
    additionalProperties: false
  },
  explain: 'Linux 读取 /proc/meminfo：MemAvailable 估计不发生交换时可使用的内存。macOS os.freemem() 不等于系统活动监视器的内存压力。',
  terminal:{
    fields:{meminfo:'cat /proc/meminfo'},
    decode: values => {
      const info=parseMeminfo(values.meminfo);
      const totalBytes=info.get('MemTotal'), freeBytes=info.get('MemFree');
      if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) throw new Error('Invalid meminfo');
      const availableBytes=Math.max(0,Math.min(totalBytes,info.get('MemAvailable') ?? freeBytes));
      const usedBytes=totalBytes-availableBytes;
      return {totalBytes,freeBytes,availableBytes,usedBytes,
        usagePercent:totalBytes>0?Number((usedBytes/totalBytes*100).toFixed(1)):0,source:'proc-meminfo'};
    }
  },
  createPlan: async () => [{ type: process.platform === 'linux' ? 'file-read' : 'node-api', code: readMemoryUsage.toString() }],
  execute: readMemoryUsage
};
