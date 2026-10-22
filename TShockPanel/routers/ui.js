'use strict';

/**
 * 面板外观偏好路由（2 条）：GET/POST /api/ui。
 *
 * 读写与校验都在 lib/ui-state.js；这里只做 HTTP 形状。
 */

function createUiRoutes(ctx) {
  const { route, json, readJsonBody, uiState } = ctx;

  route('GET', /^\/api\/ui$/, (req, res) => {
    json(res, 200, uiState.read());
  });

  route('POST', /^\/api\/ui$/, async (req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, uiState.patch(body));
  });
}

module.exports = { createUiRoutes };
