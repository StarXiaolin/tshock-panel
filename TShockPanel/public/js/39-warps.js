'use strict';

/* 传送点：列表、新建、隐藏、删除、发送玩家
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 传送点                                                              */
/* ------------------------------------------------------------------ */

async function loadWarps() {
  try {
    const data = await api('/api/warps');
    warpState.list = data.warps || [];
    warpState.worldId = data.worldId;
    warpState.error = data.error || '';
    renderWarps();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderWarps() {
  const tbody = $('#warps-table tbody');
  if (!tbody) return;
  const scope = $('#warp-scope');
  if (warpState.error) {
    scope.className = 'notice danger';
    scope.innerHTML = `读取传送点失败：${esc(warpState.error)}`;
  } else if (!warpState.worldId) {
    scope.className = 'notice';
    scope.innerHTML = '还没有选择世界，无法确定当前世界的传送点。请先在「世界存档」里选择一个世界。';
  } else {
    scope.className = 'notice info';
    scope.innerHTML = `当前世界 ID：<code>${esc(warpState.worldId)}</code> · 传送点按世界隔离，列表里会标出属于其它世界的传送点。`;
  }

  const query = warpState.search.toLowerCase();
  const rows = warpState.list.filter((w) => !query || String(w.name).toLowerCase().includes(query));
  $('#warp-count').textContent = `共 ${warpState.list.length} 个`;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty">${
      warpState.list.length ? '没有匹配的传送点' : '还没有传送点，点左上角新建一个'
    }</div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((w) => {
      const current = w.current === true;
      const hidden = w.hidden;
      return `<tr>
        <td><input type="checkbox" class="warp-pick" data-name="${esc(w.name)}" ${warpState.selected.has(w.name) ? 'checked' : ''} /></td>
        <td><b>${esc(w.name)}</b></td>
        <td><span class="mono">${esc(w.x)}, ${esc(w.y)}</span></td>
        <td>${current ? '<span class="badge green">当前世界</span>' : `<span class="badge">#${esc(w.worldId)}</span>`}</td>
        <td>${hidden ? '<span class="badge amber">已隐藏</span>' : '<span class="badge">公开</span>'}</td>
        <td><div class="cell-actions">
          <button class="btn btn-ghost sm" data-action="warp-send" data-name="${esc(w.name)}">发送玩家</button>
          <button class="btn btn-ghost sm" data-action="warp-toggle-hide" data-name="${esc(w.name)}" data-hidden="${hidden ? '1' : '0'}">${hidden ? '取消隐藏' : '隐藏'}</button>
          <button class="btn btn-danger sm" data-action="warp-delete" data-name="${esc(w.name)}">删除</button>
        </div></td>
      </tr>`;
    })
    .join('');

  $$('.warp-pick', tbody).forEach((cb) =>
    cb.addEventListener('change', () => {
      if (cb.checked) warpState.selected.add(cb.dataset.name);
      else warpState.selected.delete(cb.dataset.name);
    }),
  );
}
