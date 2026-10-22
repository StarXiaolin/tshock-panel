'use strict';

/**
 * 备份服务：创建 / 列出 / 还原 / 删除。
 *
 * 一次备份 = 一个目录（`<时间戳>_<世界名>`），里面放：
 *   world.wld（可选）、tshock.sqlite、config.json、sscconfig.json、manifest.json
 *
 * 为什么单独一层：
 *   备份是“出事能回头”的唯一保障，但它原先和 HTTP 路由、服务器进程状态混在
 *   server.js 里，既没法单测（要真的去动用户的世界文件），也说不清“还原前会不会
 *   先保一份”。现在把“路径、世界解析、进程是否在跑、日志”全部由外部注入，
 *   测试可以在临时目录里把整条链路跑一遍。
 */

const fs = require('fs');
const path = require('path');

const fsp = fs.promises;

/**
 * @param {object} deps
 * @param {string} deps.backupDir        备份根目录（TShockPanel/backups）
 * @param {string} deps.tshockDir        tshock 目录（取 tshock.sqlite）
 * @param {string} deps.configPath       tshock/config.json
 * @param {string} deps.sscPath          tshock/sscconfig.json
 * @param {(file: string) => object|null} deps.readWorldInfo 复用 lib/worlds 的解析
 * @param {(name: string) => string} deps.sanitizeFileName   备份目录名净化
 * @param {() => Promise<boolean>} deps.isRunning            服务器是否在跑（还原前必须停）
 * @param {() => string} deps.getLaunchWorld                 上次选中的世界路径
 * @param {(text: string) => void} deps.log
 */
function createBackupService(deps) {
  const { backupDir, tshockDir, configPath, sscPath, readWorldInfo, sanitizeFileName, isRunning, getLaunchWorld, log } = deps;

  const sqlitePath = path.join(tshockDir, 'tshock.sqlite');

  function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function timestamp(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  async function create({ reason = '手动备份', worldPath = '' } = {}) {
    ensureDir(backupDir);
    const world = worldPath ? path.resolve(worldPath) : '';
    const worldInfo = world && fs.existsSync(world) ? readWorldInfo(world) : null;
    const label = world ? sanitizeFileName(worldInfo?.name || path.basename(world, '.wld')) : '服务器数据';
    const stamp = timestamp();

    // 备份名只精确到秒，同一秒内两次备份会撞名。撞名时直接复用同名目录会把
    // 上一份快照覆盖掉——“还原前自动备份”恰好会撞上正在还原的那一份，
    // 结果就是还原变成空操作。所以这里补一个自增后缀，保证目录唯一。
    let id = `${stamp}_${label}`;
    let suffix = 2;
    while (fs.existsSync(path.join(backupDir, id))) {
      id = `${stamp}_${label}-${suffix}`;
      suffix += 1;
    }
    const dir = path.join(backupDir, id);
    ensureDir(dir);

    const files = [];
    const copy = (src, name) => {
      if (!fs.existsSync(src)) return;
      const stat = fs.statSync(src);
      if (!stat.isFile()) return;
      fs.copyFileSync(src, path.join(dir, name));
      files.push({ name, size: stat.size, original: src });
    };

    if (world) copy(world, 'world.wld');
    copy(sqlitePath, 'tshock.sqlite');
    copy(configPath, 'config.json');
    copy(sscPath, 'sscconfig.json');

    const manifest = {
      id,
      createdAt: Date.now(),
      reason,
      world: world ? { path: world, name: worldInfo?.name || path.basename(world, '.wld') } : null,
      files,
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    log(`已创建备份：${id}（${files.length} 个文件）`);
    return manifest;
  }

  async function list() {
    ensureDir(backupDir);
    const entries = await fsp.readdir(backupDir, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(backupDir, entry.name);
      let manifest = null;
      try {
        manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'));
      } catch (err) {
        // backups/config 之类不是快照目录，跳过
        continue;
      }
      let total = 0;
      for (const file of manifest.files || []) {
        try {
          total += (await fsp.stat(path.join(dir, file.name))).size;
        } catch (err) {
          /* ignore */
        }
      }
      result.push({
        id: manifest.id || entry.name,
        dir,
        createdAt: manifest.createdAt || 0,
        reason: manifest.reason || '',
        world: manifest.world,
        files: (manifest.files || []).map((f) => f.name),
        size: total,
      });
    }
    result.sort((a, b) => b.createdAt - a.createdAt);
    return result;
  }

  async function restore(id) {
    if (await isRunning()) throw new Error('请先停止服务器再还原备份。');
    const dir = path.join(backupDir, id);
    if (!fs.existsSync(dir)) throw new Error('备份不存在。');
    const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'));

    // 还原前先把当前状态备份一份，避免误操作无法回头
    try {
      await create({ reason: '还原前自动备份', worldPath: manifest.world?.path || getLaunchWorld() });
    } catch (err) {
      log(`还原前备份失败：${err.message}`);
    }

    const restored = [];
    for (const file of manifest.files || []) {
      const src = path.join(dir, file.name);
      if (!fs.existsSync(src)) continue;
      let target = file.original;
      if (file.name === 'world.wld' && manifest.world?.path) target = manifest.world.path;
      if (file.name === 'config.json') target = configPath;
      if (file.name === 'sscconfig.json') target = sscPath;
      if (file.name === 'tshock.sqlite') target = sqlitePath;
      if (!target) continue;
      ensureDir(path.dirname(target));
      fs.copyFileSync(src, target);
      restored.push({ name: file.name, target });
    }
    log(`已还原备份 ${id}（${restored.length} 个文件）`);
    return { ok: true, restored };
  }

  async function remove(id) {
    const dir = path.join(backupDir, id);
    if (!dir.toLowerCase().startsWith(backupDir.toLowerCase())) throw new Error('非法路径');
    if (!fs.existsSync(dir)) throw new Error('备份不存在。');
    await fsp.rm(dir, { recursive: true, force: true });
    return { ok: true };
  }

  return { create, list, restore, remove };
}

module.exports = { createBackupService };
