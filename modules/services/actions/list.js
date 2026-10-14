import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export default {
  id: 'services.list',
  title: '列出 systemd 服务',
  description: '在 Linux 上执行 systemctl 的只读列表命令；Mac 上返回明确标记的模拟数据。',
  kind: 'read',
  permission: 'services:read',
  exposure: { web: true, mcp: true },
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  explain: 'systemd 是许多 Linux 发行版的服务管理器。systemctl list-units --type=service --all 可以列出运行中和未运行的已加载 Unit。',
  createPlan: async () => process.platform === 'linux'
    ? [{ type: 'execFile', command: 'systemctl', args: ['list-units', '--type=service', '--all', '--no-pager', '--no-legend', '--plain'] }]
    : [{ type: 'mock', description: 'macOS 不使用 systemd；返回演示数据（不代表 VPS 真实状态）' }],
  execute: async () => {
    if (process.platform !== 'linux') {
      return { source: 'mock-macos', services: [{ name: 'demo.service', state: 'mock', description: '仅用于 MacBook 本地开发' }] };
    }
    const { stdout } = await execFileAsync('systemctl',
      ['list-units', '--type=service', '--all', '--no-pager', '--no-legend', '--plain'],
      { timeout: 10000, maxBuffer: 1024 * 1024 });
    return { source: 'systemd', lines: stdout.split('\n').map(s => s.trim()).filter(Boolean) };
  }
};
