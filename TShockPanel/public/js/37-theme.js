'use strict';

/* 外观：三套主题、字号/密度、自定义主题导入导出
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* 主题与外观                                                          */
/* ------------------------------------------------------------------ */

const THEME_ORDER = ['dark', 'light', 'high-contrast'];
const THEME_LABELS = { dark: '夜间', light: '日间', 'high-contrast': '高对比度', custom: '自定义' };
const UI_COLOR_TOKENS = {
  background: '--bg',
  surface: '--panel',
  foreground: '--text',
  mutedForeground: '--muted',
  accent: '--accent',
  danger: '--rose',
  success: '--accent-2',
  warning: '--amber',
  border: '--line',
  selection: '--selection',
  inputBackground: '--input-bg',
};
const UI_META_TOKENS = {
  fontFamily: '--font-family',
  baseFontSize: '--base-font-size',
  radius: '--radius',
  spacing: '--space-unit',
  buttonMinHeight: '--button-min-height',
};

function isColorValue(value) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) || /^rgba?\([\d\s.,%]+\)$/i.test(value) || /^hsla?\([\d\s.,%]+\)$/i.test(value);
}

function isLengthValue(value) {
  return /^\d+(\.\d+)?(px|rem|em|%)$/.test(String(value));
}

function validateTheme(theme) {
  if (!theme || typeof theme !== 'object') throw new Error('主题必须是一个 JSON 对象');
  const missing = Object.keys(UI_COLOR_TOKENS).filter((key) => !(key in theme));
  if (missing.length) throw new Error('缺少令牌：' + missing.join('、'));
  for (const key of Object.keys(UI_COLOR_TOKENS)) {
    if (!isColorValue(String(theme[key]))) throw new Error(`令牌 ${key} 不是合法颜色：${theme[key]}`);
  }
  const metaMissing = Object.keys(UI_META_TOKENS).filter((key) => !(key in theme));
  if (metaMissing.length) throw new Error('缺少令牌：' + metaMissing.join('、'));
  for (const key of ['baseFontSize', 'radius', 'spacing', 'buttonMinHeight']) {
    if (!isLengthValue(theme[key])) throw new Error(`令牌 ${key} 需要带单位（例如 14px）：${theme[key]}`);
  }
  if (typeof theme.fontFamily !== 'string' || !theme.fontFamily.trim()) throw new Error('fontFamily 不能为空');
  return true;
}

/* 主色改变后，悬停/浅色/文字色等派生令牌也要跟着变，否则会出现“紫色主色 + 绿色按钮” */
const ACCENT_DERIVED_VARS = ['--accent-hover', '--accent-2', '--accent-ink', '--accent-text', '--selection'];

function hexToHsl(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lig = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  let rgb;
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return (
    '#' +
    rgb
      .map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

function accentFamily(accent, panelColor) {
  const hsl = hexToHsl(accent);
  if (!hsl) return null;
  const panelHsl = hexToHsl(panelColor) || { l: 12 };
  const lightPanel = panelHsl.l > 50;
  return {
    '--accent-hover': hslToHex(hsl.h, hsl.s, hsl.l + (lightPanel ? -7 : 9)),
    '--accent-2': hslToHex(hsl.h, hsl.s, hsl.l + (lightPanel ? -12 : -6)),
    '--accent-ink': hsl.l > 62 ? '#0b131d' : '#ffffff',
    '--accent-text': hslToHex(hsl.h, Math.min(100, hsl.s + 4), lightPanel ? Math.max(18, hsl.l - 22) : Math.min(88, hsl.l + 26)),
  };
}

/** 把主色派生令牌写进根元素（主色变化时立即生效，不需要等保存） */
function applyAccentFamily(accent, panelColor) {
  const family = accentFamily(accent, panelColor);
  if (!family) return;
  const root = document.documentElement;
  for (const [cssVar, value] of Object.entries(family)) root.style.setProperty(cssVar, value);
}

function applyCustomTheme(theme) {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(UI_COLOR_TOKENS)) {
    // 自定义配色允许只写一部分令牌，缺的留给底层主题；写 undefined 会把变量变成字符串 "undefined"
    if (typeof theme[key] === 'string' && theme[key]) root.style.setProperty(cssVar, theme[key]);
  }
  for (const [key, cssVar] of Object.entries(UI_META_TOKENS)) {
    if (typeof theme[key] === 'string' && theme[key]) root.style.setProperty(cssVar, theme[key]);
  }
  // 主色派生：避免只换主色时按钮/悬停色仍是旧主题的绿
  if (typeof theme.accent === 'string' && theme.accent) {
    applyAccentFamily(theme.accent, theme.surface || theme.background || '#111a26');
  }
}

function clearCustomTheme() {
  const root = document.documentElement;
  for (const cssVar of [...Object.values(UI_COLOR_TOKENS), ...Object.values(UI_META_TOKENS), ...ACCENT_DERIVED_VARS]) {
    root.style.removeProperty(cssVar);
  }
}

function applyUi() {
  const root = document.documentElement;
  // 自定义配色 = “底子主题 + 覆盖值”，所以 data-theme 仍然指向真实的底子主题
  const base = appUi.theme === 'custom' ? (appUi.customTheme && appUi.customTheme.baseTheme) || 'dark' : appUi.theme;
  root.dataset.theme = base;
  if (appUi.theme === 'custom' && appUi.customTheme) applyCustomTheme(appUi.customTheme);
  else clearCustomTheme();
  root.style.setProperty('--ui-scale', String(appUi.fontScale || 1));
  root.style.setProperty('--icon-size', `${appUi.iconSize || 18}px`);
  document.body.dataset.density = appUi.density || 'comfortable';
  document.body.dataset.labels = appUi.showLabels === false ? 'off' : 'on';
}

async function loadUi() {
  try {
    const data = await api('/api/ui');
    appUi.theme = data.theme || 'dark';
    appUi.fontScale = Number(data.fontScale) || 1;
    appUi.density = data.density || 'comfortable';
    appUi.iconSize = Number(data.iconSize) || 18;
    appUi.showLabels = data.showLabels !== false;
    const custom = data.customThemes && data.customThemes[appUi.theme];
    appUi.customTheme = custom || null;
  } catch (err) {
    /* 读取失败就用默认值，不影响使用 */
  }
  applyUi();
}

async function saveUi(patch = {}) {
  Object.assign(appUi, patch);
  applyUi();
  try {
    const body = {
      theme: appUi.theme,
      fontScale: appUi.fontScale,
      density: appUi.density,
      iconSize: appUi.iconSize,
      showLabels: appUi.showLabels,
    };
    if (Object.prototype.hasOwnProperty.call(patch, 'customThemes')) {
      // 显式清除（传 {}）或由其他入口改写时，以 patch 为准
      body.customThemes = patch.customThemes;
    } else if (appUi.theme === 'custom' && appUi.customTheme) {
      body.customThemes = { custom: appUi.customTheme };
    }
    const data = await api('/api/ui', { method: 'POST', body });
    if (data.customThemes && data.customThemes.custom && appUi.theme === 'custom') {
      appUi.customTheme = data.customThemes.custom;
    }
  } catch (err) {
    toast(err.message, 'error');
  }
  renderThemeGrid();
}

function renderThemeGrid() {
  const box = $('#theme-grid');
  if (!box) return;
  const themes = [...THEME_ORDER];
  if (appUi.customTheme) themes.push('custom');
  box.innerHTML = themes
    .map(
      (key) => `<button class="theme-card ${appUi.theme === key ? 'active' : ''}" data-action="set-theme" data-theme="${key}">
        <span class="theme-preview theme-${key}"></span>
        <span class="theme-name">${THEME_LABELS[key] || key}</span>
      </button>`,
    )
    .join('');
}

function renderAppearanceForm() {
  const scale = $('#ui-font-scale');
  if (!scale) return;
  scale.value = String(appUi.fontScale);
  $('#ui-density').value = appUi.density;
  $('#ui-icon-size').value = String(appUi.iconSize >= 22 ? 22 : 18);
  $('#ui-show-labels').checked = appUi.showLabels !== false;
}

async function loadAppearance() {
  renderAppearanceForm();
  renderThemeGrid();
  renderColorEditor();
}

/* ------------------------------------------------------------------ */
/* 自定义配色：色板编辑器                                             */
/* ------------------------------------------------------------------ */

/* 只开放实色令牌；带透明度的 --selection 留给 JSON 导入，避免 color 输入框丢 alpha */
const COLOR_EDITOR_FIELDS = [
  ['background', '页面背景'],
  ['surface', '卡片'],
  ['foreground', '主要文字'],
  ['mutedForeground', '次要文字'],
  ['accent', '主色'],
  ['border', '边框'],
  ['inputBackground', '输入框'],
  ['danger', '危险'],
  ['warning', '警告'],
  ['success', '成功'],
];

/** 把计算后颜色统一成 #rrggbb（color 输入框只接受这种） */
function toHexColor(value) {
  const text = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return ('#' + text[1] + text[1] + text[2] + text[2] + text[3] + text[3]).toLowerCase();
  }
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(text);
  if (m) {
    const hex = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0');
    return '#' + hex(m[1]) + hex(m[2]) + hex(m[3]);
  }
  return '#000000';
}

/** 当前页面实际生效的颜色（来自计算后的 CSS 变量） */
function currentColorMap() {
  const styles = getComputedStyle(document.documentElement);
  const map = {};
  for (const [key, cssVar] of Object.entries(UI_COLOR_TOKENS)) {
    map[key] = toHexColor(styles.getPropertyValue(cssVar));
  }
  return map;
}

let colorDraft = null;

function renderColorEditor() {
  const box = $('#color-editor');
  if (!box) return;
  const draft = currentColorMap();
  if (appUi.theme === 'custom' && appUi.customTheme) {
    for (const key of Object.keys(UI_COLOR_TOKENS)) {
      if (typeof appUi.customTheme[key] === 'string') draft[key] = toHexColor(appUi.customTheme[key]);
    }
  }
  colorDraft = draft;
  box.innerHTML = COLOR_EDITOR_FIELDS.map(
    ([key, label]) => `<label class="color-field">
      <span class="color-name">${label}</span>
      <input type="color" data-color-key="${key}" value="${draft[key]}" />
      <code data-color-text="${key}">${draft[key]}</code>
    </label>`,
  ).join('');
  bindColorEditor();
  const hint = $('#color-editor-hint');
  if (hint) {
    hint.textContent = appUi.theme === 'custom' ? '当前为自定义配色；修改后点「应用配色」保存' : '从当前主题开始调，不点「应用配色」不会保存';
  }
}

/** 输入即预览：直接改根元素的 CSS 变量，不落盘 */
function bindColorEditor() {
  const box = $('#color-editor');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  box.addEventListener('input', (event) => {
    const input = event.target.closest('input[type="color"]');
    if (!input) return;
    const key = input.dataset.colorKey;
    if (!key || !UI_COLOR_TOKENS[key]) return;
    if (!colorDraft) colorDraft = currentColorMap();
    colorDraft[key] = input.value;
    const text = box.querySelector(`[data-color-text="${key}"]`);
    if (text) text.textContent = input.value;
    document.documentElement.style.setProperty(UI_COLOR_TOKENS[key], input.value);
    // 主色/卡片色变动时，悬停色与文字色也跟着预览
    if (key === 'accent' || key === 'surface' || key === 'background') {
      applyAccentFamily(colorDraft.accent, colorDraft.surface || colorDraft.background);
    }
  });
}

/** 把色板拼成完整主题（含 16 个令牌，保证与 JSON 导入/导出的校验兼容） */
function buildCustomTheme() {
  const styles = getComputedStyle(document.documentElement);
  const baseTheme = THEME_ORDER.includes(appUi.theme)
    ? appUi.theme
    : (appUi.customTheme && appUi.customTheme.baseTheme) || 'dark';
  const theme = { baseTheme };
  const draft = colorDraft || currentColorMap();
  for (const [key, cssVar] of Object.entries(UI_COLOR_TOKENS)) {
    theme[key] = draft[key] || toHexColor(styles.getPropertyValue(cssVar));
  }
  // 选区颜色跟随主色（半透明），避免换了主色后选中文字还是旧主题的绿
  if (hexToHsl(draft.accent)) {
    const rgb = [draft.accent.slice(1, 3), draft.accent.slice(3, 5), draft.accent.slice(5, 7)].map((h) => parseInt(h, 16));
    theme.selection = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.18)`;
  }
  for (const [key, cssVar] of Object.entries(UI_META_TOKENS)) {
    theme[key] = styles.getPropertyValue(cssVar).trim() || (key === 'fontFamily' ? 'system-ui' : '0px');
  }
  return theme;
}

async function saveCustomColors() {
  const theme = buildCustomTheme();
  appUi.customTheme = theme;
  await saveUi({ theme: 'custom' });
  toast('自定义配色已应用');
  renderColorEditor();
}

async function resetCustomColors() {
  const base = (appUi.customTheme && appUi.customTheme.baseTheme) || 'dark';
  appUi.customTheme = null;
  colorDraft = null;
  await saveUi({ theme: THEME_ORDER.includes(base) ? base : 'dark', customThemes: {} });
  renderColorEditor();
  toast('已清除自定义配色');
}
