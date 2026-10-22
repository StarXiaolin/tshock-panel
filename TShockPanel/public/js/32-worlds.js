'use strict';

/* 世界存档：列表、新建、导入、选择、删除
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 世界                                                                */
/* ------------------------------------------------------------------ */

async function loadWorlds(silent = false) {
  try {
    const data = await api('/api/worlds');
    app.worlds = data.worlds || [];
    app.worldDirs = data.dirs || [];
    if (app.view === 'worlds') renderWorlds();
    if (app.view === 'dashboard') renderWorldSelect();
  } catch (err) {
    if (!silent) toast(err.message, 'error');
  }
}

function renderWorlds() {
  const q = ($('#world-search').value || '').trim().toLowerCase();
  const rows = app.worlds.filter((w) => {
    if (!q) return true;
    return (w.name + ' ' + w.file + ' ' + w.path).toLowerCase().includes(q);
  });
  $('#worlds-count').textContent = `共 ${app.worlds.length} 个世界`;
  const tbody = $('#worlds-table tbody');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty">${app.worlds.length === 0 ? '还没有世界存档，点击「新建世界」开始' : '没有匹配的世界'}</div></td></tr>`;
  } else {
    tbody.innerHTML = rows
      .map((w) => {
        const badges = [];
        if (w.current) badges.push('<span class="badge green">运行中</span>');
        if (w.selected) badges.push('<span class="badge">已选择</span>');
        return `<tr>
          <td>
            <div class="cell-main">
              <b>${esc(w.name)} ${badges.join(' ')}</b>
              <span>${esc(w.file)}</span>
            </div>
          </td>
          <td><span class="muted">v${esc(w.version)}</span></td>
          <td>${fmtBytes(w.size)}</td>
          <td><span class="muted">${fmtTime(w.modified)}</span></td>
          <td>
            <div class="cell-actions">
              <button class="btn btn-primary sm" data-action="world-start" data-path="${esc(w.path)}">启动</button>
              <button class="btn btn-ghost sm" data-action="world-select" data-path="${esc(w.path)}">选择</button>
              <button class="btn btn-ghost sm" data-action="world-backup" data-path="${esc(w.path)}">备份</button>
              <button class="btn btn-ghost sm" data-action="world-delete" data-path="${esc(w.path)}">删除</button>
            </div>
          </td>
        </tr>`;
      })
      .join('');
  }
  $('#worlds-dirs').textContent = (app.worldDirs || []).length
    ? '存档目录：' + app.worldDirs.join('　|　')
    : '未找到存档目录，请到「服务器设置 → 面板设置」修改。';
}

async function newWorldFlow() {
  const result = await modal({
    title: '新建世界',
    desc: '服务器会用原版生成器创建存档，生成小世界约需 1 分钟，大世界可能需要数分钟。',
    okText: '开始生成',
    fields: [
      { id: 'name', label: '世界名称', placeholder: '例如：朋友开荒' },
      {
        id: 'size',
        label: '世界大小',
        type: 'select',
        value: '1',
        options: [
          { value: '1', label: '小世界（4200 × 1200）' },
          { value: '2', label: '中世界（6400 × 1800）' },
          { value: '3', label: '大世界（8400 × 2400）' },
        ],
      },
      { id: 'seed', label: '世界种子（可选）', placeholder: '留空则随机，例如 05162020' },
    ],
  });
  if (!result) return;
  const name = (result.name || '').trim();
  if (!name) {
    toast('请填写世界名称', 'error');
    return;
  }
  try {
    await api('/api/worlds/create', { method: 'POST', body: { name, size: Number(result.size), seed: result.seed } });
    toast('已开始生成世界，进度见控制台');
    switchView('console');
    refreshState();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function uploadWorld(file) {
  if (!file) return;
  if (!/\.wld$/i.test(file.name)) {
    toast('只支持 .wld 世界存档', 'error');
    return;
  }
  toast(`正在导入 ${file.name}（${fmtBytes(file.size)}）…`);
  try {
    const res = await fetch('/api/worlds/upload?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '导入失败');
    toast(`已导入世界「${data.name}」`);
    await loadWorlds();
  } catch (err) {
    toast(err.message, 'error');
  }
}
