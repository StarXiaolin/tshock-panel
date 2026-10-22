'use strict';

/* 玩家与封禁：在线玩家、封禁列表、账户与白名单
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 玩家与封禁                                                          */
/* ------------------------------------------------------------------ */

async function loadPlayers() {
  const s = app.state;
  if (!s || !s.server.running) {
    app.players = [];
    app.bans = [];
    app.users = [];
    renderPlayers();
    renderWhitelist();
    return;
  }
  try {
    const [players, bans, users, groups] = await Promise.all([
      api('/api/players').catch(() => ({ players: [] })),
      api('/api/bans').catch(() => ({ bans: [] })),
      api('/api/users').catch(() => ({ users: [] })),
      api('/api/group-names').catch(() => ({ groups: [] })),
    ]);
    app.players = players.players || [];
    app.bans = bans.bans || [];
    app.users = users.users || [];
    app.groupNames = (groups.groups || []).map((g) => (typeof g === 'string' ? g : g.name));
  } catch (err) {
    toast(err.message, 'error');
  }
  renderPlayers();
  renderWhitelist();
}

function renderPlayers() {
  const running = isRunning();
  const pbody = $('#players-table tbody');
  if (!running) {
    pbody.innerHTML = '<tr><td colspan="5"><div class="empty">服务器未运行</div></td></tr>';
  } else if (app.players.length === 0) {
    pbody.innerHTML = '<tr><td colspan="5"><div class="empty">暂无在线玩家</div></td></tr>';
  } else {
    pbody.innerHTML = app.players
      .map((p) => {
        const name = p.nickname || p.name || '未知';
        return `<tr>
          <td><b>${esc(name)}</b></td>
          <td><span class="muted">${esc(p.username || '—')}</span></td>
          <td><span class="badge">${esc(p.group || 'guest')}</span></td>
          <td><span class="muted mono">${esc(maskIpClient(p.ip))}</span></td>
          <td><div class="cell-actions">
            <button class="btn btn-ghost sm" data-action="player-detail" data-name="${esc(name)}">详情</button>
            <button class="btn btn-ghost sm" data-action="player-kick" data-name="${esc(name)}">踢出</button>
            <button class="btn btn-ghost sm" data-action="player-ban" data-name="${esc(name)}">封禁</button>
            <button class="btn btn-ghost sm" data-action="player-kill" data-name="${esc(name)}">杀死</button>
          </div></td>
        </tr>`;
      })
      .join('');
  }

  const bbody = $('#bans-table tbody');
  if (!running) {
    bbody.innerHTML = '<tr><td colspan="5"><div class="empty">服务器未运行</div></td></tr>';
  } else if (app.bans.length === 0) {
    bbody.innerHTML = '<tr><td colspan="5"><div class="empty">没有被封禁的玩家</div></td></tr>';
  } else {
    bbody.innerHTML = app.bans
      .map(
        (b) => `<tr>
        <td>#${esc(b.ticket_number)}</td>
        <td><span class="mono">${esc(b.identifier)}</span></td>
        <td>${esc(b.reason || '—')}</td>
        <td><span class="muted">${esc(b.banning_user || '—')}</span></td>
        <td><button class="btn btn-ghost sm" data-action="ban-remove" data-ticket="${esc(b.ticket_number)}">解封</button></td>
      </tr>`,
      )
      .join('');
  }

  const ubody = $('#users-table tbody');
  const userQuery = ($('#user-search') && $('#user-search').value.trim().toLowerCase()) || '';
  const users = app.users.filter((u) => !userQuery || String(u.name).toLowerCase().includes(userQuery));
  if (!running) {
    ubody.innerHTML = '<tr><td colspan="3"><div class="empty">服务器未运行</div></td></tr>';
  } else if (app.users.length === 0) {
    ubody.innerHTML = '<tr><td colspan="3"><div class="empty">还没有注册账户</div></td></tr>';
  } else if (users.length === 0) {
    ubody.innerHTML = '<tr><td colspan="3"><div class="empty">没有匹配的账户</div></td></tr>';
  } else {
    ubody.innerHTML = users
      .map(
        (u) => `<tr>
        <td><b>${esc(u.name)}</b></td>
        <td><span class="badge">${esc(u.group || 'guest')}</span></td>
        <td><div class="cell-actions">
          <button class="btn btn-ghost sm" data-action="user-password" data-user="${esc(u.name)}">改密码</button>
          <button class="btn btn-ghost sm" data-action="user-group" data-user="${esc(u.name)}" data-group="${esc(u.group || '')}">改组</button>
          <button class="btn btn-ghost sm" data-action="user-remove" data-user="${esc(u.name)}">删除</button>
        </div></td>
      </tr>`,
      )
      .join('');
  }

  const groupSelect = $('#user-group');
  const groupNames = app.groupNames || [];
  if (groupSelect.options.length === 0 && groupNames.length) {
    groupSelect.innerHTML = groupNames.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    if (groupNames.includes('default')) groupSelect.value = 'default';
  }
}

function maskIpClient(ip) {
  const text = String(ip || '');
  if (!text) return '—';
  const parts = text.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  return '****';
}

async function renderWhitelist() {
  try {
    const data = await api('/api/text?name=whitelist');
    $('#whitelist').value = data.content.replace(/\r\n/g, '\n').trimEnd();
  } catch (err) {
    /* ignore */
  }
}
