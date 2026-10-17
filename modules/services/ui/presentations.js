export default [
  {
    "actionId": "services.list",
    "loadOnEnter": true,
    "renderer": "table",
    "rowsKey": "services",
    "inputsLabel": "筛选",
    "inputs": [
      {
        "key": "nameKeyword",
        "label": "服务名称关键词",
        "type": "text",
        "placeholder": "例如 nginx"
      },
      {
        "key": "active",
        "label": "运行状态",
        "type": "select",
        "optionsKey": "activeStates"
      },
      {
        "key": "sub",
        "label": "子状态",
        "type": "select",
        "optionsKey": "subStates"
      }
    ],
    "columns": [
      {
        "key": "name",
        "label": "服务"
      },
      {
        "key": "active",
        "label": "运行状态"
      },
      {
        "key": "sub",
        "label": "子状态"
      },
      {
        "key": "description",
        "label": "说明"
      }
    ],
    "refreshIntervalMs": 0,
    "clientFilters": [
      {
        "key": "nameKeyword",
        "field": "name",
        "match": "contains"
      },
      {
        "key": "active",
        "field": "active",
        "match": "exact"
      },
      {
        "key": "sub",
        "field": "sub",
        "match": "exact"
      }
    ]
  }
  ,{
    "actionId":"services.logs",
    "renderer":"logs",
    "loadOnEnter":false,
    "inputsLabel":"日志查询",
    "inputs":[
      {"key":"unit","label":"systemd 服务","type":"text","placeholder":"例如 certbot.service"},
      {"key":"lines","label":"最近行数","type":"number"}
    ],
    "refreshIntervalMs":0
  }
];
