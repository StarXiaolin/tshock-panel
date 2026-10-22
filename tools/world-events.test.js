'use strict';

/**
 * lib/world-events.js + routers/world-events.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * 世界事件靠“跑命令再解析中文帮助”来探测能力，属于全项目最脆的一段：
 * TShock 文案一改就可能解析不出来。所以锁住：
 *   1. 解析函数对当前文案格式的行为（含解析失败时的兜底）；
 *   2. 探测结果缓存 5 分钟、refresh 强制刷新；
 *   3. 触发命令字符串逐字一致（入侵带子类型与波数、雨带子类型）；
 *   4. 血月与日食互斥：未 force 时返回 conflict，由路由回 409。
 *
 * 用法：node tools/world-events.test.js
 */

const {
  parseListFromText,
  parseRainTypes,
  createEventDiscovery,
  createWorldEventService,
} = require('../TShockPanel/lib/world-events');
const { createWorldEventRoutes } = require('../TShockPanel/routers/world-events');

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

const EVENT_META = {
  bloodmoon: { label: '血月', desc: '', icon: '🌕' },
  eclipse: { label: '日食', desc: '', icon: '☀' },
  invasion: { label: '入侵', desc: '', icon: '⚔' },
  rain: { label: '雨', desc: '', icon: '☂' },
};
const INVASION_META = { goblins: '哥布林入侵', pirates: '海盗入侵' };
const RAIN_META = { meteor: '流星雨' };
const eventPermission = (type) => `tshock.world.time.${type}`;

const calls = [];
const logs = [];
let bloodmoon = 'Disabled';

const restCommand = async (command) => {
  calls.push(command);
  if (command === '/worldevent') return ['用法：/worldevent <类型>', '有效的事件类型：bloodmoon, eclipse, invasion, rain。'];
  if (command === '/worldevent invasion') return ['入侵类型：goblins, pirates。'];
  if (command === '/worldevent rain') return ['/worldevent rain meteor  召唤流星雨'];
  return ['已触发'];
};
const restCall = async (path) => {
  if (path === '/v3/world/bloodmoon') return { response: bloodmoon };
  throw new Error('未预期：' + path);
};

const discovery = createEventDiscovery({
  restCommand,
  meta: { EVENT_META, INVASION_META, RAIN_META, eventPermission },
});
const events = createWorldEventService({ restCall, restCommand, addLog: (c, t) => logs.push([c, t]), discovery });

const routes = [];
const reply = { last: null };
createWorldEventRoutes({
  route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  readJsonBody: async (req) => req.body || {},
  requireRunning: () => {},
  events,
});

(async () => {
  console.log('1) 文案解析');
  check('解析事件类型列表', parseListFromText('有效的事件类型：a, b，c。', '有效的事件类型'), ['a', 'b', 'c']);
  check('解析不到返回 null', parseListFromText('无关文本', '有效的事件类型'), null);
  check('雨类型去重', parseRainTypes('/worldevent rain meteor  流星\n/worldevent rain meteor\n/worldevent rain rain'), ['meteor', 'rain']);
  check('没有雨类型时给空数组', parseRainTypes(''), []);

  console.log('2) 探测与缓存');
  calls.length = 0;
  const first = await discovery.discover();
  check('首次探测发 3 条命令', calls, ['/worldevent', '/worldevent invasion', '/worldevent rain']);
  check('类型来自解析帮助', first.types.map((t) => t.type), ['bloodmoon', 'eclipse', 'invasion', 'rain']);
  check('类型带上标签与权限', [first.types[0].label, first.types[0].permission, first.types[0].known], ['血月', 'tshock.world.time.bloodmoon', true]);
  check('入侵子类型', first.invasions.map((x) => x.key), ['goblins', 'pirates']);
  check('雨子类型', first.rains.map((x) => x.key), ['meteor']);
  check('原始输出保留', first.raw.root.length, 2);

  calls.length = 0;
  const second = await discovery.discover();
  check('缓存期内不再发命令', calls, []);
  check('返回同一份缓存', second === first, true);

  calls.length = 0;
  await discovery.discover(true);
  check('force 重新探测', calls.length, 3);

  calls.length = 0;
  const shortTtl = createEventDiscovery({
    restCommand,
    meta: { EVENT_META, INVASION_META, RAIN_META, eventPermission },
    ttlMs: 0,
  });
  await shortTtl.discover();
  await shortTtl.discover();
  check('TTL 到期后会重新探测', calls.length, 6);

  console.log('3) 描述接口');
  calls.length = 0;
  const described = await events.describe();
  check('带上状态字段', Object.keys(described.status), ['bloodmoon', 'last']);
  check('血月状态被解析', described.status.bloodmoon, false);
  check('describe 不重复探测（用缓存）', calls.filter((c) => c === '/worldevent').length, 0);

  console.log('4) 触发与命令拼装');
  calls.length = 0;
  const eclipse = await events.trigger({ type: 'eclipse' });
  check('普通事件命令', eclipse.command, '/worldevent eclipse');
  check('记录结果字段', Object.keys(eclipse).sort(), ['at', 'command', 'label', 'ok', 'output', 'sub', 'type', 'waves'].sort());
  check('成功后 ok', eclipse.ok, true);
  check('写入面板日志', logs.at(-1), ['panel', '世界事件：/worldevent eclipse → 已触发']);

  const invasion = await events.trigger({ type: 'invasion', sub: 'goblins', waves: '5' });
  check('入侵带子类型与波数', invasion.command, '/worldevent invasion goblins 5');
  const rain = await events.trigger({ type: 'rain', sub: 'meteor' });
  check('雨带子类型', rain.command, '/worldevent rain meteor');
  const plainInvasion = await events.trigger({ type: 'invasion' });
  check('不带子类型时不追加', plainInvasion.command, '/worldevent invasion');

  console.log('5) 校验');
  await checkThrows('未知事件类型', () => events.trigger({ type: 'nope' }), '当前 TShock 不支持事件类型「nope」');
  await checkThrows('未知入侵类型', () => events.trigger({ type: 'invasion', sub: 'zombies' }), '无效的入侵类型「zombies」');
  await checkThrows('波数非数字', () => events.trigger({ type: 'invasion', waves: 'abc' }), '波数需要是 1–999 的整数');
  await checkThrows('波数超过 999', () => events.trigger({ type: 'invasion', waves: '1000' }), '波数需要是 1–999 的整数');
  await checkThrows('未知雨类型', () => events.trigger({ type: 'rain', sub: 'sand' }), '无效的雨类型「sand」');

  console.log('6) 血月与日食互斥');
  bloodmoon = 'Enabled';
  const conflict = await events.trigger({ type: 'eclipse' });
  check('返回 conflict 而不是抛出', conflict.conflict, 'bloodmoon');
  check('带可读提示', conflict.message, '血月正在进行中，日食与血月互斥。继续触发会先结束血月，是否继续？');
  const forced = await events.trigger({ type: 'eclipse', force: true });
  check('force 后正常执行', forced.command, '/worldevent eclipse');
  bloodmoon = 'Disabled';

  console.log('7) 输出判定');
  bloodmoon = 'Unknown';
  check('血月状态未知时返回 null', await events.bloodmoonState(), null);
  bloodmoon = 'Enabled';
  const failedRun = await events.trigger({ type: 'rain', sub: 'meteor', force: true });
  check('正常输出 ok=true', failedRun.ok, true);

  console.log('8) 路由');
  check('注册 2 条', routes.length, 2);
  check(
    'method + 路径与拆分前一致',
    routes.map((r) => `${r.method} ${r.pattern.source}`),
    ['GET ^\\/api\\/world-events$', 'POST ^\\/api\\/world-events\\/trigger$']
  );
  await routes[0].handler({}, {}, new URL('http://x/api/world-events'));
  check('GET 回 200 并带 status', [reply.last.code, Object.keys(reply.last.payload.status)], [200, ['bloodmoon', 'last']]);
  await routes[1].handler({ body: { type: 'eclipse' } }, {});
  check('冲突时回 409', reply.last.code, 409);
  check('409 带 error 与 conflict', [typeof reply.last.payload.error, reply.last.payload.conflict], ['string', 'bloodmoon']);
  bloodmoon = 'Disabled';
  await routes[1].handler({ body: { type: 'eclipse' } }, {});
  check('不冲突时回 200', reply.last.code, 200);

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
