'use strict';

/**
 * 插件管理路由：/api/plugins 与其 5 个子接口。
 *
 * 这是后端“按域拆路由”的第一个样板：路由只负责 HTTP 形状（读参数 → 调服务 → 回 JSON），
 * 依赖全部由 server.js 通过 ctx 注入，模块自己不 require server.js（否则就成环了）。
 *
 * 注意：TShock 没有插件热重载 API，这里只做文件层管理 + 需要重启的提示，
 * 所有文案与行为与拆分前逐字一致。
 */

/** 只能通过插件配置入口读取/修改的 tshock 核心配置，禁止在这里改 */
const CORE_CONFIG_FILES = new Set(['config.json', 'sscconfig.json']);

function createPluginRoutes(ctx) {
  const {
    route,
    json,
    fs,
    fsp,
    path,
    pluginDir,
    tshockDir,
    trashDir,
    backupDir,
    ensureDir,
    moveFile,
    timestamp,
    backupConfigFile,
    writeFileAtomic,
    addLog,
    readBody,
    readJsonBody,
    requireRunning,
    restCommand,
    isLive,
  } = ctx;

  function listPluginFiles() {
    if (!fs.existsSync(pluginDir)) return [];
    return fs
      .readdirSync(pluginDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.dll'))
      .map((entry) => {
        const stat = fs.statSync(path.join(pluginDir, entry.name));
        return { name: entry.name, size: stat.size, modified: stat.mtimeMs };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function listPluginConfigs() {
    if (!fs.existsSync(tshockDir)) return [];
    return fs
      .readdirSync(tshockDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .filter((entry) => !CORE_CONFIG_FILES.has(entry.name.toLowerCase()))
      .map((entry) => {
        const stat = fs.statSync(path.join(tshockDir, entry.name));
        return { name: entry.name, size: stat.size, modified: stat.mtimeMs };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function detectApm() {
    // 只有服务器真的在跑，/apm 才有意义
    if (!isLive()) return { detected: false, reason: '服务器未运行' };
    try {
      const output = await restCommand('/apm', 6000);
      const text = output.join('\n');
      if (/指令不存在|命令无效|输入的命令无效/.test(text)) {
        return { detected: false, reason: '未检测到 AutoPluginManager 插件' };
      }
      return { detected: true, output };
    } catch (err) {
      return { detected: false, reason: '检测失败：' + err.message };
    }
  }

  route('GET', /^\/api\/plugins$/, async (req, res) => {
    const plugins = listPluginFiles();
    const configs = listPluginConfigs();
    const apm = await detectApm();
    json(res, 200, { plugins, configs, apm, pluginDir, running: isLive() });
  });

  route('POST', /^\/api\/plugins\/upload$/, async (req, res, url) => {
    let name = path.basename(url.searchParams.get('name') || '');
    if (!name.toLowerCase().endsWith('.dll')) throw new Error('只支持 .dll 插件文件');
    const buf = await readBody(req, 64 * 1024 * 1024);
    if (buf.length < 64) throw new Error('文件内容为空');
    ensureDir(pluginDir);
    const target = path.join(pluginDir, name);
    if (fs.existsSync(target)) {
      ensureDir(path.join(backupDir, 'plugins'));
      fs.copyFileSync(target, path.join(backupDir, 'plugins', `${timestamp()}_${name}`));
    }
    await fsp.writeFile(target, buf);
    addLog('panel', `上传插件：${name}（需重启服务器生效）`);
    json(res, 200, { ok: true, name, needsRestart: true });
  });

  route('POST', /^\/api\/plugins\/delete$/, async (req, res) => {
    const body = await readJsonBody(req);
    const name = path.basename(String(body.name || ''));
    if (!name.toLowerCase().endsWith('.dll')) throw new Error('只能删除 .dll 插件文件');
    const target = path.join(pluginDir, name);
    if (!fs.existsSync(target)) throw new Error('文件不存在');
    ensureDir(path.join(trashDir, 'plugins'));
    moveFile(target, path.join(trashDir, 'plugins', `${timestamp()}_${name}`));
    addLog('panel', `删除插件：${name}（需重启服务器生效）`);
    json(res, 200, { ok: true, needsRestart: true });
  });

  route('GET', /^\/api\/plugins\/config$/, async (req, res, url) => {
    const name = path.basename(url.searchParams.get('name') || '');
    if (!name.toLowerCase().endsWith('.json')) throw new Error('文件名不合法');
    const file = path.join(tshockDir, name);
    if (!fs.existsSync(file)) throw new Error('配置文件不存在');
    json(res, 200, { name, content: await fsp.readFile(file, 'utf8') });
  });

  route('POST', /^\/api\/plugins\/config$/, async (req, res) => {
    const body = await readJsonBody(req);
    const name = path.basename(String(body.name || ''));
    if (!name.toLowerCase().endsWith('.json') || CORE_CONFIG_FILES.has(name.toLowerCase())) {
      throw new Error('这个文件不能通过插件配置入口修改');
    }
    const file = path.join(tshockDir, name);
    if (!fs.existsSync(file)) throw new Error('配置文件不存在');
    let parsed;
    try {
      parsed = JSON.parse(String(body.content || ''));
    } catch (err) {
      throw new Error('JSON 格式错误：' + err.message);
    }
    backupConfigFile(file, name);
    writeFileAtomic(file, JSON.stringify(parsed, null, 2) + '\n');
    addLog('panel', `修改插件配置：${name}`);
    json(res, 200, { ok: true });
  });

  route('POST', /^\/api\/plugins\/apm$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const action = String(body.action || '');
    const index = Number(body.index);
    let command;
    if (action === 'list') command = '/apm -il';
    else if (action === 'on' || action === 'off') {
      if (!Number.isInteger(index) || index < 1) throw new Error('请填写插件序号');
      command = `/apm -${action} ${index}`;
    } else throw new Error('未知操作');
    const output = await restCommand(command);
    json(res, 200, { ok: true, command, output });
  });
}

module.exports = { createPluginRoutes, CORE_CONFIG_FILES };
