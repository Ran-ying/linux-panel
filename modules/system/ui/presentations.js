/** Data-only descriptors; the panel owns rendering, layout and interaction. */
export default [
  {
    "actionId": "system.info",
    "renderer": "sections",
    "loadOnEnter": true,
    "refreshIntervalMs": 15000,
    "sections": [
      {
        "renderer": "metrics",
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
      },
      {
        "key": "disk",
        "renderer": "progress",
        "title": "磁盘占用",
        "valueKey": "usagePercent",
        "totalKey": "totalBytes",
        "usedKey": "usedBytes",
        "availableKey": "availableBytes",
        "details": [
          {
            "key": "mountpoint",
            "label": "挂载点"
          },
          {
            "key": "source",
            "label": "采集方式"
          }
        ]
      }
    ]
  },
  {
    "actionId": "system.resources",
    "renderer": "sections",
    "loadOnEnter": true,
    "refreshIntervalMs": 5000,
    "sections": [
      {
        "key": "cpu",
        "renderer": "progress",
        "title": "CPU 使用率",
        "valueKey": "usagePercent",
        "details": [
          {
            "key": "logicalCpus",
            "label": "逻辑处理器",
            "format": "integer"
          },
          {
            "key": "sampleWindowMs",
            "label": "采样间隔",
            "format": "milliseconds"
          },
          {
            "key": "model",
            "label": "处理器"
          }
        ]
      },
      {
        "key": "memory",
        "renderer": "progress",
        "title": "内存占用",
        "valueKey": "usagePercent",
        "totalKey": "totalBytes",
        "usedKey": "usedBytes",
        "availableKey": "availableBytes",
        "details": [
          {
            "key": "source",
            "label": "数据来源"
          }
        ]
      }
    ]
  }
];
