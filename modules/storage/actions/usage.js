import { statfs } from 'node:fs/promises';

/** Convert a statfs bigint record into portable, JSON-safe byte counts. */
export function summarizeStatfs(stats, mountpoint = '/') {
  const blockSize = BigInt(stats.bsize);
  const total = BigInt(stats.blocks) * blockSize;
  const free = BigInt(stats.bfree) * blockSize;
  const available = BigInt(stats.bavail) * blockSize;
  const safe = (value) => {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Filesystem size outside JSON-safe integer range');
    }
    return Number(value);
  };
  const totalBytes = safe(total);
  const freeBytes = safe(free);
  const availableBytes = safe(available);
  const usedBytes = safe(total - free);
  return {
    mountpoint, totalBytes, usedBytes, availableBytes, freeBytes,
    usagePercent: totalBytes > 0 ? Number((usedBytes / totalBytes * 100).toFixed(1)) : 0,
    source: 'node-statfs'
  };
}

export default {
  id: 'storage.usage',
  title: '根文件系统磁盘占用',
  description: '通过 Node.js fs.statfs() 读取当前主机根文件系统容量。',
  kind: 'read', permission: 'storage:read', exposure: { web: true, mcp: true },
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['mountpoint', 'totalBytes', 'usedBytes', 'availableBytes', 'freeBytes', 'usagePercent', 'source'],
    properties: {
      mountpoint: { type: 'string' }, totalBytes: { type: 'number', minimum: 0 },
      usedBytes: { type: 'number', minimum: 0 }, availableBytes: { type: 'number', minimum: 0 },
      freeBytes: { type: 'number', minimum: 0 }, usagePercent: { type: 'number', minimum: 0, maximum: 100 },
      source: { type: 'string' }
    },
    additionalProperties: false
  },
  presentation: {
    type: 'progress', title: '根文件系统', valueKey: 'usagePercent',
    totalKey: 'totalBytes', usedKey: 'usedBytes', availableKey: 'availableBytes',
    details: [{ key: 'mountpoint', label: '挂载点' }, { key: 'source', label: '采集方式' }]
  },
  explain: 'fs.statfs("/") 获取文件系统的块数量与可用块。已用量根据总块和空闲块计算，available 可能少于 free（保留块）。APFS 等文件系统统计口径可能与 Finder 略有差异。',
  createPlan: async () => [{ type: 'node-api', description: '调用 fs.promises.statfs("/", { bigint: true })；不执行 Shell 命令' }],
  execute: async () => summarizeStatfs(await statfs('/', { bigint: true }))
};
