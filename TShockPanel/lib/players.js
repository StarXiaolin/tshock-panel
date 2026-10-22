'use strict';

/**
 * 玩家与账户相关的纯逻辑：显示名、IP 打码、accountinfo 文本解析、封禁记录换算。
 *
 * 这些都是“给定输入必然得到同一输出”的规则函数，和 HTTP、文件、子进程无关，
 * 所以从 server.js 拆出来单独测试。封禁涉及 .NET ticks 与 Unix 毫秒的换算，
 * 算错会显示错误的解封时间，值得逐条钉住。
 */

// DateTime 的 ticks 是 100 纳秒一格：1 ms = 10000 ticks。
const TICKS_PER_MS = 10000;
// 0001-01-01 到 1970-01-01 的毫秒数（.NET 纪元偏移）。
const TICKS_EPOCH_OFFSET = 62135596800000;
// DateTime.MaxValue.Ticks：TShock 用它表示“永久封禁”。
const TICKS_MAX = 3155378975999999999;

/** 玩家显示名：优先昵称，其次角色名，最后账户名。 */
function displayName(player) {
  if (!player) return '';
  return player.nickname || player.name || player.username || '';
}

/** IPv4 打码成 1.2.*.*，IPv6 保留前两段，其余一律 ****。 */
function maskIp(ip) {
  const text = String(ip || '');
  if (!text) return '';
  const parts = text.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  if (text.includes(':')) return text.split(':').slice(0, 2).join(':') + ':****';
  return '****';
}

/** 解析 `/accountinfo <user>` 的中文输出；字段缺失时给空串而不是 undefined。 */
function parseAccountInfo(lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
  const group = (/的用户组为(.+?)。/.exec(text) || [])[1] || '';
  const lastIp = (/最后记录IP为\s*(.+)/.exec(text) || [])[1] || '';
  const registeredAt = (/注册时间为\s*(.+)/.exec(text) || [])[1] || '';
  return {
    exists: !/不存在/.test(text),
    group: group.trim(),
    lastIp: lastIp.trim(),
    registeredAt: registeredAt.trim(),
    raw: Array.isArray(lines) ? lines : [String(lines)],
  };
}

/** 当前时刻的 .NET ticks。 */
function nowTicks(now = Date.now()) {
  return (now + TICKS_EPOCH_OFFSET) * TICKS_PER_MS;
}

/** 一条封禁记录的到期时间；永久封禁（DateTime.MaxValue）返回 null。 */
function banExpires(ban) {
  const ticks = Number(ban && ban.end_date_ticks);
  if (!ban || !ban.end_date_ticks || !Number.isFinite(ticks)) return null;
  if (ticks >= TICKS_MAX) return null;
  return new Date(ticks / TICKS_PER_MS - TICKS_EPOCH_OFFSET).toISOString();
}

/**
 * 只保留仍然生效的封禁，并补上 expires 字段。
 * 注意：TShock 的“解封”只是把到期时间设成当前时间，接口仍会返回这条记录，
 * 所以必须在这里过滤，否则前端会看到一堆“已解封但还在列表里”的封禁。
 */
function activeBans(bans, now = Date.now()) {
  const ticks = nowTicks(now);
  return (bans || [])
    .filter((b) => !b.end_date_ticks || Number(b.end_date_ticks) > ticks)
    .map((b) => ({ ...b, expires: banExpires(b) }));
}

/**
 * 玩家服务：只包住“拿在线列表”这一个 REST 调用。
 * 路由层与物品发放都通过它取在线玩家，避免两处各写一份解析。
 */
function createPlayerService({ restCall }) {
  async function onlinePlayers() {
    const data = await restCall('/v2/players/list');
    return Array.isArray(data.players) ? data.players : [];
  }

  /** 按显示名找在线玩家（大小写不敏感）；找不到返回 null。 */
  async function findOnline(name) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    const players = await onlinePlayers();
    return players.find((p) => displayName(p).toLowerCase() === wanted) || null;
  }

  return { onlinePlayers, findOnline };
}

module.exports = {
  TICKS_PER_MS,
  TICKS_EPOCH_OFFSET,
  TICKS_MAX,
  displayName,
  maskIp,
  parseAccountInfo,
  nowTicks,
  banExpires,
  activeBans,
  createPlayerService,
};
