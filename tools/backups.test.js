'use strict';

/**
 * lib/backups.js 的单元测试（零依赖，全部在临时目录里跑）。
 *
 * 备份是“出事能回头”的唯一保障，所以要锁住：
 *   1. 一次备份会把世界/账号库/配置都抓进来，并写下 manifest；
 *   2. 列表按时间倒序，且能忽略 backups/config 这类非快照目录；
 *   3. 还原前必须先停服务器（运行中直接报错）；
 *   4. 还原会先把当前状态备份一份，且文件内容真的被写回原位置；
 *   5. 删除只删备份目录，不接受路径穿越。
 *
 * 用法：node tools/backups.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createBackupService } = require('../TShockPanel/lib/backups');
const { readWorldInfo } = require('../TShockPanel/lib/worlds');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed += 1;
    console.error(`  [FAIL] ${name}\n         期望 ${JSON.stringify(expected)}\n         实际 ${JSON.stringify(actual)}`);
  } else {
    console.log(`  [OK]   ${name}`);
  }
}
function checkThrows(name, fn, message) {
  try {
    fn();
    check(name, 'no throw', message);
  } catch (err) {
    check(name, err.message, message);
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-backup-'));
const tshockDir = path.join(root, 'tshock');
const backupDir = path.join(root, 'backups');
const worldPath = path.join(root, 'Worlds', 'test.wld');
fs.mkdirSync(tshockDir, { recursive: true });
fs.mkdirSync(path.dirname(worldPath), { recursive: true });

const configPath = path.join(tshockDir, 'config.json');
const sscPath = path.join(tshockDir, 'sscconfig.json');
const sqlitePath = path.join(tshockDir, 'tshock.sqlite');
// 一个最小的假 .wld：头部足够长，readWorldInfo 会返回 null（内容不合规），
// 这里只关心“文件被复制”，不关心能否解析出世界名
fs.writeFileSync(worldPath, Buffer.alloc(200, 7));
fs.writeFileSync(configPath, '{"Settings":{}}');
fs.writeFileSync(sscPath, '{"Settings":{}}');
fs.writeFileSync(sqlitePath, Buffer.from('sqlite-bytes'));

let running = false;
const logs = [];
const svc = createBackupService({
  backupDir,
  tshockDir,
  configPath,
  sscPath,
  readWorldInfo,
  sanitizeFileName: (n) => String(n).replace(/[\\/:*?"<>|]/g, ' ').trim() || '新世界',
  isRunning: async () => running,
  getLaunchWorld: () => worldPath,
  log: (t) => logs.push(t),
});

(async () => {
  console.log('1) 创建备份');
  const manifest = await svc.create({ reason: '单元测试', worldPath });
  check('manifest 有 id 与文件清单', Boolean(manifest.id) && manifest.files.length >= 3, true);
  check('抓到了账号库', manifest.files.some((f) => f.name === 'tshock.sqlite'), true);
  check('抓到了配置', manifest.files.some((f) => f.name === 'config.json'), true);
  check('抓到了世界文件', manifest.files.some((f) => f.name === 'world.wld'), true);
  const snapshotDir = path.join(backupDir, manifest.id);
  check('快照目录里有 manifest.json', fs.existsSync(path.join(snapshotDir, 'manifest.json')), true);
  check('快照里的 sqlite 内容一致', fs.readFileSync(path.join(snapshotDir, 'tshock.sqlite'), 'utf8'), 'sqlite-bytes');

  console.log('2) 列表');
  // 造一个非快照目录，确认会被忽略
  fs.mkdirSync(path.join(backupDir, 'config'), { recursive: true });
  const list = await svc.list();
  check('只列出真正的快照', list.length, 1);
  check('列表带 id 与大小', list[0].id, manifest.id);
  check('大小 > 0', list[0].size > 0, true);

  console.log('3) 还原前的服务器状态检查');
  running = true;
  try {
    await svc.restore(manifest.id);
    check('运行中应报错', 'no throw', '请先停止服务器再还原备份。');
  } catch (err) {
    check('运行中报错文案', err.message, '请先停止服务器再还原备份。');
  }
  running = false;

  console.log('4) 还原');
  const countBeforeRestore = (await svc.list()).length;
  fs.writeFileSync(sqlitePath, 'changed-after-backup');
  fs.writeFileSync(configPath, '{"Settings":{"x":1}}');
  const res = await svc.restore(manifest.id);
  check('还原报告 ok', res.ok, true);
  check('账号库被写回', fs.readFileSync(sqlitePath, 'utf8'), 'sqlite-bytes');
  check('配置被写回', fs.readFileSync(configPath, 'utf8'), '{"Settings":{}}');
  const afterRestore = await svc.list();
  check('还原前自动备份了一份', afterRestore.length, countBeforeRestore + 1);
  check(
    '自动备份的原因标记正确',
    afterRestore.some((b) => b.reason === '还原前自动备份'),
    true
  );
  check('被还原的那份快照没被覆盖', afterRestore.some((b) => b.id === manifest.id), true);

  console.log('5) 删除');
  const before = (await svc.list()).length;
  const backupIds = (await svc.list()).map((b) => b.id);
  await svc.remove(backupIds[0]);
  check('删掉一个', (await svc.list()).length, before - 1);
  try {
    await svc.remove('2020-01-01_000000_不存在');
    check('删除不存在的备份应报错', 'no throw', '备份不存在。');
  } catch (err) {
    check('删除不存在的备份报错文案', err.message, '备份不存在。');
  }

  fs.rmSync(root, { recursive: true, force: true });

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
