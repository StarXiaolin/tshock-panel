'use strict';

/**
 * 世界存档服务：枚举、新建、删除。
 *
 * 原先这三件事和“服务器进程状态”“REST 调用”“HTTP 路由”混在 server.js 里：
 * 想验证“删除世界是不是只允许删世界目录里的文件”，只能真的去动用户的存档。
 * 现在把目录、当前世界、是否在跑、以及“新建世界要拉一个服务器进程”都从外部注入，
 * 逻辑本身就可以在临时目录里跑测试。
 *
 * 约定：所有路径判断都用 resolve 后的小写比较，避免 Windows 大小写/短路径坑。
 */

const fs = require('fs');
const path = require('path');
const net = require('net');

const fsp = fs.promises;

/**
 * @param {object} deps
 * @param {() => string} deps.getWorldsDir       用户世界目录（Terraria/Worlds）
 * @param {string} deps.serverDir                服务器根目录（可能也散落 .wld）
 * @param {string} deps.trashDir                 删除世界的回收站
 * @param {() => string} deps.getCurrentWorld    当前服务器正在用的世界路径（proc.worldPath）
 * @param {() => string} deps.getSelectedWorld   面板里选中准备启动的世界（state.launch.world）
 * @param {() => number} deps.getMaxPlayers      面板默认人数（建图时传给 TShock）
 * @param {() => Promise<boolean>} deps.isRunning
 * @param {(params: object) => void} deps.startServer  以 mode:'create' 拉起建图进程
 * @param {(file: string) => object|null} deps.readWorldInfo
 * @param {(name: string) => string} deps.sanitizeFileName
 * @param {(src: string, dest: string) => void} deps.moveFile
 * @param {() => string} deps.timestamp
 */
function createWorldStore(deps) {
  const {
    getWorldsDir,
    serverDir,
    trashDir,
    getCurrentWorld,
    getSelectedWorld,
    getMaxPlayers,
    isRunning,
    startServer,
    readWorldInfo,
    sanitizeFileName,
    moveFile,
    timestamp,
  } = deps;

  const same = (a, b) => path.resolve(a || '').toLowerCase() === path.resolve(b || '').toLowerCase();

  function worldDirs() {
    const dirs = [getWorldsDir()];
    const local = path.join(serverDir, 'Worlds');
    if (fs.existsSync(local)) dirs.push(local);
    return dirs.filter((d) => d && fs.existsSync(d));
  }

  async function list() {
    const seen = new Set();
    const result = [];
    const worldsDir = getWorldsDir();

    const push = (file) => {
      const resolved = path.resolve(file);
      if (seen.has(resolved.toLowerCase())) return;
      seen.add(resolved.toLowerCase());
      const info = readWorldInfo(resolved);
      if (!info) return;
      const dir = path.dirname(resolved);
      result.push({
        path: resolved,
        file: path.basename(resolved),
        dir,
        name: info.name || path.basename(resolved, '.wld'),
        seed: info.seed,
        version: info.version,
        size: info.size,
        modified: info.modified,
        inTerrariaFolder: same(dir, worldsDir),
        current: same(resolved, getCurrentWorld()),
        selected: same(resolved, getSelectedWorld()),
      });
    };

    for (const dir of worldDirs()) {
      let entries = [];
      try {
        entries = await fsp.readdir(dir);
      } catch (err) {
        continue;
      }
      for (const entry of entries) {
        if (entry.toLowerCase().endsWith('.wld')) push(path.join(dir, entry));
      }
    }

    // 服务器根目录里散落的世界文件
    try {
      const rootEntries = await fsp.readdir(serverDir);
      for (const entry of rootEntries) {
        if (entry.toLowerCase().endsWith('.wld')) push(path.join(serverDir, entry));
      }
    } catch (err) {
      /* ignore */
    }

    result.sort((a, b) => b.modified - a.modified);
    return result;
  }

  function findFreePort() {
    return new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.unref();
      probe.on('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const port = probe.address().port;
        probe.close(() => resolve(port));
      });
    });
  }

  async function create({ name, size, seed }) {
    const worldsDir = getWorldsDir();
    if (!fs.existsSync(worldsDir)) {
      throw new Error(`世界存档目录不存在：${worldsDir}`);
    }
    const base = sanitizeFileName(name || '新世界');
    let target = path.join(worldsDir, `${base}.wld`);
    let index = 1;
    while (fs.existsSync(target)) {
      target = path.join(worldsDir, `${base} (${index++}).wld`);
    }
    const port = await findFreePort();
    startServer({
      mode: 'create',
      worldPath: target,
      worldName: base,
      size: Number(size) || 1,
      seed: String(seed || '').trim(),
      port,
      maxPlayers: getMaxPlayers(),
    });
    return { ok: true, path: target, name: base };
  }

  async function remove(file) {
    const resolved = path.resolve(file);
    const allowed = worldDirs().some((dir) => resolved.toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep));
    if (!allowed) throw new Error('只能删除世界目录里的存档。');
    if (!fs.existsSync(resolved)) throw new Error('文件不存在。');
    if (same(resolved, getCurrentWorld()) && (await isRunning())) {
      throw new Error('这个世界正在使用中，请先停止服务器。');
    }
    if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
    const target = path.join(trashDir, `${timestamp()}_${path.basename(resolved)}`);
    moveFile(resolved, target);
    return { ok: true, movedTo: target };
  }

  return { worldDirs, list, create, remove };
}

module.exports = { createWorldStore };
