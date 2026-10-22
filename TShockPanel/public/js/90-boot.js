'use strict';

/* 启动：全局事件绑定
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 事件绑定                                                            */
/* ------------------------------------------------------------------ */

function bindEvents() {
  $$('.nav-item').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    event.preventDefault();
    handleAction(el.dataset.action, el).catch((err) => toast(err.message, 'error'));
  });

  $('#btn-start').addEventListener('click', () => $('#launch-go').click());
  $('#btn-stop').addEventListener('click', (e) => handleAction('stop', e.currentTarget));
  $('#btn-restart').addEventListener('click', (e) => handleAction('restart', e.currentTarget));

  $('#launch-go').addEventListener('click', async () => {
    const worldPath = $('#launch-world').value;
    if (!worldPath) {
      toast('请先选择世界存档', 'error');
      return;
    }
    try {
      await api('/api/server/start', { method: 'POST', body: { worldPath } });
      toast('正在启动服务器…');
      switchView('console');
      refreshState();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // 控制台
  $('#console-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#console-cmd');
    const value = input.value;
    input.value = '';
    await sendCommand(value);
  });

  $('#console-cmd').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' && app.history.length) {
      event.preventDefault();
      app.historyIndex = app.historyIndex < 0 ? app.history.length - 1 : Math.max(0, app.historyIndex - 1);
      $('#console-cmd').value = app.history[app.historyIndex] || '';
    } else if (event.key === 'ArrowDown' && app.history.length) {
      event.preventDefault();
      if (app.historyIndex >= 0) {
        app.historyIndex += 1;
        if (app.historyIndex >= app.history.length) {
          app.historyIndex = -1;
          $('#console-cmd').value = '';
        } else {
          $('#console-cmd').value = app.history[app.historyIndex];
        }
      }
    }
  });

  $('#quick-cmds').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-cmd]');
    if (!btn) return;
    sendCommand(btn.dataset.cmd);
  });

  $('#console-filter').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-filter]');
    if (!btn) return;
    app.consoleFilter = btn.dataset.filter;
    $$('#console-filter button').forEach((b) => b.classList.toggle('active', b === btn));
    renderConsole();
  });

  // 世界
  $('#world-search').addEventListener('input', renderWorlds);
  $('#world-file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    uploadWorld(file);
  });

  // 物品发放
  const giveSearch = $('#give-search');
  if (giveSearch) {
    let timer = null;
    giveSearch.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(renderGiveResults, 120);
    });
    giveSearch.addEventListener('focus', renderGiveResults);
  }
  const giveSubmit = $('#give-submit');
  if (giveSubmit) giveSubmit.addEventListener('click', () => handleAction('give-item', giveSubmit));

  // 账户搜索
  const userSearch = $('#user-search');
  if (userSearch) userSearch.addEventListener('input', renderPlayers);

  // 传送点
  const warpSearch = $('#warp-search');
  if (warpSearch) {
    warpSearch.addEventListener('input', () => {
      warpState.search = warpSearch.value.trim();
      renderWarps();
    });
  }
  const warpAll = $('#warp-select-all');
  if (warpAll) {
    warpAll.addEventListener('change', () => {
      $$('#warps-table tbody .warp-pick').forEach((cb) => {
        cb.checked = warpAll.checked;
        if (warpAll.checked) warpState.selected.add(cb.dataset.name);
        else warpState.selected.delete(cb.dataset.name);
      });
    });
  }

  // 插件上传
  const pluginFile = $('#plugin-file');
  if (pluginFile) {
    pluginFile.addEventListener('change', async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        const res = await fetch('/api/plugins/upload?name=' + encodeURIComponent(file.name), {
          method: 'POST',
          body: file,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '上传失败');
        toast('插件已上传，重启服务器后生效');
        await loadPlugins();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // 外观设置
  const appearanceControls = [
    ['#ui-font-scale', () => ({ fontScale: Number($('#ui-font-scale').value) })],
    ['#ui-density', () => ({ density: $('#ui-density').value })],
    ['#ui-icon-size', () => ({ iconSize: Number($('#ui-icon-size').value) })],
    ['#ui-show-labels', () => ({ showLabels: $('#ui-show-labels').checked })],
  ];
  for (const [selector, build] of appearanceControls) {
    const el = $(selector);
    if (el) el.addEventListener('change', () => saveUi(build()));
  }

  // 玩家
  $('#ban-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/bans/add', {
        method: 'POST',
        body: {
          identifier: $('#ban-identifier').value.trim(),
          name: $('#ban-name').value.trim(),
          reason: $('#ban-reason').value.trim(),
        },
      });
      toast('已封禁');
      $('#ban-identifier').value = '';
      $('#ban-name').value = '';
      $('#ban-reason').value = '';
      await loadPlayers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#user-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/users/add', {
        method: 'POST',
        body: {
          user: $('#user-name').value.trim(),
          password: $('#user-pass').value,
          group: $('#user-group').value || 'guest',
        },
      });
      toast('账户已创建');
      $('#user-name').value = '';
      $('#user-pass').value = '';
      await loadPlayers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // 设置
  $('#settings-search').addEventListener('input', applySettingsFilter);
  $('#settings-tabs').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-tab]');
    if (!btn) return;
    $$('#settings-tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.tab === btn.dataset.tab));
  });
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('log', (event) => {
    try {
      appendLog(JSON.parse(event.data));
    } catch (err) {
      /* ignore */
    }
  });
  es.addEventListener('state', () => refreshState());
  es.addEventListener('logUpdate', (event) => {
    try {
      updateLogLine(JSON.parse(event.data));
    } catch (err) {
      /* ignore */
    }
  });
  es.addEventListener('notice', (event) => {
    try {
      const data = JSON.parse(event.data);
      toast(data.text || '提示', data.level === 'error' ? 'error' : 'ok');
    } catch (err) {
      /* ignore */
    }
  });
  es.onerror = () => {
    /* EventSource 会自动重连 */
  };
}

async function boot() {
  await loadUi();
  bindEvents();
  connectEvents();
  await refreshState();
  await loadWorlds(true);
  await loadConsole();
  renderDashboard();
  setInterval(async () => {
    if (document.hidden) return;
    if (app.view === 'dashboard' || app.view === 'players') await refreshState();
  }, 4000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshState();
  });
}

boot().catch((err) => {
  console.error(err);
  toast('面板初始化失败：' + err.message, 'error', 8000);
});
