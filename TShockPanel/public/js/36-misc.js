'use strict';

/* 备份与还原 / 帮助
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 备份                                                                */
/* ------------------------------------------------------------------ */

async function loadBackups() {
  try {
    const data = await api('/api/backups');
    const tbody = $('#backups-table tbody');
    if (!data.backups.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty">还没有备份</div></td></tr>';
      return;
    }
    const running = isRunning();
    tbody.innerHTML = data.backups
      .map(
        (b) => `<tr>
        <td>${fmtTime(b.createdAt)}</td>
        <td><div class="cell-main"><b>${esc(b.world?.name || '服务器数据')}</b><span>${esc((b.files || []).join('、'))}</span></div></td>
        <td><span class="muted">${esc(b.reason || '—')}</span></td>
        <td>${fmtBytes(b.size)}</td>
        <td><div class="cell-actions">
          <button class="btn btn-ghost sm" data-action="backup-restore" data-id="${esc(b.id)}" ${running ? 'disabled title="请先停止服务器"' : ''}>还原</button>
          <button class="btn btn-ghost sm" data-action="backup-delete" data-id="${esc(b.id)}">删除</button>
        </div></td>
      </tr>`,
      )
      .join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* 帮助                                                                */
/* ------------------------------------------------------------------ */

function renderHelp() {
  renderInfoList();
  if (app.state) $('#about-version').textContent = app.state.version || '1.0.0';
}
