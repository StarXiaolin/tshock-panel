'use strict';

/**
 * 前端脚本完整性检查（零依赖）。
 *
 * 本机没有可用的 Electron 浏览器，无法自动点页面，所以用三个静态断言兜住
 * “拆分脚本时最容易犯的错”：
 *
 *   1. index.html 里的 <script src> 顺序与文件都存在；
 *   2. 各脚本之间没有重复的顶层声明（经典脚本共享全局词法作用域，重复 const
 *      会直接 SyntaxError，整个页面白屏）；
 *   3. 基线版本 app.js 里的每一个顶层函数/常量，现在仍然能在某个脚本里找到
 *      （防止搬运时漏掉一段）。
 *
 * 用法：node tools/frontend-check.js
 *       node tools/frontend-check.js --rev arch-2026-10-19-baseline   # 从 git 历史取基线
 *       node tools/frontend-check.js --write-baseline                 # 重新生成内置基线快照
 *
 * 基线默认读 tools/frontend-baseline.json：公开仓库里没有那批内部重构标签，
 * 所以基线必须是仓库自带的数据，而不是“本机 git 里刚好有的标签”。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'TShockPanel', 'public');
const revIndex = process.argv.indexOf('--rev');
const explicitRev = revIndex >= 0 ? process.argv[revIndex + 1] : null;
const DEFAULT_REV = 'arch-2026-10-19-baseline';
const BASELINE_FILE = path.join(__dirname, 'frontend-baseline.json');
const writeBaseline = process.argv.includes('--write-baseline');

let failed = 0;
function fail(message) {
  failed += 1;
  console.error(`  [FAIL] ${message}`);
}
function ok(message) {
  console.log(`  [OK]   ${message}`);
}

/** 从源码里取顶层声明名（只认行首，够用且不会误伤缩进里的局部变量） */
function topLevelNames(source) {
  const names = new Set();
  const patterns = [
    /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    /^class\s+([A-Za-z_$][\w$]*)/gm,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) names.add(m[1]);
  }
  return names;
}

console.log('前端脚本完整性检查');

function readFromGit(rev) {
  return execFileSync('git', ['show', `${rev}:TShockPanel/public/app.js`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function caseLabels(text) {
  return [...text.matchAll(/^\s{4}case '([^']+)':/gm)].map((m) => m[1]);
}

if (writeBaseline) {
  const rev = explicitRev || DEFAULT_REV;
  const source = readFromGit(rev);
  const data = {
    source: rev,
    generatedAt: new Date().toISOString().slice(0, 10),
    names: [...topLevelNames(source)].sort(),
    actions: [...new Set(caseLabels(source))].sort(),
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`  已写入 ${path.relative(root, BASELINE_FILE)}`);
  console.log(`  来源 ${rev}：${data.names.length} 个符号、${data.actions.length} 个 action`);
  process.exit(0);
}

let baseline = null;
if (explicitRev) {
  try {
    const source = readFromGit(explicitRev);
    baseline = { label: `git:${explicitRev}`, names: topLevelNames(source), actions: new Set(caseLabels(source)) };
  } catch (err) {
    fail(`取不到基线版本 ${explicitRev} 的 app.js：${err.message.split('\n')[0]}`);
  }
} else if (fs.existsSync(BASELINE_FILE)) {
  const data = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  baseline = {
    label: `内置快照（来自 ${data.source}）`,
    names: new Set(data.names),
    actions: new Set(data.actions),
  };
} else {
  try {
    const source = readFromGit(DEFAULT_REV);
    baseline = { label: `git:${DEFAULT_REV}`, names: topLevelNames(source), actions: new Set(caseLabels(source)) };
  } catch (err) {
    console.log('  [SKIP] 没有内置基线快照，也取不到本地标签，跳过基线对比');
  }
}
if (baseline) console.log(`  基线：${baseline.label}`);

// 1) 解析 index.html 的脚本顺序
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map((m) => m[1]);
if (scriptSrcs.length === 0) fail('index.html 里没有找到任何 <script src>');
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].length;

let files = 0;
const allNames = new Map(); // name -> 第一个定义它的文件
const perFile = new Map();

for (const src of scriptSrcs) {
  const file = path.join(publicDir, src);
  if (!fs.existsSync(file)) {
    fail(`index.html 引用了不存在的脚本：${src}`);
    continue;
  }
  files += 1;
  const source = fs.readFileSync(file, 'utf8');
  const names = topLevelNames(source);
  perFile.set(src, names);
  for (const name of names) {
    if (allNames.has(name)) {
      fail(`顶层声明重复：${name}（${allNames.get(name)} 与 ${src}）`);
    } else {
      allNames.set(name, src);
    }
  }
}
if (files === scriptSrcs.length && files > 0) {
  ok(`${files} 个脚本按 index.html 顺序解析成功：${scriptSrcs.join(' -> ')}${inlineScripts ? `（另有 ${inlineScripts} 段内联脚本）` : ''}`);
}

// 2) 基线符号必须仍然存在
if (baseline) {
  const baselineNames = baseline.names;
  const missing = [...baselineNames].filter((n) => !allNames.has(n));
  if (missing.length > 0) {
    fail(`基线里有 ${missing.length} 个顶层符号在拆分后找不到：${missing.join(', ')}`);
  } else {
    ok(`基线的 ${baselineNames.size} 个顶层符号全部仍在（未丢失任何函数/常量）`);
  }

  // 3) 当前 app 对象里不允许再有重复键（L3 曾出现 groups 声明两次，后者静默覆盖前者）
  const appFile = allNames.get('app');
  if (appFile) {
    const currentSource = fs.readFileSync(path.join(publicDir, appFile), 'utf8');
    const appBlock = /const app = \{([\s\S]*?)\n\};/.exec(currentSource);
    if (!appBlock) {
      fail(`在 ${appFile} 里找到了 app，但没能解析出对象字面量`);
    } else {
      const keys = [...appBlock[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]);
      const dupKeys = [];
      const seen = new Set();
      for (const k of keys) {
        if (seen.has(k)) dupKeys.push(k);
        seen.add(k);
      }
      if (dupKeys.length > 0) {
        fail(`${appFile} 的 app 对象里有重复键（后面的会静默覆盖前面的）：${dupKeys.join(', ')}`);
      } else {
        ok(`${appFile} 的 app 对象无重复键（${keys.length} 个字段）`);
      }
    }
  } else {
    fail('找不到 app 的声明位置');
  }

  // 4) action 名称集合：把 handleAction 拆成多组后，任何一个 case 漏搬都会导致按钮失灵，
  //    所以逐个比对“基线里有哪些 case，现在是否都还在”，并且不允许重复定义。
  const baselineCases = baseline.actions;
  const currentCases = new Map();
  for (const [src, names] of perFile) {
    if (!/^js\/(4\d|50)-/.test(src)) continue;
    const text = fs.readFileSync(path.join(publicDir, src), 'utf8');
    for (const label of caseLabels(text)) {
      if (currentCases.has(label)) {
        fail(`action 重复定义：'${label}'（${currentCases.get(label)} 与 ${src}）`);
      } else {
        currentCases.set(label, src);
      }
    }
  }
  const missingCases = [...baselineCases].filter((c) => !currentCases.has(c));
  if (missingCases.length > 0) {
    fail(`基线里有 ${missingCases.length} 个 action 在拆分后找不到：${missingCases.join(', ')}`);
  } else {
    ok(`基线的 ${baselineCases.size} 个 action 名称全部仍在（分布在 ${new Set(currentCases.values()).size} 个文件）`);
  }

  // 5) 反向检查：页面上写死的 data-action 必须都有对应 case，否则按钮点了没反应
  const usedActions = new Set();
  const marked = /data-action="([^"$][^"]*)"/g;
  for (const text of [html, ...[...perFile.keys()].map((f) => fs.readFileSync(path.join(publicDir, f), 'utf8'))]) {
    let m;
    while ((m = marked.exec(text)) !== null) usedActions.add(m[1]);
  }
  const dangling = [...usedActions].filter((a) => !currentCases.has(a));
  if (dangling.length > 0) {
    fail(`页面里有 ${dangling.length} 个 data-action 找不到处理分支：${dangling.join(', ')}`);
  } else {
    ok(`页面里的 ${usedActions.size} 个 data-action 全部有对应处理分支`);
  }
}

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
