'use strict';

/* 动作：权限组与 SSC
 *
 * 从 42-actions.js 的 handleAction switch 原样搬出（仅搬运，未改逻辑）。
 * 约定：命中的 case 自己 return（返回值被外层忽略）；未命中时 default 返回 false。
 * action 名称全局唯一，所以“命中后继续尝试下一组”不会误执行别的分支。
 */

async function groupSscActions(action, el) {
  switch (action) {
    case 'refresh-groups':
      await loadGroups();
      toast('用户组已刷新');
      return;
    case 'select-group':
      app.currentGroup = el.dataset.group;
      renderGroupList();
      renderGroupDetail();
      return;
    case 'toggle-cat': {
      const body = el.parentElement.querySelector('.cat-body');
      if (body) body.hidden = !body.hidden;
      return;
    }
    case 'quick-add-perm':
    case 'add-perm': {
      const node = el.dataset.node || ($('#perm-input') && $('#perm-input').value.trim());
      if (!node) return toast('请输入权限节点', 'error');
      await changePermission(node, 'add');
      if ($('#perm-input')) $('#perm-input').value = '';
      return;
    }
    case 'remove-perm':
      await changePermission(el.dataset.node, 'remove');
      return;
    case 'save-parent': {
      const parent = $('#group-parent').value;
      if (!parent) return toast('请选择父组', 'error');
      try {
        await api('/api/groups/parent', { method: 'POST', body: { group: app.currentGroup, parent } });
        toast(`已把 ${app.currentGroup} 的父组设为 ${parent}`);
        await loadGroups();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'ssc-add-item':
      app.sscInventory.push({ netID: 0, prefix: 0, stack: 1 });
      renderSscInventory();
      return;
    case 'ssc-remove-row': {
      const index = Number(el.dataset.row);
      app.sscInventory.splice(index, 1);
      renderSscInventory();
      return;
    }
    case 'save-ssc-inventory': {
      const rows = $$('#ssc-inventory .ssc-row').map((row) => ({
        netID: Number(row.querySelector('[data-role="item"]').dataset.netid),
        prefix: Number(row.querySelector('[data-role="prefix"]').value),
        stack: Number(row.querySelector('[data-role="stack"]').value),
      }));
      try {
        await api('/api/ssc/inventory', { method: 'POST', body: { inventory: rows } });
        toast('初始物品已写入 sscconfig.json，重启服务器后生效');
        await loadSscInventory();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'player-detail':
      await showPlayerDetail(el.dataset.name);
      return;
    case 'user-password': {
      const user = el.dataset.user;
      const result = await modal({
        title: `修改密码 · ${user}`,
        desc: '密码会以掩码输入，只交给 TShock 的账户接口处理，不写入日志。',
        okText: '保存密码',
        fields: [{ id: 'password', label: '新密码', type: 'password', placeholder: '至少 4 位' }],
      });
      if (!result) return;
      if (!result.password || result.password.length < 4) return toast('密码至少 4 位', 'error');
      try {
        await api('/api/users/password', { method: 'POST', body: { user, password: result.password } });
        toast(`已更新 ${user} 的密码`);
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'user-group': {
      const user = el.dataset.user;
      const options = (app.groupNames || []).filter((g) => g !== 'superadmin').map((g) => ({ value: g, label: g }));
      const result = await modal({
        title: `迁移权限组 · ${user}`,
        desc: '通过 TShock 的用户接口修改，内存中的玩家组会同步更新。',
        okText: '迁移',
        fields: [{ id: 'group', label: '目标组', type: 'select', options, value: el.dataset.group }],
      });
      if (!result) return;
      try {
        await api('/api/users/group', { method: 'POST', body: { user, group: result.group } });
        toast(`已把 ${user} 迁移到 ${result.group}`);
        await loadPlayers();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'toggle-group': {
      const id = el.dataset.group;
      const group = el.closest('.group');
      if (app.settingsOpen.has(id)) app.settingsOpen.delete(id);
      else app.settingsOpen.add(id);
      group.classList.toggle('open');
      return;
    }
    default:
      return false;
  }
}
