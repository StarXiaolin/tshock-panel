'use strict';

/**
 * 日志总线：内存环形缓冲 + SSE 广播 + 行解析。
 *
 * 从 server.js 搬出来，因为它跟 HTTP 路由、进程管理都没有关系，只负责
 * “把一行日志收进来、必要时折叠/截断、再推给所有连着的浏览器”。
 *
 * 状态（缓冲数组、SSE 连接集合）仍然是一个实例一份，用工厂返回，这样
 * server.js 里原来的 `logBuffer.items` / `sseClients.add` 调用点可以一字不改。
 */

const MAX_LOG_LINES = 4000;

/** 崩溃调用栈最多保留多少层，再多就折叠成“已省略 N 行” */
const MAX_STACK_LINES = 200;

function createLogBus({ maxLines = MAX_LOG_LINES } = {}) {
  const logBuffer = { items: [], nextId: 1 };
  const sseClients = new Set();

  let pendingLogUpdate = null;
  let logUpdateTimer = null;
  let stackRun = 0;

  function broadcast(event, payload) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(frame);
      } catch (err) {
        sseClients.delete(res);
      }
    }
  }

  /** 折叠/省略日志时只需刷新最后一条，做一点节流避免刷爆前端。 */
  function queueLogUpdate(payload) {
    pendingLogUpdate = payload;
    if (logUpdateTimer) return;
    logUpdateTimer = setTimeout(() => {
      logUpdateTimer = null;
      if (pendingLogUpdate) {
        broadcast('logUpdate', pendingLogUpdate);
        pendingLogUpdate = null;
      }
    }, 120);
  }

  function addLog(stream, text) {
    if (!text) return;
    const items = logBuffer.items;
    const last = items[items.length - 1];

    // 完全相同的连续行折叠成一条，只更新时间与次数
    if (last && last.stream === stream && last.text === text) {
      last.count = (last.count || 1) + 1;
      last.t = Date.now();
      queueLogUpdate({ id: last.id, count: last.count, t: last.t, hidden: last.hidden });
      return;
    }

    // 崩溃调用栈可能刷出成千上万行，只保留前 200 层，避免冲掉有用日志
    if (/^\s+at\s/.test(text)) {
      stackRun += 1;
      if (stackRun > MAX_STACK_LINES) {
        if (last && last.stream === stream) {
          last.hidden = (last.hidden || 0) + 1;
          queueLogUpdate({ id: last.id, hidden: last.hidden, count: last.count });
        }
        return;
      }
    } else {
      stackRun = 0;
    }

    const item = { id: logBuffer.nextId++, t: Date.now(), stream, text };
    items.push(item);
    if (items.length > maxLines) {
      items.splice(0, items.length - maxLines);
    }
    broadcast('log', item);
  }

  return { logBuffer, sseClients, addLog, broadcast, queueLogUpdate };
}

/** 子进程输出按 UTF-8 解；解不开再试 GBK（老版本 Windows 控制台），最后 latin1。 */
function decodeLine(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (err) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch (err2) {
      return buf.toString('latin1');
    }
  }
}

/** 把任意分块的字节流切成行回调；兼容 CRLF，单行超过 512KB 就直接吐出。 */
function makeLineReader(onLine) {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    let idx = pending.indexOf(0x0a);
    while (idx >= 0) {
      let line = pending.subarray(0, idx);
      pending = pending.subarray(idx + 1);
      if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
      onLine(decodeLine(line));
      idx = pending.indexOf(0x0a);
    }
    if (pending.length > 512 * 1024) {
      onLine(decodeLine(pending));
      pending = Buffer.alloc(0);
    }
  };
}

/** 终端颜色控制符，写日志面板前要剥掉 */
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

module.exports = { createLogBus, decodeLine, makeLineReader, ANSI_RE, MAX_LOG_LINES };
