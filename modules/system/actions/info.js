import os from 'node:os';

async function readSystemInfo() {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuCount: os.availableParallelism(),
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    uptimeSeconds: os.uptime(),
    nodeVersion: process.version
  };
}

export default {
  id: 'system.info',
  title: '读取系统基本信息',
  description: '使用 Node.js 标准库读取当前主机信息（Mac 本地运行时不是 VPS）。',
  kind: 'read',
  permission: 'system:read',
  exposure: { web: true, mcp: true },
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['hostname', 'platform', 'release', 'arch', 'cpuCount', 'totalMemoryBytes', 'freeMemoryBytes', 'uptimeSeconds', 'nodeVersion'],
    properties: {
      hostname: { type: 'string' }, platform: { type: 'string' }, release: { type: 'string' },
      arch: { type: 'string' }, cpuCount: { type: 'integer', minimum: 1 },
      totalMemoryBytes: { type: 'number', minimum: 0 }, freeMemoryBytes: { type: 'number', minimum: 0 },
      uptimeSeconds: { type: 'number', minimum: 0 }, nodeVersion: { type: 'string' }
    },
    additionalProperties: false
  },
  explain: 'os 模块读取当前 Node.js 进程所在主机。availableParallelism 是进程可使用的并行度，不等同于物理 CPU 核心数。',
  createPlan: async () => [{ type: 'node-api', code: readSystemInfo.toString() }],
  execute: readSystemInfo
};
