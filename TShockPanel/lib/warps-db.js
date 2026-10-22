'use strict';

/**
 * tshock.sqlite 的传送点表访问层。
 *
 * 为什么单独一层：面板里有且只有一处直接读 TShock 的数据库（`Warps` 表）——
 * 因为 `/warp list` 不返回隐藏项，而面板要显示隐藏状态。把这唯一一处库访问
 * 收进一个模块，其它地方就再也不可能随手 `new DatabaseSync(...)` 了。
 *
 * Node 22 的 `node:sqlite` 是内置模块，但老版本没有，所以这里做惰性 require
 * 并提供明确的错误文案。
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {object} deps
 * @param {string} deps.tshockDir       tshock 目录（tshock.sqlite 所在）
 * @param {string} deps.backupDir       备份根目录（warps 子目录在这里）
 * @param {() => string} deps.getWorldFile  当前世界文件（proc.worldPath 或 state.launch.world）
 * @param {(file: string) => object|null} deps.readWorldInfo
 * @param {(dir: string) => void} deps.ensureDir
 * @param {() => string} deps.timestamp
 * @param {(text: string) => void} deps.log
 */
function createWarpsDb(deps) {
  const { tshockDir, backupDir, getWorldFile, readWorldInfo, ensureDir, timestamp, log } = deps;

  let sqliteModule;
  let sqliteChecked = false;

  function getSqlite() {
    if (!sqliteChecked) {
      sqliteChecked = true;
      try {
        sqliteModule = require('node:sqlite');
      } catch (err) {
        sqliteModule = null;
      }
    }
    return sqliteModule;
  }

  function openDb(readOnly = true) {
    const mod = getSqlite();
    if (!mod) {
      throw new Error('当前 Node.js 不支持读取 SQLite（需要 Node 22 及以上），请升级 Node.js');
    }
    const dbPath = path.join(tshockDir, 'tshock.sqlite');
    if (!fs.existsSync(dbPath)) throw new Error('找不到 tshock.sqlite');
    return new mod.DatabaseSync(dbPath, { readOnly, timeout: 5000 });
  }

  /** 当前世界的 TShock 世界 ID（字符串）；拿不到就返回 null。 */
  function currentWorldId() {
    const worldFile = getWorldFile();
    if (!worldFile || !fs.existsSync(worldFile)) return null;
    try {
      const info = readWorldInfo(worldFile);
      return info && info.worldId ? String(info.worldId) : null;
    } catch (err) {
      return null;
    }
  }

  /** 直接动数据库前先复制一份，最多留 20 份。 */
  function backupDatabase(label) {
    try {
      const dir = path.join(backupDir, 'warps');
      ensureDir(dir);
      // 文件名只精确到秒，同一秒内两次备份会撞名并覆盖前一份；撞名时加自增后缀
      // （与 lib/tshock-config.js、lib/backups.js 的处理一致）。
      const stamp = timestamp();
      let name = `${stamp}_${label}.sqlite`;
      let suffix = 2;
      while (fs.existsSync(path.join(dir, name))) {
        name = `${stamp}_${label}-${suffix}.sqlite`;
        suffix += 1;
      }
      const target = path.join(dir, name);
      fs.copyFileSync(path.join(tshockDir, 'tshock.sqlite'), target);
      const files = fs.readdirSync(dir).sort();
      while (files.length > 20) {
        try {
          fs.unlinkSync(path.join(dir, files.shift()));
        } catch (err) {
          /* ignore */
        }
      }
    } catch (err) {
      log(`备份数据库失败：${err.message}`);
    }
  }

  return { getSqlite, openDb, currentWorldId, backupDatabase };
}

module.exports = { createWarpsDb };
