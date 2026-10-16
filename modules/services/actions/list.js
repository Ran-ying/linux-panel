import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Preserve the full description; handle systemctl failure bullet prefix. */
export function parseSystemctlLines(stdout) {
  const services = [];
  const unparsedLines = [];
  for (const line of stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
    const cleaned = line.replace(/^●\s+/, '');
    const match = cleaned.match(/^(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (!match) {
      unparsedLines.push(line);
      continue;
    }
    services.push({
      name: match[1], load: match[2], active: match[3],
      sub: match[4], description: match[5]
    });
  }
  return { services, unparsedLines };
}


/** Filters are literal data comparisons after parsing, never shell fragments. */
export function serviceResult(source,parsed,input={}) {
  const keyword=(input.nameKeyword ?? '').trim().toLowerCase();
  const active=input.active ?? '',sub=input.sub ?? '';
  const activeStates=[...new Set(parsed.services.map(service=>service.active))].sort();
  const subStates=[...new Set(parsed.services.map(service=>service.sub))].sort();
  const services=parsed.services.filter(service=>
    (!keyword || service.name.toLowerCase().includes(keyword)) &&
    (!active || service.active===active) && (!sub || service.sub===sub));
  return {source,services,unparsedLines:parsed.unparsedLines,count:services.length,activeStates,subStates};
}

export default {
  id: 'services.list',
  title: '列出 systemd 服务',
  description: '读取 systemd 服务，支持服务名称关键词、运行状态和子状态组合筛选。',
  kind: 'read', permission: 'services:read', exposure: { web: true, mcp: true },
  inputSchema: { type:'object',additionalProperties:false,properties:{
    nameKeyword:{type:'string',maxLength:120},active:{type:'string',maxLength:64},sub:{type:'string',maxLength:64}
  } },
  outputSchema: {
    type: 'object',
    required: ['source', 'services', 'unparsedLines', 'count', 'activeStates', 'subStates'],
    properties: {
      activeStates:{type:'array',items:{type:'string'}},subStates:{type:'array',items:{type:'string'}},
      source: { type: 'string' }, count: { type: 'integer', minimum: 0 },
      unparsedLines: { type: 'array', items: { type: 'string' } },
      services: { type: 'array', items: {
        type: 'object', required: ['name', 'load', 'active', 'sub', 'description'],
        properties: {
          name: { type: 'string' }, load: { type: 'string' }, active: { type: 'string' },
          sub: { type: 'string' }, description: { type: 'string' }
        }, additionalProperties: false
      } }
    },
    additionalProperties: false
  },
  explain: 'systemctl list-units --type=service --all 读取已加载的 systemd Units；它不是全部已安装服务文件。nameKeyword 对服务名称做不区分大小写的字面子串匹配，active/sub 精确匹配，多个条件同时成立；留空表示全部。状态选项来自本次完整采集，再进行筛选。macOS 不使用 systemd，示例数据不能代表 VPS。',
  terminal:{
    fields:{units:'systemctl list-units --type=service --all --no-pager --no-legend --plain'},
    decode: (values,{input={}}={}) => {
      const result=parseSystemctlLines(values.units);
      return serviceResult('systemd',result,input);
    }
  },
  createPlan: async () => process.platform === 'linux'
    ? [{ type: 'execFile', command: 'systemctl', args: ['list-units', '--type=service', '--all', '--no-pager', '--no-legend', '--plain'] }]
    : [{ type: 'mock', description: 'macOS 没有 systemd；返回明确标记的模拟数据' }],
  execute: async (input={}) => {
    if (process.platform !== 'linux') {
      const services = [{ name: 'demo.service', load: 'mock', active: 'mock', sub: 'mock', description: 'MacBook 演示数据，非真实 Linux 服务' }];
      return serviceResult('mock-macos',{services,unparsedLines:[]},input);
    }
    const { stdout } = await execFileAsync('systemctl',
      ['list-units', '--type=service', '--all', '--no-pager', '--no-legend', '--plain'],
      { timeout: 10000, maxBuffer: 1024 * 1024 });
    const result = parseSystemctlLines(stdout);
    return serviceResult('systemd',result,input);
  }
};
