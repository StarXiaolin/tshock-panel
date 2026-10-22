'use strict';

/* 控制台：日志渲染、筛选、导出
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 日志                                                                */
/* ------------------------------------------------------------------ */

function lineHtml(item) {
  const stream = item.stream || 'stdout';
  const meta = [];
  if (item.count > 1) meta.push('×' + item.count);
  if (item.hidden > 0) meta.push(`已省略 ${item.hidden} 行`);
  return `<div class="line log-${esc(stream)}" data-id="${item.id}"><span class="ts">${fmtClock(item.t)}</span><span class="txt">${esc(item.text)}</span>${meta.length ? `<span class="meta">${meta.join(' · ')}</span>` : ''}</div>`;
}

function updateLogLine(partial) {
  const last = app.logs[app.logs.length - 1];
  if (!last || last.id !== partial.id) return;
  Object.assign(last, partial);
  const html = lineHtml(last);
  for (const sel of ['#console', '#dash-log']) {
    const el = document.querySelector(`${sel} [data-id="${last.id}"]`);
    if (el) el.outerHTML = html;
  }
}

function matchesFilter(item) {
  if (app.consoleFilter === 'all') return true;
  if (app.consoleFilter === 'error') {
    return item.stream === 'stderr' || /error|错误|异常|exception|失败|warn/i.test(item.text);
  }
  if (app.consoleFilter === 'cmd') return item.stream === 'input' || item.stream === 'output' || item.stream === 'panel';
  return true;
}

function appendLog(item) {
  if (!item || item.id <= app.lastLogId) return;
  app.lastLogId = item.id;
  app.logs.push(item);
  if (app.logs.length > 4000) app.logs.splice(0, app.logs.length - 4000);

  if (app.view === 'console' && item.id > app.consoleClearedAt && matchesFilter(item)) {
    const box = $('#console');
    box.insertAdjacentHTML('beforeend', lineHtml(item));
    while (box.childElementCount > 2000) box.firstElementChild.remove();
    if ($('#console-autoscroll').checked) box.scrollTop = box.scrollHeight;
  }
  if (app.view === 'dashboard') {
    const mini = $('#dash-log');
    mini.insertAdjacentHTML('beforeend', lineHtml(item));
    while (mini.childElementCount > 150) mini.firstElementChild.remove();
    mini.scrollTop = mini.scrollHeight;
  }
}

function renderConsole() {
  const box = $('#console');
  const items = app.logs.filter((it) => it.id > app.consoleClearedAt && matchesFilter(it));
  const slice = items.slice(-1500);
  box.innerHTML = slice.map((it) => lineHtml(it)).join('');
  box.scrollTop = box.scrollHeight;
}

async function loadConsole() {
  if (app.logs.length === 0) {
    try {
      const data = await api('/api/logs?limit=300');
      for (const item of data.items) {
        app.logs.push(item);
        app.lastLogId = Math.max(app.lastLogId, item.id);
      }
    } catch (err) {
      /* ignore */
    }
  }
  renderConsole();
}

function downloadLog() {
  const text = app.logs.map((it) => `[${fmtTime(it.t)}] [${it.stream}] ${it.text}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tshock-console-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
