'use strict';

/* 动作：外壳与服务器启停
 *
 * 从 42-actions.js 的 handleAction switch 原样搬出（仅搬运，未改逻辑）。
 * 约定：命中的 case 自己 return（返回值被外层忽略）；未命中时 default 返回 false。
 * action 名称全局唯一，所以“命中后继续尝试下一组”不会误执行别的分支。
 */

async function shellActions(action, el) {
  switch (action) {
    case 'goto-worlds':
      switchView('worlds');
      return;
    case 'goto-settings':
      switchView('settings');
      return;
    case 'goto-console':
      switchView('console');
      return;
    case 'stop': {
      const ok = await confirmDialog('停止服务器', '将保存世界并安全关闭服务器，玩家会被断开。', '停止服务器');
      if (!ok) return;
      try {
        await api('/api/server/stop', { method: 'POST', body: {} });
        toast('服务器已停止');
      } catch (err) {
        toast(err.message, 'error');
      }
      refreshState();
      return;
    }
    case 'restart': {
      const ok = await confirmDialog('重启服务器', '服务器会先保存并关闭，然后重新启动。', '重启');
      if (!ok) return;
      try {
        await api('/api/server/restart', { method: 'POST', body: {} });
        toast('正在重启…');
        switchView('console');
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'save-world':
      await sendCommand('/save');
      return;
    default:
      return false;
  }
}
