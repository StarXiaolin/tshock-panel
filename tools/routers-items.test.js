'use strict';

/**
 * routers/items.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * 物品发放会真的给玩家塞东西，出错影响面大，所以锁住：
 *   1. 两条路由的 method + 路径与拆分前一致；
 *   2. /give 命令字符串逐字一致（含引号，前缀为 0 时不带最后一段）；
 *   3. 校验顺序：物品参数先于“玩家是否在线”（顺序变了，前端提示语就变了）；
 *   4. 输出里出现中文错误关键字时 ok=false，但仍然是 200 + 原文。
 *
 * 用法：node tools/routers-items.test.js
 */

const { createItemRoutes } = require('../TShockPanel/routers/items');

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
const commands = [];
const logs = [];
let online = [{ nickname: 'Alice', name: 'Alice' }];
let commandOutput = ['已发放'];

const items = {
  load: () => [
    { id: 1, zh: '火把', en: 'Torch' },
    { id: 4956, zh: '外星法杖', en: 'Xenopopper' },
  ],
  validateGive({ netId, count, prefix }) {
    if (!Number.isInteger(netId) || netId === 0) throw new Error('物品 ID 不合法');
    const item = netId === 1 ? { id: 1, zh: '火把', en: 'Torch' } : null;
    if (netId > 0 && !item) throw new Error(`物品 ID ${netId} 不在物品库中`);
    if (!Number.isInteger(count) || count < 1 || count > 9999) throw new Error('数量需要是 1–9999 的整数');
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 255) throw new Error('前缀需要是 0–255 的整数（0 表示无前缀）');
    return { item };
  },
};

createItemRoutes({
  route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  readJsonBody: async (req) => req.body || {},
  requireRunning: () => {},
  restCommand: async (command) => {
    commands.push(command);
    return commandOutput;
  },
  addLog: (channel, text) => logs.push([channel, text]),
  items,
  players: {
    onlinePlayers: async () => online,
  },
});

(async () => {
  console.log('1) 路由注册');
  check('注册 2 条', routes.length, 2);
  check(
    'method + 路径与拆分前一致',
    routes.map((r) => `${r.method} ${r.pattern.source}`),
    ['GET ^\\/api\\/items$', 'POST ^\\/api\\/items\\/give$']
  );

  console.log('2) 物品库查询');
  await routes[0].handler({}, {});
  check('返回 items 与 count', [reply.last.payload.count, reply.last.payload.items.length], [2, 2]);

  console.log('3) 发放成功');
  commands.length = 0;
  logs.length = 0;
  await routes[1].handler({ body: { netId: 1, count: 3, prefix: 5, player: 'alice' } }, {});
  check('命令逐字一致', commands, ['/give 1 "Alice" 3 5']);
  check('返回 ok / item / player', [reply.last.payload.ok, reply.last.payload.item.zh, reply.last.payload.player], [true, '火把', 'Alice']);
  check('日志记录了中文名与数量', logs.at(-1), ['panel', '发放物品：火把 ×3 → Alice（前缀 5）']);

  console.log('4) 前缀为 0 时不带最后一段');
  commands.length = 0;
  await routes[1].handler({ body: { netId: 1, count: 1, player: 'Alice' } }, {});
  check('命令无前缀段', commands, ['/give 1 "Alice" 1']);
  check('日志无前缀后缀', logs.at(-1)[1], '发放物品：火把 ×1 → Alice');

  console.log('5) 校验顺序：物品先于玩家');
  await checkThrows(
    '物品非法优先报错',
    () => routes[1].handler({ body: { netId: 0, player: 'nobody' } }, {}),
    '物品 ID 不合法'
  );
  await checkThrows(
    '不在库中优先报错',
    () => routes[1].handler({ body: { netId: 999999, player: 'nobody' } }, {}),
    '物品 ID 999999 不在物品库中'
  );
  await checkThrows(
    '缺玩家在参数校验之后',
    () => routes[1].handler({ body: { netId: 1 } }, {}),
    '请先选择目标玩家'
  );
  await checkThrows(
    '数量越界',
    () => routes[1].handler({ body: { netId: 1, count: 10000, player: 'Alice' } }, {}),
    '数量需要是 1–9999 的整数'
  );
  await checkThrows(
    '前缀越界',
    () => routes[1].handler({ body: { netId: 1, prefix: 256, player: 'Alice' } }, {}),
    '前缀需要是 0–255 的整数（0 表示无前缀）'
  );

  console.log('6) 在线玩家校验');
  online = [];
  await checkThrows(
    '没人在线时的提示',
    () => routes[1].handler({ body: { netId: 1, player: 'Alice' } }, {}),
    '当前没有在线玩家，无法发放物品'
  );
  online = [{ nickname: 'Bob', name: 'Bob' }];
  await checkThrows(
    '指定玩家不在线',
    () => routes[1].handler({ body: { netId: 1, player: 'Alice' } }, {}),
    '玩家「Alice」当前不在线，无法发放物品'
  );

  console.log('7) 执行结果判定');
  online = [{ nickname: 'Alice', name: 'Alice' }];
  commandOutput = ['物品不存在'];
  await routes[1].handler({ body: { netId: 1, player: 'Alice' } }, {});
  check('输出含错误关键字时 ok=false', reply.last.payload.ok, false);
  check('仍返回原文输出', reply.last.payload.output, ['物品不存在']);
  commandOutput = ['已发放'];
  await routes[1].handler({ body: { netId: 1, player: 'Alice' } }, {});
  check('正常时 ok=true', reply.last.payload.ok, true);

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
