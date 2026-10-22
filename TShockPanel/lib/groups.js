'use strict';

/**
 * 用户组服务：读组详情、增删权限、改父组、建组、删组。
 *
 * 为什么单独成一个模块：
 *  - “组详情”原本是 server.js 里的 listGroupsDetailed()，被“用户组页”和
 *    “用户账户改所属组”两处共用；下沉后两边注入同一个实例，避免两份实现漂移。
 *  - TShock 没有用户组的写接口，只能走 rawcmd 的 /group 子命令。命令字符串
 *    集中在这里，比拼在路由里更容易审阅，也不会散到别处。
 *
 * 所有对外函数的入参与报错文案都保持拆分前逐字一致（行为不变）。
 */

const PERMISSION_RE = /^[A-Za-z0-9_.*!\-]{1,120}$/;

function createGroupService({ restCall, restCommand, addLog }) {
  const log = (text) => {
    if (typeof addLog === 'function') addLog('panel', text);
  };

  /** 组名列表（用于下拉框）。 */
  async function names() {
    const data = await restCall('/v2/groups/list');
    return (data.groups || []).map((g) => g.name);
  }

  /**
   * 每个组带上父组、聊天颜色与权限列表。
   * 单个组读取失败只在该组上标记 error，不拖垮整页（与拆分前一致）。
   */
  async function listDetailed() {
    const list = await names();
    return Promise.all(
      list.map(async (name) => {
        try {
          const detail = await restCall('/v2/groups/read?group=' + encodeURIComponent(name));
          return {
            name,
            parent: detail.parent || '',
            chatcolor: detail.chatcolor || '',
            permissions: (Array.isArray(detail.permissions) ? detail.permissions : []).filter(
              (p) => p && String(p).trim(),
            ),
          };
        } catch (err) {
          return { name, parent: '', chatcolor: '', permissions: [], error: err.message };
        }
      }),
    );
  }

  function requireGroup(group) {
    if (!group) throw new Error('缺少组名');
    return group;
  }

  /** 增删权限：addperm / delperm；权限串先过白名单正则，挡住命令注入。 */
  async function changePermission({ group, permission, action }) {
    requireGroup(group);
    const perm = String(permission || '').trim();
    if (!PERMISSION_RE.test(perm)) {
      throw new Error('权限字符串只能包含字母、数字以及 . _ * ! -');
    }
    const remove = action === 'remove';
    const output = await restCommand(`/group ${remove ? 'delperm' : 'addperm'} "${group}" "${perm}"`);
    log(`用户组 ${group} ${remove ? '移除' : '添加'}权限：${perm}`);
    return output;
  }

  /** 改父组：TShock 自己也会拦“父组是自己”，这里提前给出更明确的报错。 */
  async function setParent({ group, parent }) {
    requireGroup(group);
    const target = String(parent || '').trim();
    if (!target) throw new Error('请选择父组');
    if (group === target) throw new Error('父组不能是自己');
    const output = await restCommand(`/group parent "${group}" "${target}"`);
    log(`用户组 ${group} 的父组改为 ${target}`);
    return output;
  }

  /** 建组：先 add（可带初始权限），再单独一条 parent；两条命令失败都会抛出。 */
  async function create({ name, permissions, parent }) {
    const groupName = String(name || '').trim();
    if (!PERMISSION_RE.test(groupName) || groupName.includes('*') || groupName.includes('!')) {
      throw new Error('组名只能包含字母、数字、下划线、点和短横线');
    }
    const perms = Array.isArray(permissions) ? permissions.filter((p) => PERMISSION_RE.test(p)) : [];
    const parts = [`/group add "${groupName}"`].concat(perms.map((p) => `"${p}"`));
    const output = await restCommand(parts.join(' '));
    if (parent) await restCommand(`/group parent "${groupName}" "${parent}"`);
    log(`创建用户组 ${groupName}`);
    return output;
  }

  /** 删组：仍有成员时 TShock 会拒绝，错误原样抛给前端。 */
  async function remove({ name }) {
    const groupName = String(name || '').trim();
    requireGroup(groupName);
    const output = await restCommand(`/group del "${groupName}"`);
    log(`删除用户组 ${groupName}`);
    return output;
  }

  return { names, listDetailed, changePermission, setParent, create, remove };
}

module.exports = { createGroupService, PERMISSION_RE };
