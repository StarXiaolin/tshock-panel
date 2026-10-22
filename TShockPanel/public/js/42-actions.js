'use strict';

/* 动作分发：data-action 的中央分派
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 动作分发                                                            */
/* ------------------------------------------------------------------ */

async function handleAction(action, el) {
  // 顺序尝试各页面的动作处理：命中的那组自己执行完（返回 undefined 或 true），
  // 未命中的组返回 false 继续下一组。action 名称全局唯一，不会重复执行。
  for (const group of [
    shellActions,
    warpActions,
    pluginThemeActions,
    giveEventActions,
    groupSscActions,
    settingsActions,
    worldPlayerActions,
    backupMiscActions,
  ]) {
    if (await group(action, el)) return;
  }
}

async function saveConfig() {
  const changed = collectChangedSettings();
  if (Object.keys(changed).length === 0) {
    toast('没有需要保存的修改');
    return;
  }
  try {
    const res = await api('/api/config', { method: 'POST', body: { settings: changed } });
    toast(res.restartRequired ? '已保存，重启服务器后生效' : '已保存');
    await loadSettings();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* 控制台命令                                                          */
/* ------------------------------------------------------------------ */

async function sendCommand(cmd) {
  if (!isRunning()) {
    toast('服务器未运行', 'error');
    return;
  }
  const command = String(cmd || '').trim();
  if (!command) return;
  try {
    await api('/api/console', { method: 'POST', body: { command } });
    app.history.push(command);
    if (app.history.length > 100) app.history.shift();
    app.historyIndex = -1;
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* 玩家详情                                                            */
/* ------------------------------------------------------------------ */

async function showPlayerDetail(name, reveal = false) {
  let data;
  try {
    data = await api(`/api/players/detail?name=${encodeURIComponent(name)}${reveal ? '&reveal=1' : ''}`);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const p = data.player;
  const account = data.account;
  const rows = [
    ['角色名', p.name || name],
    ['账号', p.username || '未登录/游客'],
    ['权限组', p.group || 'guest'],
    ['IP', p.ip || '—'],
    ['IP 显示', p.revealed ? '完整 IP（已记审计日志）' : '已脱敏'],
  ];
  if (account && account.exists) {
    rows.push(['账号所在组', account.group || '—']);
    rows.push(['注册时间', account.registeredAt || '—']);
    rows.push(['最后记录 IP', account.lastIp || '—']);
  } else if (p.username) {
    rows.push(['账户信息', '未注册（可能是游客登录）']);
  }

  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-mask"><div class="modal">
    <div class="modal-head"><h3>玩家详情 · ${esc(name)}</h3><p>数据来自在线玩家列表与 TShock 的 /accountinfo</p></div>
    <div class="modal-body">
      <div class="player-detail-grid">
        ${rows.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('')}
      </div>
      <div class="hint">${esc(data.sscInventory.available ? '' : 'SSC 背包快照：' + data.sscInventory.reason)}</div>
    </div>
    <div class="modal-foot">
      ${p.revealed ? '' : '<button class="btn" data-reveal="1">查看完整 IP</button>'}
      <button class="btn btn-primary" data-close="1">关闭</button>
    </div>
  </div></div>`;

  $$('[data-close]', root).forEach((b) => b.addEventListener('click', () => (root.innerHTML = '')));
  $$('[data-reveal]', root).forEach((b) =>
    b.addEventListener('click', () => {
      root.innerHTML = '';
      showPlayerDetail(name, true);
    }),
  );
}

