'use strict';

/* 服务器设置：150+ 配置项表单、MOTD/规则模板
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

const MOTD_TEMPLATE = [
  '[c/55D284:==== 欢迎来到 %map% ====]',
  '[c/8EA2BD:在线玩家 %onlineplayers%/%serverslots%]  [c/FFFF00:%players%]',
  '',
  '[c/55D284:【注册】] [c/FFFFFF:第一次进入服务器，输入] [c/FFFF00:%specifier%register 你的密码]',
  '[c/55D284:【登录】] [c/FFFFFF:已有账号，输入] [c/FFFF00:%specifier%login 你的密码]',
  '[c/8EA2BD:账号名与角色名相同，密码至少 4 位；请不要与其他网站使用同一个密码。]',
  '',
  '[c/55D284:【改密】] [c/FFFFFF:%specifier%password 旧密码 新密码]',
  '[c/55D284:【规则】] [c/FFFFFF:%specifier%rules]    [c/55D284:【命令】] [c/FFFFFF:%specifier%help]',
  '',
  '[c/8EA2BD:不登录也能游玩，但注册后才会保存权限与账号，也能防止别人冒用你的角色名。]',
  '[c/8EA2BD:EN: %specifier%register <password>  /  %specifier%login <password>]',
].join('\n');

async function loadSettings() {
  try {
    const data = await api('/api/config');
    app.config = data.settings;
    app.schema = data.schema;
    app.originalSettings = JSON.parse(JSON.stringify(data.settings));
    renderSettings();
    $('#raw-config').value = JSON.stringify(data.settings, null, 2);
  } catch (err) {
    toast(err.message, 'error');
  }
  try {
    const ssc = await api('/api/sscconfig');
    app.ssc = ssc.settings;
    app.sscOriginal = JSON.parse(JSON.stringify(ssc.settings));
    renderSsc();
    $('#raw-ssc').value = JSON.stringify(ssc.settings, null, 2);
  } catch (err) {
    /* ignore */
  }
  try {
    const [motd, rules] = await Promise.all([api('/api/text?name=motd'), api('/api/text?name=rules')]);
    $('#text-motd').value = motd.content.replace(/\r\n/g, '\n');
    $('#text-rules').value = rules.content.replace(/\r\n/g, '\n');
  } catch (err) {
    /* ignore */
  }
  renderPanelSettings();
  await loadSscInventory();
  updateDirtyLabel();
}

function controlFor(key) {
  const settings = app.config;
  const value = settings[key];
  const enums = (app.schema && app.schema.enums) || {};
  const sensitive = (app.schema?.sensitive || []).includes(key);

  if (enums[key]) {
    const opts = enums[key]
      .map((o) => `<option value="${esc(o.value)}" ${String(value) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`)
      .join('');
    const extra = enums[key].some((o) => String(o.value) === String(value)) ? '' : `<option value="${esc(value)}" selected>${esc(value)}（未知）</option>`;
    return `<select class="input" data-key="${esc(key)}" data-kind="enum">${extra}${opts}</select>`;
  }
  if (typeof value === 'boolean') {
    return `<label class="switch"><input type="checkbox" data-key="${esc(key)}" data-kind="bool" ${value ? 'checked' : ''} /><span></span></label>`;
  }
  if (typeof value === 'number') {
    return `<input class="input num-input" type="number" data-key="${esc(key)}" data-kind="number" value="${value}" />`;
  }
  if (Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number')) {
    return `<input class="input color-input" type="color" data-key="${esc(key)}" data-kind="color" value="${rgbToHex(value)}" />`;
  }
  if (sensitive) {
    return `<input class="input" type="password" data-key="${esc(key)}" data-kind="text" value="${esc(value)}" />`;
  }
  if (typeof value === 'string') {
    return `<input class="input" type="text" data-key="${esc(key)}" data-kind="text" value="${esc(value)}" />`;
  }
  return `<span class="muted">复杂结构，请用原始 JSON 编辑</span>`;
}

function renderSettings() {
  const container = $('#settings-form');
  const groups = app.schema.groups;
  container.innerHTML = groups
    .map((group) => {
      const open = app.settingsOpen.has(group.id);
      const rows = group.items
        .map((item) => {
          const key = item.key;
          if (!(key in app.config)) return '';
          const label = item.label || key;
          return `<div class="setting" data-key-row="${esc(key)}" data-search="${esc((label + ' ' + key + ' ' + (item.hint || '')).toLowerCase())}">
            <div class="setting-info">
              <b>${esc(label)}</b>
              <code>${esc(key)}</code>
              ${item.hint ? `<p>${esc(item.hint)}</p>` : ''}
            </div>
            <div class="setting-control">${controlFor(key)}</div>
          </div>`;
        })
        .join('');
      return `<div class="group ${open ? 'open' : ''}" data-group="${esc(group.id)}">
        <div class="group-head" data-action="toggle-group" data-group="${esc(group.id)}">
          <div>
            <h3>${esc(group.title)}</h3>
            <p>${esc(group.desc || '')}</p>
          </div>
          <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 6l6 6-6 6z"/></svg>
        </div>
        <div class="group-body">${rows}</div>
      </div>`;
    })
    .join('');

  $$('#settings-form [data-key]').forEach((el) => {
    el.addEventListener('change', onSettingChange);
    el.addEventListener('input', onSettingChange);
  });
  applySettingsFilter();
}

function onSettingChange(event) {
  const row = event.target.closest('.setting');
  if (!row) return;
  const key = event.target.dataset.key;
  const dirty = !sameValue(currentControlValue(event.target), app.originalSettings[key], event.target.dataset.kind);
  row.classList.toggle('dirty', dirty);
  updateDirtyCount();
}

function currentControlValue(el) {
  const kind = el.dataset.kind;
  if (kind === 'bool') return el.checked;
  if (kind === 'number') return Number(el.value);
  if (kind === 'color') return hexToRgb(el.value);
  return el.value;
}

function sameValue(a, b, kind) {
  if (kind === 'color') return Array.isArray(b) && a.length === 3 && a.every((v, i) => Number(v) === Number(b[i]));
  if (kind === 'number') return Number(a) === Number(b);
  if (kind === 'bool') return !!a === !!b;
  return String(a) === String(b);
}

function collectSettings() {
  const out = {};
  $$('#settings-form [data-key]').forEach((el) => {
    out[el.dataset.key] = currentControlValue(el);
  });
  return out;
}

function collectChangedSettings() {
  const all = collectSettings();
  const out = {};
  for (const [key, value] of Object.entries(all)) {
    if (!(key in app.originalSettings)) continue;
    const kind = kindOf(app.originalSettings[key]);
    if (!sameValue(value, app.originalSettings[key], kind)) out[key] = value;
  }
  return out;
}

function kindOf(value) {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'color';
  return 'text';
}

function updateDirtyLabel() {
  const count = Object.keys(collectChangedSettings()).length;
  $('#settings-dirty').textContent = count ? `${count} 项已修改` : '';
}

function updateDirtyCount() {
  updateDirtyLabel();
}

function applySettingsFilter() {
  const q = ($('#settings-search').value || '').trim().toLowerCase();
  $$('#settings-form .group').forEach((group) => {
    let visible = 0;
    $$('.setting', group).forEach((row) => {
      const hit = !q || (row.dataset.search || '').includes(q);
      row.style.display = hit ? '' : 'none';
      if (hit) visible += 1;
    });
    group.style.display = visible || !q ? '' : 'none';
    if (q && visible) group.classList.add('open');
  });
}

function renderSsc() {
  const box = $('#ssc-form');
  const settings = app.ssc || {};
  const defs = [
    ['Enabled', '启用服务端角色存档', '开启后玩家的角色数据由服务器保存（SSC）。'],
    ['StartingHealth', '初始生命值', '新角色进入时的生命值。'],
    ['StartingMana', '初始魔力值', '新角色进入时的魔力值。'],
    ['ServerSideCharacterSave', '自动保存间隔（分钟）', '服务端角色数据的保存间隔。'],
    ['LogonDiscardThreshold', '登录丢弃阈值', '低于该数值的判定丢弃，避免误伤。'],
    ['WarnPlayersAboutBypassPermission', '提示绕过权限', '玩家使用绕过权限时给出提示。'],
    ['KeepPlayerAppearance', '保留外观', 'SSC 模式下保留玩家上传的外观。'],
  ];
  box.innerHTML = defs
    .filter(([key]) => key in settings)
    .map(([key, label, hint]) => {
      const value = settings[key];
      let control;
      if (typeof value === 'boolean') {
        control = `<label class="switch"><input type="checkbox" data-ssc="${esc(key)}" data-kind="bool" ${value ? 'checked' : ''} /><span></span></label>`;
      } else if (typeof value === 'number') {
        control = `<input class="input num-input" type="number" data-ssc="${esc(key)}" data-kind="number" value="${value}" />`;
      } else {
        control = `<input class="input" type="text" data-ssc="${esc(key)}" data-kind="text" value="${esc(value)}" />`;
      }
      return `<div class="setting">
        <div class="setting-info"><b>${esc(label)}</b><code>${esc(key)}</code><p>${esc(hint)}</p></div>
        <div class="setting-control">${control}</div>
      </div>`;
    })
    .join('');
}

function renderPanelSettings() {
  const s = app.state;
  if (!s) return;
  $('#panel-worlds-dir').value = s.paths.worldsDir;
  $('#panel-rest-port').value = s.rest.port;
  $('#panel-backup-on-start').checked = !!s.backupOnStart;
  $('#panel-auto-restart').checked = !!s.autoRestart;
}
