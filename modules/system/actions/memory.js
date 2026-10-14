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

export default {
  id: 'system.memory',
  title: '内存使用情况',
  description: 'Linux 优先使用 /proc/meminfo 的 MemAvailable；macOS 使用 Node.js 近似值。',
  kind: 'read', permission: 'system:read', exposure: { web: true, mcp: true },
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
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
  presentation: {
    type: 'progress', title: '内存占用', valueKey: 'usagePercent', totalKey: 'totalBytes',
    usedKey: 'usedBytes', availableKey: 'availableBytes',
    details: [{ key: 'source', label: '数据来源' }]
  },
  explain: 'Linux 读取 /proc/meminfo：MemAvailable 估计不发生交换时可使用的内存。macOS os.freemem() 不等于系统活动监视器的内存压力。',
  createPlan: async () => [process.platform === 'linux'
    ? { type: 'file-read', path: '/proc/meminfo', description: '读取 MemTotal、MemFree、MemAvailable' }
    : { type: 'node-api', description: '使用 os.totalmem() 和 os.freemem() 估算，macOS 数值仅供参考' }],
  execute: async () => {
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
};
