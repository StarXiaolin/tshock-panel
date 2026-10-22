'use strict';

/**
 * lib/panel-state.js 的单元测试（零依赖，用临时目录真读写）。
 *
 * panel.json 装的是端口、REST 令牌、上次选的世界。这里有一条安全语义：
 * **没有令牌就随机生成**（否则 TShock REST 不可用；用固定值等于没令牌）。
 * 所以锁住：
 *   1. 文件缺失 / 内容坏掉 / 只写一部分字段时都能合并出完整设置；
 *   2. restToken 为空时一定生成 18 字节随机串；已有令牌绝不覆盖；
 *   3. launch 深合并一层（只写 maxPlayers 不会丢掉 world/port/password）；
 *   4. save() 落盘格式为 2 空格缩进 + 末尾换行，且能读回。
 *
 * 用法：node tools/panel-state.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPanelState, defaultWorldsDir } = require('../TShockPanel/lib/panel-state');

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-statefile-'));
const statePath = path.join(root, 'panel.json');

let tokenCounter = 0;
const fakeCrypto = {
  randomBytes: (n) => {
    tokenCounter += 1;
    return Buffer.alloc(n, tokenCounter);
  },
};

const fixedEnv = { USERPROFILE: 'C:/Users/tester' };
const panelState = createPanelState({
  statePath,
  fs,
  crypto: fakeCrypto,
  path,
  os,
  env: fixedEnv,
  writeFileAtomic: (file, content) => fs.writeFileSync(file, content, 'utf8'),
});

console.log('1) 默认世界目录');
check(
  '按 USERPROFILE 拼出 Terraria 世界目录',
  defaultWorldsDir(fixedEnv, os, path).replace(/\\/g, '/'),
  'C:/Users/tester/Documents/My Games/Terraria/Worlds'
);
check(
  '没有 USERPROFILE 时退回 home',
  defaultWorldsDir({}, { homedir: () => '/home/x' }, path).replace(/\\/g, '/'),
  '/home/x/Documents/My Games/Terraria/Worlds'
);
check('每次 defaults() 都是新对象', panelState.defaults() === panelState.defaults(), false);

console.log('2) 文件缺失 → 默认值 + 生成令牌');
const fresh = panelState.load();
check('端口与开关默认', [fresh.panelPort, fresh.restPort, fresh.backupOnStart, fresh.autoRestart], [13087, 7878, true, false]);
check('launch 默认', fresh.launch, { world: '', port: 7777, maxPlayers: 8, password: '' });
check('生成了 18 字节令牌（36 位十六进制）', /^[0-9a-f]{36}$/.test(fresh.restToken), true);
check('两次加载生成不同令牌', panelState.load().restToken !== fresh.restToken, true);

console.log('3) 部分字段合并');
fs.writeFileSync(
  statePath,
  JSON.stringify({ restPort: 7900, launch: { maxPlayers: 16 }, worldsDir: 'D:/W' }),
  'utf8'
);
const merged = panelState.load();
check('已有字段覆盖默认', [merged.restPort, merged.worldsDir], [7900, 'D:/W']);
check('launch 深合并（其余字段保留）', merged.launch, { world: '', port: 7777, maxPlayers: 16, password: '' });
check('缺失的顶层字段补默认', [merged.panelPort, merged.backupOnStart], [13087, true]);
check('仍会补令牌', /^[0-9a-f]{36}$/.test(merged.restToken), true);

console.log('4) 已有令牌不覆盖');
fs.writeFileSync(statePath, JSON.stringify({ restToken: 'fixed-token' }), 'utf8');
check('保留原令牌', panelState.load().restToken, 'fixed-token');

console.log('5) 坏文件当没有文件');
fs.writeFileSync(statePath, '{broken', 'utf8');
const broken = panelState.load();
check('回退到默认值', [broken.panelPort, broken.restPort], [13087, 7878]);
check('坏文件也补令牌', /^[0-9a-f]{36}$/.test(broken.restToken), true);
fs.writeFileSync(statePath, '"a string"', 'utf8');
check('顶层不是对象也能回退', panelState.load().panelPort, 13087);

console.log('6) 保存格式与回读');
panelState.save({ ...panelState.defaults(), restToken: 'abc', launch: { world: 'D:/w.wld', port: 7777, maxPlayers: 4, password: '' } });
const raw = fs.readFileSync(statePath, 'utf8');
check('2 空格缩进', raw.split('\n')[1], '  "panelPort": 13087,');
check('末尾有换行', raw.endsWith('\n'), true);
check('读回 launch', JSON.parse(raw).launch.world, 'D:/w.wld');

fs.rmSync(root, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
