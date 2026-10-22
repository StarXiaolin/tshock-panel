'use strict';

/**
 * 三套主题的文字对比度检查（零依赖，纯文本解析 style.css 后计算 WCAG 对比度）。
 *
 * 起因：白色模式的观感问题（阴影仍是暗色）暴露出“主题质量没有可验证的标准”。
 * 阴影靠肉眼，但文字可读性可以算：把令牌解析成颜色，按 WCAG 公式算对比度。
 *
 * 判定标准：
 *   - 正文与次级文字（text / text-soft）：≥ 7:1（AAA）
 *   - 弱化文字（muted / muted-2）与语义色（warn/danger/info/accent）：≥ 4.5:1（AA）
 *   - 控制台日志颜色：≥ 4.5:1；时间戳（log-time）是刻意压暗的装饰信息，
 *     只要求 ≥ 2:1（这条阈值写在这里，是为了防止以后有人顺手把它再调暗）。
 *
 * 用法：node tools/contrast.test.js
 */

const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'TShockPanel', 'public', 'style.css');
const css = fs.readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed += 1;
    console.error(`  [FAIL] ${name}\n         期望 ${JSON.stringify(expected)}\n         实际 ${JSON.stringify(actual)}`);
  } else {
    console.log(`  [OK]   ${name}`);
  }
}

function themeBlock(start, end) {
  const i = css.indexOf(start);
  const j = css.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error(`找不到主题区块：${start}`);
  return css.slice(i, j);
}

const blocks = {
  dark: themeBlock(':root,', '[data-theme="light"] {'),
  light: themeBlock('[data-theme="light"] {', '[data-theme="high-contrast"] {'),
  'high-contrast': themeBlock('[data-theme="high-contrast"] {', '/* 外观：字号缩放'),
};

function tokensOf(text) {
  const map = new Map();
  for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

function resolve(map, name, depth = 0) {
  const value = map.get(name);
  if (!value || depth > 5) return null;
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (m) return resolve(map, m[1], depth + 1);
  return value;
}

function parseColor(value) {
  if (!value) return null;
  let m = /^#([0-9a-f]{6})$/i.exec(value);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#([0-9a-f]{3})$/i.exec(value);
  if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(value);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function luminance([r, g, b]) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

function measure(map, fgName, bgName) {
  const fg = parseColor(resolve(map, '--' + fgName));
  const bg = parseColor(resolve(map, '--' + bgName));
  if (!fg || !bg) throw new Error(`无法解析 ${fgName} / ${bgName}`);
  return ratio(fg, bg);
}

for (const [name, block] of Object.entries(blocks)) {
  const map = tokensOf(block);
  console.log(`1) ${name} 主题`);
  const textOnBg = measure(map, 'text', 'bg');
  const textOnPanel = measure(map, 'text', 'panel');
  check(`${name}: 正文 on 背景 ≥ 7`, textOnBg >= 7, true);
  check(`${name}: 正文 on 卡片 ≥ 7`, textOnPanel >= 7, true);
  check(`${name}: 次级文字 ≥ 7`, measure(map, 'text-soft', 'panel') >= 7, true);
  check(`${name}: muted ≥ 4.5`, measure(map, 'muted', 'panel') >= 4.5, true);
  check(`${name}: muted-2 ≥ 4.5`, measure(map, 'muted-2', 'panel') >= 4.5, true);
  check(`${name}: accent-text ≥ 4.5`, measure(map, 'accent-text', 'panel') >= 4.5, true);
  check(`${name}: warn-text ≥ 4.5`, measure(map, 'warn-text', 'panel') >= 4.5, true);
  check(`${name}: danger-text ≥ 4.5`, measure(map, 'danger-text', 'panel') >= 4.5, true);
  check(`${name}: info-text ≥ 4.5`, measure(map, 'info-text', 'panel') >= 4.5, true);
  for (const logName of ['log-stdout', 'log-tshock', 'log-panel', 'log-stderr', 'log-output', 'log-input']) {
    check(`${name}: ${logName} ≥ 4.5`, measure(map, logName, 'console-bg') >= 4.5, true);
  }
  const timeRatio = measure(map, 'log-time', 'console-bg');
  check(`${name}: log-time 只要求 ≥ 2（刻意压暗的时间戳）`, timeRatio >= 2, true);
}

console.log('2) 高对比主题的额外要求');
const hcMap = tokensOf(blocks['high-contrast']);
check('高对比正文 ≥ 15', measure(hcMap, 'text', 'bg') >= 15, true);
check('高对比 muted 也 ≥ 7', measure(hcMap, 'muted', 'panel') >= 7, true);

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
