'use strict';

/**
 * `/api/state` 的响应装配。
 *
 * 这一个对象是前端的唯一真相来源：仪表盘、顶栏、设置页都读它。原先它是 server.js
 * 里 66 行的内联函数，直接引用 proc / state / 路径常量 / 配置文件——既没法单测，
 * 也很难回答“加一个字段要动几处”。现在装配逻辑集中在这里，靠注入取值：
 *  - proc 与面板状态仍是外面的同一批对象（只读访问，不做缓存）；
 *  - REST 调用与文件读取可替换，测试不需要真起服务器；
 *  - `now()` 可注入，uptime 断言不会因毫秒漂移偶发失败。
 *
 * 行为与拆分前一致，包括：服务器没跑时 live=null、players=[]、rest.ok=false；
 * 读不到 setup-code.txt 时给空字符串而不是报错。
 */

function createStateView(deps) {
  const {
    version,
    proc,
    isRunning,
    restCall,
    readJsonFile,
    configPath,
    fsp,
    path,
    tshockDir,
    serverDir,
    panelDir,
    backupDir,
    getPanelState,
    now = () => Date.now(),
  } = deps;

  async function build() {
    const running = await isRunning();
    let live = null;
    let players = [];

    if (running) {
      try {
        live = await restCall('/v2/server/status', 3000);
      } catch (err) {
        live = null;
      }
      try {
        const res = await restCall('/v2/players/list', 3000);
        players = Array.isArray(res.players) ? res.players : [];
      } catch (err) {
        players = [];
      }
    }

    let setupCode = '';
    try {
      setupCode = (await fsp.readFile(path.join(tshockDir, 'setup-code.txt'), 'utf8')).trim();
    } catch (err) {
      setupCode = '';
    }

    const state = getPanelState();
    const config = readJsonFile(configPath, {}) || {};
    const settings = config.Settings || {};

    return {
      version,
      now: now(),
      server: {
        running,
        ready: proc.ready,
        adopted: proc.adopted,
        mode: proc.mode,
        pid: proc.pid || null,
        startedAt: proc.startedAt || null,
        uptimeMs: proc.startedAt ? now() - proc.startedAt : 0,
        worldPath: proc.worldPath || state.launch.world || '',
        worldName: proc.worldName || '',
        port: proc.port || state.launch.port,
        maxPlayers: proc.maxPlayers || state.launch.maxPlayers,
        lastError: proc.lastError,
      },
      live,
      players,
      setupCode,
      paths: {
        serverDir,
        panelDir,
        worldsDir: state.worldsDir,
        tshockDir,
        backupsDir: backupDir,
        logsDir: path.join(tshockDir, 'logs'),
      },
      launch: state.launch,
      config: {
        maxSlots: Number(settings.MaxSlots) || 8,
        serverPort: Number(settings.ServerPort) || 7777,
        hasPassword: !!settings.ServerPassword,
      },
      rest: { port: state.restPort, ok: running ? live !== null : false },
      backupOnStart: state.backupOnStart,
      autoRestart: state.autoRestart,
    };
  }

  return { build };
}

module.exports = { createStateView };
