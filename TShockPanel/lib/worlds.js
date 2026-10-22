'use strict';

/**
 * 泰拉瑞亚世界存档（.wld）头部信息读取。
 *
 * 1.4.x 的 .wld 结构：
 *    int32  版本号
 *    byte[7] "relogic"
 *    byte   文件类型（世界为 2）
 *    ...    头部若干字段
 *    在偏移量 26 处有一个 int32，指向“世界名字节数”所在的偏移。
 *    名字后面紧跟种子字符串（同样是 1 字节长度 + UTF-8）。
 *
 * 为了兼容老版本存档，解析失败时会退回逐字节扫描的兜底方案。
 */

const fs = require('fs');

const MAGIC = 'relogic';
const MAX_NAME_BYTES = 255;

const strictDecoder = new TextDecoder('utf-8', { fatal: true });

function decodeUtf8(buf) {
  try {
    return strictDecoder.decode(buf);
  } catch (err) {
    return null;
  }
}

function isPrintable(str) {
  if (!str || str.length === 0) return false;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function readAt(file, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size, length));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return { buf, size };
  } finally {
    fs.closeSync(fd);
  }
}

function readStringAt(buf, offset) {
  if (offset + 1 > buf.length) return null;
  const len = buf[offset];
  if (len === 0) return { value: '', next: offset + 1 };
  if (offset + 1 + len > buf.length) return null;
  const value = decodeUtf8(buf.subarray(offset + 1, offset + 1 + len));
  if (value === null || !isPrintable(value)) return null;
  return { value, next: offset + 1 + len };
}

/** 兜底：在头部区域扫描“长度 + 合法 UTF-8 字符串”的组合。 */
function scanName(buf, size) {
  const limit = Math.min(buf.length - 2, 4096);
  for (let off = 20; off < limit; off++) {
    const len = buf[off];
    if (len < 1 || len > 80) continue;
    if (off + 1 + len >= buf.length) continue;
    const name = decodeUtf8(buf.subarray(off + 1, off + 1 + len));
    if (!name || !isPrintable(name)) continue;
    if (!/[0-9A-Za-z\u00A0-\uFFFF]/.test(name)) continue;
    // 名字后面通常紧跟种子字符串，用来验证这次命中是否可信。
    const seed = readStringAt(buf, off + 1 + len);
    if (!seed) continue;
    if (off > 8192 || off >= size) break;
    return { name, seed: seed.value };
  }
  return null;
}

/**
 * 读取单个世界文件的信息。
 * @returns {null | {name: string|null, seed: string|null, version: number, size: number, modified: number}}
 */
function readWorldInfo(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    return null;
  }
  if (!stat.isFile() || stat.size < 64) return null;

  let buf;
  try {
    buf = readAt(file, 32768).buf;
  } catch (err) {
    return null;
  }

  if (buf.toString('latin1', 4, 11) !== MAGIC) return null;
  const version = buf.readInt32LE(0);

  let name = null;
  let seed = null;
  let worldId = null;

  const pointer = buf.length >= 30 ? buf.readInt32LE(26) : -1;
  if (pointer > 26 && pointer < buf.length) {
    const parsed = readStringAt(buf, pointer);
    if (parsed) {
      name = parsed.value;
      const seedParsed = readStringAt(buf, parsed.next);
      if (seedParsed) {
        seed = seedParsed.value;
        // 头部结构：名字 → 种子 → 4 字节生成器版本 → 4 字节格式版本 → 16 字节 GUID → 4 字节世界 ID
        const idOffset = seedParsed.next + 4 + 4 + 16;
        if (idOffset + 4 <= buf.length) {
          const id = buf.readInt32LE(idOffset);
          if (Number.isInteger(id) && id > 0) worldId = id;
        }
      }
    }
  }

  if (name === null) {
    const scanned = scanName(buf, stat.size);
    if (scanned) {
      name = scanned.name;
      seed = scanned.seed;
    }
  }

  return {
    name: name || null,
    seed: seed || null,
    version,
    size: stat.size,
    modified: stat.mtimeMs,
    worldId,
  };
}

/** 把世界名转成安全的文件名。 */
function sanitizeFileName(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '');
  return cleaned.slice(0, 60) || '新世界';
}

module.exports = { readWorldInfo, sanitizeFileName };
