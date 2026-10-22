'use strict';

/* 动作：备份、杂项与控制台
 *
 * 从 42-actions.js 的 handleAction switch 原样搬出（仅搬运，未改逻辑）。
 * 约定：命中的 case 自己 return（返回值被外层忽略）；未命中时 default 返回 false。
 * action 名称全局唯一，所以“命中后继续尝试下一组”不会误执行别的分支。
 */

async function backupMiscActions(action, el) {
  switch (action) {
    case 'create-backup': {
      try {
        await api('/api/backups/create', { method: 'POST', body: { reason: '手动备份' } });
        toast('备份完成');
        await loadBackups();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'refresh-backups':
      await loadBackups();
      return;
    case 'backup-restore': {
      const ok = await confirmDialog('还原备份', '将把世界存档、账号数据库和配置恢复为备份时的状态。还原前会自动再备份一份当前状态。', '还原');
      if (!ok) return;
      try {
        await api('/api/backups/restore', { method: 'POST', body: { id: el.dataset.id } });
        toast('还原完成');
        await loadBackups();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'backup-delete': {
      const ok = await confirmDialog('删除备份', '删除后无法恢复。', '删除');
      if (!ok) return;
      try {
        await api('/api/backups/delete', { method: 'POST', body: { id: el.dataset.id } });
        toast('已删除');
        await loadBackups();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'open':
      try {
        await api('/api/open', { method: 'POST', body: { target: el.dataset.target } });
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    case 'quit-panel': {
      const stop = el.dataset.stop === '1';
      const ok = await confirmDialog(
        stop ? '停止服务器并退出面板' : '仅退出面板',
        stop
          ? '面板会先保存并关闭服务器，然后结束面板进程。'
          : '只结束面板进程；如果服务器仍在运行，它会继续跑，下次打开面板会自动接管。',
        '确定退出',
      );
      if (!ok) return;
      try {
        await api('/api/shutdown', { method: 'POST', body: { stopServer: stop } });
      } catch (err) {
        /* 服务器可能已经断开，忽略 */
      }
      document.body.innerHTML =
        '<div style="display:grid;place-items:center;height:100vh;color:#8ea2bd;font-family:system-ui;font-size:15px">面板已关闭，可以直接关掉这个页面。</div>';
      return;
    }
    case 'copy':
      try {
        await navigator.clipboard.writeText(el.dataset.text || '');
        toast('已复制');
      } catch (err) {
        toast('复制失败，请手动选择', 'error');
      }
      return;
    case 'clear-console':
      app.consoleClearedAt = app.lastLogId;
      $('#console').innerHTML = '';
      return;
    case 'download-log':
      downloadLog();
      return;
    default:
      return false;
  }
}
