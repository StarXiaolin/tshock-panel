'use strict';

/**
 * TShock REST 客户端 —— 面板访问 TShock 的唯一出口。
 *
 * 为什么要单独一层：
 *   面板里所有“读在线玩家、读组、发命令、看状态”都走 REST，原先 5 个函数散在
 *   server.js 中间，外加 11 处调用点各自拼 `?a=...&b=...` 和 encodeURIComponent。
 *   转义不一致（尤其是带引号、空格、中文的命令参数）是这类面板最常见的坑。
 *
 * 设计约束：
 *   - 端口与令牌由 server.js 注入（它们属于面板状态，不属于 REST 客户端）；
 *   - 只做 HTTP + 错误归一，不碰业务语义；
 *   - 对外抛出的错误文案保持与原实现逐字一致（前端会直接显示这些字符串）。
 */

/** 把查询参数拼到 pathname 上；已有 `?` 时用 `&`。返回新的 pathname。 */
function appendQuery(pathname, params) {
  if (!params) return pathname;
  const pairs = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  if (pairs.length === 0) return pathname;
  const sep = pathname.includes('?') ? '&' : '?';
  return `${pathname}${sep}${pairs.join('&')}`;
}

/**
 * @param {object} deps
 * @param {() => number} deps.getPort    TShock REST 端口
 * @param {() => string} deps.getToken   面板的 REST 令牌
 */
function createRestClient({ getPort, getToken }) {
  function url(pathname) {
    return `http://127.0.0.1:${getPort()}${pathname}`;
  }

  /** 发一个 GET，返回 { statusCode, json, text }；HTTP 非 200 也不抛，由调用方判断。 */
  async function get(pathname, timeout = 6000) {
    const hasQuery = pathname.includes('?');
    const hasToken = /(?:^|[?&])token=/.test(pathname);
    const target = url(pathname) + (hasToken ? '' : `${hasQuery ? '&' : '?'}token=${encodeURIComponent(getToken())}`);
    const res = await fetch(target, { signal: AbortSignal.timeout(timeout) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (err) {
      json = null;
    }
    return { statusCode: res.status, json, text };
  }

  /** 探活：TShock 的 /v2/server/status 是否 200。 */
  async function ok(timeout = 1500) {
    try {
      const r = await get('/v2/server/status', timeout);
      return r.statusCode === 200;
    } catch (err) {
      return false;
    }
  }

  /** 调用一个返回 JSON 的接口；业务失败（status!=200 或 JSON 里带 error）抛错。 */
  async function call(pathname, timeout = 12000) {
    const r = await get(pathname, timeout);
    if (!r.json) throw new Error(`REST 返回无法解析：${r.text.slice(0, 200)}`);
    if (r.statusCode !== 200 || (r.json.status && String(r.json.status) !== '200')) {
      throw new Error(r.json.error || r.json.response || `REST 错误 ${r.statusCode}`);
    }
    return r.json;
  }

  /** 下发一条 TShock 命令，返回输出行数组。 */
  async function command(cmd, timeout = 20000) {
    const json = await call(appendQuery('/v3/server/rawcmd', { cmd }), timeout);
    return Array.isArray(json.response) ? json.response : json.response ? [String(json.response)] : [];
  }

  return { url, get, ok, call, command };
}

module.exports = { createRestClient, appendQuery };
