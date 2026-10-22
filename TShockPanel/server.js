'use strict';

/**
 * TShock 图形化管理面板 —— 本地服务端。
 *
 * 设计要点：
 *  - 零第三方依赖，只用 Node 内置模块，双击启动即可。
 *  - 通过子进程拉起 TShock.Server.exe，实时接管它的标准输出。
 *  - 命令下发与在线玩家/封禁等信息走 TShock 自带的 REST 接口
 *    （无 TTY 时 TShock 不读取标准输入，因此不能直接往 stdin 写命令）。
 *  - 所有改动都会自动备份，配置文件写入采用“临时文件 + 替换”避免写坏。
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { readWorldInfo, sanitizeFileName } = require('./lib/worlds');
const { createConfigStore } = require('./lib/tshock-config');
const { createRestClient } = require('./lib/rest');
const { createLogBus, decodeLine, makeLineReader, ANSI_RE } = require('./lib/logbus');
const { createItemService } = require('./lib/items');
const { createItemRoutes } = require('./routers/items');
const { createSscRoutes } = require('./routers/ssc');
const { createEventDiscovery, createWorldEventService } = require('./lib/world-events');
const { createWorldEventRoutes } = require('./routers/world-events');
const { createServerControlRoutes } = require('./routers/server-control');
const { createStaticFiles } = require('./lib/static-files');
const { createProcessManager } = require('./lib/process');
const { createStateView } = require('./lib/state-view');
const { createPanelState } = require('./lib/panel-state');
const { createHttpUtils } = require('./lib/http-utils');
const { listenWithFallback } = require('./lib/listen');
const { createBackupService } = require('./lib/backups');
const { createWorldStore } = require('./lib/worlds-store');
const { createPluginRoutes } = require('./routers/plugins');
const { createBackupRoutes } = require('./routers/backups');
const { createWorldRoutes } = require('./routers/worlds');
const { createWarpsDb } = require('./lib/warps-db');
const { createWarpRoutes } = require('./routers/warps');
const { createGroupService } = require('./lib/groups');
const { createGroupRoutes } = require('./routers/groups');
const { createPlayerService } = require('./lib/players');
const { createPlayerRoutes } = require('./routers/players');
const { createConfigRoutes } = require('./routers/config');
const { createUiState } = require('./lib/ui-state');
const { createUiRoutes } = require('./routers/ui');
const {
  writeFileAtomic,
  moveFile,
  readJsonFile,
  timestamp,
  ensureDir,
} = require('./lib/files');
const {
  PERMISSION_GROUPS,
  EVENT_META,
  INVASION_META,
  RAIN_META,
  eventPermission,
} = require('./lib/catalog');

const VERSION = '1.0.1';

const PANEL_DIR = __dirname;
const SERVER_DIR = path.resolve(PANEL_DIR, '..');
const PUBLIC_DIR = path.join(PANEL_DIR, 'public');
const STATE_PATH = path.join(PANEL_DIR, 'panel.json');
const BACKUP_DIR = path.join(PANEL_DIR, 'backups');
const CONFIG_BACKUP_DIR = path.join(BACKUP_DIR, 'config');
const TRASH_DIR = path.join(PANEL_DIR, 'trash');
const TSHOCK_DIR = path.join(SERVER_DIR, 'tshock');
const WHITELIST_FILE = path.join(TSHOCK_DIR, 'whitelist.txt');
const EXE_PATH = path.join(SERVER_DIR, 'TShock.Server.exe');
const CONFIG_PATH = path.join(TSHOCK_DIR, 'config.json');
const SSC_PATH = path.join(TSHOCK_DIR, 'sscconfig.json');

const TEXT_FILES = {
  motd: path.join(TSHOCK_DIR, 'motd.txt'),
  rules: path.join(TSHOCK_DIR, 'rules.txt'),
  whitelist: WHITELIST_FILE,
};

// ---------------------------------------------------------------------------
// 面板配置
// ---------------------------------------------------------------------------

// 面板设置（实现在 lib/panel-state.js：默认值、合并、令牌、保存）
const panelState = createPanelState({
  statePath: STATE_PATH,
  fs,
  crypto,
  path,
  os,
  writeFileAtomic,
});

const state = panelState.load();

function saveState() {
  panelState.save(state);
}

// tshock/*.json 的读写全部收敛在 lib/tshock-config.js；
// 这里只负责把“路径 + 面板状态”注入进去，然后沿用原来的函数名，调用点零改动。
const {
  backupFile: backupConfigFile,
  ensureRestConfig,
  getConfig,
  saveConfig,
  getSsc,
  saveSsc,
} = createConfigStore({
  configPath: CONFIG_PATH,
  sscPath: SSC_PATH,
  backupDir: CONFIG_BACKUP_DIR,
  getRestPort: () => state.restPort,
  getRestToken: () => state.restToken,
  log: (text) => addLog('panel', text),
});

// ---------------------------------------------------------------------------
// 日志缓冲与事件推送（实现在 lib/logbus.js）
// ---------------------------------------------------------------------------

const { logBuffer, sseClients, addLog, broadcast, queueLogUpdate } = createLogBus();

// ---------------------------------------------------------------------------
// 服务器进程
// ---------------------------------------------------------------------------

// --- REST ------------------------------------------------------------------
// 实现在 lib/rest.js；这里只注入端口与令牌，并沿用原函数名，调用点零改动。

const {
  get: restGet,
  ok: restOk,
  call: restCall,
  command: restCommand,
} = createRestClient({
  getPort: () => state.restPort,
  getToken: () => state.restToken,
});

// --- 服务器进程 --------------------------------------------------------------
// 实现在 lib/process.js：启停、双 tail、就绪监控、自动重启、接管已运行的服务器。
// 这里只注入路径、日志总线、REST 与面板状态取值器；proc 仍是同一个对象引用，
// getState() 读它、路由层判断运行状态也读它。

const {
  proc,
  childAlive,
  isRunning,
  startServer,
  stopServer,
  adoptRunningServer,
} = createProcessManager({
  exePath: EXE_PATH,
  serverDir: SERVER_DIR,
  panelDir: PANEL_DIR,
  tshockDir: TSHOCK_DIR,
  configPath: CONFIG_PATH,
  fs,
  fsp,
  path,
  spawn,
  addLog,
  broadcast,
  makeLineReader,
  decodeLine,
  ANSI_RE,
  restOk,
  restCall,
  restCommand,
  readJsonFile,
  ensureRestConfig,
  ensureDir,
  timestamp,
  backupBeforeStart: (worldPath) => {
    createBackup({ reason: '启动前自动备份', worldPath }).catch(() => {});
  },
  getLaunch: () => state.launch,
  isAutoRestart: () => state.autoRestart,
  isBackupOnStart: () => state.backupOnStart,
  onWorldCreated: (worldPath) => {
    state.launch.world = worldPath;
    saveState();
  },
});

// ---------------------------------------------------------------------------
// 配置读写（实现已下沉到 lib/tshock-config.js，本文件只在上方注入依赖）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 世界存档（实现在 lib/worlds-store.js）
// ---------------------------------------------------------------------------

const worldStore = createWorldStore({
  getWorldsDir: () => state.worldsDir,
  serverDir: SERVER_DIR,
  trashDir: TRASH_DIR,
  getCurrentWorld: () => proc.worldPath || '',
  getSelectedWorld: () => state.launch.world || '',
  getMaxPlayers: () => state.launch.maxPlayers,
  isRunning,
  startServer,
  readWorldInfo,
  sanitizeFileName,
  moveFile,
  timestamp,
});

// 路由已迁到 routers/worlds.js，这里只在上面保留 worldStore 实例供其注入

// ---------------------------------------------------------------------------
// 备份（实现在 lib/backups.js）
// ---------------------------------------------------------------------------

const backupService = createBackupService({
  backupDir: BACKUP_DIR,
  tshockDir: TSHOCK_DIR,
  configPath: CONFIG_PATH,
  sscPath: SSC_PATH,
  readWorldInfo,
  sanitizeFileName,
  isRunning,
  getLaunchWorld: () => state.launch.world,
  log: (text) => addLog('panel', text),
});

// 启动前自动备份会用到 create；其余三条已迁到 routers/backups.js，这里不再保留别名
const createBackup = backupService.create;

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------

// HTTP 基础工具（实现在 lib/http-utils.js）：回 JSON、读体、运行时检查
const { json, readBody, readJsonBody, requireRunning } = createHttpUtils({
  isRunning: () => !!(childAlive() || proc.adopted),
});

// ---------------------------------------------------------------------------
// 状态汇总
// ---------------------------------------------------------------------------

// /api/state 的响应装配（实现在 lib/state-view.js）
const stateView = createStateView({
  version: VERSION,
  proc,
  isRunning,
  restCall,
  readJsonFile,
  configPath: CONFIG_PATH,
  fsp,
  path,
  tshockDir: TSHOCK_DIR,
  serverDir: SERVER_DIR,
  panelDir: PANEL_DIR,
  backupDir: BACKUP_DIR,
  getPanelState: () => state,
});

async function getState() {
  return stateView.build();
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

// 服务器控制与面板状态路由（实现见 routers/server-control.js）
// 进程启停仍是 server.js 的能力，这里只把能力注入给路由层。
createServerControlRoutes({
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
  panelState: state,
  saveState,
  spawn,
  fs,
  path,
  ensureDir,
  dirs: {
    server: SERVER_DIR,
    tshock: TSHOCK_DIR,
    backups: BACKUP_DIR,
    panel: PANEL_DIR,
    logs: path.join(TSHOCK_DIR, 'logs'),
    plugins: path.join(SERVER_DIR, 'ServerPlugins'),
  },
  exit: () => process.exit(0),
});

// 世界存档路由（实现见 routers/worlds.js，底层逻辑在 lib/worlds-store.js）
createWorldRoutes({
  route,
  json,
  readBody,
  readJsonBody,
  fs,
  fsp,
  path,
  worlds: worldStore,
  getWorldsDir: () => state.worldsDir,
  getSelectedWorld: () => state.launch.world,
  selectWorld: (resolved) => {
    state.launch.world = resolved;
    saveState();
    return state.launch.world;
  },
  sanitizeFileName,
  readWorldInfo,
});

// 配置与文本文件路由：/api/config、/api/sscconfig、/api/text（实现见 routers/config.js）
createConfigRoutes({
  route,
  json,
  readJsonBody,
  fsp,
  fs,
  path,
  ensureDir,
  writeFileAtomic,
  backupConfigFile,
  configStore: { getConfig, saveConfig, getSsc, saveSsc },
  textFiles: TEXT_FILES,
  sscPath: SSC_PATH,
});

// 用户组服务先建：玩家路由里的“改账户所属组”要校验组是否存在。
// 路由注册仍在下面（见 createGroupRoutes），这里只是把实例提前。
const groupService = createGroupService({
  restCall,
  restCommand,
  addLog,
});

// 玩家/封禁/账户路由（实现见 routers/players.js，纯逻辑在 lib/players.js）
const playerService = createPlayerService({ restCall });

createPlayerRoutes({
  route,
  json,
  readJsonBody,
  requireRunning,
  restCall,
  restCommand,
  addLog,
  players: playerService,
  groups: groupService,
});

// 备份路由（实现见 routers/backups.js，底层逻辑在 lib/backups.js）
createBackupRoutes({
  route,
  json,
  readJsonBody,
  backups: backupService,
  backupDir: BACKUP_DIR,
  getLaunchWorld: () => state.launch.world,
});

// ---------------------------------------------------------------------------
// 物品（发放 / 查询）
// ---------------------------------------------------------------------------

const ITEMS_PATH = path.join(PANEL_DIR, 'data', 'items.json');

// 物品库实例只建一次：查询接口与 SSC 初始物品校验共用同一份缓存。
const itemService = createItemService({ itemsPath: ITEMS_PATH });
const findItem = itemService.find;

// 物品路由：/api/items、/api/items/give（实现见 routers/items.js）
createItemRoutes({
  route,
  json,
  readJsonBody,
  requireRunning,
  restCommand,
  addLog,
  items: itemService,
  players: playerService,
});

// ---------------------------------------------------------------------------
// 用户组与权限
// ---------------------------------------------------------------------------

// 用户组路由：/api/groups、/api/groups/*、/api/group-names（实现见 routers/groups.js）
createGroupRoutes({
  route,
  json,
  readJsonBody,
  requireRunning,
  groups: groupService,
  catalog: PERMISSION_GROUPS,
});

// ---------------------------------------------------------------------------
// 世界事件
// ---------------------------------------------------------------------------

const eventDiscovery = createEventDiscovery({
  restCommand,
  meta: { EVENT_META, INVASION_META, RAIN_META, eventPermission },
});

const worldEvents = createWorldEventService({
  restCall,
  restCommand,
  addLog,
  discovery: eventDiscovery,
});

// 世界事件路由：/api/world-events、/api/world-events/trigger（实现见 routers/world-events.js）
createWorldEventRoutes({
  route,
  json,
  readJsonBody,
  requireRunning,
  events: worldEvents,
});

// ---------------------------------------------------------------------------
// SSC 初始物品
// ---------------------------------------------------------------------------

// SSC 初始物品路由：GET/POST /api/ssc/inventory（校验在 lib/ssc-inventory.js）
createSscRoutes({
  route,
  json,
  readJsonBody,
  readJsonFile,
  writeFileAtomic,
  backupConfigFile,
  addLog,
  sscPath: SSC_PATH,
  findItem,
});

// ---------------------------------------------------------------------------
// 传送点（Warps）
//
// 读取：TShock 没有提供 Warp 的 REST 接口，且 /warp list 不显示隐藏的传送点，
//       所以这里用 node:sqlite 以只读方式读 tshock.sqlite 的 Warps 表。
// 修改：隐藏/删除/发送玩家都走 TShock 自己的命令，保证它内存里的缓存同步。
// 新增：TShock 只支持 /warp add <名字>（位置取执行者坐标），无法指定坐标；
//       所以新增是直接 INSERT 一行，并提示“需要重启服务器才会被加载”。
// ---------------------------------------------------------------------------
// 传送点（库访问在 lib/warps-db.js，路由在 routers/warps.js）
// ---------------------------------------------------------------------------

const warpsDb = createWarpsDb({
  tshockDir: TSHOCK_DIR,
  backupDir: BACKUP_DIR,
  getWorldFile: () => proc.worldPath || state.launch.world,
  readWorldInfo,
  ensureDir,
  timestamp,
  log: (text) => addLog('panel', text),
});

createWarpRoutes({
  route,
  json,
  readJsonBody,
  requireRunning,
  restCommand,
  addLog,
  warpsDb,
  isLive: () => !!(childAlive() || proc.adopted),
});

// ---------------------------------------------------------------------------
// 插件管理
//
// 重要：TShock 核心没有提供运行时热重载/卸载单个插件的接口。
// 插件 DLL 在服务器启动时加载，因此新增、删除插件文件都必须重启服务器才生效。
// 这里只做文件层面的管理，不会调用任何不存在的 TShock.Plugins.* API。
// ---------------------------------------------------------------------------

const PLUGIN_DIR = path.join(SERVER_DIR, 'ServerPlugins');
const UI_STATE_PATH = path.join(PANEL_DIR, 'dsh.ui.json');

// 插件管理路由：/api/plugins 及其子接口（实现见 routers/plugins.js）
createPluginRoutes({
  route,
  json,
  fs,
  fsp,
  path,
  pluginDir: PLUGIN_DIR,
  tshockDir: TSHOCK_DIR,
  trashDir: TRASH_DIR,
  backupDir: BACKUP_DIR,
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
  isLive: () => !!(childAlive() || proc.adopted),
});

// ---------------------------------------------------------------------------
// 面板外观偏好（只写面板自己的文件，不碰 tshock/）
// ---------------------------------------------------------------------------

const uiState = createUiState({
  uiStatePath: UI_STATE_PATH,
  readJsonFile,
  writeFileAtomic,
});

// 面板外观偏好路由：GET/POST /api/ui（实现见 routers/ui.js）
createUiRoutes({ route, json, readJsonBody, uiState });

// ---------------------------------------------------------------------------
// 静态文件
// ---------------------------------------------------------------------------

// 静态文件服务：public/ 下的前端资源（实现在 lib/static-files.js）
const staticFiles = createStaticFiles({ publicDir: PUBLIC_DIR, fs, fsp, path });

// ---------------------------------------------------------------------------
// 服务器
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = r.pattern.exec(pathname);
        if (!match) continue;
        await r.handler(req, res, url);
        return;
      }
      json(res, 404, { error: '接口不存在' });
      return;
    }
    await staticFiles.serve(req, res, pathname);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (!res.headersSent) json(res, 400, { error: message });
    else {
      try {
        res.end();
      } catch (e) {
        /* ignore */
      }
    }
    if (pathname.startsWith('/api/') && !/服务器没有运行/.test(message)) {
      addLog('panel', `请求失败 ${pathname}：${message}`);
    }
  } finally {
    const cost = Date.now() - started;
    if (cost > 3000) addLog('panel', `请求 ${pathname} 耗时 ${cost}ms`);
  }
});

function openBrowser(url) {
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '""', url], { windowsHide: true, detached: true, stdio: 'ignore' });
    child.unref();
  } catch (err) {
    /* ignore */
  }
}

async function main() {
  ensureDir(BACKUP_DIR);
  ensureDir(CONFIG_BACKUP_DIR);
  ensureDir(TRASH_DIR);
  ensureDir(path.join(PANEL_DIR, 'logs'));

  // 服务器未运行时先把 REST 配置准备好
  const rest = ensureRestConfig();
  if (!rest.ok) addLog('panel', `提示：${rest.reason}`);

  await adoptRunningServer();

  const desiredPort = Number(state.panelPort) || 13087;
  const port = await listenWithFallback(server, desiredPort);
  // 端口被占用时只是临时顺延，不改写用户配置的端口，避免下次启动越飘越远
  if (port !== desiredPort) addLog('panel', `端口 ${desiredPort} 被占用，本次临时使用 ${port}`);
  saveState();

  const url = `http://127.0.0.1:${port}`;
  console.log('');
  console.log('  TShock 管理面板已启动');
  console.log(`  地址：${url}`);
  console.log(`  服务器目录：${SERVER_DIR}`);
  console.log('  请在这个窗口按 Ctrl+C 退出面板（会先保存并停止服务器）。');
  console.log('');

  if (!process.argv.includes('--no-open')) openBrowser(url);
}

let shuttingDown = false;

async function gracefulExit(stopServerToo) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n正在关闭面板…');
  if (stopServerToo && (childAlive() || proc.adopted)) {
    console.log('  正在保存并停止服务器，请稍候…');
    try {
      await stopServer({ silent: true });
    } catch (err) {
      console.error('  停止服务器失败：', err.message);
    }
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  gracefulExit(true);
});

process.on('SIGTERM', () => {
  gracefulExit(true);
});

process.on('uncaughtException', (err) => {
  console.error('未捕获异常：', err);
  try {
    addLog('panel', `内部错误：${err.message}`);
  } catch (e) {
    /* ignore */
  }
});

main().catch((err) => {
  console.error('面板启动失败：', err);
  process.exit(1);
});


