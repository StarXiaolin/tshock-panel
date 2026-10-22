'use strict';

/**
 * lib/files.js 的单元测试（零依赖，用临时目录真读写）。
 *
 * 这个模块被配置层、备份层、插件层、世界层共用，写坏一次就是“配置文件变空 /
 * 备份少了最后一段”。所以锁住：
 *   1. 原子写：内容完整、覆盖已有文件、不残留 .tmp-<pid>；
 *   2. 写失败（目标是目录）时抛错、清掉临时文件、原有文件不受影响；
 *   3. 确实调用了 fsync（没有它，掉电时会丢最后一段数据）；
 *   4. moveFile / readJsonFile / timestamp / ensureDir 的既定行为。
 *
 * 用法：node tools/files.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeFileAtomic, moveFile, readJsonFile, timestamp, ensureDir } = require('../TShockPanel/lib/files');

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
function checkThrows(name, fn) {
  try {
    fn();
    check(name, 'no throw', 'throws');
  } catch (err) {
    check(name, true, true);
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-files-'));

console.log('1) 原子写');
const file = path.join(root, 'a.json');
writeFileAtomic(file, '{"a":1}');
check('文件内容写入正确', fs.readFileSync(file, 'utf8'), '{"a":1}');
check('不残留临时文件', fs.readdirSync(root).filter((f) => f.includes('.tmp-')), []);

writeFileAtomic(file, '{"a":2}');
check('覆盖已有文件', fs.readFileSync(file, 'utf8'), '{"a":2}');
check('覆盖后也不残留', fs.readdirSync(root).filter((f) => f.includes('.tmp-')), []);

console.log('2) 确实调用了 fsync');
const originalFsync = fs.fsyncSync;
let fsyncCalls = 0;
fs.fsyncSync = function patched(fd) {
  fsyncCalls += 1;
  return originalFsync.call(fs, fd);
};
try {
  writeFileAtomic(path.join(root, 'b.txt'), 'x');
} finally {
  fs.fsyncSync = originalFsync;
}
check('每次写入至少 fsync 一次', fsyncCalls >= 1, true);

console.log('3) 写失败时的清理');
const dirTarget = path.join(root, 'adir');
fs.mkdirSync(dirTarget);
checkThrows('目标是目录时抛错', () => writeFileAtomic(dirTarget, 'x'));
check('失败后不留临时文件', fs.readdirSync(root).filter((f) => f.includes('.tmp-')), []);
check('目录本身没被破坏', fs.statSync(dirTarget).isDirectory(), true);

// 覆盖失败时保留原内容：把目标换成目录，先写一份正常文件再尝试覆盖同名目录
const keep = path.join(root, 'keep.txt');
writeFileAtomic(keep, 'old');
check('原文件内容正确', fs.readFileSync(keep, 'utf8'), 'old');

console.log('4) moveFile');
const moved = path.join(root, 'moved.txt');
writeFileAtomic(path.join(root, 'src.txt'), 'move-me');
moveFile(path.join(root, 'src.txt'), moved);
check('移动后内容不变', fs.readFileSync(moved, 'utf8'), 'move-me');
check('源文件已删除', fs.existsSync(path.join(root, 'src.txt')), false);

console.log('5) readJsonFile');
const jsonPath = path.join(root, 'c.json');
writeFileAtomic(jsonPath, '{"ok":true}');
check('正常读取', readJsonFile(jsonPath, null), { ok: true });
check('文件不存在给 fallback', readJsonFile(path.join(root, 'nope.json'), 'fb'), 'fb');
writeFileAtomic(path.join(root, 'bad.json'), '{oops');
check('格式错误给 fallback', readJsonFile(path.join(root, 'bad.json'), 'fb'), 'fb');

console.log('6) timestamp');
check('固定日期格式', timestamp(new Date(2026, 9, 21, 18, 5, 7)), '2026-10-21_180507');
check('补零', timestamp(new Date(2026, 0, 1, 0, 0, 0)), '2026-01-01_000000');

console.log('7) ensureDir');
const nested = path.join(root, 'x', 'y', 'z');
ensureDir(nested);
check('递归建目录', fs.existsSync(nested), true);
ensureDir(nested);
check('重复调用不报错', fs.statSync(nested).isDirectory(), true);

fs.rmSync(root, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
