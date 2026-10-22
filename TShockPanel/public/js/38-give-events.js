'use strict';

/* 物品发放：物品库、搜索、发放记录
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 物品库                                                              */
/* ------------------------------------------------------------------ */

async function ensureItems() {
  if (app.items) return app.items;
  const data = await api('/api/items');
  app.items = data.items;
  app.itemsIndex = new Map(data.items.map((it) => [it.id, it]));
  return app.items;
}

function itemById(id) {
  if (!app.itemsIndex) return null;
  return app.itemsIndex.get(Number(id)) || null;
}

function itemLabel(id) {
  const it = itemById(id);
  if (!it) return Number(id) === 0 ? '（空槽位）' : `未知物品 #${id}`;
  return `${it.zh || it.en} (#${it.id})`;
}

function searchItems(query, limit = 60) {
  const q = String(query || '').trim();
  if (!q || !app.items) return [];
  const lower = q.toLowerCase();
  const exactId = /^-?\d+$/.test(q) ? Number(q) : null;
  const hits = [];
  for (const it of app.items) {
    let score = 0;
    if (exactId !== null && it.id === exactId) score = 100;
    else if (it.zh === q) score = 90;
    else if ((it.en || '').toLowerCase() === lower) score = 85;
    else if (String(it.id) === q) score = 80;
    else if ((it.zh || '').startsWith(q)) score = 70;
    else if ((it.en || '').toLowerCase().startsWith(lower)) score = 60;
    else if ((it.zh || '').includes(q)) score = 50;
    else if ((it.en || '').toLowerCase().includes(lower)) score = 40;
    else if ((it.key || '').toLowerCase().includes(lower)) score = 30;
    else if (String(it.id).includes(q)) score = 20;
    if (score) hits.push({ it, score });
  }
  hits.sort((a, b) => b.score - a.score || a.it.id - b.it.id);
  return hits.slice(0, limit).map((h) => h.it);
}

function itemRowsHtml(items) {
  if (!items.length) return '<div class="empty">没有匹配的物品</div>';
  return items
    .map(
      (it) => `<div class="item-row" data-item-id="${it.id}">
        <span class="id">#${it.id}</span>
        <span class="zh">${esc(it.zh || it.en)}${it.special ? ' <span class="spec">特殊</span>' : ''}</span>
        <span class="en">${esc(it.en !== it.zh ? it.en : it.key || '')}</span>
      </div>`,
    )
    .join('');
}

/* ------------------------------------------------------------------ */
/* 物品发放视图                                                        */
/* ------------------------------------------------------------------ */

async function loadGive() {
  await ensureItems();
  $('#give-item-count').textContent = app.items.length.toLocaleString('zh-CN');
  await refreshGivePlayers();
  renderGiveQuick();
  renderGiveHistory();
  renderPickedItem();
}

async function refreshGivePlayers() {
  const select = $('#give-player');
  if (!select) return;
  if (!isRunning()) {
    select.innerHTML = '<option value="">服务器未运行</option>';
    $('#give-player-hint').textContent = '启动服务器后这里会列出在线玩家';
    return;
  }
  try {
    const data = await api('/api/players');
    app.players = data.players || [];
  } catch (err) {
    app.players = [];
  }
  if (!app.players.length) {
    select.innerHTML = '<option value="">当前没有在线玩家</option>';
    $('#give-player-hint').textContent = '玩家进入服务器后这里会自动出现';
    return;
  }
  const previous = select.value;
  select.innerHTML = app.players
    .map((p) => {
      const name = p.nickname || p.name || '';
      const extra = [p.username ? `账号 ${p.username}` : '未登录', p.group || 'guest'].join(' · ');
      return `<option value="${esc(name)}">${esc(name)}　（${esc(extra)}）</option>`;
    })
    .join('');
  if (previous && app.players.some((p) => (p.nickname || p.name) === previous)) select.value = previous;
  $('#give-player-hint').textContent = `在线 ${app.players.length} 人`;
}

function renderGiveQuick() {
  const box = $('#give-quick');
  if (!box) return;
  const picks = [4956, 757, 1326, 29, 8, 75];
  box.innerHTML = picks
    .filter((id) => itemById(id))
    .map((id) => `<button data-action="pick-quick-item" data-id="${id}">${esc(itemById(id).zh)}</button>`)
    .join('');
}

function renderGiveResults() {
  const input = $('#give-search');
  if (!input) return;
  const query = input.value.trim();
  if (!query) {
    hideDropdown();
    return;
  }
  showItemDropdown(input, searchItems(query, 50), (id) => {
    app.givePicked = id;
    input.value = itemLabel(id).replace(/\s*\(#-?\d+\)$/, '');
    renderPickedItem();
  });
}

function renderPickedItem() {
  const box = $('#give-picked');
  const button = $('#give-submit');
  if (!box) return;
  if (!app.givePicked) {
    box.className = 'picked-item';
    box.innerHTML = '<div class="empty">还没有选择物品，先在上面的搜索框里挑一件</div>';
    if (button) button.disabled = true;
    return;
  }
  const it = itemById(app.givePicked);
  box.className = 'picked-item has-item';
  box.innerHTML = `<div class="grow">
      <div class="big">${esc(it ? it.zh || it.en : app.givePicked)}</div>
      <div class="sub">#${esc(app.givePicked)} · ${esc(it ? it.en || '' : '')}</div>
    </div>
    <button class="btn btn-ghost sm" data-action="clear-picked">换一个</button>`;
  if (button) button.disabled = false;
}

function renderGiveHistory() {
  const box = $('#give-history');
  if (!box) return;
  if (!app.giveHistory.length) {
    box.innerHTML = '<div class="empty">还没有发放记录</div>';
    return;
  }
  box.innerHTML = app.giveHistory
    .slice(0, 12)
    .map(
      (entry) => `<div class="hist-row">
        <time>${fmtClock(entry.at)}</time>
        <span>${esc(entry.text)}</span>
      </div>`,
    )
    .join('');
}

/* ------------------------------------------------------------------ */
/* 世界事件视图                                                        */
/* ------------------------------------------------------------------ */

async function loadEvents(force = false) {
  try {
    const data = await api('/api/world-events' + (force ? '?refresh=1' : ''));
    app.events = data;
    renderEvents();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderEvents() {
  const meta = app.events;
  if (!meta) return;
  const status = meta.status || {};

  const chips = [
    `<div class="status-chip ${status.bloodmoon ? 'on' : ''}">血月：<b>${
      status.bloodmoon === null || status.bloodmoon === undefined ? '未知' : status.bloodmoon ? '进行中' : '未进行'
    }</b></div>`,
    `<div class="status-chip">可用事件：<b>${meta.types.length}</b></div>`,
    `<div class="status-chip">入侵类型：<b>${meta.invasions.length}</b></div>`,
    `<div class="status-chip">雨：<b>${meta.rains.length}</b></div>`,
  ];
  $('#event-status').innerHTML = chips.join('');

  const simple = meta.types.filter((t) => t.type !== 'invasion' && t.type !== 'rain');
  $('#event-grid').innerHTML = simple
    .map(
      (t) => `<button class="event-btn" data-action="trigger-event" data-type="${esc(t.type)}" title="${esc(t.permission)}">
        <span class="ico">${esc(t.icon)}</span>
        <span><span class="t">${esc(t.label)}</span><span class="d">${esc(t.desc || t.type)}</span></span>
      </button>`,
    )
    .join('');

  $('#invasion-type').innerHTML = meta.invasions
    .map((x) => `<option value="${esc(x.key)}">${esc(x.label)}（${esc(x.key)}）</option>`)
    .join('');
  $('#rain-type').innerHTML =
    '<option value="">普通雨</option>' +
    meta.rains.map((x) => `<option value="${esc(x.key)}">${esc(x.label)}（${esc(x.key)}）</option>`).join('');

  $('#events-source').textContent = `读取于 ${fmtTime(meta.at)} · 列表来自运行时 /worldevent`;
  renderEventResult(status.last);
}

function renderEventResult(last) {
  const box = $('#event-result');
  if (!box) return;
  if (!last) {
    box.innerHTML = '<div class="empty">还没有触发过事件</div>';
    return;
  }
  const title = [last.label, last.sub, last.waves ? `第 ${last.waves} 波` : ''].filter(Boolean).join(' · ');
  box.innerHTML = `<div class="result-box">
    <div class="${last.ok ? 'ok' : 'bad'}">${last.ok ? '✓ 已下发' : '✗ 执行失败'} · ${esc(title)}</div>
    <div class="muted" style="margin-top:4px">${fmtTime(last.at)} · <code>${esc(last.command)}</code></div>
    ${
      last.output && last.output.length
        ? `<div class="result-lines">${last.output.map((line) => `<div class="ln">${esc(line)}</div>`).join('')}</div>`
        : ''
    }
  </div>`;
}

async function triggerEvent(type, sub, waves, force) {
  try {
    const result = await api('/api/world-events/trigger', { method: 'POST', body: { type, sub, waves, force } });
    if (app.events) app.events.status.last = result;
    renderEventResult(result);
    toast(result.ok ? `${result.label} 已触发` : 'TShock 返回了错误，请查看结果面板', result.ok ? 'ok' : 'error');
  } catch (err) {
    if (err.status === 409) {
      const ok = await confirmDialog('事件冲突', err.message, '仍然继续');
      if (ok) return triggerEvent(type, sub, waves, true);
      return;
    }
    toast(err.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* 浮层下拉：渲染到 body 上，避免被 card 的 overflow 裁切或被后面的卡片盖住 */
/* ------------------------------------------------------------------ */

function ensureDropdownLayer() {
  if (dropdown.layer) return dropdown.layer;
  const layer = document.createElement('div');
  layer.id = 'dropdown-layer';
  layer.hidden = true;
  document.body.appendChild(layer);
  dropdown.layer = layer;

  const reposition = () => positionDropdown();
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  document.addEventListener('mousedown', (event) => {
    if (!dropdown.anchor || layer.hidden) return;
    if (layer.contains(event.target) || dropdown.anchor.contains(event.target)) return;
    hideDropdown();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideDropdown();
  });
  return layer;
}

function positionDropdown() {
  if (!dropdown.anchor || !dropdown.layer || dropdown.layer.hidden) return;
  const rect = dropdown.anchor.getBoundingClientRect();
  const layer = dropdown.layer;
  const width = Math.max(rect.width, 300);
  layer.style.width = `${width}px`;
  layer.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;

  const needed = layer.offsetHeight;
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  // 下方放不下、且上方空间更大时，向上弹出
  if (needed > spaceBelow && spaceAbove > spaceBelow) {
    layer.style.top = `${Math.max(8, rect.top - needed - 4)}px`;
  } else {
    layer.style.top = `${rect.bottom + 4}px`;
  }
}

function showItemDropdown(anchor, items, onPick) {
  const layer = ensureDropdownLayer();
  layer.innerHTML = `<div class="item-results dropdown-panel">${itemRowsHtml(items)}</div>`;
  layer.hidden = false;
  dropdown.anchor = anchor;
  positionDropdown();
  layer.querySelectorAll('.item-row').forEach((el) => {
    el.addEventListener('mousedown', (event) => {
      event.preventDefault();
      onPick(Number(el.dataset.itemId));
      hideDropdown();
    });
  });
}

function hideDropdown() {
  if (!dropdown.layer) return;
  dropdown.layer.hidden = true;
  dropdown.layer.innerHTML = '';
  dropdown.anchor = null;
}
