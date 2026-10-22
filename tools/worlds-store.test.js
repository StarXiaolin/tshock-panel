'use strict';

/**
 * lib/worlds-store.js 的单元测试（零依赖，全部在临时目录里跑）。
 *
 * 锁住四件事：
 *   1. 列表会合并多个目录、去重、按修改时间倒序，并正确标注 current / selected；
 *   2. 新建世界遇到重名会加 " (1)" 后缀，且把 mode=create 与人数传给建图进程；
 *   3. 删除只允许删世界目录里的存档（防路径穿越），且只能进回收站；
 *   4. 正在使用的世界在服务器运行中不允许删。
 *
 * 用法：node tools/worlds-store.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWorldStore } = require('../TShockPanel/lib/worlds-store');

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-worlds-'));
const worldsDir = path.join(root, 'Worlds');
const serverDir = path.join(root, 'server');
const trashDir = path.join(root, 'trash');
fs.mkdirSync(worldsDir, { recursive: true });
fs.mkdirSync(path.join(serverDir, 'Worlds'), { recursive: true });

function touch(file, mtimeMs) {
  fs.writeFileSync(file, 'fake-wld');
  const t = new Date(mtimeMs);
  fs.utimesSync(file, t, t);
}
const older = path.join(worldsDir, 'older.wld');
const newer = path.join(worldsDir, 'newer.wld');
const loose = path.join(serverDir, 'loose.wld');
touch(older, Date.now() - 60000);
touch(newer, Date.now() - 1000);
touch(loose, Date.now() - 120000);

let running = false;
let currentWorld = newer;
let selectedWorld = newer;
let maxPlayers = 8;
const spawned = [];

const store = createWorldStore({
  getWorldsDir: () => worldsDir,
  serverDir,
  trashDir,
  getCurrentWorld: () => currentWorld,
  getSelectedWorld: () => selectedWorld,
  getMaxPlayers: () => maxPlayers,
  isRunning: async () => running,
  startServer: (params) => spawned.push(params),
  // 用真实解析器：内容不是合法 .wld，会返回 null，所以这里换成轻量 stub
  readWorldInfo: (file) => ({ name: path.basename(file, '.wld'), size: 8, modified: fs.statSync(file).mtimeMs, seed: 'x', version: 279 }),
  sanitizeFileName: (n) => String(n || '').replace(/[\\/:*?"<>|]/g, ' ').trim() || '新世界',
  moveFile: (src, dest) => fs.renameSync(src, dest),
  timestamp: () => '2026-10-20_190000',
});

(async () => {
  console.log('1) 列表');
  const list = await store.list();
  check('合并 3 个世界（两个目录）', list.length, 3);
  check('按修改时间倒序', list.map((w) => w.file), ['newer.wld', 'older.wld', 'loose.wld']);
  check('当前世界被标记', list.find((w) => w.file === 'newer.wld').current, true);
  check('选中世界被标记', list.find((w) => w.file === 'newer.wld').selected, true);
  check('非 Terraria 目录的世界标记为 false', list.find((w) => w.file === 'loose.wld').inTerrariaFolder, false);

  console.log('2) 新建世界');
  const created = await store.create({ name: '新世界', size: 2, seed: 'abc' });
  check('返回目标路径', created.path, path.join(worldsDir, '新世界.wld'));
  check('调用建图进程一次', spawned.length, 1);
  check('mode=create', spawned[0].mode, 'create');
  check('带上人数', spawned[0].maxPlayers, 8);
  check('带上尺寸与种子', [spawned[0].size, spawned[0].seed], [2, 'abc']);

  // 同名文件已存在时会加后缀
  fs.writeFileSync(path.join(worldsDir, '新世界.wld'), 'x');
  const created2 = await store.create({ name: '新世界' });
  check('重名时加后缀', path.basename(created2.path), '新世界 (1).wld');

  console.log('3) 删除');
  const res = await store.remove(older);
  check('删除成功', res.ok, true);
  check('文件离开世界目录', fs.existsSync(older), false);
  check('进了回收站', fs.existsSync(path.join(trashDir, '2026-10-20_190000_older.wld')), true);

  try {
    await store.remove(path.join(root, 'outside.wld'));
    check('目录外文件应被拒绝', 'no throw', '只能删除世界目录里的存档。');
  } catch (err) {
    check('目录外文件被拒绝', err.message, '只能删除世界目录里的存档。');
  }

  running = true;
  currentWorld = newer;
  try {
    await store.remove(newer);
    check('运行中的世界应被拒绝', 'no throw', '这个世界正在使用中，请先停止服务器。');
  } catch (err) {
    check('运行中的世界被拒绝', err.message, '这个世界正在使用中，请先停止服务器。');
  }
  running = false;

  console.log('4) 服务器根目录里散落的 .wld 也能列出来');
  check('loose.wld 在列表里', (await store.list()).some((w) => w.file === 'loose.wld'), true);

  fs.rmSync(root, { recursive: true, force: true });

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
