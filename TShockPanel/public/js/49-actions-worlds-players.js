'use strict';

/* 动作：世界存档与玩家操作
 *
 * 从 42-actions.js 的 handleAction switch 原样搬出（仅搬运，未改逻辑）。
 * 约定：命中的 case 自己 return（返回值被外层忽略）；未命中时 default 返回 false。
 * action 名称全局唯一，所以“命中后继续尝试下一组”不会误执行别的分支。
 */

async function worldPlayerActions(action, el) {
  switch (action) {
    case 'new-world':
      await newWorldFlow();
      return;
    case 'upload-world':
      $('#world-file').click();
      return;
    case 'refresh-worlds':
      await loadWorlds();
      toast('世界列表已刷新');
      return;
    case 'world-select': {
      try {
        await api('/api/worlds/select', { method: 'POST', body: { path: el.dataset.path } });
        toast('已选择该世界');
        await loadWorlds();
        await refreshState();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'world-start': {
      try {
        await api('/api/worlds/select', { method: 'POST', body: { path: el.dataset.path } });
        await api('/api/server/start', { method: 'POST', body: { worldPath: el.dataset.path } });
        toast('正在启动服务器…');
        switchView('console');
        refreshState();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'world-backup': {
      try {
        await api('/api/backups/create', { method: 'POST', body: { worldPath: el.dataset.path, reason: '手动备份世界' } });
        toast('备份完成');
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'world-delete': {
      const ok = await confirmDialog('删除世界', '存档会被移动到面板的 trash 目录，可以手动找回。', '删除');
      if (!ok) return;
      try {
        await api('/api/worlds/delete', { method: 'POST', body: { path: el.dataset.path } });
        toast('世界已移入 trash');
        await loadWorlds();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'player-kick': {
      const name = el.dataset.name;
      const r = await modal({
        title: `踢出 ${name}`,
        fields: [{ id: 'reason', label: '原因（可选）', placeholder: '例如：请勿刷屏' }],
        okText: '踢出',
        danger: true,
      });
      if (!r) return;
      try {
        await api('/api/players/action', { method: 'POST', body: { action: 'kick', name, reason: r.reason } });
        toast('已发送踢出指令');
        await loadPlayers();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'player-ban': {
      const name = el.dataset.name;
      const r = await modal({
        title: `封禁 ${name}`,
        desc: '将按该玩家的 IP 进行封禁。',
        fields: [{ id: 'reason', label: '封禁原因', value: '违反服务器规则' }],
        okText: '封禁',
        danger: true,
      });
      if (!r) return;
      try {
        await api('/api/players/action', { method: 'POST', body: { action: 'ban', name, reason: r.reason } });
        toast('已封禁');
        await loadPlayers();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'player-kill': {
      try {
        await api('/api/players/action', { method: 'POST', body: { action: 'kill', name: el.dataset.name } });
        toast('已执行');
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'ban-remove': {
      try {
        await api('/api/bans/remove', { method: 'POST', body: { ticket: Number(el.dataset.ticket) } });
        toast('已解封');
        await loadPlayers();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'user-remove': {
      const ok = await confirmDialog('删除账户', `确定删除账户「${el.dataset.user}」吗？`, '删除');
      if (!ok) return;
      try {
        await api('/api/users/remove', { method: 'POST', body: { user: el.dataset.user } });
        toast('账户已删除');
        await loadPlayers();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'save-whitelist': {
      try {
        await api('/api/text', { method: 'POST', body: { name: 'whitelist', content: $('#whitelist').value } });
        toast('白名单已保存');
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    default:
      return false;
  }
}
