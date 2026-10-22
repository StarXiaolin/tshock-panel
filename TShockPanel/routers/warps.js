'use strict';

/**
 * 传送点路由：列表 / 新建 / 隐藏 / 删除 / 发送玩家。
 *
 * 库访问在 lib/warps-db.js，命令下发改走注入的 restCommand。
 * 注意：新建与隐藏之后的“重启才生效”是 TShock 的真实行为（启动时把 Warps 读进内存），
 * 文案与拆分前保持一致。
 */

function createWarpRoutes(ctx) {
  const { route, json, readJsonBody, requireRunning, restCommand, addLog, warpsDb, isLive } = ctx;

  route('GET', /^\/api\/warps$/, async (req, res) => {
    let warps = [];
    let error = '';
    try {
      const db = warpsDb.openDb(true);
      const rows = db.prepare('SELECT Id, WarpName, X, Y, WorldID, Private FROM Warps ORDER BY WarpName').all();
      db.close();
      warps = rows.map((row) => ({
        id: row.Id,
        name: row.WarpName,
        x: row.X,
        y: row.Y,
        worldId: row.WorldID,
        hidden: String(row.Private) === '1',
      }));
    } catch (err) {
      error = err.message;
    }
    const worldId = warpsDb.currentWorldId();
    for (const warp of warps) {
      warp.current = worldId ? String(warp.worldId) === worldId : null;
    }
    json(res, 200, {
      warps,
      worldId,
      error,
      running: isLive(),
      sqlite: !!warpsDb.getSqlite(),
    });
  });

  route('POST', /^\/api\/warps\/add$/, async (req, res) => {
    const body = await readJsonBody(req);
    const name = String(body.name || '').trim();
    const x = Number(body.x);
    const y = Number(body.y);
    if (!name || name.length > 40) throw new Error('名称长度需要在 1–40 之间');
    if (/[\s"'\\]/.test(name)) throw new Error('名称不能包含空格、引号或反斜杠（TShock 用空格分隔参数）');
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('X / Y 需要是整数（图格坐标）');
    if (x < 0 || y < 0 || x > 20000 || y > 20000) throw new Error('坐标超出合理范围（0–20000）');

    const worldId = warpsDb.currentWorldId();
    if (!worldId) throw new Error('无法确定当前世界的世界 ID：请先在「世界存档」里选择一个世界');

    warpsDb.backupDatabase('before-warp-add');
    const db = warpsDb.openDb(false);
    try {
      const exists = db.prepare('SELECT 1 FROM Warps WHERE WarpName = ? AND WorldID = ?').get(name, worldId);
      if (exists) throw new Error(`传送点「${name}」已经存在`);
      db.prepare('INSERT INTO Warps (WarpName, X, Y, WorldID) VALUES (?, ?, ?, ?)').run(name, x, y, worldId);
    } finally {
      db.close();
    }
    addLog('panel', `创建传送点 ${name}（${x}, ${y}）`);
    json(res, 200, {
      ok: true,
      name,
      x,
      y,
      needsRestart: true,
      note: 'TShock 在启动时把传送点读入内存，新传送点需要重启服务器后才会出现在 /warp list 里。',
    });
  });

  route('POST', /^\/api\/warps\/hide$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const name = String(body.name || '').trim();
    if (!name) throw new Error('缺少传送点名');
    const hidden = !!body.hidden;
    let output = [];
    let fallback = false;
    try {
      output = await restCommand(`/warp hide "${name}" ${hidden ? 'true' : 'false'}`);
    } catch (err) {
      output = [err.message];
    }
    // 命令执行后再核对一次数据库：TShock 内存里没有的条目（面板新建、尚未重启）需要直接写库
    const worldId = warpsDb.currentWorldId();
    const db = warpsDb.openDb(false);
    try {
      const row = db.prepare('SELECT Private FROM Warps WHERE WarpName = ? AND WorldID = ?').get(name, worldId);
      if (!row) throw new Error(`找不到传送点「${name}」`);
      const currently = String(row.Private) === '1';
      if (currently !== hidden) {
        db.prepare('UPDATE Warps SET Private = ? WHERE WarpName = ? AND WorldID = ?').run(hidden ? '1' : '0', name, worldId);
        fallback = true;
      }
    } finally {
      db.close();
    }
    addLog('panel', `传送点 ${name} ${hidden ? '已隐藏' : '已取消隐藏'}${fallback ? '（数据库直改，重启后生效）' : ''}`);
    json(res, 200, { ok: true, output, hidden, fallback });
  });

  route('POST', /^\/api\/warps\/delete$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const names = (Array.isArray(body.names) ? body.names : [body.name]).map((n) => String(n || '').trim()).filter(Boolean);
    if (!names.length) throw new Error('请选择要删除的传送点');
    const worldId = warpsDb.currentWorldId();
    const failed = [];
    for (const name of names) {
      let deletedInCache = false;
      try {
        await restCommand(`/warp del "${name}"`);
        deletedInCache = true;
      } catch (err) {
        /* 可能只是 TShock 内存里没有（面板刚插入、还没重启），继续走数据库删除 */
      }
      try {
        const db = warpsDb.openDb(false);
        try {
          const info = db.prepare('DELETE FROM Warps WHERE WarpName = ? AND WorldID = ?').run(name, worldId);
          if (!info.changes && !deletedInCache) failed.push(`${name}：找不到这个传送点`);
        } finally {
          db.close();
        }
      } catch (err) {
        failed.push(`${name}：${err.message}`);
      }
    }
    if (failed.length) throw new Error('部分传送点删除失败：' + failed.join('；'));
    addLog('panel', `删除传送点：${names.join('、')}`);
    json(res, 200, { ok: true, deleted: names.length });
  });

  route('POST', /^\/api\/warps\/send$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const player = String(body.player || '').trim();
    const name = String(body.name || '').trim();
    if (!player) throw new Error('请选择在线玩家');
    if (!name) throw new Error('缺少传送点名');
    const output = await restCommand(`/warp send "${player}" "${name}"`);
    addLog('panel', `把玩家 ${player} 发送到传送点 ${name}`);
    json(res, 200, { ok: true, output });
  });
}

module.exports = { createWarpRoutes };
