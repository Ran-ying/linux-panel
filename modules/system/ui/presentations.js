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
        "details": [
          {
            "key": "logicalCpus",
            "label": "逻辑处理器",
            "format": "integer"
          },
          {
            "key": "availableParallelism",
            "label": "可用并行度",
            "format": "integer"
          }
        ]
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
    "refreshIntervalMs": 0,
    "fields": [
      {
        "key": "distribution",
        "label": "操作系统"
      },
      {
        "key": "release",
        "label": "内核版本"
      },
      {
        "key": "arch",
        "label": "架构"
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
