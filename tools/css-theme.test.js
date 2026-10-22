'use strict';

/**
 * 主题样式一致性检查（零依赖，纯文本分析 TShockPanel/public/style.css）。
 *
 * 起因：白色模式下有几个阴影/分隔线仍是暗色模式的写死值（用户实际看到并反馈）。
 * 这类问题的根因不是“忘了改”而是“没有拦住的机制”——业务样式里可以随手写 rgba()，
 * 写的人以为那是中性色，其实是照着深色背景挑的。
 *
 * 这个检查保证三件事：
 *   1. 三个主题都为关键令牌提供了值（缺了会静默继承 :root 的深色值）；
 *   2. 业务样式区不允许出现硬编码颜色（主题预览色块 .theme-* 除外）；
 *   3. 样式里 var(--x) 引用的令牌都有定义，避免拼错后静默失效。
 *
 * 用法：node tools/css-theme.test.js
 */

const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'TShockPanel', 'public', 'style.css');
const raw = fs.readFileSync(cssPath, 'utf8');
const css = raw.replace(/\r\n/g, '\n');

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

function sliceBetween(a, b) {
  const i = css.indexOf(a);
  const j = css.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`找不到样式区块：${a} … ${b}`);
  return css.slice(i, j);
}

const darkBlock = sliceBetween(':root,', '[data-theme="light"] {');
const lightBlock = sliceBetween('[data-theme="light"] {', '[data-theme="high-contrast"] {');
const hcBlock = sliceBetween('[data-theme="high-contrast"] {', '/* 外观：字号缩放');
const bodyText = css.slice(css.indexOf('/* 外观：字号缩放'));

const tokensOf = (text) => {
  const names = new Set();
  for (const m of text.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) names.add(m[1]);
  return names;
};

const dark = tokensOf(darkBlock);
const light = tokensOf(lightBlock);
const hc = tokensOf(hcBlock);

// 主题必须各自定义的关键令牌：颜色、阴影、遮罩、分隔线、选区都会直接影响观感
const requiredPerTheme = [
  '--bg',
  '--panel',
  '--text',
  '--accent',
  '--line',
  '--shadow',
  '--shadow-pop',
  '--shadow-modal',
  '--mask-bg',
  '--row-line',
  '--fade-to',
  '--selection',
  '--overlay',
  '--card-bg',
  '--topbar-bg',
];

console.log('1) 三个主题都为关键令牌提供值');
check('深色缺令牌', requiredPerTheme.filter((t) => !dark.has(t)), []);
check('白色缺令牌', requiredPerTheme.filter((t) => !light.has(t)), []);
check('高对比缺令牌', requiredPerTheme.filter((t) => !hc.has(t)), []);

console.log('2) 业务样式不允许硬编码颜色');
const offenders = [];
const lines = bodyText.split('\n');
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  // 主题预览色块展示的就是各主题原色，允许写死
  if (/\.theme-(dark|light|high-contrast)\b/.test(line)) continue;
  if (/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/.test(line)) offenders.push(line.trim());
}
check('硬编码颜色行', offenders, []);

console.log('3) var() 引用的令牌都有定义');
const used = new Set();
for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
const allDefined = new Set([...dark, ...light, ...hc]);
const undefinedTokens = [...used].filter((t) => !allDefined.has(t));
check('未定义的令牌', undefinedTokens, []);
check('样式里至少用到 40 个令牌', used.size >= 40, true);

console.log('4) 括号与注释成对');
check('大括号数量平衡', (css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
check('注释成对', (css.match(/\/\*/g) || []).length, (css.match(/\*\//g) || []).length);

console.log('5) 白色主题的阴影不能再是暗色硬编码');
const lightShadows = [...lightBlock.matchAll(/--shadow(-pop|-modal)?:\s*([^;]+);/g)].map((m) => m[2].trim());
check('白色主题共 3 个阴影令牌', lightShadows.length, 3);
check(
  '阴影都使用带蓝调的深灰而不是纯黑',
  lightShadows.filter((v) => !/rgba\(15,\s*23,\s*42|none/.test(v)),
  []
);
check(
  '没有把深色主题的阴影照抄过来',
  lightShadows.filter((v) => /rgba\(0,\s*0,\s*0/.test(v)),
  []
);

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
