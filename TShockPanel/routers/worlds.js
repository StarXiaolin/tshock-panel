'use strict';

/**
 * 世界存档路由：列表 / 新建 / 导入 / 删除 / 选择。
 *
 * 业务逻辑在 lib/worlds-store.js（已单测）；这里只做 HTTP 形状、入参校验和
 * “选中的世界”这一处面板状态写入。
 */

function createWorldRoutes(ctx) {
  const {
    route,
    json,
    readBody,
    readJsonBody,
    fs,
    fsp,
    path,
    worlds,
    getWorldsDir,
    getSelectedWorld,
    selectWorld,
    sanitizeFileName,
    readWorldInfo,
  } = ctx;

  route('GET', /^\/api\/worlds$/, async (req, res) => {
    json(res, 200, {
      worlds: await worlds.list(),
      dirs: worlds.worldDirs(),
      worldsDir: getWorldsDir(),
      selected: getSelectedWorld(),
    });
  });

  route('POST', /^\/api\/worlds\/create$/, async (req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await worlds.create(body));
  });

  route('POST', /^\/api\/worlds\/upload$/, async (req, res, url) => {
    let name = url.searchParams.get('name') || '';
    name = path.basename(name);
    if (!name.toLowerCase().endsWith('.wld')) throw new Error('只支持 .wld 世界存档');
    const worldsDir = getWorldsDir();
    if (!fs.existsSync(worldsDir)) throw new Error('世界存档目录不存在。');
    const buf = await readBody(req, 512 * 1024 * 1024);
    if (buf.length < 64) throw new Error('文件内容为空或不完整。');
    const target = path.join(worldsDir, sanitizeFileName(name.replace(/\.wld$/i, '')) + '.wld');
    await fsp.writeFile(target, buf);
    const info = readWorldInfo(target);
    json(res, 200, { ok: true, path: target, name: info?.name || name });
  });

  route('POST', /^\/api\/worlds\/delete$/, async (req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await worlds.remove(body.path));
  });

  route('POST', /^\/api\/worlds\/select$/, async (req, res) => {
    const body = await readJsonBody(req);
    if (!body.path) throw new Error('缺少世界路径');
    json(res, 200, { ok: true, selected: selectWorld(path.resolve(body.path)) });
  });
}

module.exports = { createWorldRoutes };
