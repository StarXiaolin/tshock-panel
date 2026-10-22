'use strict';

/**
 * lib/tshock-config.js 的单元测试（零依赖，直接 node 运行）。
 *
 * 覆盖配置读写收敛后最容易退化的四个点：
 *   1. 只改认识的字段，未知字段（未知设置项、顶层其它节点）必须原样保留；
 *   2. 每次写入前都要有备份；
 *   3. ensureRestConfig 必须幂等（已配好就一个字节都不写）；
 *   4. SSCCONFIG 只替换白名单里的字段。
 *
 * 用法：node tools/config-store.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createConfigStore } = require('../TShockPanel/lib/tshock-config');

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-cfg-'));
const configPath = path.join(dir, 'config.json');
const sscPath = path.join(dir, 'sscconfig.json');
const backupDir = path.join(dir, 'config-backups');

fs.writeFileSync(
  configPath,
  JSON.stringify(
    {
      Settings: { MaxSlots: 8, ServerPort: 7777, FutureOption: 'keep-me', ApplicationRestTokens: {} },
      Extra: { keep: true },
    },
    null,
    2
  )
);
fs.writeFileSync(sscPath, JSON.stringify({ Settings: { Enabled: true, StartingHealth: 100 } }, null, 2));

const logs = [];
const store = createConfigStore({
  configPath,
  sscPath,
  backupDir,
  getRestPort: () => 7878,
  getRestToken: () => 'test-token',
  log: (text) => logs.push(text),
});

console.log('1) getConfig 保留未知字段');
const got = store.getConfig();
check('settings 含 FutureOption', got.settings.FutureOption, 'keep-me');
check('schema 有分组', Array.isArray(got.schema.groups) && got.schema.groups.length > 0, true);

console.log('2) saveConfig 增量写：只改白名单内、已存在的键');
const saved = store.saveConfig({ MaxSlots: 12, NonexistentKey: 1 });
check('MaxSlots 已更新', JSON.parse(fs.readFileSync(configPath, 'utf8')).Settings.MaxSlots, 12);
check('未知名键被忽略', saved.applied, ['MaxSlots']);
check('未知设置项仍在', JSON.parse(fs.readFileSync(configPath, 'utf8')).Settings.FutureOption, 'keep-me');
check('顶层其它节点仍在', JSON.parse(fs.readFileSync(configPath, 'utf8')).Extra, { keep: true });
check('写入前已备份', fs.readdirSync(backupDir).length, 1);

console.log('3) 同一秒内连续备份不互相覆盖');
const namesBefore = fs.readdirSync(backupDir);
const contentBefore = fs.readFileSync(path.join(backupDir, namesBefore[0]), 'utf8');
store.saveConfig({ MaxSlots: 15 });
const namesAfter = fs.readdirSync(backupDir);
check('多出一份备份（而不是覆盖上一份）', namesAfter.length, 2);
check('两份文件名不同', new Set(namesAfter).size, 2);
check('旧备份内容未被改动', fs.readFileSync(path.join(backupDir, namesBefore[0]), 'utf8'), contentBefore);
const newest = namesAfter.filter((n) => n !== namesBefore[0])[0];
check('新备份存的是上一版本（MaxSlots=12）', JSON.parse(fs.readFileSync(path.join(backupDir, newest), 'utf8')).Settings.MaxSlots, 12);

console.log('4) saveConfig 原始 JSON 模式');
fs.rmSync(backupDir, { recursive: true, force: true });
store.saveConfig(null, JSON.stringify({ Settings: { MaxSlots: 20 }, Extra: false }));
check('原始模式整份替换', Object.keys(JSON.parse(fs.readFileSync(configPath, 'utf8'))).sort(), ['Extra', 'Settings']);
check('原始模式也备份', fs.readdirSync(backupDir).length, 1);

console.log('5) ensureRestConfig 幂等');
const first = store.ensureRestConfig();
const afterFirst = fs.readFileSync(configPath, 'utf8');
check('返回 ok', first.ok, true);
check('写入 REST 端口', JSON.parse(afterFirst).Settings.RestApiPort, 7878);
check('写入面板令牌', JSON.parse(afterFirst).Settings.ApplicationRestTokens['test-token'], {
  Username: 'panel',
  UserGroupName: 'superadmin',
});
const backupCountAfterFirst = fs.readdirSync(backupDir).length;
const second = store.ensureRestConfig();
check('第二次仍返回 ok', second.ok, true);
check('第二次不再产生备份', fs.readdirSync(backupDir).length, backupCountAfterFirst);
check('第二次一个字节都没改', fs.readFileSync(configPath, 'utf8'), afterFirst);

console.log('6) SSC 只改白名单字段');
const sscSaved = store.saveSsc({ StartingHealth: 200, SomeOtherField: 'ignored' });
const sscAfter = JSON.parse(fs.readFileSync(sscPath, 'utf8'));
check('StartingHealth 已更新', sscAfter.Settings.StartingHealth, 200);
check('非白名单字段被忽略', sscAfter.Settings.SomeOtherField, undefined);
check('return.restartRequired', sscSaved.restartRequired, true);

console.log('7) 配置文件丢失时的错误文案');
const missing = createConfigStore({
  configPath: path.join(dir, 'nope.json'),
  sscPath: path.join(dir, 'nope-ssc.json'),
  backupDir,
  getRestPort: () => 7878,
  getRestToken: () => 'x',
  log: () => {},
});
check('ensureRestConfig 不抛错', missing.ensureRestConfig().ok, false);
try {
  missing.getConfig();
  check('getConfig 抛错', false, true);
} catch (err) {
  check('getConfig 抛错且文案不变', err.message, '读取 tshock/config.json 失败，文件可能不存在或格式错误。');
}

fs.rmSync(dir, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
