#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthService } from '../platform/auth/service.js';
import { StateStore } from '../platform/state-store.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const username = process.argv[2] || 'admin';
const fromStdin = process.argv[3] === '--password-stdin';
if (process.argv.length > (fromStdin ? 4 : 3)) {
  process.stderr.write('Usage: admin-init.js [username] [--password-stdin]\n');
  process.exit(1);
}

async function stdinPassword() {
  if (process.stdin.isTTY) throw new Error('--password-stdin requires a pipe or redirected file');
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024) throw new Error('Password input too large');
    chunks.push(chunk);
  }
  const value = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  if (/[\r\n\0]/.test(value)) throw new Error('Provide exactly one password line');
  return value;
}

async function hiddenInput(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode)
    throw new Error('Run this command in an interactive terminal (passwords are never CLI arguments)');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = '';
  try {
    return await new Promise((resolveInput, reject) => {
      const receive = buffer => {
        const valueString = buffer.toString('utf8');
        for (const character of valueString) {
          if (character === '\u0003') {
            process.stdin.off('data', receive);
            reject(new Error('Cancelled'));
            return;
          }
          if (character === '\r' || character === '\n') {
            process.stdin.off('data', receive);
            process.stdout.write('\n');
            resolveInput(value);
            return;
          }
          if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
          else if (character >= ' ' && value.length < 256) value += character;
        }
      };
      process.stdin.on('data', receive);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

try {
  const path = resolve(process.env.PANEL_DATA_DIR || resolve(root, 'data'), 'panel-state.json');
  const auth = new AuthService(new StateStore(path));
  if (await auth.isInitialized()) throw new Error('Already initialized. No Web bootstrap or default password exists.');
  const password = fromStdin ? await stdinPassword() : await hiddenInput('Create administrator password (12+ bytes): ');
  const confirm = fromStdin ? password : await hiddenInput('Confirm password: ');
  if (password !== confirm) throw new Error('Passwords do not match');
  const user = await auth.bootstrap(username, password);
  process.stdout.write(`Created administrator "${user.username}". Private state saved under PANEL_DATA_DIR.\n`);
} catch (error) {
  process.stderr.write(`Initialization failed: ${error.message}\n`);
  process.exitCode = 1;
}
