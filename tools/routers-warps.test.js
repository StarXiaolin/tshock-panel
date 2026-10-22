'use strict';

/**
 * routers/warps.js 的单元测试（零依赖，不连真库）。
 *
 * 传送点是“点了就改数据库”的功能，所以锁住：
 *   1. 5 条路由的 method + 路径与拆分前逐字一致；
 *   2. 新建的入参校验顺序与文案（名称长度 → 非法字符 → 坐标整数 → 坐标范围 → 世界 ID）；
 *   3. 新建会先备份数据库再插入，且返回“需要重启”的提示；
 *   4. 列表在库打不开时把错误放进 error 字段而不是抛 500。
 *
 * 用法：node tools/routers-warps.test.js
 */

const { createWarpRoutes } = require('../TShockPanel/routers/warps');

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

function makeDb(rows = []) {
  return {
    prepare(sql) {
      return {
        all: () => rows,
        get: () => undefined,
        run: (a, b, c, d) => {
          calls.push(['run', sql, a, b, c, d]);
          return { changes: 1 };
        },
      };
    },
    close() {},
  };
}

let dbError = null;
const warpsDb = {
  getSqlite: () => ({}),
  openDb: () => {
    if (dbError) throw new Error(dbError);
    return makeDb([{ Id: 1, WarpName: 'spawn', X: 100, Y: 200, WorldID: 7, Private: 1 }]);
  },
  currentWorldId: () => '7',
  backupDatabase: (label) => calls.push(['backup', label]),
};

createWarpRoutes({
  route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  readJsonBody: async (req) => req.body || {},
  requireRunning: () => {},
  restCommand: async () => ['ok'],
  addLog: () => {},
  warpsDb,
  isLive: () => false,
});

(async () => {
  console.log('1) 路由注册');
  check('注册 5 条', routes.length, 5);
  check(
    'method + 路径与拆分前一致',
    routes.map((r) => `${r.method} ${r.pattern.source}`),
    [
      'GET ^\\/api\\/warps$',
      'POST ^\\/api\\/warps\\/add$',
      'POST ^\\/api\\/warps\\/hide$',
      'POST ^\\/api\\/warps\\/delete$',
      'POST ^\\/api\\/warps\\/send$',
    ]
  );

  console.log('2) 列表');
  await routes[0].handler({}, {});
  check('返回 5 个字段', Object.keys(reply.last.payload).sort(), ['error', 'running', 'sqlite', 'warps', 'worldId']);
  check('隐藏状态被转成布尔', reply.last.payload.warps[0].hidden, true);
  check('current 用世界 ID 比对', reply.last.payload.warps[0].current, true);

  dbError = '找不到 tshock.sqlite';
  await routes[0].handler({}, {});
  check('库打不开时 error 有内容而不抛错', reply.last.payload.error, '找不到 tshock.sqlite');
  dbError = null;

  console.log('3) 新建校验');
  const add = (body) => routes[1].handler({ body }, {});
  await checkThrows('名称为空', () => add({ name: '', x: 1, y: 2 }), '名称长度需要在 1–40 之间');
  await checkThrows('名称过长', () => add({ name: 'a'.repeat(41), x: 1, y: 2 }), '名称长度需要在 1–40 之间');
  await checkThrows('名称含空格', () => add({ name: 'a b', x: 1, y: 2 }), '名称不能包含空格、引号或反斜杠（TShock 用空格分隔参数）');
  await checkThrows('坐标非整数', () => add({ name: 'a', x: 1.5, y: 2 }), 'X / Y 需要是整数（图格坐标）');
  await checkThrows('坐标越界', () => add({ name: 'a', x: 30000, y: 2 }), '坐标超出合理范围（0–20000）');

  console.log('4) 新建成功路径');
  calls.length = 0;
  await add({ name: 'home', x: 10, y: 20 });
  check('先备份数据库', calls[0], ['backup', 'before-warp-add']);
  check('再插入一行', calls[1][0], 'run');
  check('返回需要重启', reply.last.payload.needsRestart, true);
  check('返回坐标', [reply.last.payload.x, reply.last.payload.y], [10, 20]);

  console.log('5) 隐藏 / 发送');
  await checkThrows('隐藏缺名', () => routes[2].handler({ body: {} }, {}), '缺少传送点名');
  await checkThrows('发送缺玩家', () => routes[4].handler({ body: { name: 'a' } }, {}), '请选择在线玩家');

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
