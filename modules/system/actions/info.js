import os from 'node:os';

export default {
  id: 'system.info',
  title: '读取系统基本信息',
  description: '使用 Node.js 标准库读取本机 CPU、内存、运行时间和操作系统信息。',
  kind: 'read',
  permission: 'system:read',
  exposure: { web: true, mcp: true },
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  explain: 'os 模块在当前 Node.js 进程所在主机上读取系统信息。在 MacBook 本地运行时返回 Mac 的信息，不是 VPS 的信息。',
  createPlan: async () => [{ description: '调用 Node.js os.platform(), os.release(), os.totalmem() 等只读接口', type: 'node-api' }],
  execute: async () => ({
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuCount: os.availableParallelism(),
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    uptimeSeconds: os.uptime(),
    nodeVersion: process.version
  })
};
