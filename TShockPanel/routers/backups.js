'use strict';

/**
 * 备份路由：列表 / 创建 / 还原 / 删除。
 *
 * 只负责 HTTP 形状；真正的读写逻辑在 lib/backups.js 里，已经单测覆盖。
 * 依赖由 server.js 注入，模块不 require server.js（避免循环依赖）。
 */

function createBackupRoutes(ctx) {
  const { route, json, readJsonBody, backups, backupDir, getLaunchWorld } = ctx;

  route('GET', /^\/api\/backups$/, async (req, res) => {
    json(res, 200, { backups: await backups.list(), dir: backupDir });
  });

  route('POST', /^\/api\/backups\/create$/, async (req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await backups.create({ reason: body.reason || '手动备份', worldPath: body.worldPath || getLaunchWorld() }));
  });

  route('POST', /^\/api\/backups\/restore$/, async (req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await backups.restore(String(body.id || '')));
  });

  route('POST', /^\/api\/backups\/delete$/, async (req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await backups.remove(String(body.id || '')));
  });
}

module.exports = { createBackupRoutes };
