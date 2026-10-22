'use strict';

/**
 * 世界事件路由（2 条）：能力清单 GET /api/world-events、触发 POST /api/world-events/trigger。
 *
 * 探测、校验与命令拼装在 lib/world-events.js；这里只处理“冲突时回 409”这一件
 * HTTP 层的事，其余直接回 200。
 */

function createWorldEventRoutes(ctx) {
  const { route, json, readJsonBody, requireRunning, events } = ctx;

  route('GET', /^\/api\/world-events$/, async (req, res, url) => {
    requireRunning();
    const refresh = url.searchParams.get('refresh') === '1';
    json(res, 200, await events.describe({ refresh }));
  });

  route('POST', /^\/api\/world-events\/trigger$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const result = await events.trigger(body);
    if (result && result.conflict) {
      json(res, 409, { error: result.message, conflict: result.conflict });
      return;
    }
    json(res, 200, result);
  });
}

module.exports = { createWorldEventRoutes };
