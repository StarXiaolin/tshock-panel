'use strict';

/**
 * 物品路由（2 条）：物品库查询、给在线玩家发放物品。
 *
 * 物品库与参数校验在 lib/items.js，在线玩家在 lib/players.js；这里只负责
 * “校验顺序 + 拼 /give 命令 + 判定执行结果”这三件事。
 *
 * 行为保持不变：
 *  - 校验顺序：物品 → 数量 → 前缀 → 玩家在线（前端提示语依赖这个顺序）；
 *  - 命令形如 `/give 4956 "Alice" 1 5`（前缀为 0 时不带最后一段）；
 *  - 输出里出现 不存在/无效/错误/失败/无法/权限 视为失败，但仍返回 200 与原文。
 */

const { displayName } = require('../lib/players');

function createItemRoutes(ctx) {
  const { route, json, readJsonBody, requireRunning, restCommand, addLog, items, players } = ctx;

  route('GET', /^\/api\/items$/, (req, res) => {
    const list = items.load();
    json(res, 200, { items: list, count: list.length });
  });

  route('POST', /^\/api\/items\/give$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const netId = Number(body.netId);
    const count = Number(body.count ?? 1);
    const prefix = Number(body.prefix ?? 0);
    const wanted = String(body.player || '').trim();

    const { item } = items.validateGive({ netId, count, prefix });
    if (!wanted) throw new Error('请先选择目标玩家');

    const online = await players.onlinePlayers();
    if (online.length === 0) throw new Error('当前没有在线玩家，无法发放物品');
    const target = online.find((p) => displayName(p).toLowerCase() === wanted.toLowerCase());
    if (!target) throw new Error(`玩家「${wanted}」当前不在线，无法发放物品`);

    const nick = displayName(target);
    let command = `/give ${netId} "${nick}" ${count}`;
    if (prefix > 0) command += ` ${prefix}`;

    const output = await restCommand(command);
    const failed = output.some((line) => /不存在|无效|错误|失败|无法|权限/.test(line));
    addLog(
      'panel',
      `发放物品：${item ? item.zh || item.en : netId} ×${count} → ${nick}${prefix > 0 ? `（前缀 ${prefix}）` : ''}`,
    );
    json(res, 200, { ok: !failed, output, item, player: nick });
  });
}

module.exports = { createItemRoutes };
