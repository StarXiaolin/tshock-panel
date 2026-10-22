'use strict';

/**
 * lib/state-view.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * `/api/state` 是前端的唯一真相来源，字段少了/改名了前端会静默白屏，
 * 所以这里逐字段锁住：
 *   1. 服务器没跑时 live=null、players=[]、rest.ok=false；
 *   2. 跑起来后 status/players 两次 REST 调用与它们的失败兜底；
 *   3. setup-code.txt 读不到时给空串（不是报错）；
 *   4. uptime 按 proc.startedAt 与注入的 now() 计算；
 *   5. 路径、launch、config、开关字段齐全，且 config 缺字段时有默认值。
 *
 * 用法：node tools/state-view.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createStateView } = require('../TShockPanel/lib/state-view');

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-state-'));
const tshockDir = path.join(root, 'tshock');
fs.mkdirSync(tshockDir, { recursive: true });
const configPath = path.join(tshockDir, 'config.json');
fs.writeFileSync(
  configPath,
  JSON.stringify({ Settings: { MaxSlots: 12, ServerPort: 7788, ServerPassword: 'pw' } })
);

const statics = {
  version: '1.0.0',
  proc: {
    ready: false,
    adopted: false,
    mode: null,
    pid: 0,
    startedAt: 0,
    worldPath: '',
    worldName: '',
    port: 0,
    maxPlayers: 0,
    lastError: '',
  },
  isRunning: async () => false,
  restCall: async () => {
    throw new Error('不应该在未运行时调用 REST');
  },
  readJsonFile: (file, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return fallback;
    }
  },
  configPath,
  fsp: fs.promises,
  path,
  tshockDir,
  serverDir: path.join(root, 'server'),
  panelDir: path.join(root, 'panel'),
  backupDir: path.join(root, 'panel', 'backups'),
  getPanelState: () => ({
    restPort: 7878,
    worldsDir: 'D:/Worlds',
    launch: { world: 'D:/Worlds/a.wld', port: 7777, maxPlayers: 8, password: '' },
    backupOnStart: true,
    autoRestart: false,
  }),
  now: () => 1000000,
};

(async () => {
  console.log('1) 未运行时的形状');
  const view = createStateView(statics);
  const off = await view.build();
  check('版本与时间', [off.version, off.now], ['1.0.0', 1000000]);
  check('未运行标记', [off.server.running, off.server.ready, off.server.pid], [false, false, null]);
  check('live/players 为空', [off.live, off.players], [null, []]);
  check('REST 状态为未就绪', off.rest, { port: 7878, ok: false });
  check('世界路径回退到已选世界', off.server.worldPath, 'D:/Worlds/a.wld');
  check('端口与人数回退到 launch', [off.server.port, off.server.maxPlayers], [7777, 8]);
  check('setup-code 读不到给空串', off.setupCode, '');
  check('路径字段齐全', Object.keys(off.paths).sort(), ['backupsDir', 'logsDir', 'panelDir', 'serverDir', 'tshockDir', 'worldsDir']);
  check('日志目录在 tshock 下', off.paths.logsDir, path.join(tshockDir, 'logs'));
  check('launch 原样透传', off.launch.world, 'D:/Worlds/a.wld');
  check('config 读取', off.config, { maxSlots: 12, serverPort: 7788, hasPassword: true });
  check('开关字段', [off.backupOnStart, off.autoRestart], [true, false]);
  check(
    '顶层字段齐全',
    Object.keys(off).sort(),
    ['version', 'now', 'server', 'live', 'players', 'setupCode', 'paths', 'launch', 'config', 'rest', 'backupOnStart', 'autoRestart'].sort()
  );

  console.log('2) 运行中：REST 两次调用');
  fs.writeFileSync(path.join(tshockDir, 'setup-code.txt'), '  ABC123  \n');
  const calls = [];
  const running = createStateView({
    ...statics,
    proc: { ...statics.proc, ready: true, mode: 'run', pid: 4242, startedAt: 900000, worldName: '开荒', port: 7788, maxPlayers: 12 },
    isRunning: async () => true,
    restCall: async (p) => {
      calls.push(p);
      if (p === '/v2/server/status') return { port: 7788, world: '开荒' };
      if (p === '/v2/players/list') return { players: [{ nickname: 'Alice' }] };
      throw new Error('未预期：' + p);
    },
  });
  const on = await running.build();
  check('调用了两个接口', calls, ['/v2/server/status', '/v2/players/list']);
  check('live 原样返回', on.live.port, 7788);
  check('players 取数组', on.players, [{ nickname: 'Alice' }]);
  check('REST 就绪', on.rest.ok, true);
  check('setup-code 去空白', on.setupCode, 'ABC123');
  check('uptime 按注入时钟计算', on.server.uptimeMs, 1000000 - 900000);
  check('运行字段', [on.server.running, on.server.ready, on.server.pid, on.server.mode], [true, true, 4242, 'run']);
  check('用 proc 的端口而不是 launch 的', on.server.port, 7788);

  console.log('3) REST 失败时兜底');
  const broken = createStateView({
    ...statics,
    isRunning: async () => true,
    restCall: async () => {
      throw new Error('REST 挂了');
    },
  });
  const bad = await broken.build();
  check('status 失败给 null', bad.live, null);
  check('players 失败给空数组', bad.players, []);
  check('rest.ok 跟着变 false', bad.rest.ok, false);

  console.log('4) config 缺字段时的默认值');
  fs.writeFileSync(configPath, JSON.stringify({ Settings: {} }));
  const empty = await view.build();
  check('默认人数 8 / 端口 7777', [empty.config.maxSlots, empty.config.serverPort], [8, 7777]);
  check('没设密码', empty.config.hasPassword, false);

  fs.rmSync(root, { recursive: true, force: true });

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
