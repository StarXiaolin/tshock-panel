'use strict';

/* 插件管理：DLL 列表、配置编辑、APM 探测
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 插件管理                                                            */
/* ------------------------------------------------------------------ */

async function loadPlugins() {
  try {
    const data = await api('/api/plugins');
    app.plugins = data.plugins || [];
    app.pluginConfigs = data.configs || [];
    renderPlugins(data);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderPlugins(data) {
  const running = data ? data.running : isRunning();
  const pbody = $('#plugins-table tbody');
  const list = app.plugins || [];
  $('#plugin-count').textContent = `共 ${list.length} 个 DLL`;
  if (!list.length) {
    pbody.innerHTML = '<tr><td colspan="4"><div class="empty">ServerPlugins 里没有插件</div></td></tr>';
  } else {
    pbody.innerHTML = list
      .map(
        (p) => `<tr>
        <td><b>${esc(p.name)}</b></td>
        <td>${fmtBytes(p.size)}</td>
        <td><span class="muted">${fmtTime(p.modified)}</span></td>
        <td><div class="cell-actions">
          <button class="btn btn-ghost sm" data-action="plugin-config" data-plugin="${esc(p.name.replace(/\.dll$/i, ''))}">查看配置</button>
          <button class="btn btn-danger sm" data-action="delete-plugin" data-name="${esc(p.name)}">删除</button>
        </div></td>
      </tr>`,
      )
      .join('');
  }

  const cbody = $('#plugin-configs-table tbody');
  const configs = app.pluginConfigs || [];
  if (!configs.length) {
    cbody.innerHTML = '<tr><td colspan="4"><div class="empty">tshock/ 下没有插件配置文件</div></td></tr>';
  } else {
    cbody.innerHTML = configs
      .map(
        (c) => `<tr>
        <td><b>${esc(c.name)}</b></td>
        <td>${fmtBytes(c.size)}</td>
        <td><span class="muted">${fmtTime(c.modified)}</span></td>
        <td><button class="btn btn-ghost sm" data-action="plugin-config" data-config="${esc(c.name)}">编辑</button></td>
      </tr>`,
      )
      .join('');
  }

  const startedAt = app.state && app.state.server ? app.state.server.startedAt : 0;
  const pending = running && startedAt && list.some((p) => p.modified > startedAt) ||
    running && startedAt && configs.some((c) => c.modified > startedAt);
  const banner = $('#plugin-banner');
  if (banner) {
    banner.className = pending ? 'notice danger' : 'notice';
    banner.innerHTML = pending
      ? '检测到插件文件在服务器启动后被修改，<strong>需要重启服务器</strong>才会生效。'
      : '插件文件的增删改都需要<strong>重启服务器</strong>才会生效；TShock 没有提供运行时热重载或卸载插件的接口。';
  }

  const apmCard = $('#apm-card');
  if (apmCard) {
    const apm = data && data.apm ? data.apm : { detected: false, reason: '服务器未运行' };
    apmCard.hidden = !apm.detected;
    if (apm.detected && apm.output) {
      $('#apm-output').textContent = apm.output.join('\n');
    }
  }
}

async function openPluginConfig(name) {
  try {
    const data = await api('/api/plugins/config?name=' + encodeURIComponent(name));
    const result = await modal({
      title: `编辑 ${name}`,
      desc: '保存前会自动备份原文件；JSON 解析失败不会写入。',
      okText: '保存',
      fields: [{ id: 'content', label: '内容', type: 'textarea', rows: 16, value: data.content }],
    });
    if (!result) return;
    await api('/api/plugins/config', { method: 'POST', body: { name, content: result.content } });
    toast('已保存，重启服务器后生效');
    await loadPlugins();
  } catch (err) {
    toast(err.message, 'error');
  }
}
