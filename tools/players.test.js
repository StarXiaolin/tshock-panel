'use strict';

/**
 * lib/players.js + routers/players.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * 这段代码的风险点不在“能不能跑”，而在“算得对不对”：
 *   1. 封禁时间要在 .NET ticks 与 Unix 毫秒之间来回换算，算错会显示错误的解封时间；
 *   2. “已解封”的记录仍然会从 REST 接口返回，必须在这里过滤掉；
 *   3. IP 打码与“可以看到完整 IP”的审计日志是隐私相关的，不能被顺手改掉。
 *
 * 用法：node tools/players.test.js
 */

const {
  TICKS_MAX,
  displayName,
  maskIp,
  parseAccountInfo,
  nowTicks,
  banExpires,
  activeBans,
  createPlayerService,
} = require('../TShockPanel/lib/players');
const { createPlayerRoutes } = require('../TShockPanel/routers/players');

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

// ---- 假的 REST 层 ----
const calls = [];
const logs = [];
// 封禁时间断言必须在同一时间基准上算，否则会因毫秒漂移偶发失败。
const baseNow = Date.now();
const online = [
  { nickname: 'Alice', name: 'Alice', username: 'alice', ip: '1.2.3.4' },
  { nickname: '', name: 'Bob', username: 'bob', ip: '10.20.30.40' },
];
const rest = {
  async call(p) {
    calls.push(['call', p]);
    if (p === '/v2/players/list') return { players: online };
    if (p === '/v3/bans/list') {
      return {
        bans: [
          { identifier: '1.2.3.4', ticket_number: 1, end_date_ticks: String(TICKS_MAX) },
          { identifier: '5.6.7.8', ticket_number: 2, end_date_ticks: String(nowTicks(baseNow - 60000)) },
          { identifier: '9.9.9.9', ticket_number: 3, end_date_ticks: String(nowTicks(baseNow + 86400000)) },
          { identifier: 'no-expiry', ticket_number: 4 },
        ],
      };
    }
    return { ok: true, path: p };
  },
  async command(command) {
    calls.push(['command', command]);
    return ['账户信息：ok'];
  },
};

const players = createPlayerService({ restCall: rest.call });

const routes = [];
const reply = { last: null };
createPlayerRoutes({
  route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  readJsonBody: async (req) => req.body || {},
  requireRunning: () => {},
  restCall: rest.call,
  restCommand: rest.command,
  addLog: (channel, text) => logs.push([channel, text]),
  players,
  groups: {
    listDetailed: async () => [{ name: 'guest' }, { name: 'default' }],
  },
});

(async () => {
  console.log('1) 显示名与 IP 打码');
  check('昵称优先', displayName({ nickname: 'N', name: 'A', username: 'u' }), 'N');
  check('没有昵称退到角色名', displayName({ nickname: '', name: 'A', username: 'u' }), 'A');
  check('最后退到账户名', displayName({ username: 'u' }), 'u');
  check('空玩家返回空串', displayName(null), '');
  check('IPv4 打码', maskIp('192.168.1.99'), '192.168.*.*');
  check('IPv6 只留前两段', maskIp('fe80:0000:0000:0000:1:2:3:4'), 'fe80:0000:****');
  check('空 IP 返回空串', maskIp(''), '');
  check('非 IP 文本一律 ****', maskIp('unknown'), '****');

  console.log('2) accountinfo 文本解析');
  const full = parseAccountInfo([
    '账户 alice 的用户组为 guest。',
    '最后记录IP为 1.2.3.4',
    '注册时间为 2020-01-01',
  ]);
  check('三个字段都取到', [full.group, full.lastIp, full.registeredAt], ['guest', '1.2.3.4', '2020-01-01']);
  check('存在', full.exists, true);
  check('没有该账户', parseAccountInfo(['账户 nobody 不存在。']).exists, false);
  check('字段缺失给空串', parseAccountInfo([]).group, '');
  check('非数组输入也包成数组', parseAccountInfo('账户 x 不存在。').raw, ['账户 x 不存在。']);

  console.log('3) 封禁时间换算');
  const t = Date.parse('2020-01-01T00:00:00Z');
  // ticks 是 1e17 量级，超过了双精确整数上限（9.007e15），往返换算天生有 ±1ms 误差。
  check('ticks → ISO 往返一致（±2ms）', Math.abs(Date.parse(banExpires({ end_date_ticks: nowTicks(t) })) - t) <= 2, true);
  check('DateTime.MaxValue 视为永不过期', banExpires({ end_date_ticks: String(TICKS_MAX) }), null);
  check('没有到期字段返回 null', banExpires({}), null);

  console.log('4) 过期封禁被过滤');
  const view = activeBans((await rest.call('/v3/bans/list')).bans, baseNow);
  check('剩下的回执号', view.map((b) => b.ticket_number), [1, 3, 4]);
  check('永久封禁 expires 为 null', view[0].expires, null);
  check(
    '未来到期给出 ISO（±2ms）',
    Math.abs(Date.parse(view[1].expires) - (baseNow + 86400000)) <= 2,
    true,
  );
  check('其余字段原样保留', view[0].identifier, '1.2.3.4');

  console.log('5) 路由注册');
  check('注册 12 条', routes.length, 12);
  check(
    'method + 路径与拆分前一致',
    routes.map((r) => `${r.method} ${r.pattern.source}`),
    [
      'GET ^\\/api\\/players$',
      'POST ^\\/api\\/players\\/action$',
      'GET ^\\/api\\/bans$',
      'POST ^\\/api\\/bans\\/add$',
      'POST ^\\/api\\/bans\\/remove$',
      'GET ^\\/api\\/users$',
      'POST ^\\/api\\/users\\/add$',
      'POST ^\\/api\\/users\\/remove$',
      'GET ^\\/api\\/players\\/detail$',
      'GET ^\\/api\\/users\\/detail$',
      'POST ^\\/api\\/users\\/password$',
      'POST ^\\/api\\/users\\/group$'
    ]
  );

  console.log('6) 在线列表与查找');
  check('在线列表', (await players.onlinePlayers()).length, 2);
  check('按昵称大小写不敏感找到', (await players.findOnline('alice')).username, 'alice');
  check('按角色名找到（昵称为空时）', (await players.findOnline('bob')).username, 'bob');
  check('找不到返回 null', await players.findOnline('nobody'), null);

  console.log('7) 路由行为');
  await routes[0].handler({}, {});
  check('GET /api/players 只返回 players', Object.keys(reply.last.payload), ['players']);
  await routes[2].handler({}, {});
  check('GET /api/bans 只剩生效记录', reply.last.payload.bans.map((b) => b.ticket_number), [1, 3, 4]);
  await checkThrows(
    'users/add 密码太短',
    () => routes[6].handler({ body: { user: 'x', password: '123' } }, {}),
    '密码至少 4 位'
  );
  await checkThrows(
    'users/group 拒绝 superadmin',
    () => routes[11].handler({ body: { user: 'x', group: 'superadmin' } }, {}),
    '不允许把账户直接设为 superadmin，请创建自定义管理组并分配所需权限。'
  );
  await checkThrows(
    'users/group 校验组存在',
    () => routes[11].handler({ body: { user: 'x', group: 'nope' } }, {}),
    '用户组「nope」不存在'
  );
  await routes[11].handler({ body: { user: 'x', group: 'guest' } }, {});
  check('users/group 成功返回 message', reply.last.payload, { ok: true, message: '组已更新' });

  console.log('8) 玩家详情默认打码，reveal=1 才给完整 IP');
  const urlMasked = new URL('http://x/api/players/detail?name=Alice');
  await routes[8].handler({}, {}, urlMasked);
  check('默认 ip 打码', reply.last.payload.player.ip, '1.2.*.*');
  check('ipMasked 始终是打码值', reply.last.payload.player.ipMasked, '1.2.*.*');
  check('revealed 标记', reply.last.payload.player.revealed, false);
  check('sscInventory 如实返回不可用', reply.last.payload.sscInventory.available, false);
  const urlReveal = new URL('http://x/api/players/detail?name=Alice&reveal=1');
  await routes[8].handler({}, {}, urlReveal);
  check('reveal=1 给完整 IP', reply.last.payload.player.ip, '1.2.3.4');
  check('审计日志留痕', logs.some((l) => /查看了玩家 Alice 的完整 IP/.test(l[1])), true);
  await checkThrows(
    '不在线玩家报错',
    () => routes[8].handler({}, {}, new URL('http://x/api/players/detail?name=nobody')),
    '玩家「nobody」不在线'
  );

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
