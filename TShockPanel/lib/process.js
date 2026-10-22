'use strict';

/**
 * TShock 服务器进程管理：启动、停止、接管、日志跟踪、就绪判定、自动重启。
 *
 * 这是面板里唯一直接操作进程的模块，原先约 480 行全部内联在 server.js 中间，
 * 没有任何单测——而它恰好是“面板退不出去 / 退了但服务器还在 / 服务器崩了不自动起”
 * 这些问题的唯一来源。拆出来后：
 *  - `spawn`、五个定时器、`now()`、`sleep()` 全部可注入，单测不需要真的起服务器；
 *  - `buildArgs` / `parseUptime` 是纯函数，直接锁住命令行参数与 uptime 解析；
 *  - 面板状态（state）通过 `launch()` / `isAutoRestart()` 等取值器注入，
 *    模块不再引用 server.js 的任何全局变量。
 *
 * 行为与拆分前逐字一致，包括：
 *  - 正式运行时端口与人数以 tshock/config.json 为准，只有生成世界才用调用方端口；
 *  - 服务器输出写进面板 logs/server-<时间戳>.log，再 tail 这个文件转发到日志总线
 *    （这样即使面板窗口被关掉，服务器也不会因为管道断开而退出）；
 *  - 停止顺序：先 REST /exit，等宽限期，再 kill()，最后 taskkill /T 兜底；
 *  - 自动重启只在“曾经就绪过”且开着 autoRestart 时执行，延时 5 秒。
 */

/** 组装 TShock 命令行参数（纯函数，便于单测）。 */
function buildArgs({ mode, worldPath, worldName, port, maxPlayers, password, size, seed }) {
  const args = [];
  if (mode === 'create') {
    args.push('-autocreate', String(size || 1));
    if (worldName) args.push('-worldname', worldName);
    if (seed) args.push('-seed', String(seed));
    args.push('-world', worldPath);
    // 生成世界用的临时服务器跑在独立端口上，避免占用正式端口
    args.push('-port', String(port), '-maxplayers', String(maxPlayers));
  } else {
    // 正式运行时端口与人数一律以 tshock/config.json 的 ServerPort / MaxSlots 为准。
    // 传 -port / -maxplayers 会覆盖配置文件，导致仪表盘与设置页显示不一致。
    args.push('-world', worldPath);
  }
  if (password) args.push('-password', password);
  args.push('-noupnp');
  return args;
}

/** 解析 `/v2/server/status` 的 uptime（形如 "0.00:00:03"）为毫秒。 */
function parseUptime(text) {
  const m = /^(\d+)\.(\d+):(\d+):(\d+)$/.exec(String(text || '').trim());
  if (!m) return 0;
  return ((Number(m[1]) * 24 + Number(m[2])) * 60 + Number(m[3])) * 60 * 1000 + Number(m[4]) * 1000;
}

/** 读 tshock/tshock.pid；读不到或不是数字返回 0。 */
function readPidFile(pidPath, fs) {
  try {
    const raw = fs.readFileSync(pidPath, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : 0;
  } catch (err) {
    return 0;
  }
}

/** 进程是否还活着（信号 0 探测；EPERM 也算活着）。 */
function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * @param {object} deps
 */
function createProcessManager(deps) {
  const {
    // 路径
    exePath,
    serverDir,
    panelDir,
    tshockDir,
    configPath,
    // 基础库与进程
    fs,
    fsp,
    path,
    spawn,
    // 日志与事件
    addLog,
    broadcast,
    makeLineReader,
    decodeLine,
    ANSI_RE,
    // REST
    restOk,
    restCall,
    restCommand,
    // 配置与备份
    readJsonFile,
    ensureRestConfig,
    ensureDir,
    timestamp,
    backupBeforeStart,
    // 面板状态
    getLaunch,
    isAutoRestart,
    isBackupOnStart,
    onWorldCreated,
    // 可注入的时钟（单测用）
    now = () => Date.now(),
    setInterval: setIntervalImpl = setInterval,
    clearInterval: clearIntervalImpl = clearInterval,
    setTimeout: setTimeoutImpl = setTimeout,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = deps;

  /** 当前服务器进程的对外状态；`getState()` 直接读这个对象的字段。 */
  const proc = {
    child: null,
    pid: 0,
    startedAt: 0,
    worldPath: '',
    worldName: '',
    port: 0,
    maxPlayers: 0,
    mode: null, // 'run' | 'create'
    ready: false,
    readySignal: false,
    adopted: false,
    lastError: '',
    exiting: false,
  };

  let readinessTimer = null;
  let restartRequested = false;

  function childAlive() {
    return !!(proc.child && proc.child.exitCode === null && !proc.child.killed);
  }

  async function isRunning() {
    if (childAlive()) return true;
    if (proc.adopted) return await restOk();
    return false;
  }

  function broadcastState() {
    broadcast('state', {
      running: childAlive() || proc.adopted,
      ready: proc.ready,
      mode: proc.mode,
      pid: proc.pid || null,
    });
  }

  /** 面板重启后接管已经在跑的服务器。 */
  async function adoptRunningServer() {
    if (!exePath || !fs.existsSync(exePath)) return;
    if (!(await restOk(1200))) return;
    try {
      const status = await restCall('/v2/server/status', 4000);
      const pid = readPidFile(path.join(tshockDir, 'tshock.pid'), fs);
      proc.adopted = true;
      proc.ready = true;
      proc.pid = pidAlive(pid) ? pid : 0;
      proc.port = Number(status.port) || getLaunch().port;
      proc.maxPlayers = Number(status.maxplayers) || getLaunch().maxPlayers;
      proc.worldName = status.world || '';
      proc.startedAt = now() - parseUptime(status.uptime);
      proc.worldPath = getLaunch().world || '';
      addLog('panel', `已连接正在运行的服务器：${status.world || '未知世界'}（端口 ${proc.port}）`);
      const logFile = newestConsoleLog();
      if (logFile) {
        startConsoleTail(logFile, true);
        addLog('panel', `正在跟踪服务器输出：${path.basename(logFile)}`);
      } else {
        startLogTail();
      }
      broadcastState();
    } catch (err) {
      proc.adopted = false;
    }
  }

  /** 服务器标准输出写入面板 logs 目录下的会话文件，面板通过跟踪文件读取。
   *  这样即使面板窗口被关掉，服务器也不会因为管道断开而退出。 */
  const consoleTail = { file: '', offset: 0, reader: null, timer: null };

  function newestConsoleLog() {
    try {
      const dir = path.join(panelDir, 'logs');
      const files = fs.readdirSync(dir).filter((f) => /^server-.*\.log$/.test(f));
      if (files.length === 0) return '';
      const full = files.map((f) => path.join(dir, f));
      full.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      return full[0];
    } catch (err) {
      return '';
    }
  }

  function startConsoleTail(file, fromEnd = false) {
    stopConsoleTail();
    consoleTail.file = file;
    consoleTail.reader = makeLineReader((line) => {
      addLog('stdout', line);
      if (/服务器已启动|Server started/i.test(line)) proc.readySignal = true;
    });
    if (fromEnd) {
      try {
        consoleTail.offset = Math.max(0, fs.statSync(file).size - 16384);
      } catch (err) {
        consoleTail.offset = 0;
      }
    } else {
      consoleTail.offset = 0;
    }
    consoleTail.timer = setIntervalImpl(tailConsoleOnce, 250);
    tailConsoleOnce();
  }

  function stopConsoleTail() {
    if (consoleTail.timer) clearIntervalImpl(consoleTail.timer);
    consoleTail.timer = null;
    consoleTail.file = '';
    consoleTail.offset = 0;
    consoleTail.reader = null;
  }

  async function tailConsoleOnce() {
    if (!consoleTail.file) return;
    try {
      const st = await fsp.stat(consoleTail.file);
      if (st.size <= consoleTail.offset) return;
      const fh = await fsp.open(consoleTail.file, 'r');
      const len = st.size - consoleTail.offset;
      const buf = Buffer.alloc(Math.min(len, 512 * 1024));
      await fh.read(buf, 0, buf.length, consoleTail.offset);
      await fh.close();
      consoleTail.offset += buf.length;
      consoleTail.reader(buf);
    } catch (err) {
      /* 文件暂时不可读时忽略 */
    }
  }

  /** 外部启动的服务器没有面板日志可选，退回到 tshock/logs 目录。 */
  let tailTimer = null;
  let tailState = { file: '', offset: 0 };

  function startLogTail() {
    if (tailTimer) return;
    tailTimer = setIntervalImpl(tailTick, 1500);
  }

  function stopLogTail() {
    if (tailTimer) clearIntervalImpl(tailTimer);
    tailTimer = null;
    tailState = { file: '', offset: 0 };
  }

  async function tailTick() {
    if (!proc.adopted) return;
    try {
      const files = (await fsp.readdir(path.join(tshockDir, 'logs'))).filter((f) => f.endsWith('.log'));
      if (files.length === 0) return;
      const full = files.map((f) => path.join(tshockDir, 'logs', f));
      const stats = await Promise.all(full.map(async (f) => ({ f, st: await fsp.stat(f) })));
      stats.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
      const newest = stats[0];
      if (tailState.file !== newest.f) {
        tailState.file = newest.f;
        tailState.offset = Math.max(0, newest.st.size - 8192);
      }
      if (newest.st.size < tailState.offset) tailState.offset = 0;
      if (newest.st.size === tailState.offset) return;
      const fh = await fsp.open(newest.f, 'r');
      const length = newest.st.size - tailState.offset;
      const buf = Buffer.alloc(Math.min(length, 256 * 1024));
      await fh.read(buf, 0, buf.length, tailState.offset);
      await fh.close();
      tailState.offset += buf.length;
      const text = decodeLine(buf);
      for (const line of text.split(/\r?\n/)) {
        const clean = line.replace(ANSI_RE, '').trim();
        if (clean) addLog('tshock', clean);
      }
    } catch (err) {
      /* 忽略文件跟踪错误 */
    }
  }

  /** 启动服务器；返回后由 monitorReadiness 异步跟踪就绪状态。 */
  function startServer(params = {}) {
    if (childAlive() || proc.adopted) {
      throw new Error('服务器已经在运行，请先停止。');
    }
    if (!fs.existsSync(exePath)) {
      throw new Error(`找不到服务器程序：${exePath}`);
    }

    const launch = getLaunch();
    const mode = params.mode === 'create' ? 'create' : 'run';
    const worldPath = params.worldPath ? path.resolve(params.worldPath) : '';
    if (!worldPath) throw new Error('请先选择要启动的世界存档。');
    if (mode === 'run' && !fs.existsSync(worldPath)) throw new Error(`世界存档不存在：${worldPath}`);

    // 正式运行时端口、人数、密码都以 tshock/config.json 为准；
    // 只有生成世界用的临时服务器才用调用方指定的端口。
    const cfgSettings = (readJsonFile(configPath, {}) || {}).Settings || {};
    const port = mode === 'create' ? Number(params.port) || launch.port || 7777 : Number(cfgSettings.ServerPort) || 7777;
    const maxPlayers = mode === 'create' ? Number(params.maxPlayers) || 8 : Number(cfgSettings.MaxSlots) || 8;
    const password = mode === 'create' ? params.password || '' : '';
    // 服务器未运行，此时可以安全地确保面板需要的 REST 配置就位。
    try {
      ensureRestConfig();
    } catch (err) {
      addLog('panel', `写入 REST 配置失败：${err.message}`);
    }

    if (isBackupOnStart()) {
      backupBeforeStart(mode === 'run' ? worldPath : '');
    }

    const args = buildArgs({
      mode,
      worldPath,
      worldName: params.worldName,
      port,
      maxPlayers,
      password,
      size: params.size,
      seed: params.seed,
    });

    addLog('panel', `启动服务器：${exePath}`);
    addLog('panel', `参数：${args.join(' ')}`);

    ensureDir(path.join(panelDir, 'logs'));

    const consoleLog = path.join(panelDir, 'logs', `server-${timestamp()}.log`);
    const fd = fs.openSync(consoleLog, 'a');
    let child;
    try {
      child = spawn(exePath, args, {
        cwd: serverDir,
        stdio: ['ignore', fd, fd],
        windowsHide: true,
      });
    } finally {
      try {
        fs.closeSync(fd);
      } catch (err) {
        /* ignore */
      }
    }

    proc.consoleLog = consoleLog;
    proc.child = child;
    proc.pid = child.pid;
    proc.startedAt = now();
    proc.worldPath = worldPath;
    proc.worldName = params.worldName || path.basename(worldPath, '.wld');
    proc.port = port;
    proc.maxPlayers = maxPlayers;
    proc.mode = mode;
    proc.ready = false;
    proc.readySignal = false;
    proc.adopted = false;
    proc.lastError = '';
    proc.exiting = false;
    stopLogTail();
    startConsoleTail(consoleLog);

    child.on('error', (err) => {
      proc.lastError = err.message;
      addLog('panel', `启动失败：${err.message}`);
    });

    child.on('exit', (code, signal) => {
      const wasCreating = proc.mode === 'create';
      const wasReady = proc.ready;
      addLog('panel', `服务器进程已退出（代码 ${code === null ? signal : code}）。`);
      proc.child = null;
      proc.ready = false;
      proc.pid = 0;
      proc.mode = null;
      proc.exiting = false;
      // 把缓冲区里最后几行读出来再停止跟踪
      const fileAtExit = consoleTail.file;
      setTimeoutImpl(async () => {
        if (consoleTail.file !== fileAtExit) return;
        await tailConsoleOnce();
        if (consoleTail.file === fileAtExit) stopConsoleTail();
      }, 400);
      broadcastState();

      if (!wasReady) {
        const codeText = code === null ? signal : code;
        let msg = wasCreating ? `创建世界失败（退出码 ${codeText}）。` : `服务器启动失败（退出码 ${codeText}）。`;
        if (code === 3221225725) {
          msg += ' TShock 在生成世界时发生栈溢出，通常是种子导致的，请换一个种子或更小的世界尺寸再试。';
        } else {
          msg += ' 详情见控制台日志。';
        }
        proc.lastError = msg;
        broadcast('notice', { level: 'error', text: msg });
      }

      if (isAutoRestart() && wasReady && !restartRequested) {
        restartRequested = false;
        const launch = getLaunch();
        addLog('panel', '自动重启：5 秒后重新拉起服务器。');
        setTimeoutImpl(() => {
          try {
            startServer({
              mode: 'run',
              worldPath: proc.worldPath || launch.world,
              port: proc.port || launch.port,
              maxPlayers: proc.maxPlayers || launch.maxPlayers,
              password: launch.password,
            });
          } catch (err) {
            addLog('panel', `自动重启失败：${err.message}`);
          }
        }, 5000);
      }
    });

    monitorReadiness(child, mode);
    broadcastState();
    return { ok: true, pid: child.pid };
  }

  function monitorReadiness(child, mode) {
    const started = now();
    const timeout = mode === 'create' ? 30 * 60 * 1000 : 8 * 60 * 1000;
    if (readinessTimer) clearIntervalImpl(readinessTimer);

    readinessTimer = setIntervalImpl(() => {
      if (proc.child !== child) {
        clearIntervalImpl(readinessTimer);
        readinessTimer = null;
        return;
      }
      if (child.exitCode !== null) {
        clearIntervalImpl(readinessTimer);
        readinessTimer = null;
        return;
      }
      if (now() - started > timeout) {
        addLog('panel', '等待服务器就绪超时。');
        clearIntervalImpl(readinessTimer);
        readinessTimer = null;
        return;
      }
      if (!proc.readySignal) return;

      clearIntervalImpl(readinessTimer);
      readinessTimer = null;
      proc.ready = true;
      proc.lastError = '';
      addLog('panel', '服务器已就绪。');
      broadcastState();
      if (mode === 'create') {
        addLog('panel', '新世界已生成，正在关闭临时服务器…');
        if (proc.worldPath) onWorldCreated(proc.worldPath);
        broadcast('notice', { level: 'ok', text: `世界「${path.basename(proc.worldPath || '', '.wld')}」创建完成` });
        setTimeoutImpl(() => {
          stopServer({ silent: true }).catch(() => {});
        }, 2500);
      }
    }, 400);
  }

  async function waitUntil(fn, timeoutMs, stepMs = 300) {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (await fn()) return true;
      await sleep(stepMs);
    }
    return false;
  }

  async function stopServer(options = {}) {
    const running = childAlive() || proc.adopted;
    if (!running) return { ok: true, already: true };

    if (!options.silent) addLog('panel', '正在停止服务器…');

    const canRest = await restOk(1200);
    if (canRest) {
      try {
        await restCommand('/exit');
      } catch (err) {
        addLog('panel', `通过 REST 关闭失败：${err.message}`);
      }
    } else {
      addLog('panel', 'REST 接口暂不可用，将直接结束服务器进程。');
    }

    // 正常退出需要时间保存世界；还没就绪的服务器则不用等太久
    const grace = canRest ? (proc.ready ? 90000 : 20000) : 4000;
    let stopped = await waitUntil(async () => !childAlive() && !(await isRunning()), grace, 400);
    if (!stopped && proc.child) {
      addLog('panel', '服务器未在预期时间内退出，发送终止信号。');
      try {
        proc.child.kill();
      } catch (err) {
        /* ignore */
      }
      stopped = await waitUntil(() => !childAlive(), 15000, 300);
    }
    if (proc.child && childAlive()) {
      try {
        spawn('taskkill', ['/PID', String(proc.pid), '/F', '/T'], { windowsHide: true, stdio: 'ignore' });
      } catch (err) {
        /* ignore */
      }
      await waitUntil(() => !childAlive(), 10000, 300);
    }

    proc.adopted = false;
    proc.ready = false;
    stopLogTail();
    stopConsoleTail();
    try {
      ensureRestConfig();
    } catch (err) {
      /* ignore */
    }
    broadcastState();
    return { ok: true };
  }

  return { proc, childAlive, isRunning, startServer, stopServer, adoptRunningServer, broadcastState };
}

module.exports = {
  createProcessManager,
  buildArgs,
  parseUptime,
  readPidFile,
  pidAlive,
};
