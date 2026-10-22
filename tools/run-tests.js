'use strict';

/**
 * 测试总入口：跑完 tools/*.test.js 与两项前端检查，任意一项失败就以退出码 1 结束。
 * 只用 Node 内置模块，不需要 npm install，也没有 package.json。
 *
 *   node tools/run-tests.js
 *   node tools/run-tests.js --verbose    # 每个用例的输出都打印出来
 *
 * 冒烟测试（tools/smoke.ps1）不在这里：它需要完整的 TShock 发布包才能跑。
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TOOLS_DIR = path.join(ROOT, 'tools');
const verbose = process.argv.includes('--verbose');

/** 单测按文件名排序，输出顺序稳定，便于对比两次运行 */
function listSuites() {
  return fs
    .readdirSync(TOOLS_DIR)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join('tools', name));
}

/** 非 *.test.js 的检查（前端完整性、前端启动、版本号），单独列出来 */
const CHECKS = ['frontend-check.js', 'frontend-boot.js', 'version-check.js'].map((name) => path.join('tools', name));

function runOne(rel) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8' });
  const ms = Date.now() - started;
  if (result.error) {
    console.error(`  ! ${rel} 无法执行：${result.error.message}`);
    return { ok: false, ms };
  }
  const ok = result.status === 0;
  if (!ok || verbose) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    if (output) {
      for (const line of output.split('\n')) console.log(`    ${line}`);
    }
  }
  return { ok, ms };
}

function main() {
  const suites = listSuites();
  const targets = [...suites, ...CHECKS];
  console.log(`跑 ${suites.length} 套单测 + ${CHECKS.length} 项检查…\n`);

  const failed = [];
  for (const rel of targets) {
    const { ok, ms } = runOne(rel);
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${rel.padEnd(40)} ${String(ms).padStart(5)} ms`);
    if (!ok) failed.push(rel);
  }

  console.log('');
  if (failed.length) {
    console.error(`失败 ${failed.length} 项：`);
    for (const rel of failed) console.error(`  - ${rel}`);
    process.exitCode = 1;
    return;
  }
  console.log(`全部通过（${targets.length} 项）。`);
}

main();
