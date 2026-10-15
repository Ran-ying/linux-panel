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

export default {
  id: 'services.list',
  title: '列出 systemd 服务',
  description: 'Linux 调用 systemctl 并解析结构化服务表；macOS 返回标注的演示数据。',
  kind: 'read', permission: 'services:read', exposure: { web: true, mcp: true },
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['source', 'services', 'unparsedLines', 'count'],
    properties: {
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
  explain: 'systemctl list-units --type=service --all 读取已加载的 systemd Units；它不是全部已安装服务文件。macOS 不使用 systemd，示例数据不能代表 VPS。',
  terminal:{
    fields:{units:'systemctl list-units --type=service --all --no-pager --no-legend --plain'},
    decode: values => {
      const result=parseSystemctlLines(values.units);
      return {source:'systemd',...result,count:result.services.length};
    }
  },
  createPlan: async () => process.platform === 'linux'
    ? [{ type: 'execFile', command: 'systemctl', args: ['list-units', '--type=service', '--all', '--no-pager', '--no-legend', '--plain'] }]
    : [{ type: 'mock', description: 'macOS 没有 systemd；返回明确标记的模拟数据' }],
  execute: async () => {
    if (process.platform !== 'linux') {
      const services = [{ name: 'demo.service', load: 'mock', active: 'mock', sub: 'mock', description: 'MacBook 演示数据，非真实 Linux 服务' }];
      return { source: 'mock-macos', services, unparsedLines: [], count: services.length };
    }
    const { stdout } = await execFileAsync('systemctl',
      ['list-units', '--type=service', '--all', '--no-pager', '--no-legend', '--plain'],
      { timeout: 10000, maxBuffer: 1024 * 1024 });
    const result = parseSystemctlLines(stdout);
    return { source: 'systemd', ...result, count: result.services.length };
  }
};
