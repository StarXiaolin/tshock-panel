'use strict';

/**
 * 面板外观偏好（主题/字号/密度/图标大小/自定义配色）的读写与校验。
 *
 * 这些偏好只写在面板自己的 dsh.ui.json 里，不碰 tshock/ 下的任何文件；
 * 文件损坏或缺失时一律回退到默认值，绝不因为一个偏好文件让面板起不来。
 *
 * 自定义配色由前端「外观 → 自定义配色」生成：一组 CSS 变量值 + 一个基础主题名。
 * 因为它最终会被写进 `documentElement.style`，所以**必须在这里做格式校验**：
 * 只允许 hex / rgb(a) / hsl(a) 三种颜色写法、只允许白名单里的令牌名，
 * 避免任意的 CSS 片段通过配色字段注入页面。
 */

const UI_DEFAULTS = {
  theme: 'dark',
  fontScale: 1,
  density: 'comfortable',
  iconSize: 18,
  showLabels: true,
  customThemes: {},
};

const FONT_SCALE_RANGE = { min: 0.5, max: 2 };
const ICON_SIZE_RANGE = { min: 12, max: 32 };

/** 自定义配色可以覆盖的颜色令牌（与前端 37-theme.js 的 UI_COLOR_TOKENS 一致）。 */
const THEME_COLOR_TOKENS = {
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

/** 自定义配色可以覆盖的非颜色令牌。 */
const THEME_META_TOKENS = {
  fontFamily: '--font-family',
  baseFontSize: '--base-font-size',
  radius: '--radius',
  spacing: '--space-unit',
  buttonMinHeight: '--button-min-height',
};

/** 自定义主题可以是「某个内置主题 + 覆盖值」，这里限定可选的底子。 */
const THEME_BASE_NAMES = ['dark', 'light', 'high-contrast'];

/** 允许的自定义主题名（目前只有用户自建的一个槽位）。 */
const CUSTOM_THEME_NAMES = ['custom'];

const COLOR_RE = /^(#([0-9a-f]{3}|[0-9a-f]{6})|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i;
const LENGTH_RE = /^\d+(\.\d+)?(px|rem|em|%)$/;

function validateCustomTheme(name, theme) {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    throw new Error(`主题「${name}」需要是一个对象`);
  }
  const allowed = new Set([...Object.keys(THEME_COLOR_TOKENS), ...Object.keys(THEME_META_TOKENS), 'baseTheme']);
  const unknown = Object.keys(theme).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`主题「${name}」含未知令牌：${unknown.join('、')}`);

  for (const [key, value] of Object.entries(theme)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`主题「${name}」的 ${key} 需要是非空字符串`);
    }
    if (key === 'baseTheme') {
      if (!THEME_BASE_NAMES.includes(value)) {
        throw new Error(`主题「${name}」的 baseTheme 只能是 ${THEME_BASE_NAMES.join(' / ')}`);
      }
      continue;
    }
    if (key in THEME_COLOR_TOKENS) {
      if (!COLOR_RE.test(value.trim())) throw new Error(`主题「${name}」的 ${key} 不是合法颜色：${value}`);
      continue;
    }
    if (key === 'fontFamily') continue;
    if (!LENGTH_RE.test(value.trim())) {
      throw new Error(`主题「${name}」的 ${key} 需要带单位（例如 14px）：${value}`);
    }
  }
}

/** 校验整份 customThemes；写入前调用，任何一项不合法都整体拒绝。 */
function validateCustomThemes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('customThemes 需要是一个对象');
  }
  for (const [name, theme] of Object.entries(value)) {
    if (!CUSTOM_THEME_NAMES.includes(name)) throw new Error(`不支持的自定义主题名：${name}`);
    validateCustomTheme(name, theme);
  }
}

function createUiState({ uiStatePath, readJsonFile, writeFileAtomic }) {
  /** 读当前偏好；文件缺失或不是对象时返回一份默认值副本。 */
  function read() {
    const data = readJsonFile(uiStatePath, null);
    if (!data || typeof data !== 'object') return { ...UI_DEFAULTS, customThemes: {} };
    return { ...UI_DEFAULTS, ...data, customThemes: data.customThemes || {} };
  }

  /**
   * 按部分字段更新偏好并落盘，返回新的完整偏好。
   * 只接受白名单里的字段，其余一律忽略（避免前端多传字段污染文件）。
   */
  function patch(body) {
    const input = body && typeof body === 'object' ? body : {};
    const next = { ...read() };
    for (const key of ['theme', 'density']) {
      if (key in input) next[key] = String(input[key]);
    }
    if ('fontScale' in input) {
      const scale = Number(input.fontScale);
      if (!Number.isFinite(scale) || scale < FONT_SCALE_RANGE.min || scale > FONT_SCALE_RANGE.max) {
        throw new Error('字号缩放不合法');
      }
      next.fontScale = scale;
    }
    if ('iconSize' in input) {
      const size = Number(input.iconSize);
      if (!Number.isFinite(size) || size < ICON_SIZE_RANGE.min || size > ICON_SIZE_RANGE.max) {
        throw new Error('图标大小不合法');
      }
      next.iconSize = size;
    }
    if ('showLabels' in input) next.showLabels = !!input.showLabels;
    if ('customThemes' in input) {
      // 允许传 {} 来清除自定义配色；其余情况必须通过格式校验
      validateCustomThemes(input.customThemes);
      next.customThemes = input.customThemes;
    }
    writeFileAtomic(uiStatePath, JSON.stringify(next, null, 2) + '\n');
    return next;
  }

  return { read, patch };
}

module.exports = {
  createUiState,
  validateCustomThemes,
  UI_DEFAULTS,
  FONT_SCALE_RANGE,
  ICON_SIZE_RANGE,
  THEME_COLOR_TOKENS,
  THEME_META_TOKENS,
  THEME_BASE_NAMES,
  CUSTOM_THEME_NAMES,
  COLOR_RE,
  LENGTH_RE,
};
