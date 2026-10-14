import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStatfs } from '../modules/storage/actions/usage.js';
import { parseSystemctlLines } from '../modules/services/actions/list.js';
import { parseMeminfo } from '../modules/system/actions/memory.js';
import { cpuSnapshot, cpuUsageBetween } from '../modules/system/actions/cpu.js';

test('statfs disk accounting preserves available vs free blocks', () => {
  const data = summarizeStatfs({ bsize: 1024n, blocks: 100n, bfree: 40n, bavail: 30n });
  assert.equal(data.totalBytes, 102400);
  assert.equal(data.usedBytes, 61440);
  assert.equal(data.freeBytes, 40960);
  assert.equal(data.availableBytes, 30720);
  assert.equal(data.usagePercent, 60);
  assert.equal(data.mountpoint, '/');
});

test('statfs rejects values outside JSON-safe numeric range', () => {
  assert.throws(() => summarizeStatfs({
    bsize: 4096n, blocks: BigInt(Number.MAX_SAFE_INTEGER), bfree: 1n, bavail: 0n
  }), /JSON-safe/);
});

test('systemctl parser preserves descriptions and records unrecognized lines', () => {
  const data = parseSystemctlLines(
    'nginx.service loaded active running A web server\n' +
    '● failed.service loaded failed failed An unusual error message\n' +
    'malformed-row\n');
  assert.deepEqual(data.services[0], {
    name: 'nginx.service', load: 'loaded', active: 'active',
    sub: 'running', description: 'A web server'
  });
  assert.equal(data.services[1].name, 'failed.service');
  assert.deepEqual(data.unparsedLines, ['malformed-row']);
});

test('meminfo uses explicit kB to bytes conversion', () => {
  const values = parseMeminfo('MemTotal:       1000 kB\nMemFree:        100 kB\nMemAvailable:    300 kB\n');
  assert.equal(values.get('MemTotal'), 1024000);
  assert.equal(values.get('MemAvailable'), 307200);
});

test('cpu snapshot delta calculates busy fraction and handles zero elapsed', () => {
  const before = cpuSnapshot([{ times: { user: 20, nice: 0, sys: 20, idle: 60, irq: 0 } }]);
  const after = cpuSnapshot([{ times: { user: 40, nice: 0, sys: 30, idle: 70, irq: 0 } }]);
  assert.equal(cpuUsageBetween(before, after), 75);
  assert.equal(cpuUsageBetween(before, before), 0);
});
