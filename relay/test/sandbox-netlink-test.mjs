/**
 * 沙箱降级测试：模拟受限 unit（缺少 AF_NETLINK）下 os.networkInterfaces() 抛 ENOTSUP，
 * 断言中继仍能启动、/healthz 正常，并记录降级日志。
 *   node relay/test/sandbox-netlink-test.mjs
 *
 * 用 --require 预加载桩替换 os.networkInterfaces，不改动仓库代码。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const PORT = Number(process.env.SANDBOX_TEST_PORT) || 18791;
const STATE_DIR = mkdtempSync(join(tmpdir(), 't2c-sandbox-'));
const PRELOAD = join(STATE_DIR, 'fake-netlink.cjs');

writeFileSync(PRELOAD, [
  "'use strict';",
  "const os = require('os');",
  'os.networkInterfaces = () => {',
  "  const err = new Error('uv_interface_addresses returned Unknown system error 97');",
  "  err.code = 'ENOTSUP';",
  '  throw err;',
  '};',
  '',
].join('\n'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let output = '';

try {
  child = spawn(process.execPath, ['--require', PRELOAD, 'relay/server.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(PORT),
      // 用 0.0.0.0 触发启动时的局域网地址枚举（127.0.0.1 会跳过 lanAddresses）
      HOST: '0.0.0.0',
      STATE_DIRECTORY: STATE_DIR,
      TALK2COPILOT_TOKEN: '',
      TALK2COPILOT_ADMIN_TOKEN: '',
      LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => (output += data));
  child.stderr.on('data', data => (output += data));

  let health;
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) {
        health = await res.json();
        break;
      }
    } catch {
      // 尚未监听
    }
    await sleep(100);
  }

  assert.ok(health, '网卡枚举失败时中继仍应启动并通过健康检查');
  assert.equal(health.status, 'ok');
  assert.match(output, /无法枚举本机网卡/, '应记录降级日志');
  assert.equal(child.exitCode, null, '中继进程不应因网卡枚举失败而退出');
  console.log('沙箱网卡枚举降级测试：全部通过');
} catch (err) {
  console.error('测试失败：', err.message);
  console.error('---- 中继日志（末尾） ----');
  console.error(output.split('\n').slice(-20).join('\n'));
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      sleep(3000),
    ]);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
  rmSync(STATE_DIR, { recursive: true, force: true });
}
