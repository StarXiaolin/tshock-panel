'use strict';

/**
 * 静态文件服务：把 public/ 目录按扩展名映射 Content-Type 返回给浏览器。
 *
 * 为什么单独一层：
 *   这是面板唯一对外暴露文件系统的路径，安全边界只有“路径必须落在 public 内”
 *   这一条。把它放在 server.js 里时既没法单测，也很难说服别人“真的挡住了穿越”。
 *   拆出来后可以直接起一个真 HTTP 服务，用 ../ 之类的请求验证边界。
 *
 * 行为与拆分前一致：
 *  - `/` 映射到 index.html；
 *  - 只返回普通文件，目录一律 404；
 *  - Cache-Control: no-store（面板开发/升级频繁，缓存会让用户看到旧前端）；
 *  - 路径穿越一律 403。
 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * @param {object} deps
 * @param {string} deps.publicDir 静态根目录（绝对路径）
 * @param {object} deps.fs        node:fs
 * @param {object} deps.fsp       node:fs/promises
 * @param {object} deps.path      node:path
 */
function createStaticFiles({ publicDir, fs, fsp, path }) {
  async function serve(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.join(publicDir, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (!file.toLowerCase().startsWith(publicDir.toLowerCase())) {
      res.writeHead(403).end('403');
      return;
    }
    try {
      const stat = await fsp.stat(file);
      if (!stat.isFile()) throw new Error('not file');
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    }
  }

  return { serve };
}

module.exports = { createStaticFiles, MIME };
