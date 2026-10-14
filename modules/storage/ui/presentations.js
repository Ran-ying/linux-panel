/** Presentation metadata belongs to the Web UI, not the storage Action. */
export default [{
  actionId: 'storage.usage',
    loadOnEnter: true,
  renderer: 'progress', title: '根文件系统', valueKey: 'usagePercent',
  totalKey: 'totalBytes', usedKey: 'usedBytes', availableKey: 'availableBytes',
  details: [
    { key: 'mountpoint', label: '挂载点' },
    { key: 'source', label: '采集方式' }
  ],
  refreshIntervalMs: 15000
}];
