'use strict';

/**
 * routers/server-control.js 的单元测试（零依赖，不启动 HTTP 服务，不真的拉起服务器）。
 *
 * 这 10 条路由直接控制“正在跑的服务器”，是面板里风险最高的一组：
 *   1. 路由的 method + 路径与拆分前逐字一致（前端 url 写死的是这些）；
 *   2. SSE 的心跳定时器在连接关闭时必须清掉（否则进程退不出去）；
 *   3. 启动/重启会写回 panel.json（选中世界、端口、人数），必须真的保存；
 *   4. 退出面板先回 200 再关停服务器，最后才 process.exit。
 *
 * 进程启停本身用假函数替代，这里只验证“调用顺序与参数”。
 *
 * 用法：node tools/routers-server-control.test.js
 */

const path = require('path');

const { createServerControlRoutes } = require('../TShockPanel/routers/server-control');

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

const routes = [];
const reply = { last: null };
const calls = [];
const logs = [];
const sseClients = new Set();
const logBuffer = {
  items: [
    { id: 1, text: 'a' },
    { id: 2, text: 'b' },
    { id: 3, text: 'c' },
    { id: 4, text: 'd' },
  ],
  nextId: 5,
};
const panelState = {
  worldsDir: 'D:/Worlds',
  restPort: 7878,
  backupOnStart: true,
  autoRestart: false,
  launch: { world: 'D:/Worlds/old.wld', port: 7777, maxPlayers: 8, password: 'pw' },
};
let running = true;
let exitCalled = 0;
let pendingExit = null;
const intervals = [];
const cleared = [];

const ctx = {
  route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  readJsonBody: async (req) => req.body || {},
  getState: async () => ({ server: { running }, version: '1.0.0' }),
  requireRunning: () => {
    if (!running) throw new Error('服务器没有运行。');
  },
  restCommand: async (command) => {
    calls.push(['restCommand', command]);
    return ['输出1', '输出2'];
  },
  addLog: (channel, text) => logs.push([channel, text]),
  logBuffer,
  sseClients,
  startServer: (params) => {
    calls.push(['startServer', params]);
    return { ok: true, pid: 1234 };
  },
  stopServer: async (options) => {
    calls.push(['stopServer', options]);
    return { ok: true };
  },
  panelState,
  saveState: () => calls.push(['saveState']),
  spawn: (cmd, args) => {
    calls.push(['spawn', cmd, args]);
    return { unref: () => calls.push(['unref']) };
  },
  fs: { existsSync: (dir) => dir === 'D:/Worlds' },
  path,
  ensureDir: (dir) => calls.push(['ensureDir', dir]),
  dirs: {
    server: 'D:/Srv',
    tshock: 'D:/Srv/tshock',
    backups: 'D:/Srv/panel/backups',
    panel: 'D:/Srv/panel',
    logs: 'D:/Srv/tshock/logs',
    plugins: 'D:/Srv/ServerPlugins',
  },
  setInterval: (fn, ms) => {
    const id = intervals.length + 1;
    intervals.push({ id, fn, ms });
    return id;
  },
  clearInterval: (id) => cleared.push(id),
  exit: () => {
    exitCalled += 1;
  },
  scheduleExit: (fn) => {
    pendingExit = fn;
  },
};

createServerControlRoutes(ctx);

(async () => {
  console.log('1) 路由注册');
  check('注册 10 条', routes.length, 10);
  check(
    'method + 路径与拆分前一致',
    routes.map((r) => `${r.method} ${r.pattern.source}`),
    [
      'GET ^\\/api\\/state$',
      'GET ^\\/api\\/events$',
      'GET ^\\/api\\/logs$',
      'POST ^\\/api\\/server\\/start$',
      'POST ^\\/api\\/server\\/stop$',
      'POST ^\\/api\\/server\\/restart$',
      'POST ^\\/api\\/console$',
      'POST ^\\/api\\/open$',
      'POST ^\\/api\\/settings\\/panel$',
      'POST ^\\/api\\/shutdown$'
    ]
  );

  console.log('2) GET /api/state');
  await routes[0].handler({}, {});
  check('透传 getState 结果', reply.last.payload.version, '1.0.0');

  console.log('3) GET /api/events（SSE）');
  let closeHandler = null;
  const fakeRes = {
    headers: null,
    body: '',
    writeHead(code, headers) {
      this.headers = { code, headers };
    },
    write(chunk) {
      this.body += chunk;
    },
  };
  const fakeReq = { on: (event, fn) => { if (event === 'close') closeHandler = fn; } };
  routes[1].handler(fakeReq, fakeRes);
  check('回 200 + SSE 头', [fakeRes.headers.code, fakeRes.headers.headers['Content-Type']], [200, 'text/event-stream; charset=utf-8']);
  check('先发 retry', fakeRes.body, 'retry: 3000\n\n');
  check('加入了 SSE 客户端集合', sseClients.has(fakeRes), true);
  check('心跳 15 秒', intervals.at(-1).ms, 15000);
  intervals.at(-1).fn();
  check('心跳会写注释行保活', fakeRes.body.endsWith(': ping\n\n'), true);
  closeHandler();
  check('连接关闭后移出集合', sseClients.has(fakeRes), false);
  check('连接关闭后清掉定时器', cleared, [intervals.at(-1).id]);

  console.log('4) GET /api/logs');
  await routes[2].handler({}, {}, new URL('http://x/api/logs?since=2'));
  check('只返回 since 之后的', reply.last.payload.items.map((i) => i.id), [3, 4]);
  check('带上 nextId', reply.last.payload.nextId, 5);
  await routes[2].handler({}, {}, new URL('http://x/api/logs?since=0&limit=2'));
  check('limit 生效', reply.last.payload.items.map((i) => i.id), [3, 4]);
  await routes[2].handler({}, {}, new URL('http://x/api/logs?since=0&limit=99999'));
  check('limit 上限 4000 不报错', reply.last.code, 200);

  console.log('5) 启动服务器');
  calls.length = 0;
  await routes[3].handler({ body: {} }, {});
  check('使用已选世界启动', calls[0], ['startServer', { mode: 'run', worldPath: 'D:/Worlds/old.wld' }]);
  check('启动后把世界写成绝对路径并保存', [panelState.launch.world, calls.some((c) => c[0] === 'saveState')], [path.resolve('D:/Worlds/old.wld'), true]);
  check('返回 startServer 的结果', reply.last.payload, { ok: true, pid: 1234 });
  panelState.launch.world = '';
  await checkThrows('没选世界时报错', () => routes[3].handler({ body: {} }, {}), '请先选择一个世界存档。');

  console.log('6) 停止与重启');
  calls.length = 0;
  await routes[4].handler({}, {});
  check('stop 调用 stopServer', calls[0], ['stopServer', undefined]);
  calls.length = 0;
  await routes[5].handler({ body: { port: 7788 } }, {});
  check('重启先停后启', [calls[0][0], calls[1][0]], ['stopServer', 'startServer']);
  check('端口按请求覆盖，其余沿用已选世界', calls[1][1], {
    mode: 'run',
    worldPath: '',
    port: 7788,
    maxPlayers: 8,
    password: 'pw',
  });

  console.log('7) 控制台');
  calls.length = 0;
  logs.length = 0;
  await routes[6].handler({ body: { command: 'say hi' } }, {});
  check('自动补前导斜杠', calls[0], ['restCommand', '/say hi']);
  check('输入与输出都进日志', logs, [['input', '/say hi'], ['output', '输出1'], ['output', '输出2']]);
  await checkThrows('空命令报错', () => routes[6].handler({ body: { command: '   ' } }, {}), '命令不能为空');
  running = false;
  await checkThrows('停服时统一报错', () => routes[6].handler({ body: { command: 'say hi' } }, {}), '服务器没有运行。');
  running = true;

  console.log('8) 打开目录');
  calls.length = 0;
  await routes[7].handler({ body: { target: 'plugins' } }, {});
  check('确保目录存在', calls[0], ['ensureDir', 'D:/Srv/ServerPlugins']);
  check('用资源管理器打开', calls[1], ['spawn', 'explorer.exe', ['D:/Srv/ServerPlugins']]);
  check('不await 子进程', calls[2], ['unref']);
  await checkThrows('未知目录', () => routes[7].handler({ body: { target: 'nope' } }, {}), '未知目录');

  console.log('9) 面板设置');
  calls.length = 0;
  await routes[8].handler({ body: { restPort: 7900, backupOnStart: false, launch: { maxPlayers: 16 } } }, {});
  check('更新端口与开关', [panelState.restPort, panelState.backupOnStart], [7900, false]);
  check('launch 合并而不是替换', panelState.launch.maxPlayers, 16);
  check('保存了面板状态', calls.includes('saveState') || calls.some((c) => c[0] === 'saveState'), true);
  await checkThrows('端口越界', () => routes[8].handler({ body: { restPort: 80 } }, {}), 'REST 端口范围不合法');
  await checkThrows('目录不存在', () => routes[8].handler({ body: { worldsDir: 'Z:/nope' } }, {}), '目录不存在：' + path.resolve('Z:/nope'));

  console.log('10) 退出面板');
  calls.length = 0;
  await routes[9].handler({ body: {} }, {});
  check('先回 200', reply.last.payload, { ok: true });
  check('不勾选时不停服务器', calls.length, 0);
  await routes[9].handler({ body: { stopServer: true } }, {});
  check('勾选时先停服务器', calls, [['stopServer', { silent: true }]]);
  check('退出延后执行', exitCalled, 0);
  pendingExit();
  check('延时后真的退出', exitCalled, 1);

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
