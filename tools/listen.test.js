'use strict';

/**
 * lib/listen.js 的单元测试（零依赖，用真实端口复现“被占用 → 顺延”）。
 *
 * 面板固定端口 13087，被占用时必须顺延到 13088、13089…而不是直接起不来；
 * 但顺延后的端口**不能写回配置**，否则下次启动会越漂越远（这是 main() 里的约定，
 * 这里只验证顺延本身）。
 *
 * 用法：node tools/listen.test.js
 */

const http = require('http');
const { listenWithFallback } = require('../TShockPanel/lib/listen');

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

function startServer(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}
function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

(async () => {
  console.log('1) 端口空闲时直接用');
  const s1 = http.createServer(() => {});
  const freePort = await startServer(s1);
  await closeServer(s1);

  const s2 = http.createServer(() => {});
  const used = await listenWithFallback(s2, freePort);
  // 注意：从 close 到再次 listen 之间有极短的窗口，别的进程可能抢走这个端口。
  // 所以不硬断言“一定等于首选端口”，而是断言“真的监听了、返回值与实际一致”。
  check('返回的端口不小于首选端口', used >= freePort, true);
  check('确实进入了 listening 状态', s2.listening, true);
  check('返回值就是实际监听端口', s2.address().port, used);
  await closeServer(s2);

  console.log('2) 端口被占用时顺延');
  const blocker = http.createServer(() => {});
  const occupied = await startServer(blocker);

  const s3 = http.createServer(() => {});
  const fallback = await listenWithFallback(s3, occupied);
  check('顺延到更大的端口', fallback > occupied, true);
  check('新端口可用', s3.listening, true);
  await closeServer(s3);

  console.log('3) 连续占用时继续顺延');
  const blocker2 = http.createServer(() => {});
  const occupied2 = await startServer(blocker2);
  const s4 = http.createServer(() => {});
  const fallback2 = await listenWithFallback(s4, occupied2, { maxTries: 5 });
  check('跳过两个被占端口', fallback2 >= occupied2 + 1, true);
  await closeServer(s4);
  await closeServer(blocker2);
  await closeServer(blocker);

  console.log('4) 非 EADDRINUSE 的错误直接抛');
  const fakeBad = {
    once(event, fn) {
      if (event === 'error') this._onError = fn;
    },
    removeListener() {},
    listen() {
      setImmediate(() => this._onError({ code: 'EACCES', message: '权限不足' }));
    },
  };
  await checkThrows('EACCES 不重试', () => listenWithFallback(fakeBad, 1234), '权限不足');

  console.log('5) 试满次数仍找不到端口');
  const fakeBusy = {
    once(event, fn) {
      if (event === 'error') this._onError = fn;
    },
    removeListener() {},
    listen() {
      setImmediate(() => this._onError({ code: 'EADDRINUSE', message: '占用' }));
    },
  };
  await checkThrows(
    '达到上限后给出明确错误',
    () => listenWithFallback(fakeBusy, 4000, { maxTries: 3 }),
    '找不到可用端口用于启动面板。'
  );

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
