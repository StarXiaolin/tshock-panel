'use strict';

/**
 * routers/backups.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * 备份接口是“删错了就没了”的一类，所以锁住：
 *   1. 4 条路由的 method + 路径与拆分前逐字一致；
 *   2. 创建备份时，没传 worldPath 会回落到“面板选中的世界”；
 *   3. 还原/删除把 id 原样（字符串化）传给服务层；
 *   4. GET 返回 { backups, dir } 两个字段。
 *
 * 用法：node tools/routers-backups.test.js
 */

const { createBackupRoutes } = require('../TShockPanel/routers/backups');

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

const routes = [];
const calls = [];
const reply = { last: null };

const backups = {
  list: async () => [{ id: 'a' }, { id: 'b' }],
  create: async (opts) => {
    calls.push(['create', opts]);
    return { id: 'new', ...opts };
  },
  restore: async (id) => {
    calls.push(['restore', id]);
    return { ok: true, restored: [] };
  },
  remove: async (id) => {
    calls.push(['remove', id]);
    return { ok: true };
  },
};

createBackupRoutes({
  route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  readJsonBody: async (req) => req.body || {},
  backups,
  backupDir: 'D:/panel/backups',
  getLaunchWorld: () => 'D:/Worlds/selected.wld',
});

(async () => {
  console.log('1) 路由注册');
  check('注册 4 条', routes.length, 4);
  check(
    'method + 路径与拆分前一致',
    routes.map((r) => `${r.method} ${r.pattern.source}`),
    ['GET ^\\/api\\/backups$', 'POST ^\\/api\\/backups\\/create$', 'POST ^\\/api\\/backups\\/restore$', 'POST ^\\/api\\/backups\\/delete$']
  );

  console.log('2) GET /api/backups');
  await routes[0].handler({}, {});
  check('返回 backups 与 dir', Object.keys(reply.last.payload), ['backups', 'dir']);
  check('dir 原样返回', reply.last.payload.dir, 'D:/panel/backups');

  console.log('3) 创建：worldPath 回落');
  await routes[1].handler({ body: {} }, {});
  check('没传 worldPath 时用选中的世界', calls.at(-1)[1].worldPath, 'D:/Worlds/selected.wld');
  check('默认原因是手动备份', calls.at(-1)[1].reason, '手动备份');

  await routes[1].handler({ body: { worldPath: 'D:/Worlds/other.wld', reason: '自定义' } }, {});
  check('显式参数优先', [calls.at(-1)[1].worldPath, calls.at(-1)[1].reason], ['D:/Worlds/other.wld', '自定义']);

  console.log('4) 还原 / 删除：id 字符串化');
  await routes[2].handler({ body: { id: 123 } }, {});
  check('还原收到字符串 id', calls.at(-1), ['restore', '123']);
  await routes[3].handler({ body: {} }, {});
  check('缺 id 时传空串', calls.at(-1), ['remove', '']);

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
