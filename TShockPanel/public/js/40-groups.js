'use strict';

/* 权限管理：组列表、权限节点、继承关系
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 权限管理视图                                                        */
/* ------------------------------------------------------------------ */

async function loadGroups() {
  try {
    const data = await api('/api/groups');
    app.groups = data.groups;
    app.catalog = data.catalog;
    if (!app.currentGroup || !data.groups.some((g) => g.name === app.currentGroup)) {
      app.currentGroup = data.groups.length ? data.groups[0].name : null;
    }
    renderGroupList();
    renderGroupDetail();
  } catch (err) {
    // 读不到用户组时不能停在「加载中…」：把左栏与右栏直接画成错误状态。
    // 不清 app.groups：上一次成功读取的数据留着，服务器恢复后点「刷新」即可回到正常显示。
    const box = $('#group-list');
    if (box) box.innerHTML = `<div class="empty">读取用户组失败：${esc(err.message)}<br />点上面的「刷新」重试。</div>`;
    const title = $('#group-detail-title');
    if (title) title.textContent = '读取失败';
    const meta = $('#group-detail-meta');
    if (meta) meta.textContent = '';
    const intro = $('#group-detail');
    if (intro) {
      intro.innerHTML =
        '<div class="empty">用户组数据来自 TShock 服务器：服务器没运行或 REST 接口没开时会读不到。先在「仪表盘」启动服务器，再回来点「刷新」。</div>';
    }
    const body = $('#group-detail-body');
    if (body) body.hidden = true;
    toast(err.message, 'error');
  }
}

function renderGroupList() {
  const box = $('#group-list');
  if (!box) return;
  if (!app.groups || !app.groups.length) {
    box.innerHTML = '<div class="empty">没有读取到用户组</div>';
    return;
  }
  box.innerHTML = app.groups
    .map(
      (g) => `<div class="group-item ${g.name === app.currentGroup ? 'active' : ''}" data-action="select-group" data-group="${esc(g.name)}">
        <div>
          <div class="nm">${esc(g.name)}</div>
          <div class="par">${g.parent ? '父组：' + esc(g.parent) : '无父组'}</div>
        </div>
        <div class="cnt">${g.permissions.length} 项</div>
      </div>`,
    )
    .join('');
}

function renderGroupDetail() {
  const group = (app.groups || []).find((g) => g.name === app.currentGroup);
  const title = $('#group-detail-title');
  const meta = $('#group-detail-meta');
  const intro = $('#group-detail');
  const body = $('#group-detail-body');
  if (!group) {
    title.textContent = '选择一个用户组';
    meta.textContent = '';
    intro.innerHTML = '<div class="empty">左侧点击一个组，查看并编辑它的权限。</div>';
    body.hidden = true;
    return;
  }
  intro.innerHTML = '';
  body.hidden = false;
  title.textContent = group.name;
  meta.textContent = `${group.permissions.length} 项自身权限${group.parent ? ' · 继承自 ' + group.parent : ''}`;

  const parentSelect = $('#group-parent');
  parentSelect.innerHTML =
    `<option value="" ${group.parent ? '' : 'selected'}>（当前无父组）</option>` +
    app.groups
      .filter((g) => g.name !== group.name)
      .map((g) => `<option value="${esc(g.name)}" ${g.name === group.parent ? 'selected' : ''}>${esc(g.name)}</option>`)
      .join('');

  const wildcard = group.permissions.filter((p) => p.includes('*'));
  const negative = group.permissions.filter((p) => p.startsWith('!'));
  const warnings = [];
  if (wildcard.length) {
    warnings.push(
      `该组包含 ${wildcard.length} 条通配权限（${wildcard.slice(0, 4).map(esc).join('、')}…）。通配符会一次性授予整个节点下的所有权限，请确认范围。`,
    );
  }
  if (negative.length) {
    warnings.push(`该组包含 ${negative.length} 条反权限（${negative.slice(0, 4).map(esc).join('、')}…）。反权限用于排除继承来的权限。`);
  }
  $('#group-warn').innerHTML = warnings.length
    ? `<div class="notice danger" style="margin-top:10px">${warnings.join('<br>')}</div>`
    : '';

  const has = (node) => group.permissions.includes(node);
  $('#perm-catalog').innerHTML = (app.catalog || [])
    .map(
      (cat) => `<div class="cat-group">
        <div class="cat-head" data-action="toggle-cat">
          <span>${esc(cat.title)}</span>
          <span class="muted">${cat.items.length} 项</span>
        </div>
        <div class="cat-body" hidden>
          ${cat.items
            .map(
              ([node, label]) => `<button class="perm-sug ${has(node) ? 'have' : ''}" data-action="quick-add-perm" data-node="${esc(node)}" ${has(node) ? 'disabled' : ''}>
                <span class="node">${esc(node)}</span>
                <span class="lbl">${esc(label)}</span>
              </button>`,
            )
            .join('')}
        </div>
      </div>`,
    )
    .join('');

  $('#perm-count').textContent = `（${group.permissions.length}）`;
  const sorted = [...group.permissions].sort();
  $('#perm-list').innerHTML = sorted.length
    ? sorted
        .map(
          (node) => `<div class="perm-item">
            <span class="node">${esc(node)}</span>
            ${node.includes('*') ? '<span class="tag-wild">通配</span>' : ''}
            ${node.startsWith('!') ? '<span class="tag-neg">反权限</span>' : ''}
            <span class="spacer"></span>
            <button class="btn btn-ghost sm" data-action="remove-perm" data-node="${esc(node)}">移除</button>
          </div>`,
        )
        .join('')
    : '<div class="empty">该组没有自己的权限（可能全靠父组继承）</div>';
}

/* ------------------------------------------------------------------ */
/* 权限操作                                                            */
/* ------------------------------------------------------------------ */

async function changePermission(node, action) {
  const group = app.currentGroup;
  if (!group) {
    toast('请先选择用户组', 'error');
    return;
  }
  if (!/^[A-Za-z0-9_.*!\-]{1,120}$/.test(node)) {
    toast('权限节点只能包含字母、数字以及 . _ * ! -', 'error');
    return;
  }
  if (action === 'add' && node.includes('*')) {
    const ok = await confirmDialog(
      '授予通配权限',
      `「${node}」会一次性授予该节点下的所有权限，确定要添加吗？`,
      '仍然添加',
    );
    if (!ok) return;
  }
  if (action === 'add' && node.startsWith('!')) {
    const ok = await confirmDialog(
      '添加反权限',
      `「${node}」用于从继承来的权限中排除该节点，确定要添加吗？`,
      '仍然添加',
    );
    if (!ok) return;
  }
  try {
    await api('/api/groups/perm', { method: 'POST', body: { group, permission: node, action } });
    toast(action === 'add' ? `已添加 ${node}` : `已移除 ${node}`);
    await loadGroups();
  } catch (err) {
    toast(err.message, 'error');
  }
}
