'use strict';

/**
 * lib/http-utils.js 的单元测试（零依赖，用假 req/res 驱动）。
 *
 * 这四个函数被全部 62 条路由共用，它们的错误文案是全站契约的一部分，
 * 前端就是这么显示的。所以锁住：
 *   1. json() 的响应头（Content-Type / Cache-Control / Content-Length 按字节算）；
 *   2. readBody() 的 8MB 上限与“超限立刻抛错”的行为；
 *   3. readJsonBody() 空体返回 {}、坏 JSON 给出统一文案；
 *   4. requireRunning() 依赖注入的运行时判断，不直接读全局状态。
 *
 * 用法：node tools/http-utils.test.js
 */

const { createHttpUtils, DEFAULT_LIMIT } = require('../TShockPanel/lib/http-utils');

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
async function checkThrowsAsync(name, fn, message) {
  try {
    await fn();
    check(name, 'no throw', message);
  } catch (err) {
    check(name, err.message, message);
  }
}
function checkThrows(name, fn, message) {
  try {
    fn();
    check(name, 'no throw', message);
  } catch (err) {
    check(name, err.message, message);
  }
}

let running = false;
const { json, readBody, readJsonBody, requireRunning } = createHttpUtils({ isRunning: () => running });

function fakeRes() {
  return {
    code: null,
    headers: null,
    body: '',
    writeHead(code, headers) {
      this.code = code;
      this.headers = headers;
      return this;
    },
    end(chunk) {
      this.body += chunk || '';
      return this;
    },
  };
}
async function* fakeReq(chunks) {
  for (const c of chunks) yield c;
}

(async () => {
  console.log('1) json()');
  const res = fakeRes();
  json(res, 200, { ok: true, 中文: '值' });
  check('状态码', res.code, 200);
  check('Content-Type', res.headers['Content-Type'], 'application/json; charset=utf-8');
  check('禁用缓存', res.headers['Cache-Control'], 'no-store');
  check('Content-Length 按字节算', res.headers['Content-Length'], Buffer.byteLength('{"ok":true,"中文":"值"}'));
  check('body', res.body, '{"ok":true,"中文":"值"}');

  const errRes = fakeRes();
  json(errRes, 400, { error: '坏了' });
  check('错误状态码也能回', [errRes.code, errRes.body], [400, '{"error":"坏了"}']);

  console.log('2) readBody()');
  const buf = await readBody(fakeReq([Buffer.from('ab'), Buffer.from('cd')]));
  check('拼接多块', buf.toString('utf8'), 'abcd');
  const empty = await readBody(fakeReq([]));
  check('空体返回空 Buffer', empty.length, 0);

  console.log('3) readBody() 上限');
  check('默认上限是 8MB', DEFAULT_LIMIT, 8 * 1024 * 1024);
  await checkThrowsAsync(
    '超过上限报错',
    () => readBody(fakeReq([Buffer.alloc(4), Buffer.alloc(4)]), 6),
    '请求体过大'
  );
  const justUnder = await readBody(fakeReq([Buffer.alloc(6)]), 6);
  check('刚好等于上限时放行', justUnder.length, 6);

  console.log('4) readJsonBody()');
  check('空体返回 {}', await readJsonBody(fakeReq([])), {});
  check('正常解析', await readJsonBody(fakeReq([Buffer.from('{"a":1}')])), { a: 1 });
  check('中文字段', await readJsonBody(fakeReq([Buffer.from('{"名":"值"}')])), { 名: '值' });
  await checkThrowsAsync(
    '坏 JSON 给统一文案',
    () => readJsonBody(fakeReq([Buffer.from('{oops')])),
    '请求数据不是合法 JSON'
  );
  await checkThrowsAsync(
    '二进制垃圾也给统一文案',
    () => readJsonBody(fakeReq([Buffer.from([0x80, 0x81])])),
    '请求数据不是合法 JSON'
  );

  console.log('5) requireRunning()');
  running = false;
  checkThrows('未运行时抛出', () => requireRunning(), '服务器没有运行。');
  running = true;
  checkThrows('运行时通过', () => requireRunning(), 'no throw');

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
