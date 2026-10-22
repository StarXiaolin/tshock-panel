'use strict';

/**
 * lib/static-files.js 的单元测试（零依赖，起一个真 HTTP 服务在随机端口验证）。
 *
 * 静态文件服务是面板唯一直接暴露文件系统的路径，安全边界只有“必须落在 public 内”。
 * 这里用真实请求验证：
 *   1. `/` 返回 index.html，Content-Type 与 Cache-Control 正确；
 *   2. .js/.css/.json 的 MIME 映射正确，未知扩展名回 octet-stream；
 *   3. 不存在的文件与目录都回 404（不泄露目录列表）；
 *   4. 路径穿越一律 403，且绝不会读到 public 之外的文件。
 *
 * 用法：node tools/static-files.test.js
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createStaticFiles, MIME } = require('../TShockPanel/lib/static-files');

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-static-'));
const publicDir = path.join(root, 'public');
fs.mkdirSync(path.join(publicDir, 'js'), { recursive: true });
fs.mkdirSync(path.join(publicDir, 'sub'), { recursive: true });
fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>面板</title>');
fs.writeFileSync(path.join(publicDir, 'js', 'a.js'), 'console.log(1);');
fs.writeFileSync(path.join(publicDir, 'style.css'), 'body{color:red}');
fs.writeFileSync(path.join(publicDir, 'data.json'), '{"a":1}');
fs.writeFileSync(path.join(publicDir, 'robots.txt'), 'User-agent: *');
// public 之外的同级文件：穿越测试的靶子
fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP-SECRET');

const staticFiles = createStaticFiles({ publicDir, fs, fsp: fs.promises, path });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  staticFiles.serve(req, res, url.pathname).catch((err) => {
    res.writeHead(500).end(String(err));
  });
});

function get(rawPath) {
  return new Promise((resolve, reject) => {
    // 直接用原始路径请求，避免 URL 规范化掩盖穿越意图
    const req = http.request({ port: server.address().port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

server.listen(0, '127.0.0.1', async () => {
  try {
    console.log('1) 根路径与 MIME');
    const index = await get('/');
    check('根路径返回 index.html', [index.status, index.body], [200, '<!doctype html><title>面板</title>']);
    check('html 的 Content-Type', index.headers['content-type'], 'text/html; charset=utf-8');
    check('禁用缓存', index.headers['cache-control'], 'no-store');
    check('带 Content-Length', Number(index.headers['content-length']), Buffer.byteLength('<!doctype html><title>面板</title>'));

    const js = await get('/js/a.js');
    check('js 的 Content-Type', js.headers['content-type'], 'application/javascript; charset=utf-8');
    check('js 内容正确', js.body, 'console.log(1);');
    const css = await get('/style.css');
    check('css 的 Content-Type', css.headers['content-type'], 'text/css; charset=utf-8');
    const jsonFile = await get('/data.json');
    check('json 的 Content-Type', jsonFile.headers['content-type'], 'application/json; charset=utf-8');
    const txt = await get('/robots.txt');
    check('未知扩展名回 octet-stream', txt.headers['content-type'], 'application/octet-stream');
    check('MIME 表包含前端用的全部类型', Object.keys(MIME).sort(), ['.css', '.html', '.ico', '.js', '.json', '.png', '.svg', '.woff2'].sort());

    console.log('2) 不存在的资源');
    const missing = await get('/nope.html');
    check('缺失文件 404', [missing.status, missing.body], [404, '404 Not Found']);
    const dir = await get('/sub');
    check('目录 404（不列目录）', dir.status, 404);

    console.log('3) 路径穿越');
    const escaped = await get('/../secret.txt');
    check('含 ../ 的请求读不到外部文件', escaped.body.includes('TOP-SECRET'), false);
    check('../ 被拦下（403）或规范化后 404', [403, 404].includes(escaped.status), true);
    const encoded = await get('/%2e%2e/%2e%2e/secret.txt');
    check('编码后的穿越也读不到', encoded.body.includes('TOP-SECRET'), false);
    check('编码穿越返回 403/404', [403, 404].includes(encoded.status), true);
    const winStyle = await get('/..%5csecret.txt');
    check('反斜杠穿越也读不到', winStyle.body.includes('TOP-SECRET'), false);

    console.log('4) 中文文件名');
    fs.writeFileSync(path.join(publicDir, '中文 文件.html'), '<p>ok</p>');
    const chinese = await get('/%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6.html');
    check('URL 编码的中文文件名可访问', [chinese.status, chinese.body], [200, '<p>ok</p>']);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
    console.log('');
    if (failed > 0) {
      console.error(`结果：${failed} 项失败`);
      process.exit(1);
    }
    console.log('结果：全部通过');
  }
});
