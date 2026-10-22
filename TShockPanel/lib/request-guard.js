'use strict';

/**
 * 本机面板的跨站请求防护。
 *
 * 面板只监听 127.0.0.1，而且没有登录鉴权 —— 对浏览器来说，「能连上」就等于「有权限」。
 * 但这挡不住两种浏览器侧的攻击：
 *
 *   1. CSRF：你打开一个恶意网页，它向后端 POST（简单请求不需要预检），
 *      面板就会真的去执行命令、开服、停服；
 *   2. DNS rebinding：恶意域名解析到 127.0.0.1，连接确实落在本机，
 *      但 Host 是攻击者的域名，面板照常响应。
 *
 * 这里做两件不改变正常用法的事：
 *   - `Host` 必须是本机名（127.0.0.1 / localhost / [::1]），且端口与面板一致；
 *   - `Origin` 头如果存在，必须是本机来源；不带 Origin 的 curl / 脚本照旧放行。
 *
 * 注意：这不是鉴权（见 refactor-log 的 L16），只是把「随便点开一个网页就能被远程操作」
 * 这条路堵掉。真正的鉴权另说。
 */

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const DEFAULT_PORTS = { http: '80', https: '443' };

/** 把 "host:port" / "[::1]:port" / "host" 拆成 { host, port } */
function splitHostPort(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return { host: '', port: '' };
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
  if (bracketed) return { host: `[${bracketed[1]}]`, port: bracketed[2] || '' };
  const idx = text.lastIndexOf(':');
  if (idx >= 0 && /^\d+$/.test(text.slice(idx + 1))) {
    return { host: text.slice(0, idx), port: text.slice(idx + 1) };
  }
  return { host: text, port: '' };
}

/** Host 头：必须指向本机，且端口对得上（没写端口时按默认端口算） */
function checkHost(hostHeader, port) {
  const { host, port: hostPort } = splitHostPort(hostHeader);
  if (!host) return '缺少 Host 头';
  if (!LOOPBACK_HOSTS.includes(host)) {
    return `只接受本机地址访问（收到 Host: ${host}）`;
  }
  const actual = hostPort || DEFAULT_PORTS.http;
  if (String(port) !== actual) {
    return `Host 端口与面板端口不一致（${actual} ≠ ${port}）`;
  }
  return null;
}

/** Origin 头：不存在视为非浏览器客户端，放行；存在则必须是本机同端口 */
function checkOrigin(originHeader, port) {
  if (!originHeader) return null;
  const text = String(originHeader).trim().toLowerCase();
  if (text === 'null') return '拒绝来源不明的跨站请求（Origin: null）';
  const matched = /^(http|https):\/\/(\[[^\]]+\]|[^/:]+)(?::(\d+))?$/.exec(text);
  if (!matched) return `无法识别的 Origin：${originHeader}`;
  const [, scheme, host, originPort] = matched;
  // 先判“是不是本机”，再判协议：外部来源统一报"跱站请求被拒绝"，比"只接受 http" 更好排错
  if (!LOOPBACK_HOSTS.includes(host)) return `拒绝跨站请求（来源 ${originHeader}）`;
  if (scheme !== 'http') return `只接受 http 来源（收到 ${originHeader}）`;
  const actual = originPort || DEFAULT_PORTS[scheme];
  if (String(port) !== actual) {
    return `来源端口与面板端口不一致（${actual} ≠ ${port}）`;
  }
  return null;
}

/**
 * 检查一个请求是否来自本机页面。
 * @returns {string|null} 拒绝原因；null 表示放行
 */
function checkRequest(req, port) {
  const headers = (req && req.headers) || {};
  return checkHost(headers.host, port) || checkOrigin(headers.origin, port);
}

module.exports = { checkRequest, checkHost, checkOrigin, splitHostPort, LOOPBACK_HOSTS };
