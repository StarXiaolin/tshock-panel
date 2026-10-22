'use strict';

/* 动作：物品发放与世界事件
 *
 * 从 42-actions.js 的 handleAction switch 原样搬出（仅搬运，未改逻辑）。
 * 约定：命中的 case 自己 return（返回值被外层忽略）；未命中时 default 返回 false。
 * action 名称全局唯一，所以“命中后继续尝试下一组”不会误执行别的分支。
 */

async function giveEventActions(action, el) {
  switch (action) {
    case 'refresh-give-players':
      await refreshGivePlayers();
      toast('玩家列表已刷新');
      return;
    case 'pick-quick-item':
      app.givePicked = Number(el.dataset.id);
      renderPickedItem();
      return;
    case 'clear-picked':
      app.givePicked = null;
      $('#give-search').value = '';
      hideDropdown();
      renderPickedItem();
      return;
    case 'give-item': {
      const player = $('#give-player').value;
      if (!player) return toast('请先选择在线玩家', 'error');
      if (!app.givePicked) return toast('请先选择物品', 'error');
      const count = Number($('#give-count').value);
      const prefix = Number($('#give-prefix').value);
      try {
        const res = await api('/api/items/give', {
          method: 'POST',
          body: { player, netId: app.givePicked, count, prefix },
        });
        const item = res.item ? res.item.zh || res.item.en : `#${app.givePicked}`;
        app.giveHistory.unshift({
          at: Date.now(),
          text: `${item} ×${count} → ${res.player}${prefix ? `（前缀 ${prefix}）` : ''}${res.ok ? '' : ' · 失败'}`,
        });
        renderGiveHistory();
        if (res.ok) {
          toast(`已发放 ${item} ×${count} 给 ${res.player}`);
        } else {
          toast((res.output || []).join(' / ') || '发放失败', 'error');
        }
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'refresh-events':
      await loadEvents(true);
      toast('已重新读取事件列表');
      return;
    case 'trigger-event':
      await triggerEvent(el.dataset.type);
      return;
    case 'trigger-invasion': {
      const type = $('#invasion-type').value;
      const waves = $('#invasion-waves').value.trim();
      await triggerEvent('invasion', type, waves);
      return;
    }
    case 'trigger-rain': {
      const type = $('#rain-type').value;
      await triggerEvent('rain', type);
      return;
    }
    default:
      return false;
  }
}
