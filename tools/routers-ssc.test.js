'use strict';

/**
 * lib/ssc-inventory.js + routers/ssc.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * SSC 初始物品是批量写入 sscconfig.json 的唯一入口，写坏等于所有新角色进来
 * 背包异常。所以锁住：
 *   1. 逐行报错文案带行号（用户要能定位到第几行）；
 *   2. netID=0 允许（空槽）、负数不校验在库中（起始装备）；
 *   3. 写盘前一定先备份，写完提示需要重启；
 *   4. 未知字段不会被写进配置（只替换 StartingInventory）。
 *
 * 用法：node tools/routers-ssc.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { normalizeInventory, viewOf, MAX_ITEMS } = require('../TShockPanel/lib/ssc-inventory');
const { createSscRoutes } = require('../TShockPanel/routers/ssc');

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-ssc-'));
const sscPath = path.join(root, 'sscconfig.json');
fs.writeFileSync(
  sscPath,
  JSON.stringify({ Settings: { Enabled: true, StartingInventory: [{ netID: 1, prefix: 0, stack: 1 }], Extra: 'keep' } }),
  'utf8'
);

const known = new Set([1, 4956]);
const findItem = (id) => (known.has(Number(id)) ? { id: Number(id) } : null);

const routes = [];
const reply = { last: null };
const backups = [];
const logs = [];

createSscRoutes({
  route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  readJsonBody: async (req) => req.body || {},
  readJsonFile: (file, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return fallback;
    }
  },
  writeFileAtomic: (file, content) => fs.writeFileSync(file, content, 'utf8'),
  backupConfigFile: (file, label) => backups.push([file, label]),
  addLog: (channel, text) => logs.push([channel, text]),
  sscPath,
  findItem,
});

(async () => {
  console.log('1) 逐行校验');
  check('空数组合法', normalizeInventory([], findItem), []);
  check('默认 prefix/stack 补 0 与 1', normalizeInventory([{ netID: 1 }], findItem), [{ netID: 1, prefix: 0, stack: 1 }]);
  check('netID=0 允许（空槽）', normalizeInventory([{ netID: 0 }], findItem), [{ netID: 0, prefix: 0, stack: 1 }]);
  check('负 netID 不校验在库中', normalizeInventory([{ netID: -15 }], findItem), [{ netID: -15, prefix: 0, stack: 1 }]);
  check('字符串数字被转成数字', normalizeInventory([{ netID: '1', prefix: '5', stack: '3' }], findItem), [{ netID: 1, prefix: 5, stack: 3 }]);

  await checkThrows('不是数组', () => normalizeInventory('x', findItem), 'inventory 需要是数组');
  await checkThrows(
    `超过 ${MAX_ITEMS} 项`,
    () => normalizeInventory(new Array(MAX_ITEMS + 1).fill({ netID: 1 }), findItem),
    `初始物品最多 ${MAX_ITEMS} 项`
  );
  await checkThrows(
    '第 2 行 netID 非整数',
    () => normalizeInventory([{ netID: 1 }, { netID: 'abc' }], findItem),
    '第 2 行：netID 需要是整数'
  );
  await checkThrows(
    '第 1 行物品不存在',
    () => normalizeInventory([{ netID: 999999 }], findItem),
    '第 1 行：物品 ID 999999 不存在'
  );
  await checkThrows(
    '第 3 行 prefix 越界',
    () => normalizeInventory([{ netID: 1 }, { netID: 1 }, { netID: 1, prefix: 256 }], findItem),
    '第 3 行：prefix 需要是 0–255 的整数'
  );
  await checkThrows(
    '第 1 行 stack 越界',
    () => normalizeInventory([{ netID: 1, stack: 0 }], findItem),
    '第 1 行：stack 需要是 1–9999 的整数'
  );

  console.log('2) 视图');
  check('三个字段', Object.keys(viewOf({ Settings: { Enabled: true } }, sscPath)).sort(), ['enabled', 'inventory', 'path']);
  check('空配置给空数组', viewOf({}, sscPath).inventory, []);
  check('enabled 转布尔', viewOf({ Settings: { Enabled: 1 } }, sscPath).enabled, true);
  checkThrows('配置读不到时报错', () => viewOf(null, sscPath), '读取 sscconfig.json 失败');

  console.log('3) 路由');
  check('注册 2 条', routes.length, 2);
  check(
    'method + 路径与拆分前一致',
    routes.map((r) => `${r.method} ${r.pattern.source}`),
    ['GET ^\\/api\\/ssc\\/inventory$', 'POST ^\\/api\\/ssc\\/inventory$']
  );

  await routes[0].handler({}, {});
  check('GET 返回当前内容', reply.last.payload.inventory, [{ netID: 1, prefix: 0, stack: 1 }]);
  check('GET 带上路径', reply.last.payload.path, sscPath);

  backups.length = 0;
  logs.length = 0;
  await routes[1].handler({ body: { inventory: [{ netID: 4956, prefix: 0, stack: 2 }] } }, {});
  check('POST 返回需要重启与新列表', [reply.last.payload.ok, reply.last.payload.restartRequired, reply.last.payload.inventory], [true, true, [{ netID: 4956, prefix: 0, stack: 2 }]]);
  check('写盘前先备份', backups, [[sscPath, 'sscconfig.json']]);
  check('只替换 StartingInventory，其他字段保留', JSON.parse(fs.readFileSync(sscPath, 'utf8')).Settings.Extra, 'keep');
  check('日志记录了项数', logs.at(-1), ['panel', '已更新 SSC 初始物品（1 项）']);

  await checkThrows(
    'POST 也做逐行校验',
    () => routes[1].handler({ body: { inventory: [{ netID: 999999 }] } }, {}),
    '第 1 行：物品 ID 999999 不存在'
  );

  fs.rmSync(root, { recursive: true, force: true });

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
