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

async function readDiskUsage() {
  return summarizeStatfs(await statfs('/', { bigint: true }));
}

// Internal collector; only system.info is registered as an Action.
export default {
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
  explain: 'Linux 通过 stat -f 获取文件系统的块数量与可用块；其他平台使用 fs.statfs("/")。已用量根据总块和空闲块计算，available 可能少于 free（保留块）。APFS 等文件系统统计口径可能与 Finder 略有差异。',
  terminal:{
    fields:{filesystem:"stat -f -c '%S %b %f %a' /"},
    decode: values => {
      const parts=values.filesystem.trim().split(/\s+/).map(BigInt);
      if (parts.length!==4) throw new Error('Invalid filesystem counters');
      return summarizeStatfs({bsize:parts[0],blocks:parts[1],bfree:parts[2],bavail:parts[3]});
    }
  },
  createPlan: async () => [{ type: 'node-api', code: readDiskUsage.toString() }],
  execute: readDiskUsage
};
