'use strict';

/* 动作：服务器设置与文本
 *
 * 从 42-actions.js 的 handleAction switch 原样搬出（仅搬运，未改逻辑）。
 * 约定：命中的 case 自己 return（返回值被外层忽略）；未命中时 default 返回 false。
 * action 名称全局唯一，所以“命中后继续尝试下一组”不会误执行别的分支。
 */

async function settingsActions(action, el) {
  switch (action) {
    case 'save-config':
      await saveConfig();
      return;
    case 'reload-config':
      await loadSettings();
      toast('已重新读取配置');
      return;
    case 'toggle-raw-config': {
      const card = $('#raw-config-card');
      card.hidden = !card.hidden;
      if (!card.hidden) $('#raw-config').value = JSON.stringify(app.config || {}, null, 2);
      return;
    }
    case 'save-raw-config': {
      try {
        await api('/api/config', { method: 'POST', body: { raw: $('#raw-config').value } });
        toast('配置已写入，重启服务器后生效');
        await loadSettings();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'save-ssc': {
      const settings = {};
      $$('#ssc-form [data-ssc]').forEach((input) => {
        const kind = input.dataset.kind;
        settings[input.dataset.ssc] = kind === 'bool' ? input.checked : kind === 'number' ? Number(input.value) : input.value;
      });
      try {
        await api('/api/sscconfig', { method: 'POST', body: { settings } });
        toast('SSC 设置已保存，重启后生效');
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'save-raw-ssc':
      try {
        await api('/api/sscconfig', { method: 'POST', body: { raw: $('#raw-ssc').value } });
        toast('已写入 sscconfig.json');
        await loadSettings();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    case 'save-text': {
      const name = el.dataset.name;
      const content = $(`#text-${name}`).value;
      try {
        await api('/api/text', { method: 'POST', body: { name, content } });
        toast('已保存，执行 /reload 或重启服务器后生效');
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'insert-motd-template': {
      const el = $('#text-motd');
      if (!el) return;
      if (el.value.includes('【注册】')) {
        toast('公告里已经有注册/登录说明了');
        return;
      }
      el.value = el.value.trim() ? el.value.replace(/\s*$/, '') + '\n\n' + MOTD_TEMPLATE : MOTD_TEMPLATE;
      toast('已插入模板，确认后点「保存」');
      return;
    }
    case 'save-panel': {
      try {
        await api('/api/settings/panel', {
          method: 'POST',
          body: {
            worldsDir: $('#panel-worlds-dir').value.trim(),
            restPort: Number($('#panel-rest-port').value),
            backupOnStart: $('#panel-backup-on-start').checked,
            autoRestart: $('#panel-auto-restart').checked,
          },
        });
        toast('面板设置已保存');
        await refreshState();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    default:
      return false;
  }
}
