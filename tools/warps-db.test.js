'use strict';

/**
 * lib/warps-db.js 的单元测试（零依赖，不启动 HTTP 服务，但需要 Node 22 的 node:sqlite）。
 *
 * 这是面板唯一一个“真连数据库”的模块，之前只有手工跑过一次 API 验证（记录在遗留
 * 清单 L14）。这里用临时目录造一个真实 sqlite 文件来覆盖：
 *   1. 只读打开、真实查询 Warps 表；只读连接写操作必须失败（防误改）；
 *   2. 库文件缺失时的错误文案；
 *   3. currentWorldId 的三种情况（正常 / 世界文件不存在 / 读取世界信息抛错）；
 *   4. backupDatabase 的命名、同秒撞名不覆盖、最多留 20 份。
 *
 * 用法：node tools/warps-db.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWarpsDb } = require('../TShockPanel/lib/warps-db');

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
function checkThrows(name, fn, messagePart) {
  try {
    fn();
    check(name, 'no throw', messagePart);
  } catch (err) {
    check(name, err.message.includes(messagePart), true);
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-warps-db-'));
const tshockDir = path.join(root, 'tshock');
fs.mkdirSync(tshockDir, { recursive: true });
const backupRoot = path.join(root, 'backups');

// 用 node:sqlite 造一个与 TShock 结构一致的最小库
const { DatabaseSync } = require('node:sqlite');
const seed = new DatabaseSync(path.join(tshockDir, 'tshock.sqlite'));
seed.exec('CREATE TABLE Warps (Id INTEGER PRIMARY KEY AUTOINCREMENT, WarpName TEXT, X INTEGER, Y INTEGER, WorldID INTEGER, Private INTEGER)');
seed.prepare('INSERT INTO Warps (WarpName, X, Y, WorldID, Private) VALUES (?, ?, ?, ?, ?)').run('home', 100, 200, 1054320003, 1);
seed.prepare('INSERT INTO Warps (WarpName, X, Y, WorldID, Private) VALUES (?, ?, ?, ?, ?)').run('arena', 300, 400, 1054320003, 0);
seed.close();

const logs = [];
let worldFile = path.join(root, 'world.wld');
let worldInfoThrows = false;
fs.writeFileSync(worldFile, 'fake world');

const warpsDb = createWarpsDb({
  tshockDir,
  backupDir: backupRoot,
  getWorldFile: () => worldFile,
  readWorldInfo: () => {
    if (worldInfoThrows) throw new Error('坏存档');
    return { worldId: 1054320003 };
  },
  ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
  timestamp: () => '2026-10-21_120000',
  log: (text) => logs.push(text),
});

console.log('1) 只读打开与查询');
const db = warpsDb.openDb(true);
const rows = db.prepare('SELECT WarpName, Private FROM Warps ORDER BY WarpName').all().map((r) => ({ ...r }));
db.close();
check('读到两行', rows, [{ WarpName: 'arena', Private: 0 }, { WarpName: 'home', Private: 1 }]);

const readOnlyDb = warpsDb.openDb(true);
checkThrows(
  '只读连接不能写',
  () => readOnlyDb.prepare('INSERT INTO Warps (WarpName, X, Y, WorldID, Private) VALUES (?,?,?,?,?)').run('x', 0, 0, 0, 0),
  'readonly'
);
readOnlyDb.close();

const writableDb = warpsDb.openDb(false);
writableDb.prepare('DELETE FROM Warps WHERE WarpName = ?').run('arena');
check('可写连接能删', writableDb.prepare('SELECT COUNT(*) AS n FROM Warps').get().n, 1);
writableDb.close();

console.log('2) 库文件缺失');
const emptyDir = path.join(root, 'empty');
fs.mkdirSync(emptyDir, { recursive: true });
const missing = createWarpsDb({
  tshockDir: emptyDir,
  backupDir: backupRoot,
  getWorldFile: () => '',
  readWorldInfo: () => null,
  ensureDir: () => {},
  timestamp: () => 'x',
  log: () => {},
});
checkThrows('找不到库文件', () => missing.openDb(), '找不到 tshock.sqlite');

console.log('3) currentWorldId');
check('正常取到世界 ID', warpsDb.currentWorldId(), '1054320003');
worldFile = path.join(root, 'nope.wld');
check('世界文件不存在返回 null', warpsDb.currentWorldId(), null);
worldFile = path.join(root, 'world.wld');
worldInfoThrows = true;
check('读取世界信息抛错返回 null', warpsDb.currentWorldId(), null);
worldInfoThrows = false;
check('世界信息没有 worldId 时返回 null', createWarpsDb({
  tshockDir,
  backupDir: backupRoot,
  getWorldFile: () => worldFile,
  readWorldInfo: () => ({}),
  ensureDir: () => {},
  timestamp: () => 'x',
  log: () => {},
}).currentWorldId(), null);

console.log('4) 备份数据库');
warpsDb.backupDatabase('手动');
const backupDir = path.join(backupRoot, 'warps');
const first = fs.readdirSync(backupDir);
check('按时间戳_标签命名', first, ['2026-10-21_120000_手动.sqlite']);
check('备份内容与源库一致', fs.readFileSync(path.join(backupDir, first[0])).equals(fs.readFileSync(path.join(tshockDir, 'tshock.sqlite'))), true);

warpsDb.backupDatabase('手动');
const second = fs.readdirSync(backupDir).sort();
check('同秒再备份不覆盖', second, ['2026-10-21_120000_手动-2.sqlite', '2026-10-21_120000_手动.sqlite']);

console.log('5) 最多保留 20 份');
for (let i = 0; i < 25; i += 1) {
  fs.writeFileSync(path.join(backupDir, `2020-01-01_0000${String(i).padStart(2, '0')}_旧.sqlite`), 'old');
}
warpsDb.backupDatabase('清理');
const kept = fs.readdirSync(backupDir);
check('裁剪到 20 份', kept.length, 20);
check('最新的那份保留', kept.some((f) => f.endsWith('_清理.sqlite')), true);
check('最旧的被删掉', kept.includes('2020-01-01_000000_旧.sqlite'), false);
check('备份失败只记日志不抛错', logs.length, 0);

fs.rmSync(root, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
