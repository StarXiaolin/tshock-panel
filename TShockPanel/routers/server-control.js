'use strict';

/**
 * 服务器控制与面板自身状态路由（10 条）：
 *   GET  /api/state          运行状态汇总
 *   GET  /api/events         日志推送（SSE）
 *   GET  /api/logs           日志增量拉取
 *   POST /api/server/start   启动服务器
 *   POST /api/server/stop    停止服务器
 *   POST /api/server/restart 重启服务器
 *   POST /api/console        执行控制台命令
 *   POST /api/open           在资源管理器里打开目录
 *   POST /api/settings/panel 修改面板设置
 *   POST /api/shutdown       退出面板
 *
 * 这些接口都直接动“正在运行的服务器”，是面板里风险最高的一组：
 * 所以进程的启停仍然留在 server.js（下一窗口再抽 lib/process.js），
 * 这里只做 HTTP 形状与参数校验，进程能力通过 ctx 显式注入。
 *
 * 注意：SSE 的心跳定时器与关停的延时退出都通过 ctx 注入，
 * 这样单测可以断言“有没有清掉定时器”，而不是真的等 15 秒。
 */

function createServerControlRoutes(ctx) {
  const {
    route,
    json,
    readJsonBody,
    getState,
    requireRunning,
    restCommand,
    addLog,
    logBuffer,
    sseClients,
    startServer,
    stopServer,
    panelState,
    saveState,
    spawn,
    fs,
    path,
    ensureDir,
    dirs,
    setInterval: setIntervalImpl = setInterval,
    clearInterval: clearIntervalImpl = clearInterval,
    exit,
    scheduleExit = (fn) => setTimeout(fn, 300),
  } = ctx;

  route('GET', /^\/api\/state$/, async (req, res) => {
    json(res, 200, await getState());
  });

  route('GET', /^\/api\/events$/, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    const ping = setIntervalImpl(() => {
      try {
        res.write(': ping\n\n');
      } catch (err) {
        clearIntervalImpl(ping);
      }
    }, 15000);
    req.on('close', () => {
      clearIntervalImpl(ping);
      sseClients.delete(res);
    });
  });

  route('GET', /^\/api\/logs$/, (req, res, url) => {
    const since = Number(url.searchParams.get('since') || 0);
    const limit = Math.min(Number(url.searchParams.get('limit') || 500), 4000);
    const items = logBuffer.items.filter((it) => it.id > since).slice(-limit);
    json(res, 200, { items, nextId: logBuffer.nextId });
  });

  route('POST', /^\/api\/server\/start$/, async (req, res) => {
    const body = await readJsonBody(req);
    const worldPath = body.worldPath || panelState.launch.world;
    if (!worldPath) throw new Error('请先选择一个世界存档。');
    const result = startServer({ mode: 'run', worldPath });
    panelState.launch = { ...panelState.launch, world: path.resolve(worldPath) };
    saveState();
    json(res, 200, result);
  });

  route('POST', /^\/api\/server\/stop$/, async (req, res) => {
    json(res, 200, await stopServer());
  });

  route('POST', /^\/api\/server\/restart$/, async (req, res) => {
    const body = await readJsonBody(req);
    await stopServer();
    startServer({
      mode: 'run',
      worldPath: body.worldPath || panelState.launch.world,
      port: body.port || panelState.launch.port,
      maxPlayers: body.maxPlayers || panelState.launch.maxPlayers,
      password: panelState.launch.password,
    });
    json(res, 200, { ok: true });
  });

  route('POST', /^\/api\/console$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const cmd = String(body.command || '').trim();
    if (!cmd) throw new Error('命令不能为空');
    const normalized = cmd.startsWith('/') ? cmd : '/' + cmd;
    addLog('input', normalized);
    const output = await restCommand(normalized);
    for (const line of output) addLog('output', line);
    json(res, 200, { ok: true, output });
  });

  route('POST', /^\/api\/open$/, async (req, res) => {
    const body = await readJsonBody(req);
    const map = {
      worlds: panelState.worldsDir,
      server: dirs.server,
      tshock: dirs.tshock,
      backups: dirs.backups,
      panel: dirs.panel,
      logs: dirs.logs,
      plugins: dirs.plugins,
    };
    const target = map[body.target];
    if (!target) throw new Error('未知目录');
    ensureDir(target);
    spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    json(res, 200, { ok: true, target });
  });

  route('POST', /^\/api\/settings\/panel$/, async (req, res) => {
    const body = await readJsonBody(req);
    if (body.worldsDir) {
      const dir = path.resolve(String(body.worldsDir));
      if (!fs.existsSync(dir)) throw new Error('目录不存在：' + dir);
      panelState.worldsDir = dir;
    }
    if (body.restPort) {
      const port = Number(body.restPort);
      if (!(port > 1024 && port < 65536)) throw new Error('REST 端口范围不合法');
      panelState.restPort = port;
    }
    if ('backupOnStart' in body) panelState.backupOnStart = !!body.backupOnStart;
    if ('autoRestart' in body) panelState.autoRestart = !!body.autoRestart;
    if (body.launch && typeof body.launch === 'object') {
      panelState.launch = { ...panelState.launch, ...body.launch };
    }
    saveState();
    json(res, 200, { ok: true, state: panelState });
  });

  route('POST', /^\/api\/shutdown$/, async (req, res) => {
    const body = await readJsonBody(req).catch(() => ({}));
    json(res, 200, { ok: true });
    if (body.stopServer) {
      await stopServer({ silent: true });
    }
    scheduleExit(exit);
  });
}

module.exports = { createServerControlRoutes };
