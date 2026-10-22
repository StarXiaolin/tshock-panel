'use strict';

/**
 * routers/worlds.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * 世界存档涉及“删文件”和“记住选择”，所以锁住：
 *   1. 5 条路由的 method + 路径与拆分前逐字一致；
 *   2. GET 返回 worlds / dirs / worldsDir / selected 四个字段；
 *   3. 选择世界会真的写回“选中项”并持久化（调用 saveState）；
 *   4. 导入只接受 .wld，且空文件被拒绝；
 *   5. 删除把 path 原样传给服务层。
 *
 * 用法：node tools/routers-worlds.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWorldRoutes } = require('../TShockPanel/routers/worlds');

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
const calls = [];
const reply = { last: null };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-world-routes-'));
const worldsDir = path.join(root, 'Worlds');
fs.mkdirSync(worldsDir, { recursive: true });

let selected = 'D:/Worlds/old.wld';
let saved = 0;

createWorldRoutes({
  route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  readBody: async () => Buffer.alloc(0),
  readJsonBody: async (req) => req.body || {},
  fs,
  fsp: fs.promises,
  path,
  worlds: {
    list: async () => [{ path: 'a.wld', name: 'A' }],
    worldDirs: () => [worldsDir],
    create: async (body) => {
      calls.push(['create', body]);
      return { ok: true, path: 'new.wld' };
    },
    remove: async (p) => {
      calls.push(['remove', p]);
      return { ok: true };
    },
  },
  getWorldsDir: () => worldsDir,
  getSelectedWorld: () => selected,
  selectWorld: (resolved) => {
    selected = resolved;
    saved += 1;
    return selected;
  },
  sanitizeFileName: (n) => String(n).replace(/[\\/:*?"<>|]/g, ' ').trim() || '新世界',
  readWorldInfo: () => ({ name: 'Imported' }),
});

(async () => {
  console.log('1) 路由注册');
  check('注册 5 条', routes.length, 5);
  check(
    'method + 路径与拆分前一致',
    routes.map((r) => `${r.method} ${r.pattern.source}`),
    [
      'GET ^\\/api\\/worlds$',
      'POST ^\\/api\\/worlds\\/create$',
      'POST ^\\/api\\/worlds\\/upload$',
      'POST ^\\/api\\/worlds\\/delete$',
      'POST ^\\/api\\/worlds\\/select$',
    ]
  );

  console.log('2) GET /api/worlds');
  await routes[0].handler({}, {});
  check('四个字段齐全', Object.keys(reply.last.payload).sort(), ['dirs', 'selected', 'worlds', 'worldsDir']);
  check('worldsDir 来自 getter', reply.last.payload.worldsDir, worldsDir);

  console.log('3) 新建与删除透传');
  await routes[1].handler({ body: { name: '测试', size: 2 } }, {});
  check('create 收到 body', calls.at(-1), ['create', { name: '测试', size: 2 }]);
  await routes[3].handler({ body: { path: 'D:/Worlds/x.wld' } }, {});
  check('delete 收到 path', calls.at(-1), ['remove', 'D:/Worlds/x.wld']);

  console.log('4) 选择世界会持久化');
  const before = saved;
  await routes[4].handler({ body: { path: 'D:/Worlds/new.wld' } }, {});
  check('写入了选中项', selected.toLowerCase(), path.resolve('D:/Worlds/new.wld').toLowerCase());
  check('触发了一次 saveState', saved, before + 1);
  await checkThrows('缺 path 时报错', () => routes[4].handler({ body: {} }, {}), '缺少世界路径');

  console.log('5) 导入校验');
  await checkThrows(
    '非 .wld 被拒绝',
    () => routes[2].handler({}, {}, new URL('http://x/api/worlds/upload?name=abc.txt')),
    '只支持 .wld 世界存档'
  );
  await checkThrows(
    '空文件被拒绝',
    () => routes[2].handler({}, {}, new URL('http://x/api/worlds/upload?name=abc.wld')),
    '文件内容为空或不完整。'
  );

  fs.rmSync(root, { recursive: true, force: true });

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
