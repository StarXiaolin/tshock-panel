'use strict';

/* 动作：插件与外观
 *
 * 从 42-actions.js 的 handleAction switch 原样搬出（仅搬运，未改逻辑）。
 * 约定：命中的 case 自己 return（返回值被外层忽略）；未命中时 default 返回 false。
 * action 名称全局唯一，所以“命中后继续尝试下一组”不会误执行别的分支。
 */

async function pluginThemeActions(action, el) {
  switch (action) {
    case 'refresh-plugins':
      await loadPlugins();
      toast('已刷新');
      return;
    case 'upload-plugin':
      $('#plugin-file').click();
      return;
    case 'delete-plugin': {
      const ok = await confirmDialog(
        '删除插件',
        `确定删除「${el.dataset.name}」吗？文件会移到回收站，重启服务器后生效。`,
        '删除',
      );
      if (!ok) return;
      try {
        await api('/api/plugins/delete', { method: 'POST', body: { name: el.dataset.name } });
        toast('已移入回收站，重启服务器后生效');
        await loadPlugins();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'plugin-config': {
      const name = el.dataset.config || `${el.dataset.plugin}.json`;
      await openPluginConfig(name);
      return;
    }
    case 'apm-list':
    case 'apm-on':
    case 'apm-off': {
      const kind = action === 'apm-list' ? 'list' : action === 'apm-on' ? 'on' : 'off';
      try {
        const res = await api('/api/plugins/apm', {
          method: 'POST',
          body: { action: kind, index: Number($('#apm-index').value) },
        });
        $('#apm-output').textContent = (res.output || []).join('\n');
        toast('已执行 ' + res.command);
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    case 'set-theme': {
      await saveUi({ theme: el.dataset.theme });
      renderAppearanceForm();
      return;
    }
    case 'export-theme': {
      const styles = getComputedStyle(document.documentElement);
      const theme = {};
      for (const [key, cssVar] of Object.entries(UI_COLOR_TOKENS)) theme[key] = styles.getPropertyValue(cssVar).trim();
      for (const [key, cssVar] of Object.entries(UI_META_TOKENS)) theme[key] = styles.getPropertyValue(cssVar).trim();
      // 带上底子主题，导出再导入才能真正复现当前外观（否则按夜间底子重算）
      theme.baseTheme = appUi.theme === 'custom'
        ? (appUi.customTheme && appUi.customTheme.baseTheme) || 'dark'
        : appUi.theme;
      $('#theme-json').value = JSON.stringify(theme, null, 2);
      toast('已导出当前主题 JSON');
      return;
    }
    case 'import-theme': {
      let theme;
      try {
        theme = JSON.parse($('#theme-json').value);
      } catch (err) {
        return toast('JSON 格式错误：' + err.message, 'error');
      }
      try {
        validateTheme(theme);
      } catch (err) {
        return toast(err.message, 'error');
      }
      appUi.customTheme = theme;
      await saveUi({ theme: 'custom' });
      toast('自定义主题已应用');
      renderAppearanceForm();
      return;
    }
    case 'reset-theme': {
      appUi.customTheme = null;
      await saveUi({ theme: 'dark' });
      toast('已恢复默认夜间主题');
      renderAppearanceForm();
      renderColorEditor();
      return;
    }
    case 'apply-custom-colors': {
      await saveCustomColors();
      return;
    }
    case 'reset-custom-colors': {
      await resetCustomColors();
      return;
    }
    default:
      return false;
  }
}
