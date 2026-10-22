'use strict';

/**
 * 用户组路由：列表 / 权限增删 / 父组 / 建组 / 删组 / 组名列表。
 *
 * 业务在 lib/groups.js；这里只负责 HTTP 形状（读 body、调服务、回 JSON）。
 * 注册顺序与拆分前一致；即便顺序变化也不影响匹配 —— 6 个路径互不重叠且有 $ 锚定。
 */

function createGroupRoutes(ctx) {
  const { route, json, readJsonBody, requireRunning, groups, catalog } = ctx;

  route('GET', /^\/api\/groups$/, async (req, res) => {
    requireRunning();
    json(res, 200, { groups: await groups.listDetailed(), catalog });
  });

  route('POST', /^\/api\/groups\/perm$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const output = await groups.changePermission({
      group: String(body.group || '').trim(),
      permission: body.permission,
      action: body.action,
    });
    json(res, 200, { ok: true, output });
  });

  route('POST', /^\/api\/groups\/parent$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const output = await groups.setParent({
      group: String(body.group || '').trim(),
      parent: String(body.parent || '').trim(),
    });
    json(res, 200, { ok: true, output });
  });

  route('POST', /^\/api\/groups\/create$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const output = await groups.create({
      name: body.name,
      permissions: body.permissions,
      parent: body.parent,
    });
    json(res, 200, { ok: true, output });
  });

  route('POST', /^\/api\/groups\/delete$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const output = await groups.remove({ name: body.name });
    json(res, 200, { ok: true, output });
  });

  route('GET', /^\/api\/group-names$/, async (req, res) => {
    requireRunning();
    json(res, 200, { groups: await groups.names() });
  });
}

module.exports = { createGroupRoutes };
