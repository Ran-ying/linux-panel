/** Web-only table view for the structured systemd Action. */
export default [{
  actionId: 'services.list',
  renderer: 'table', rowsKey: 'services',
  columns: [
    { key: 'name', label: '服务' },
    { key: 'active', label: '运行状态' },
    { key: 'sub', label: '子状态' },
    { key: 'description', label: '说明' }
  ],
  refreshIntervalMs: 0
}];
