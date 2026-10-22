'use strict';

/**
 * lib/logbus.js 的单元测试（零依赖）。
 *
 * 日志总线是面板最“热”的代码：服务器每秒可能吐出上百行，一旦折叠/截断/广播出错，
 * 轻则前端日志面板卡死，重则内存涨到爆。这里锁住四条不变量：
 *   1. 连续相同的行折叠成一条（id 不变、count 递增）；
 *   2. 调用栈超过 200 层后只累加 hidden，不再新增条目；
 *   3. 缓冲超过 maxLines 时从头部裁掉；
 *   4. 广播时对端已断开（write 抛错）要自动踢掉，不影响其它订阅者。
 *
 * 用法：node tools/logbus.test.js
 */

const { createLogBus, decodeLine, makeLineReader, ANSI_RE } = require('../TShockPanel/lib/logbus');

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

console.log('1) 基本写入');
const bus = createLogBus({ maxLines: 3 });
bus.addLog('stdout', 'first');
bus.addLog('stdout', 'second');
check('条目数', bus.logBuffer.items.length, 2);
check('id 从 1 递增', bus.logBuffer.items.map((i) => i.id), [1, 2]);
check('nextId 前进', bus.logBuffer.nextId, 3);
check('字段齐全', Object.keys(bus.logBuffer.items[0]).sort(), ['id', 'stream', 't', 'text']);

console.log('2) 连续相同行折叠');
bus.addLog('stdout', 'second');
bus.addLog('stdout', 'second');
check('不新增条目', bus.logBuffer.items.length, 2);
check('count 累加', bus.logBuffer.items[1].count, 3);
check('id 不变', bus.logBuffer.items[1].id, 2);
bus.addLog('stdout', 'third');
check('不同内容恢复新增', bus.logBuffer.items.length, 3);

console.log('3) 缓冲上限');
bus.addLog('stdout', 'fourth');
check('超过 maxLines 后裁掉最旧', bus.logBuffer.items.map((i) => i.text), ['second', 'third', 'fourth']);

console.log('4) 调用栈截断');
const bus2 = createLogBus({ maxLines: 5000 });
bus2.addLog('stdout', 'boom');
for (let i = 0; i < 250; i++) bus2.addLog('stdout', `    at frame${i}()`);
check('调用栈只留 200 层', bus2.logBuffer.items.length, 201);
check('超出部分记在 hidden 上', bus2.logBuffer.items[200].hidden, 50);
check('不再新增条目', bus2.logBuffer.items[200].text, '    at frame199()');

console.log('5) SSE 广播与断线清理');
const written = [];
const good = { write: (frame) => written.push(frame) };
const bad = {
  write: () => {
    throw new Error('socket closed');
  },
};
bus2.sseClients.add(good);
bus2.sseClients.add(bad);
bus2.broadcast('log', { id: 9, text: 'hi' });
check('好连接收到一帧', written.length, 1);
check('帧格式正确', written[0], 'event: log\ndata: {"id":9,"text":"hi"}\n\n');
check('坏连接被移除', bus2.sseClients.has(bad), false);
check('好连接保留', bus2.sseClients.has(good), true);

console.log('6) 行解析 makeLineReader');
const got = [];
const reader = makeLineReader((line) => got.push(line));
reader(Buffer.from('alpha\r\nbra'));
reader(Buffer.from('vo\n\ngamma')); // 最后一段没有换行，应当留在缓冲里
check('按 \\n 切分并去掉 \\r', got, ['alpha', 'bravo', '']);
reader(Buffer.from('\n'));
check('跨 chunk 的行拼回完整', got, ['alpha', 'bravo', '', 'gamma']);

console.log('7) 编码与 ANSI');
check('UTF-8 正常解码', decodeLine(Buffer.from('天顶剑', 'utf8')), '天顶剑');
check('GBK 回退（"测试" 的 GBK 字节）', decodeLine(Buffer.from([0xb2, 0xe2, 0xca, 0xd4])), '测试');
check('ANSI 颜色被剥离', '\x1b[32mOK\x1b[0m'.replace(ANSI_RE, ''), 'OK');

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
