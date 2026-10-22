'use strict';

/**
 * routers/plugins.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * 用一个假的 route() 收集注册结果，再直接调用 handler，检查：
 *   1. 6 条路由的 method + 正则与拆分前完全一致（路径变了前端就 404）；
 *   2. GET /api/plugins 的响应字段与拆分前一致；
 *   3. POST /api/plugins/config 对 config.json / sscconfig.json 的拦截仍然生效；
 *   4. POST /api/plugins/upload 对非 .dll / 空文件仍然报同样的错。
 *
 * 用法：node tools/routers-plugins.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPluginRoutes, CORE_CONFIG_FILES } = require('../TShockPanel/routers/plugins');

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-router-'));
const pluginDir = path.join(root, 'ServerPlugins');
const tshockDir = path.join(root, 'tshock');
fs.mkdirSync(pluginDir, { recursive: true });
fs.mkdirSync(tshockDir, { recursive: true });
fs.writeFileSync(path.join(pluginDir, 'Demo.dll'), Buffer.alloc(128, 1));
fs.writeFileSync(path.join(pluginDir, 'notes.txt'), 'x');
fs.writeFileSync(path.join(tshockDir, 'config.json'), '{}');
fs.writeFileSync(path.join(tshockDir, 'VeinMiner.json'), '{"a":1}');

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });
const reply = { last: null };

createPluginRoutes({
  route,
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  fs,
  fsp: fs.promises,
  path,
  pluginDir,
  tshockDir,
  trashDir: path.join(root, 'trash'),
  backupDir: path.join(root, 'backups'),
  ensureDir: (d) => fs.mkdirSync(d, { recursive: true }),
  moveFile: (a, b) => fs.renameSync(a, b),
  timestamp: () => '2026-10-20_190000',
  backupConfigFile: () => {},
  writeFileAtomic: (file, data) => fs.writeFileSync(file, data),
  addLog: () => {},
  readBody: async () => Buffer.alloc(0),
  readJsonBody: async (req) => req.body || {},
  requireRunning: () => {},
  restCommand: async () => [],
  isLive: () => false,
});

(async () => {
  console.log('1) 路由注册');
  check('注册 6 条', routes.length, 6);
  check(
    'method + 路径与拆分前一致',
    routes.map((r) => `${r.method} ${r.pattern.source}`),
    [
      'GET ^\\/api\\/plugins$',
      'POST ^\\/api\\/plugins\\/upload$',
      'POST ^\\/api\\/plugins\\/delete$',
      'GET ^\\/api\\/plugins\\/config$',
      'POST ^\\/api\\/plugins\\/config$',
      'POST ^\\/api\\/plugins\\/apm$',
    ]
  );

  const getPlugins = routes[0].handler;
  const res = {};

  console.log('2) GET /api/plugins');
  await getPlugins({}, res);
  check('只列 .dll', reply.last.payload.plugins.map((p) => p.name), ['Demo.dll']);
  check('只列非核心 json', reply.last.payload.configs.map((p) => p.name), ['VeinMiner.json']);
  check('未运行时 apm 未检测', reply.last.payload.apm.detected, false);
  check('apm 原因文案', reply.last.payload.apm.reason, '服务器未运行');
  check('running 为 false', reply.last.payload.running, false);
  check('pluginDir 原样返回', reply.last.payload.pluginDir, pluginDir);

  console.log('3) 配置守卫');
  check('CORE_CONFIG_FILES 内容', [...CORE_CONFIG_FILES].sort(), ['config.json', 'sscconfig.json']);
  await checkThrows(
    'config.json 被拦截',
    () => routes[4].handler({ body: { name: 'config.json', content: '{}' } }, res),
    '这个文件不能通过插件配置入口修改'
  );
  await checkThrows(
    '非 json 被拦截',
    () => routes[4].handler({ body: { name: 'a.txt', content: '{}' } }, res),
    '这个文件不能通过插件配置入口修改'
  );

  console.log('4) 上传校验');
  await checkThrows(
    '非 .dll 被拒绝',
    () => routes[1].handler({}, res, new URL('http://x/api/plugins/upload?name=a.txt')),
    '只支持 .dll 插件文件'
  );
  await checkThrows(
    '空文件被拒绝',
    () => routes[1].handler({}, res, new URL('http://x/api/plugins/upload?name=a.dll')),
    '文件内容为空'
  );

  fs.rmSync(root, { recursive: true, force: true });

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
