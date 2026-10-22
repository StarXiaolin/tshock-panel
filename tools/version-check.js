'use strict';

/**
 * 版本号守卫（零依赖）。
 *
 * 版本号有两个来源，发版时必须一致，否则装出来的面板和 Release 页面会对不上：
 *   1. 代码：`TShockPanel/server.js` 里的 `const VERSION = 'x.y.z'`（帮助页「关于」显示的就是它）
 *   2. 标签：Git 的 `vX.Y.Z`（发版时打，也是 GitHub Release 的锚点）
 *
 * 默认检查格式 + CHANGELOG 里有没有对应小节；带 `--tag` 时再比对标签。
 * CI 在打标签的构建里会传 `--tag ${{ github.ref_name }}`。
 *
 * 用法：
 *   node tools/version-check.js
 *   node tools/version-check.js --tag v1.0.1
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER_JS = path.join(ROOT, 'TShockPanel', 'server.js');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

const SEMVER = /^\d+\.\d+\.\d+$/;
const tagIndex = process.argv.indexOf('--tag');
const expectedTag = tagIndex >= 0 ? process.argv[tagIndex + 1] : null;

let failed = 0;
function ok(message) {
  console.log(`  [OK]   ${message}`);
}
function fail(message) {
  failed += 1;
  console.error(`  [FAIL] ${message}`);
}

console.log('版本号检查');

// 1) 代码里的版本号
let version = '';
const source = fs.readFileSync(SERVER_JS, 'utf8');
const matched = /^const VERSION = '([^']+)';/m.exec(source);
if (!matched) {
  fail('TShockPanel/server.js 里找不到 `const VERSION = ...`');
} else {
  version = matched[1];
  if (SEMVER.test(version)) {
    ok(`代码版本 ${version}（TShockPanel/server.js → /api/state → 帮助页「关于」）`);
  } else {
    fail(`代码版本 ${version} 不是 x.y.z 格式`);
  }
}

// 2) CHANGELOG 必须有同一节的记录，否则发布页没东西可写
if (version) {
  const changelog = fs.readFileSync(CHANGELOG, 'utf8');
  const escaped = version.replace(/\./g, '\\.');
  if (new RegExp(`^## \\[${escaped}\\]`, 'm').test(changelog)) {
    ok(`CHANGELOG.md 里有 [${version}] 小节`);
  } else {
    fail(`CHANGELOG.md 里没有 [${version}] 小节（发版前补一节）`);
  }
}

// 3) 打了标签的构建：标签必须与代码一致
if (expectedTag) {
  const tagVersion = String(expectedTag).replace(/^v/, '');
  if (!version) {
    fail(`标签 ${expectedTag} 无法校验：代码里没取到版本号`);
  } else if (tagVersion === version) {
    ok(`标签 ${expectedTag} 与代码版本一致`);
  } else {
    fail(`标签 ${expectedTag} 与代码版本 ${version} 不一致（改 VERSION 或重新打标签）`);
  }
}

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
