'use strict';

/**
 * routers/config.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * 这 6 条路由直接改 tshock/*.json 与 motd/rules/whitelist，写坏就是服务器起不来，
 * 所以锁住三件事：
 *   1. 6 条路由的 method + 路径与拆分前逐字一致；
 *   2. 任何写入之前一定先备份（配置文件与文本文件同一策略）；
 *   3. sscconfig 的原始 JSON 分支：格式错误要给出可读提示，成功则提示要重启。
 *
 * 用法：node tools/routers-config.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createConfigRoutes } = require('../TShockPanel/routers/config');

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-config-'));
const tshockDir = path.join(root, 'tshock');
fs.mkdirSync(tshockDir, { recursive: true });
const sscPath = path.join(tshockDir, 'sscconfig.json');
const motdPath = path.join(tshockDir, 'motd.txt');
const TEXT_FILES = { motd: motdPath };
fs.writeFileSync(sscPath, '{}\n', 'utf8');
fs.writeFileSync(motdPath, 'old\r\nline\r\n', 'utf8');

const routes = [];
const reply = { last: null };
const backups = [];
const ensureDirs = [];

createConfigRoutes({
  route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  readJsonBody: async (req) => req.body || {},
  fsp: fs.promises,
  fs,
  path,
  ensureDir: (dir) => {
    ensureDirs.push(dir);
    fs.mkdirSync(dir, { recursive: true });
  },
  writeFileAtomic: (file, content) => fs.writeFileSync(file, content, 'utf8'),
  backupConfigFile: (file, label) => backups.push([file, label]),
  configStore: {
    getConfig: () => ({ Settings: { ServerPort: 7777 } }),
    saveConfig: (settings, raw) => ({ ok: true, settings, raw }),
    getSsc: () => ({ Settings: { Enabled: false } }),
    saveSsc: (settings) => ({ ok: true, settings }),
  },
  textFiles: TEXT_FILES,
  sscPath,
});

(async () => {
  console.log('1) 路由注册');
  check('注册 6 条', routes.length, 6);
  check(
    'method + 路径与拆分前一致',
    routes.map((r) => `${r.method} ${r.pattern.source}`),
    [
      'GET ^\\/api\\/config$',
      'POST ^\\/api\\/config$',
      'GET ^\\/api\\/sscconfig$',
      'POST ^\\/api\\/sscconfig$',
      'GET ^\\/api\\/text$',
      'POST ^\\/api\\/text$'
    ]
  );

  console.log('2) config 读写透传');
  await routes[0].handler({}, {});
  check('GET /api/config 返回 getConfig 结果', reply.last.payload, { Settings: { ServerPort: 7777 } });
  await routes[1].handler({ body: { settings: { ServerPort: 7778 }, raw: '{"a":1}' } }, {});
  check('POST /api/config 透传 settings 与 raw', reply.last.payload, {
    ok: true,
    settings: { ServerPort: 7778 },
    raw: '{"a":1}',
  });

  console.log('3) sscconfig 两个分支');
  await routes[2].handler({}, {});
  check('GET /api/sscconfig 返回 getSsc 结果', reply.last.payload, { Settings: { Enabled: false } });
  await routes[3].handler({ body: { settings: { Enabled: true } } }, {});
  check('无 raw 时走 saveSsc', reply.last.payload, { ok: true, settings: { Enabled: true } });

  backups.length = 0;
  await routes[3].handler({ body: { raw: '{"Settings":{"Enabled":true}}' } }, {});
  check('raw 分支返回需要重启', reply.last.payload, { ok: true, restartRequired: true });
  check('raw 分支先备份', backups, [[sscPath, 'sscconfig.json']]);
  check('raw 分支按 2 空格重排并补换行', fs.readFileSync(sscPath, 'utf8'), '{\n  "Settings": {\n    "Enabled": true\n  }\n}\n');

  await checkThrows(
    'raw 不是合法 JSON 时给出可读提示',
    () => routes[3].handler({ body: { raw: '{bad' } }, {}),
    'JSON 格式错误：Expected property name or \'}\' in JSON at position 1 (line 1 column 2)'
  );

  console.log('4) 文本文件');
  await routes[4].handler({}, {}, new URL('http://x/api/text?name=motd'));
  check('读到原内容', reply.last.payload.content, 'old\r\nline\r\n');
  check('回显 name 与 path', [reply.last.payload.name, reply.last.payload.path], ['motd', motdPath]);
  await checkThrows(
    '不支持的文件名被拒绝',
    () => routes[4].handler({}, {}, new URL('http://x/api/text?name=bogus')),
    '不支持的文件'
  );

  fs.unlinkSync(motdPath);
  await routes[4].handler({}, {}, new URL('http://x/api/text?name=motd'));
  check('文件不存在时返回空内容而不是报错', reply.last.payload.content, '');

  backups.length = 0;
  ensureDirs.length = 0;
  await routes[5].handler({ body: { name: 'motd', content: 'a\r\nb\r\n' } }, {});
  check('CRLF 归一成 LF', fs.readFileSync(motdPath, 'utf8'), 'a\nb\n');
  check('新建文件时不需要备份', backups.length, 0);
  check('写前确保目录存在', ensureDirs, [tshockDir]);

  backups.length = 0;
  await routes[5].handler({ body: { name: 'motd', content: 'c' } }, {});
  check('覆盖已有文件前先备份', backups, [[motdPath, 'motd.txt']]);
  await checkThrows(
    '保存时也校验文件名',
    () => routes[5].handler({ body: { name: 'nope', content: 'x' } }, {}),
    '不支持的文件'
  );

  fs.rmSync(root, { recursive: true, force: true });

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
