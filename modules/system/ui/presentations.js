/**
 * Web-only presentation hints and invocation preferences.
 * These descriptors do not alter the Action contract, execution or MCP output.
 * No timer runs on the server: refresh is an optional browser interaction.
 */
export default [
  {
    actionId: 'system.info',
    renderer: 'metrics',
    fields: [
      { key: 'hostname', label: '主机名' },
      { key: 'platform', label: '操作系统' },
      { key: 'arch', label: '架构' },
      { key: 'cpuCount', label: '可用并行度', format: 'integer' },
      { key: 'totalMemoryBytes', label: '物理内存', format: 'bytes' },
      { key: 'uptimeSeconds', label: '系统运行时间', format: 'duration' },
      { key: 'nodeVersion', label: 'Node.js 版本' }
    ],
    refreshIntervalMs: 0
  },
  {
    actionId: 'system.memory',
    renderer: 'progress', title: '内存占用', valueKey: 'usagePercent',
    totalKey: 'totalBytes', usedKey: 'usedBytes', availableKey: 'availableBytes',
    details: [{ key: 'source', label: '数据来源' }],
    refreshIntervalMs: 5000
  },
  {
    actionId: 'system.cpu',
    renderer: 'progress', title: 'CPU 使用率', valueKey: 'usagePercent',
    details: [
      { key: 'logicalCpus', label: '逻辑处理器', format: 'integer' },
      { key: 'sampleWindowMs', label: '采样间隔', format: 'milliseconds' },
      { key: 'model', label: '处理器' }
    ],
    refreshIntervalMs: 5000
  }
];
