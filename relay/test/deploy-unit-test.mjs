/**
 * 中继部署 unit 的静态回归测试（无需 systemd）：
 *   node relay/test/deploy-unit-test.mjs
 *
 * Issue #13：unit 的 RestrictAddressFamilies 缺少 AF_NETLINK 时，启动阶段的
 * os.networkInterfaces() 会因 netlink 被屏蔽而抛 EAFNOSUPPORT（errno 97，
 * Node 报 ERR_SYSTEM_ERROR），中继启动即崩。
 * 这里钉住模板与安装脚本，防止再次漏掉该地址族。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RELAY = join(HERE, '..');
const unit = readFileSync(join(RELAY, 'deploy', 'talk2copilot-relay.service'), 'utf8');
const install = readFileSync(join(RELAY, 'deploy', 'install.sh'), 'utf8');

const familyLine = unit.split('\n').find(line => line.startsWith('RestrictAddressFamilies='));
assert.ok(familyLine, 'unit 必须声明 RestrictAddressFamilies');
const families = familyLine.slice('RestrictAddressFamilies='.length).trim().split(/\s+/);
for (const family of ['AF_INET', 'AF_INET6', 'AF_UNIX', 'AF_NETLINK']) {
  assert.ok(families.includes(family), `RestrictAddressFamilies 必须包含 ${family}`);
}
assert.match(unit, /netlink/i, 'unit 注释应说明 AF_NETLINK 的作用');
assert.match(unit, /errno 97/, 'unit 注释应记录缺少 AF_NETLINK 的报错（errno 97）');
assert.match(
  install,
  /install -m 0644 "\$REPO_ROOT\/relay\/deploy\/\$\{UNIT_NAME\}" "\$UNIT_PATH"/,
  'install.sh 必须从包内 unit 模板安装（否则修复不会随部署生效）',
);

console.log('中继部署 unit 测试：全部通过');
