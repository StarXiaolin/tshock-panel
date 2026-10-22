'use strict';

/* 外壳：视图切换、标题、侧边栏状态
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 视图切换                                                            */
/* ------------------------------------------------------------------ */

function switchView(name) {
  hideDropdown();
  app.view = name;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  renderShell();
  const loaders = {
    dashboard: loadDashboard,
    console: loadConsole,
    worlds: loadWorlds,
    give: loadGive,
    events: loadEvents,
    warps: loadWarps,
    groups: loadGroups,
    players: loadPlayers,
    plugins: loadPlugins,
    settings: loadSettings,
    backups: loadBackups,
    appearance: loadAppearance,
    help: renderHelp,
  };
  (loaders[name] || (() => {}))();
  $('.content').scrollTop = 0;
}

async function refreshState() {
  try {
    app.state = await api('/api/state');
  } catch (err) {
    setPill('error', '面板连接中断');
    return;
  }
  renderShell();
  if (app.view === 'dashboard') renderDashboard();
  if (app.view === 'players') renderPlayers();
  if (app.view === 'help') renderHelp();
}

function isRunning() {
  return !!(app.state && app.state.server.running);
}

function setPill(mode, text) {
  const pill = $('#pill-status');
  pill.className = 'pill ' + (mode || '');
  $('b', pill).textContent = text;
}

function renderShell() {
  const s = app.state;
  if (!s) return;
  const server = s.server;
  const running = server.running;
  const starting = running && !server.ready;

  let pillMode = running ? 'running' : '';
  let pillText = running ? (server.ready ? '运行中' : '启动中…') : '未运行';
  if (starting) pillMode = 'starting';
  if (s.server.lastError) {
    pillMode = 'error';
    pillText = '异常';
  }
  setPill(pillMode, pillText);

  $('#btn-start').hidden = running;
  $('#btn-stop').hidden = !running;
  $('#btn-restart').hidden = !running;

  const side = $('#side-status');
  side.className = 'mini-status' + (running ? (starting ? ' starting' : ' running') : '');
  $('.mini-title', side).textContent = running ? (starting ? '启动中…' : '运行中') : '未运行';
  $('.mini-sub', side).textContent = running
    ? `${server.worldName || '世界'} · ${s.live?.playercount ?? 0}/${server.maxPlayers} 人`
    : '点击「启动服务器」';

  const titles = {
    dashboard: ['仪表盘', '服务器概况与一键启停'],
    console: ['控制台', '实时日志与命令下发'],
    worlds: ['世界存档', '选择、新建与导入世界'],
    give: ['物品发放', '按玩家发放物品与装备'],
    events: ['世界事件', '陨石、血月、日食、入侵等事件控制'],
    warps: ['传送点', '管理 /warp 传送点与可见性'],
    groups: ['权限管理', '用户组、权限节点与继承关系'],
    players: ['玩家与封禁', '在线监控、封禁、账号与白名单'],
    plugins: ['插件管理', '插件文件与插件配置'],
    settings: ['服务器设置', 'TShock 配置、SSC 与公告'],
    backups: ['备份与还原', '世界与账号数据库快照'],
    appearance: ['外观', '主题、字号与布局密度'],
    help: ['帮助', '使用说明与常见问题'],
  };
  const [title, sub] = titles[app.view] || ['', ''];
  $('#view-title').textContent = title;
  $('#view-sub').textContent = sub;
}
