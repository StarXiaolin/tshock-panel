'use strict';

/**
 * lib/process.js 的单元测试（零依赖，不启动真的服务器）。
 *
 * 这是面板里唯一操作进程的模块，也是“面板退不出去 / 服务器崩了不自动起”的唯一来源。
 * 测试用假 spawn + 假定时器 + 假时钟，覆盖：
 *   1. 命令行参数（run 不带端口、create 带端口/种子/名称）与 uptime 解析；
 *   2. 启动前置校验的三种报错，以及“已在运行”的拒绝；
 *   3. 启动后 proc 状态、控制台日志文件、tail 定时器、SSE 广播；
 *   4. 进程退出的两条分支：未就绪 → 报错通知；已就绪 + autoRestart → 5 秒后重启；
 *   5. 停止：REST /exit 成功、REST 不可用时直接 kill、未运行时幂等返回；
 *   6. 接管已运行服务器：pid 文件、端口/人数、tail 启动。
 *
 * 用法：node tools/process.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createProcessManager, buildArgs, parseUptime, readPidFile, pidAlive } = require('../TShockPanel/lib/process');

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
async function checkThrows(name, fn, message) {
  try {
    await fn();
    check(name, 'no throw', message);
  } catch (err) {
    check(name, err.message, message);
  }
}

// ---------- 纯函数 ----------
console.log('1) buildArgs');
check('run 模式只带世界与 noupnp', buildArgs({ mode: 'run', worldPath: 'D:/w.wld' }), ['-world', 'D:/w.wld', '-noupnp']);
check(
  'run 模式带密码',
  buildArgs({ mode: 'run', worldPath: 'D:/w.wld', password: 'pw' }),
  ['-world', 'D:/w.wld', '-password', 'pw', '-noupnp']
);
check(
  'run 模式不传端口与人数（以 config.json 为准）',
  buildArgs({ mode: 'run', worldPath: 'D:/w.wld', port: 9999, maxPlayers: 99 }),
  ['-world', 'D:/w.wld', '-noupnp']
);
check(
  'create 模式带尺寸/名称/种子/端口/人数',
  buildArgs({ mode: 'create', worldPath: 'D:/n.wld', worldName: '新世界', seed: 123, port: 7778, maxPlayers: 4, size: 2 }),
  ['-autocreate', '2', '-worldname', '新世界', '-seed', '123', '-world', 'D:/n.wld', '-port', '7778', '-maxplayers', '4', '-noupnp']
);
check('create 模式尺寸默认 1', buildArgs({ mode: 'create', worldPath: 'x.wld', port: 7778, maxPlayers: 4 }), [
  '-autocreate',
  '1',
  '-world',
  'x.wld',
  '-port',
  '7778',
  '-maxplayers',
  '4',
  '-noupnp',
]);

console.log('2) parseUptime / readPidFile / pidAlive');
check('0.00:00:03 → 3 秒', parseUptime('0.00:00:03'), 3000);
check('1.02:03:04 → 天/时/分/秒换算', parseUptime('1.02:03:04'), ((1 * 24 + 2) * 60 + 3) * 60 * 1000 + 4 * 1000);
check('空值 → 0', parseUptime(''), 0);
check('垃圾值 → 0', parseUptime('not-a-uptime'), 0);
check('当前进程活着', pidAlive(process.pid), true);
check('pid 0 视为不存在', pidAlive(0), false);
check('不存在的 pid 视为死', pidAlive(2147483646), false);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-proc-'));
const tshockDir = path.join(root, 'tshock');
const panelDir = path.join(root, 'panel');
const serverDir = path.join(root, 'server');
fs.mkdirSync(tshockDir, { recursive: true });
fs.mkdirSync(path.join(panelDir, 'logs'), { recursive: true });
fs.mkdirSync(serverDir, { recursive: true });
const pidPath = path.join(tshockDir, 'tshock.pid');
fs.writeFileSync(pidPath, String(process.pid));
check('读 pid 文件', readPidFile(pidPath, fs), process.pid);
fs.writeFileSync(pidPath, 'not-a-pid');
check('pid 文件内容非法 → 0', readPidFile(pidPath, fs), 0);
check('pid 文件缺失 → 0', readPidFile(path.join(tshockDir, 'nope.pid'), fs), 0);

// ---------- 假环境 ----------
function makeTimers() {
  const intervals = [];
  const timeouts = [];
  const cleared = [];
  return {
    intervals,
    timeouts,
    cleared,
    setInterval: (fn, ms) => {
      const id = { fn, ms };
      intervals.push(id);
      return id;
    },
    clearInterval: (id) => cleared.push(id),
    setTimeout: (fn, ms) => {
      const id = { fn, ms };
      timeouts.push(id);
      return id;
    },
  };
}

function makeChild(pid) {
  const listeners = {};
  return {
    pid,
    exitCode: null,
    killed: false,
    on(event, fn) {
      listeners[event] = fn;
    },
    emit(event, ...args) {
      if (listeners[event]) listeners[event](...args);
    },
    kill() {
      this.killed = true;
    },
  };
}

const exePath = path.join(serverDir, 'TShock.Server.exe');
fs.writeFileSync(exePath, 'dummy');
const worldPath = path.join(root, 'world.wld');
fs.writeFileSync(worldPath, 'dummy world');
const configPath = path.join(tshockDir, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({ Settings: { ServerPort: 7777, MaxSlots: 8 } }));

const state = { launch: { world: worldPath, port: 7777, maxPlayers: 8, password: '' }, autoRestart: false, backupOnStart: false };
const logs = [];
const broadcasts = [];
const spawnCalls = [];
const backupCalls = [];
const worldCreated = [];
let restOnline = false;
let exitCommandCalls = 0;
let clock = 0;
let timers = makeTimers();

function makeManager(extra = {}) {
  return createProcessManager({
    exePath,
    serverDir,
    panelDir,
    tshockDir,
    configPath,
    fs,
    fsp: fs.promises,
    path,
    spawn: (exe, args, opts) => {
      spawnCalls.push({ exe, args, opts });
      return makeChild(4000 + spawnCalls.length);
    },
    addLog: (channel, text) => logs.push([channel, text]),
    broadcast: (event, payload) => broadcasts.push([event, payload]),
    makeLineReader: (onLine) => {
      const reader = (buf) => String(buf).split(/\r?\n/).filter(Boolean).forEach(onLine);
      return reader;
    },
    decodeLine: (buf) => String(buf),
    ANSI_RE: /\[[0-9;]*m/g,
    restOk: async () => restOnline,
    restCall: async () => ({ port: 7777, maxplayers: 8, world: '测试世界', uptime: '0.00:00:10' }),
    restCommand: async (cmd) => {
      if (cmd === '/exit') exitCommandCalls += 1;
      return ['ok'];
    },
    readJsonFile: (file, fallback) => {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        return fallback;
      }
    },
    ensureRestConfig: () => {},
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    timestamp: () => '2026-10-21_180000',
    backupBeforeStart: (p) => backupCalls.push(p),
    getLaunch: () => state.launch,
    isAutoRestart: () => state.autoRestart,
    isBackupOnStart: () => state.backupOnStart,
    onWorldCreated: (p) => worldCreated.push(p),
    now: () => {
      clock += 1000;
      return clock;
    },
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    setTimeout: timers.setTimeout,
    sleep: async () => {},
    ...extra,
  });
}

(async () => {
  console.log('3) 启动前置校验');
  const m = makeManager();
  await checkThrows('没给世界路径', () => m.startServer({}), '请先选择要启动的世界存档。');
  await checkThrows(
    'run 模式世界文件不存在',
    () => m.startServer({ worldPath: path.join(root, 'nope.wld') }),
    `世界存档不存在：${path.resolve(root, 'nope.wld')}`
  );
  const noExe = makeManager({ exePath: path.join(root, 'missing.exe') });
  await checkThrows(
    '找不到服务器程序',
    () => noExe.startServer({ worldPath }),
    `找不到服务器程序：${path.join(root, 'missing.exe')}`
  );

  console.log('4) 启动 run 模式');
  logs.length = 0;
  broadcasts.length = 0;
  spawnCalls.length = 0;
  state.backupOnStart = true;
  const started = m.startServer({ worldPath });
  check('返回 pid', started, { ok: true, pid: 4001 });
  check('spawn 参数', spawnCalls[0].args, ['-world', path.resolve(worldPath), '-noupnp']);
  check('spawn 工作目录是服务器目录', spawnCalls[0].opts.cwd, serverDir);
  check('stdio 指向日志文件描述符', [spawnCalls[0].opts.stdio[0], typeof spawnCalls[0].opts.stdio[1]], ['ignore', 'number']);
  check('proc 字段写对', [m.proc.pid, m.proc.mode, m.proc.ready, m.proc.worldName], [4001, 'run', false, 'world']);
  check('端口与人数来自 config.json', [m.proc.port, m.proc.maxPlayers], [7777, 8]);
  check('请求了启动前备份', backupCalls.length, 1);
  check('生成了控制台日志文件', fs.readdirSync(path.join(panelDir, 'logs')).some((f) => f === 'server-2026-10-21_180000.log'), true);
  check('启动了控制台 tail 定时器（250ms）', timers.intervals.some((t) => t.ms === 250), true);
  check('启动了就绪轮询（400ms，最后一个）', timers.intervals.at(-1).ms, 400);
  check('广播了 state', broadcasts.at(-1)[0], 'state');
  check('日志记录了启动', logs.some(([c, t]) => c === 'panel' && t.startsWith('启动服务器：')), true);
  await checkThrows('重复启动被拒绝', () => m.startServer({ worldPath }), '服务器已经在运行，请先停止。');

  console.log('5) 未就绪就退出 → 报错通知');
  const child = m.proc.child;
  child.exitCode = 1;
  broadcasts.length = 0;
  logs.length = 0;
  child.emit('exit', 1, null);
  check('proc 清空', [m.proc.child, m.proc.pid, m.proc.mode], [null, 0, null]);
  check('记录退出码', logs.some(([c, t]) => c === 'panel' && /服务器进程已退出（代码 1）/.test(t)), true);
  check('广播 error 通知', broadcasts.some(([e, p]) => e === 'notice' && p.level === 'error' && /服务器启动失败（退出码 1）/.test(p.text)), true);
  check('未就绪退出不会自动重启', timers.timeouts.some((t) => t.ms === 5000), false);

  console.log('6) 就绪后退出 + autoRestart → 5 秒后重启');
  state.autoRestart = true;
  const started2 = m.startServer({ worldPath });
  const child2 = m.proc.child;
  m.proc.ready = true;
  timers.timeouts.length = 0;
  child2.exitCode = 0;
  child2.emit('exit', 0, null);
  const restartTimer = timers.timeouts.find((t) => t.ms === 5000);
  check('排了一个 5 秒的重启定时器', !!restartTimer, true);
  check('日志说明自动重启', logs.some(([c, t]) => c === 'panel' && /自动重启：5 秒后/.test(t)), true);
  const spawnBefore = spawnCalls.length;
  restartTimer.fn();
  check('定时器触发后真的又拉起一次', spawnCalls.length, spawnBefore + 1);
  check('重启沿用上次的世界', spawnCalls.at(-1).args, ['-world', path.resolve(worldPath), '-noupnp']);
  state.autoRestart = false;

  console.log('7) 停止服务器');
  const stopMgr = makeManager();
  check('没在跑时幂等返回', await stopMgr.stopServer(), { ok: true, already: true });

  exitCommandCalls = 0;
  timers = makeTimers();
  const m3 = makeManager({
    restOk: async () => true,
    restCommand: async (cmd) => {
      if (cmd === '/exit') {
        exitCommandCalls += 1;
        m3.proc.child.exitCode = 0; // 模拟服务器响应 /exit 后自行退出
      }
      return ['ok'];
    },
  });
  m3.startServer({ worldPath });
  const result = await m3.stopServer();
  check('REST /exit 被调用', exitCommandCalls, 1);
  check('停止返回 ok', result, { ok: true });
  check('停止后 proc.ready 归零', m3.proc.ready, false);

  console.log('8) REST 不可用时直接 kill');
  timers = makeTimers();
  let killed = false;
  const m4 = makeManager({
    restOk: async () => false,
    spawn: (exe, args, opts) => {
      const c = makeChild(9001);
      const realKill = c.kill.bind(c);
      c.kill = () => {
        killed = true;
        c.killed = true;
        realKill();
      };
      return c;
    },
  });
  m4.startServer({ worldPath });
  const stopResult = await m4.stopServer();
  check('kill 被调用', killed, true);
  check('停止仍返回 ok', stopResult, { ok: true });
  check('日志提示 REST 不可用', logs.some(([c, t]) => c === 'panel' && /REST 接口暂不可用/.test(t)), true);

  console.log('9) 接管已运行服务器');
  timers = makeTimers();
  restOnline = true;
  fs.writeFileSync(pidPath, String(process.pid));
  const m5 = makeManager({ restOk: async () => true });
  await m5.adoptRunningServer();
  check('标记为接管', m5.proc.adopted, true);
  check('按 pid 文件取 pid', m5.proc.pid, process.pid);
  check('端口取 REST 状态', m5.proc.port, 7777);
  check('世界名取 REST 状态', m5.proc.worldName, '测试世界');
  check('启动时间按 uptime 倒推', m5.proc.startedAt > 0, true);
  check('日志说明已连接', logs.some(([c, t]) => c === 'panel' && /已连接正在运行的服务器/.test(t)), true);
  check('启动了外部日志 tail（1500ms）或控制台 tail', timers.intervals.some((t) => t.ms === 1500 || t.ms === 250), true);

  fs.rmSync(root, { recursive: true, force: true });

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
