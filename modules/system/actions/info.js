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
  title: '基本信息',
  description: '读取主机名、系统版本、架构、内存与运行时间。',
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
  explain: 'Linux 通过可编辑的终端命令读取；CPU 数量由 nproc 返回，是当前进程可用处理器数量。其他平台使用 Node.js 标准库。',
  terminal:{
    fields:{
    "hostname": "hostname",
    "platform": "uname -s | tr '[:upper:]' '[:lower:]'",
    "release": "uname -r",
    "arch": "uname -m",
    "cpuCount": "nproc",
    "totalMemoryBytes": "awk '/^MemTotal:/ {printf \"%.0f\\n\", $2 * 1024}' /proc/meminfo",
    "freeMemoryBytes": "awk '/^MemFree:/ {printf \"%.0f\\n\", $2 * 1024}' /proc/meminfo",
    "uptimeSeconds": "cut -d ' ' -f 1 /proc/uptime",
    "nodeVersion": "node --version"
},
    decode: values => Object.fromEntries(Object.entries(values).map(([key,value]) =>
      [key,['cpuCount','totalMemoryBytes','freeMemoryBytes','uptimeSeconds'].includes(key)?Number(value):value]))
  },
  createPlan: async () => [{ type: 'node-api', code: readSystemInfo.toString() }],
  execute: readSystemInfo
};
