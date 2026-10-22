'use strict';

/**
 * lib/worlds.js 的单元测试（零依赖，用临时目录造 .wld 头部）。
 *
 * 这个模块决定“世界列表里显示什么名字、世界 ID 对不对、备份目录叫什么”，
 * 此前完全没有测试。按它自己文档的结构造二进制头：
 *
 *   offset 0   int32  版本号
 *   offset 4   byte[7] "relogic"
 *   offset 11  byte   文件类型（2 = 世界）
 *   offset 26  int32  指向“名字长度字节”的偏移
 *   pointer    1 字节长度 + 名字 UTF-8
 *   紧随其后   1 字节长度 + 种子 UTF-8
 *   再往后     4 生成器版本 + 4 格式版本 + 16 GUID + 4 世界 ID
 *
 * 用法：node tools/worlds.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { readWorldInfo, sanitizeFileName } = require('../TShockPanel/lib/worlds');

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

/** 按 .wld 头部结构造一个最小存档。 */
function buildWorld({ version = 279, name = '开荒', seed = '12345', worldId = 1054320003, pointer = 30, magic = 'relogic' } = {}) {
  const nameBuf = Buffer.from(name, 'utf8');
  const seedBuf = Buffer.from(seed, 'utf8');
  const tail = Buffer.alloc(4 + 4 + 16);
  const idBuf = Buffer.alloc(4);
  idBuf.writeInt32LE(worldId, 0);
  const body = Buffer.concat([
    Buffer.from([nameBuf.length]),
    nameBuf,
    Buffer.from([seedBuf.length]),
    seedBuf,
    tail,
    idBuf,
  ]);
  const head = Buffer.alloc(30);
  head.writeInt32LE(version, 0);
  head.write(magic, 4, 'latin1');
  head[11] = 2;
  head.writeInt32LE(pointer === 30 ? 30 : pointer, 26);
  return Buffer.concat([head, body, Buffer.alloc(64)]);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-wld-'));
function write(name, buf) {
  const file = path.join(root, name);
  fs.writeFileSync(file, buf);
  return file;
}

console.log('1) 正常解析');
const okFile = write('ok.wld', buildWorld());
const info = readWorldInfo(okFile);
check('世界名', info.name, '开荒');
check('种子', info.seed, '12345');
check('版本号', info.version, 279);
check('世界 ID', info.worldId, 1054320003);
check('文件大小', info.size, fs.statSync(okFile).size);
check('修改时间与 stat 一致', info.modified, fs.statSync(okFile).mtimeMs);

const emptyName = write('empty-name.wld', buildWorld({ name: 'a b' }));
check('带空格的名字原样保留', readWorldInfo(emptyName).name, 'a b');

console.log('2) 头部不合法时返回 null');
check('文件不存在', readWorldInfo(path.join(root, 'nope.wld')), null);
check('文件太小（< 64 字节）', readWorldInfo(write('tiny.wld', Buffer.alloc(10))), null);
check('魔数不对', readWorldInfo(write('bad-magic.wld', buildWorld({ magic: 'xxxxxxx' }))), null);
check('目录不是文件', readWorldInfo(root), null);

console.log('3) 指针无效时退回扫描');
// 指针置 0（无效），把“名字+种子”放到偏移 40，让兜底扫描能命中
const scanBuf = buildWorld({ name: 'ScannedWorld', seed: 'seed9', pointer: 0 });
const nameAt40 = Buffer.from([12, ...Buffer.from('ScannedWorld'), 5, ...Buffer.from('seed9')]);
nameAt40.copy(scanBuf, 40);
const scanned = readWorldInfo(write('scan.wld', scanBuf));
check('扫描找到名字', scanned.name, 'ScannedWorld');
check('扫描也带出种子', scanned.seed, 'seed9');

console.log('4) 世界 ID 缺失或非法时为 null');
const noId = buildWorld();
noId.writeInt32LE(0, 30 + 1 + Buffer.byteLength('开荒') + 1 + 5 + 4 + 4 + 16);
const noIdInfo = readWorldInfo(write('no-id.wld', noId));
check('ID 为 0 时给 null', noIdInfo.worldId, null);
check('名字仍然可用', noIdInfo.name, '开荒');

console.log('5) sanitizeFileName');
check('替换非法字符', sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
check('折叠空白', sanitizeFileName('  多   空格  '), '多 空格');
check('去掉末尾点与空格', sanitizeFileName('名字...  '), '名字');
check('空值给默认名', sanitizeFileName(''), '新世界');
check('null 也给默认名', sanitizeFileName(null), '新世界');
check('超长截断到 60', sanitizeFileName('x'.repeat(100)).length, 60);
check('控制字符被替换', sanitizeFileName('a\u0000b\u001fc'), 'a b c');
check('中文原样保留', sanitizeFileName('1.4.5.8开荒'), '1.4.5.8开荒');

fs.rmSync(root, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
