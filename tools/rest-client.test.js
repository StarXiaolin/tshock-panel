'use strict';

/**
 * lib/rest.js 的单元测试（零依赖、不联网）。
 *
 * 用假的 fetch 拦下请求，检查：
 *   1. 查询参数拼装与 URL 编码（中文、空格、引号、& 等）；
 *   2. 令牌只在缺失时追加，已带 token 时不重复追加；
 *   3. 业务失败的错误文案与改动前逐字一致（前端会直接显示）；
 *   4. rawcmd 的返回值归一化（数组 / 字符串 / 空）。
 *
 * 用法：node tools/rest-client.test.js
 */

const { createRestClient, appendQuery } = require('../TShockPanel/lib/rest');

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

console.log('1) appendQuery');
check('无参数时原样返回', appendQuery('/v2/a', null), '/v2/a');
check('空对象原样返回', appendQuery('/v2/a', {}), '/v2/a');
check(
  '简单参数',
  appendQuery('/v2/a', { a: 1, b: 'x' }),
  '/v2/a?a=1&b=x'
);
check(
  '已有 ? 时用 &',
  appendQuery('/v2/a?z=0', { a: 1 }),
  '/v2/a?z=0&a=1'
);
check(
  '中文与空格被编码',
  appendQuery('/v3/server/rawcmd', { cmd: '/give 天顶剑 玩家 1' }),
  '/v3/server/rawcmd?cmd=' + encodeURIComponent('/give 天顶剑 玩家 1')
);
check(
  'undefined 字段被跳过',
  appendQuery('/x', { a: 1, b: undefined }),
  '/x?a=1'
);

// 用假 fetch 捕获真实请求
const calls = [];
let nextResponse = { statusCode: 200, body: { status: 200, response: ['ok'] } };
global.fetch = async (url, opts) => {
  calls.push(url);
  return {
    status: nextResponse.statusCode,
    text: async () => JSON.stringify(nextResponse.body),
  };
};

const client = createRestClient({ getPort: () => 7878, getToken: () => 'TOKEN' });

(async () => {
  console.log('2) 令牌追加');
  await client.get('/v2/server/status');
  check('自动追加 token', calls.at(-1), 'http://127.0.0.1:7878/v2/server/status?token=TOKEN');

  await client.get('/v2/x?a=1');
  check('已有查询参数时用 &', calls.at(-1), 'http://127.0.0.1:7878/v2/x?a=1&token=TOKEN');

  await client.get('/v2/x?token=OTHER');
  check('已带 token 时不重复追加', calls.at(-1), 'http://127.0.0.1:7878/v2/x?token=OTHER');

  console.log('3) rawcmd 命令编码与结果归一');
  await client.command('/give "天顶剑" 玩家 1');
  const rawUrl = calls.at(-1);
  check(
    '命令被完整编码进 cmd 参数',
    rawUrl.includes('cmd=' + encodeURIComponent('/give "天顶剑" 玩家 1')),
    true
  );
  check('命令请求同样带 token', rawUrl.endsWith('&token=TOKEN'), true);

  nextResponse = { statusCode: 200, body: { status: 200, response: 'single' } };
  check('字符串响应归一成数组', await client.command('/say hi'), ['single']);

  nextResponse = { statusCode: 200, body: { status: 200 } };
  check('无 response 时返回空数组', await client.command('/say hi'), []);

  console.log('4) 错误文案');
  nextResponse = { statusCode: 500, body: { status: 500, error: '插件挂了' } };
  try {
    await client.call('/v2/x');
    check('应抛错', 'no throw', 'throw');
  } catch (err) {
    check('业务错误透传 error 字段', err.message, '插件挂了');
  }

  nextResponse = { statusCode: 200, body: { status: 500, response: 'TShock 说不行' } };
  try {
    await client.call('/v2/x');
    check('应抛错', 'no throw', 'throw');
  } catch (err) {
    check('HTTP 200 但 body.status=500 时也抛错', err.message, 'TShock 说不行');
  }

  // JSON 解析失败的分支
  global.fetch = async () => ({ status: 200, text: async () => '<html>not json</html>' });
  try {
    await client.call('/v2/x');
    check('应抛错', 'no throw', 'throw');
  } catch (err) {
    check(
      '非 JSON 响应有可读错误',
      err.message.startsWith('REST 返回无法解析：<html>'),
      true
    );
  }

  global.fetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  check('探活在连接失败时返回 false', await client.ok(), false);

  delete global.fetch;

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
