'use strict';

/**
 * 监听端口并处理“端口被占用”的顺延。
 *
 * 为什么要单独一层：
 *  面板默认固定 13087。用户可能已经开着一个旧面板、或者别的程序占了 13087，
 *  直接 listen 会抛 EADDRINUSE 让面板起不来。原实现会顺延到 13088、13089…
 *  最多试 20 次，并且**不把顺延后的端口写回配置**（否则下次启动会越漂越远）。
 *
 *  这段逻辑原先内联在 server.js 的 main() 里，只能靠手工占端口验证；
 *  抽出来以后可以用真实端口在单测里复现“被占用 → 顺延”。
 */

/**
 * @param {import('http').Server} server 已创建但未监听的 http server
 * @param {number} port 首选端口
 * @param {{maxTries?: number, host?: string}} [options]
 * @returns {Promise<number>} 实际使用的端口
 */
async function listenWithFallback(server, port, options = {}) {
  const { maxTries = 20, host = '127.0.0.1' } = options;
  let attempt = 0;
  let current = port;

  while (attempt < maxTries) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          server.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(current, host);
      });
      return current;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      attempt += 1;
      current += 1;
    }
  }
  throw new Error('找不到可用端口用于启动面板。');
}

module.exports = { listenWithFallback };
