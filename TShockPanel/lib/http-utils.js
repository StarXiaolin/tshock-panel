'use strict';

/**
 * HTTP 层的四个基础工具：回 JSON、读请求体、读 JSON 体、检查服务器是否在运行。
 *
 * 拆出来的理由：
 *  - 所有路由模块都通过 ctx 拿到这四个函数，它们决定了**全站统一的错误文案**
 *    （「请求体过大」「请求数据不是合法 JSON」「服务器没有运行。」），
 *    散在 server.js 里时，谁也不敢保证 62 条路由看到的是同一套；
 *  - `readBody` 有 8MB 上限、`readJsonBody` 对空体宽容（返回 {}），
 *    这两个语义值得单独测。
 *
 * 行为与拆分前逐字一致。
 */

const DEFAULT_LIMIT = 8 * 1024 * 1024;

function createHttpUtils({ isRunning }) {
  function json(res, code, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  async function readBody(req, limit = DEFAULT_LIMIT) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > limit) throw new Error('请求体过大');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function readJsonBody(req) {
    const buf = await readBody(req);
    if (buf.length === 0) return {};
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch (err) {
      throw new Error('请求数据不是合法 JSON');
    }
  }

  function requireRunning() {
    if (!isRunning()) throw new Error('服务器没有运行。');
  }

  return { json, readBody, readJsonBody, requireRunning };
}

module.exports = { createHttpUtils, DEFAULT_LIMIT };
