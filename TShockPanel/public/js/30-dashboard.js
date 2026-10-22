'use strict';

/* 仪表盘：运行状态、启停控制、在线玩家、实时日志
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 仪表盘                                                              */
/* ------------------------------------------------------------------ */

async function loadDashboard() {
  await refreshState();
  await loadWorlds(true);
  renderDashboard();
}

function renderDashboard() {
  const s = app.state;
  if (!s) return;
  const server = s.server;
  const live = s.live;

  $('#stat-status').textContent = server.running ? (server.ready ? '运行中' : '启动中') : '未运行';
  $('#stat-status-sub').textContent = server.running ? `已运行 ${fmtUptime(server.uptimeMs)}` : '点击启动服务器';
  $('#stat-icon-status').style.color = server.running ? 'var(--accent)' : 'var(--muted-2)';

  $('#stat-players').textContent = live ? live.playercount ?? 0 : 0;
  const effectiveMax = live?.maxplayers ?? s.config?.maxSlots ?? server.maxPlayers;
  $('#stat-players-sub').textContent = `上限 ${effectiveMax} 人`;

  const worldName = live?.world || server.worldName || (s.launch.world ? s.launch.world.split(/[\\/]/).pop().replace(/\.wld$/i, '') : '');
  $('#stat-world').textContent = worldName || '未选择';
  $('#stat-world-sub').textContent = s.launch.world ? s.launch.world.split(/[\\/]/).pop() : '请选择存档';

  const effectivePort = live?.port ?? s.config?.serverPort ?? server.port;
  $('#stat-port').textContent = effectivePort;
  $('#stat-port-sub').textContent = `REST ${s.rest.port}${s.rest.ok ? '' : ' · 未连接'}`;

  const launchCard = $('#launch-card');
  launchCard.classList.toggle('running', server.running);
  $('#launch-tag').textContent = server.running ? (server.ready ? '运行中' : '启动中') : '未运行';
  $('#launch-tag').className = 'tag ' + (server.running ? 'green' : '');

  renderWorldSelect();
  const portValue = $('#launch-port-value');
  if (portValue) {
    portValue.textContent = effectivePort;
    $('#launch-max-value').textContent = effectiveMax;
    const hasPassword = (live && live.serverpassword) || (s.config && s.config.hasPassword);
    $('#launch-pass-value').textContent = hasPassword ? '已设置' : '无';
  }
  if (server.running) {
    $('#run-uptime').textContent = fmtUptime(server.uptimeMs);
    $('#run-pid').textContent = server.pid || '—';
    $('#run-world').textContent = worldName || '—';
    $('#run-version').textContent = live ? `TShock ${live.tshockversion} / 游戏 ${live.serverversion}` : '—';
  }

  renderDashPlayers();
  renderSetupCard();
  renderInfoList();
  renderDashLog();
}

function renderWorldSelect() {
  const select = $('#launch-world');
  const s = app.state;
  if (!select) return;
  if (app.worlds.length === 0) {
    select.innerHTML = '<option value="">（没有找到世界存档）</option>';
    return;
  }
  const current = (s && s.launch.world) || '';
  select.innerHTML = app.worlds
    .map((w) => {
      const label = `${w.name}　·　${w.file}　·　${fmtBytes(w.size)}`;
      return `<option value="${esc(w.path)}" ${w.path === current ? 'selected' : ''}>${esc(label)}</option>`;
    })
    .join('');
}

function renderDashPlayers() {
  const box = $('#dash-players');
  const s = app.state;
  if (!s) return;
  if (!s.server.running) {
    box.innerHTML = '<div class="empty">服务器未运行</div>';
    return;
  }
  if (!s.players || s.players.length === 0) {
    box.innerHTML = '<div class="empty">暂无在线玩家</div>';
    return;
  }
  box.innerHTML = s.players
    .slice(0, 8)
    .map((p) => {
      const name = p.nickname || p.name || '未知';
      const account = p.username || '未登录';
      const group = p.group || 'guest';
      return `<div class="player-chip">
        <div class="avatar">${esc(String(name).slice(0, 1).toUpperCase())}</div>
        <div class="who"><b>${esc(name)}</b><span>${esc(account)} · ${esc(group)}</span></div>
        <button class="btn btn-ghost sm" data-action="player-kick" data-name="${esc(name)}">踢出</button>
      </div>`;
    })
    .join('');
}

function renderSetupCard() {
  const box = $('#setup-card');
  const code = app.state?.setupCode;
  if (!code) {
    box.innerHTML = '<div class="hint">没有找到 setup-code.txt，服务器首次启动后会自动生成。</div>';
    return;
  }
  box.innerHTML = `
    <div class="setup-code">
      <div class="grow">
        <div class="hint" style="margin-bottom:2px">游戏内输入</div>
        <code>/setup ${esc(code)}</code>
      </div>
      <button class="btn btn-ghost sm" data-action="copy" data-text="/setup ${esc(code)}">复制</button>
    </div>
    <div class="hint">认证成功后你的账号会成为超级管理员；认证码只在本机可见。</div>`;
}

function renderInfoList() {
  const s = app.state;
  if (!s) return;
  const rows = [
    ['服务器程序', 'TShock.Server.exe'],
    ['服务器目录', s.paths.serverDir],
    ['存档目录', s.paths.worldsDir],
    ['REST 状态', s.server.running ? (s.rest.ok ? `已连接（${s.rest.port}）` : `未连接（${s.rest.port}）`) : '未运行'],
  ];
  $('#info-list').innerHTML = rows
    .map(([k, v]) => `<div class="info-row"><span>${esc(k)}</span><b title="${esc(v)}">${esc(v)}</b></div>`)
    .join('');
  const hp = $('#help-paths');
  if (hp) {
    hp.innerHTML = [
      ['服务器目录', s.paths.serverDir],
      ['tshock 配置目录', s.paths.tshockDir],
      ['世界存档目录', s.paths.worldsDir],
      ['日志目录', s.paths.logsDir],
      ['备份目录', s.paths.backupsDir],
      ['面板目录', s.paths.panelDir],
    ]
      .map(([k, v]) => `<div class="info-row"><span>${esc(k)}</span><b title="${esc(v)}">${esc(v)}</b></div>`)
      .join('');
  }
}

function renderDashLog() {
  const box = $('#dash-log');
  if (!box) return;
  const items = app.logs.slice(-120);
  if (items.length === 0) {
    box.innerHTML = '<div class="empty">还没有日志，启动服务器后会实时显示在这里。</div>';
    return;
  }
  box.innerHTML = items.map((it) => lineHtml(it)).join('');
  box.scrollTop = box.scrollHeight;
}

