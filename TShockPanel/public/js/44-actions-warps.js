'use strict';

/* 动作：传送点
 *
 * 从 42-actions.js 的 handleAction switch 原样搬出（仅搬运，未改逻辑）。
 * 约定：命中的 case 自己 return（返回值被外层忽略）；未命中时 default 返回 false。
 * action 名称全局唯一，所以“命中后继续尝试下一组”不会误执行别的分支。
 */

async function warpActions(action, el) {
  switch (action) {
    case 'refresh-players':
      await loadPlayers();
      return;
    case 'refresh-warps':
      await loadWarps();
      toast('传送点已刷新');
      return;
    case 'new-warp': {
      const result = await modal({
        title: '新建传送点',
        desc: '坐标是图格坐标（玩家可在游戏内用 /pos 查看）。TShock 只在启动时加载传送点，新建后需要重启服务器。',
        okText: '创建',
        fields: [
          { id: 'name', label: '名称（区分大小写）', placeholder: '例如 home' },
          { id: 'x', label: 'X 坐标', type: 'number', value: 0 },
          { id: 'y', label: 'Y 坐标', type: 'number', value: 0 },
        ],
      });
      if (!result) return;
      try {
        const res = await api('/api/warps/add', {
          method: 'POST',
          body: { name: result.name, x: Number(result.x), y: Number(result.y) },
        });
        toast(`已写入传送点 ${res.name}，需要重启服务器生效`);
        await loadWarps();
        const restart = await confirmDialog(
          '重启服务器',
          '新传送点需要重启服务器才会被 TShock 加载。现在重启吗？',
          '立即重启',
          false,
        );
        if (restart) {
          await api('/api/server/restart', { method: 'POST', body: {} });
          switchView('console');
        }
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'warp-send': {
      if (!isRunning()) return toast('服务器未运行', 'error');
      try {
        const data = await api('/api/players');
        app.players = data.players || [];
      } catch (err) {
        app.players = [];
      }
      if (!app.players.length) return toast('当前没有在线玩家', 'error');
      const result = await modal({
        title: `发送玩家到「${el.dataset.name}」`,
        desc: '对应 /warp send [角色名] [传送点名]，需要 tshock.tp.others。',
        okText: '发送',
        fields: [
          {
            id: 'player',
            label: '在线玩家',
            type: 'select',
            options: app.players.map((p) => ({ value: p.nickname || p.name, label: p.nickname || p.name })),
          },
        ],
      });
      if (!result) return;
      try {
        await api('/api/warps/send', { method: 'POST', body: { player: result.player, name: el.dataset.name } });
        toast('已发送');
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'warp-toggle-hide': {
      const hidden = el.dataset.hidden === '0';
      try {
        await api('/api/warps/hide', { method: 'POST', body: { name: el.dataset.name, hidden } });
        toast(hidden ? '已隐藏' : '已取消隐藏');
        await loadWarps();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'warp-delete': {
      const ok = await confirmDialog('删除传送点', `确定删除「${el.dataset.name}」吗？`, '删除');
      if (!ok) return;
      try {
        await api('/api/warps/delete', { method: 'POST', body: { names: [el.dataset.name] } });
        toast('已删除');
        await loadWarps();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'warp-batch-hide':
    case 'warp-batch-show': {
      const names = [...warpState.selected];
      if (!names.length) return toast('请先勾选传送点', 'error');
      const hidden = action === 'warp-batch-hide';
      const ok = await confirmDialog(
        hidden ? '批量隐藏' : '批量取消隐藏',
        `将对 ${names.length} 个传送点执行${hidden ? '隐藏' : '取消隐藏'}，确定吗？`,
        '确定',
        false,
      );
      if (!ok) return;
      let failed = 0;
      for (const name of names) {
        try {
          await api('/api/warps/hide', { method: 'POST', body: { name, hidden } });
        } catch (err) {
          failed += 1;
        }
      }
      toast(failed ? `${failed} 个操作失败` : '已全部完成', failed ? 'error' : 'ok');
      warpState.selected.clear();
      await loadWarps();
      return;
    }
    case 'warp-batch-delete': {
      const names = [...warpState.selected];
      if (!names.length) return toast('请先勾选传送点', 'error');
      const ok = await confirmDialog('批量删除', `将删除 ${names.length} 个传送点，操作不可撤销。确定吗？`, '删除');
      if (!ok) return;
      try {
        await api('/api/warps/delete', { method: 'POST', body: { names } });
        toast('已删除');
        warpState.selected.clear();
        await loadWarps();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    default:
      return false;
  }
}
