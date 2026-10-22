'use strict';

/**
 * 文件系统小工具。
 *
 * 只负责“怎么写才安全”，不掺任何业务判断；因此可以被配置层、备份层、
 * 插件层同时复用，而不产生循环依赖。
 */

const fs = require('fs');

/**
 * 原子写：先写临时文件、fsync 落盘，再 rename 覆盖正式文件。
 *
 * 为什么这么写：
 *  - rename 是原子的，进程崩溃时正式文件要么是旧内容、要么是新内容，不会半截；
 *  - fsync 把数据真正刷到盘上，掉电后不会留下“长度对但内容是空洞”的文件；
 *  - 任何一步失败都要清掉 .tmp-<pid>，否则每次失败都在目录里留垃圾。
 */
function writeFileAtomic(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (closeErr) {
        /* 关闭失败不影响抛出原始错误 */
      }
    }
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (unlinkErr) {
      /* 清不掉临时文件也不应该盖住真正的错误 */
    }
    throw err;
  }
}

/** 跨盘符 rename 会失败，退化成复制 + 删除。 */
function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

/** 读 JSON；文件不存在或格式坏了都返回 fallback，由调用方决定要不要报错。 */
function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

/** 备份文件名用的时间戳：2026-10-19_120000 */
function timestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  writeFileAtomic,
  moveFile,
  readJsonFile,
  timestamp,
  ensureDir,
};
