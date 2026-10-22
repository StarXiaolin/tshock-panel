'use strict';

/**
 * 配置与文本文件路由（6 条）：config.json、sscconfig.json、motd/rules/whitelist。
 *
 * 这一组路由原本在 server.js 里直接引用 CONFIG_PATH / SSC_PATH / TEXT_FILES，
 * 搬到模块后路径与“写前先备份”的策略都通过 ctx 注入，路由本身不知道任何绝对路径。
 *
 * 行为保持不变：
 *  - 保存前一定先备份（配置文件与文本文件同一策略）；
 *  - sscconfig 允许直接交原始 JSON 文本，格式错误报“JSON 格式错误：…”并提示要重启；
 *  - 文本文件写入时 CRLF 归一成 LF（避免 Windows 换行污染）。 
 */

function createConfigRoutes(ctx) {
  const {
    route,
    json,
    readJsonBody,
    fsp,
    fs,
    path,
    ensureDir,
    writeFileAtomic,
    backupConfigFile,
    configStore,
    textFiles,
    sscPath,
  } = ctx;

  route('GET', /^\/api\/config$/, async (req, res) => {
    json(res, 200, configStore.getConfig());
  });

  route('POST', /^\/api\/config$/, async (req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, configStore.saveConfig(body.settings, body.raw));
  });

  route('GET', /^\/api\/sscconfig$/, async (req, res) => {
    json(res, 200, configStore.getSsc());
  });

  route('POST', /^\/api\/sscconfig$/, async (req, res) => {
    const body = await readJsonBody(req);
    if (typeof body.raw === 'string') {
      let parsed;
      try {
        parsed = JSON.parse(body.raw);
      } catch (err) {
        throw new Error('JSON 格式错误：' + err.message);
      }
      backupConfigFile(sscPath, 'sscconfig.json');
      writeFileAtomic(sscPath, JSON.stringify(parsed, null, 2) + '\n');
      json(res, 200, { ok: true, restartRequired: true });
      return;
    }
    json(res, 200, configStore.saveSsc(body.settings));
  });

  route('GET', /^\/api\/text$/, async (req, res, url) => {
    const name = url.searchParams.get('name');
    const file = textFiles[name];
    if (!file) throw new Error('不支持的文件');
    let content = '';
    try {
      content = await fsp.readFile(file, 'utf8');
    } catch (err) {
      content = '';
    }
    json(res, 200, { name, content, path: file });
  });

  route('POST', /^\/api\/text$/, async (req, res) => {
    const body = await readJsonBody(req);
    const file = textFiles[body.name];
    if (!file) throw new Error('不支持的文件');
    ensureDir(path.dirname(file));
    // 写入前先备份原文件，和配置文件同样的策略
    if (fs.existsSync(file)) backupConfigFile(file, path.basename(file));
    writeFileAtomic(file, String(body.content ?? '').replace(/\r\n/g, '\n'));
    json(res, 200, { ok: true });
  });
}

module.exports = { createConfigRoutes };
