'use strict';

/**
 * lib/groups.js + routers/groups.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * 用户组这段代码会向 TShock 下发 /group 命令，出错的影响面比“读接口”大，
 * 所以这里把命令字符串逐字锁住：
 *   1. 加/删权限、改父组、建组、删组下发的命令与拆分前完全一致（含引号与空格）；
 *   2. 权限串与组名的白名单校验仍然生效（这是挡命令注入的那道门）；
 *   3. 单组读取失败只标记该组，不影响整页；
 *   4. 6 条路由的 method + 路径与拆分前一致，返回字段不变。
 *
 * 用法：node tools/groups.test.js
 */

const { createGroupService, PERMISSION_RE } = require('../TShockPanel/lib/groups');
const { createGroupRoutes } = require('../TShockPanel/routers/groups');

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

// ---- 假的 REST 层：记录调用，按路径返回固定数据 ----
const calls = [];
const logs = [];
const groupDetail = {
  guest: { parent: 'default', chatcolor: '255,255,255', permissions: ['tshock.canchat', ''] },
  default: { parent: '', chatcolor: '255,0,0', permissions: [] },
};

const service = createGroupService({
  restCall: async (path) => {
    calls.push(['restCall', path]);
    if (path === '/v2/groups/list') return { groups: [{ name: 'guest' }, { name: 'default' }, { name: 'broken' }] };
    const m = /^\/v2\/groups\/read\?group=(.+)$/.exec(path);
    if (m) {
      const name = decodeURIComponent(m[1]);
      if (!groupDetail[name]) throw new Error('组不存在');
      return groupDetail[name];
    }
    throw new Error(`未预期的 REST 调用：${path}`);
  },
  restCommand: async (command) => {
    calls.push(['restCommand', command]);
    return ['ok'];
  },
  addLog: (channel, text) => logs.push([channel, text]),
});

// ---- 路由层 ----
const routes = [];
const reply = { last: null };
let running = true;

createGroupRoutes({
  route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  readJsonBody: async (req) => req.body || {},
  requireRunning: () => {
    if (!running) throw new Error('服务器没有运行。');
  },
  groups: service,
  catalog: [{ key: 'tshock.canchat', label: '聊天' }],
});

(async () => {
  console.log('1) 路由注册');
  check('注册 6 条', routes.length, 6);
  check(
    'method + 路径与拆分前一致',
    routes.map((r) => `${r.method} ${r.pattern.source}`),
    [
      'GET ^\\/api\\/groups$',
      'POST ^\\/api\\/groups\\/perm$',
      'POST ^\\/api\\/groups\\/parent$',
      'POST ^\\/api\\/groups\\/create$',
      'POST ^\\/api\\/groups\\/delete$',
      'GET ^\\/api\\/group-names$'
    ]
  );

  console.log('2) 组详情');
  const detailed = await service.listDetailed();
  check('三个组都返回', detailed.map((g) => g.name), ['guest', 'default', 'broken']);
  check('空权限被过滤', detailed[0].permissions, ['tshock.canchat']);
  check('父组与颜色', [detailed[0].parent, detailed[0].chatcolor], ['default', '255,255,255']);
  check('单个组失败只标记自己', detailed[2], { name: 'broken', parent: '', chatcolor: '', permissions: [], error: '组不存在' });

  console.log('3) 权限增删');
  calls.length = 0;
  await service.changePermission({ group: 'guest', permission: 'tshock.canchat', action: 'add' });
  check('addperm 命令逐字一致', calls, [['restCommand', '/group addperm "guest" "tshock.canchat"']]);
  check('写入了面板日志', logs.at(-1), ['panel', '用户组 guest 添加权限：tshock.canchat']);
  await service.changePermission({ group: 'guest', permission: 'tshock.canchat', action: 'remove' });
  check('delperm 命令逐字一致', calls.at(-1), ['restCommand', '/group delperm "guest" "tshock.canchat"']);
  await checkThrows('缺组名', () => service.changePermission({ group: '', permission: 'x' }), '缺少组名');
  await checkThrows(
    '权限串含空格被拒绝（防注入）',
    () => service.changePermission({ group: 'guest', permission: 'a b; exit' }),
    '权限字符串只能包含字母、数字以及 . _ * ! -'
  );
  check('白名单正则接受通配', PERMISSION_RE.test('tshock.*'), true);

  console.log('4) 父组');
  calls.length = 0;
  await service.setParent({ group: 'guest', parent: 'default' });
  check('parent 命令逐字一致', calls, [['restCommand', '/group parent "guest" "default"']]);
  await checkThrows('父组不能是自己', () => service.setParent({ group: 'guest', parent: 'guest' }), '父组不能是自己');
  await checkThrows('缺父组', () => service.setParent({ group: 'guest', parent: '' }), '请选择父组');

  console.log('5) 建组');
  calls.length = 0;
  await service.create({ name: 'vip', permissions: ['tshock.canchat', 'bad perm'], parent: 'default' });
  check('先 add 带过滤后的权限，再 parent', calls, [
    ['restCommand', '/group add "vip" "tshock.canchat"'],
    ['restCommand', '/group parent "vip" "default"'],
  ]);
  calls.length = 0;
  await service.create({ name: 'noparent' });
  check('无父组只下发一条', calls, [['restCommand', '/group add "noparent"']]);
  await checkThrows('组名含星号被拒绝', () => service.create({ name: 'a*' }), '组名只能包含字母、数字、下划线、点和短横线');
  await checkThrows('组名含空格被拒绝', () => service.create({ name: 'a b' }), '组名只能包含字母、数字、下划线、点和短横线');

  console.log('6) 删组');
  calls.length = 0;
  await service.remove({ name: 'vip' });
  check('del 命令逐字一致', calls, [['restCommand', '/group del "vip"']]);
  await checkThrows('缺组名', () => service.remove({ name: '  ' }), '缺少组名');

  console.log('7) 路由行为');
  await routes[0].handler({}, {});
  check('GET /api/groups 返回 groups + catalog', Object.keys(reply.last.payload).sort(), ['catalog', 'groups']);
  check('catalog 原样透传', reply.last.payload.catalog, [{ key: 'tshock.canchat', label: '聊天' }]);
  await routes[5].handler({}, {});
  check('GET /api/group-names 只返回名字', reply.last.payload, { groups: ['guest', 'default', 'broken'] });
  await routes[1].handler({ body: { group: 'guest', permission: 'tshock.canchat' } }, {});
  check('POST perm 返回 ok + output', reply.last.payload, { ok: true, output: ['ok'] });
  running = false;
  await checkThrows('停服时统一报错', () => routes[0].handler({}, {}), '服务器没有运行。');
  running = true;

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
