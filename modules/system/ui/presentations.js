/** Data-only descriptors; the panel owns rendering, layout and interaction. */
export default [
  {
    "actionId": "system.resources",
    "renderer": "sections",
    "loadOnEnter": true,
    "refreshIntervalMs": 5000,
    "sections": [
      {
        "key": "cpu",
        "renderer": "gauge",
        "title": "CPU",
        "valueKey": "usagePercent",
        "totalKey": "logicalCpus",
        "quantityFormat": "number",
        "unit": "核"
      },
      {
        "key": "memory",
        "renderer": "gauge",
        "title": "内存",
        "valueKey": "usagePercent",
        "totalKey": "totalBytes",
        "usedKey": "usedBytes",
        "quantityFormat": "bytes"
      },
      {
        "key": "disk",
        "renderer": "gauge",
        "title": "磁盘",
        "valueKey": "usagePercent",
        "totalKey": "totalBytes",
        "usedKey": "usedBytes",
        "quantityFormat": "bytes"
      }
    ],
    "layout": "grid"
  },
  {
    "actionId": "system.info",
    "renderer": "metrics",
    "loadOnEnter": true,
    "refreshIntervalMs": 15000,
    "fields": [
      {
        "key": "hostname",
        "label": "主机名"
      },
      {
        "key": "platform",
        "label": "操作系统"
      },
      {
        "key": "arch",
        "label": "架构"
      },
      {
        "key": "cpuCount",
        "label": "可用并行度",
        "format": "integer"
      },
      {
        "key": "totalMemoryBytes",
        "label": "物理内存",
        "format": "bytes"
      },
      {
        "key": "uptimeSeconds",
        "label": "系统运行时间",
        "format": "duration"
      },
      {
        "key": "nodeVersion",
        "label": "Node.js 版本"
      }
    ]
  }
];
