'use strict';

/**
 * 玩家 / 封禁 / 账户路由（12 条）。
 *
 * 这些接口都是“读 body → 校验 → 调 REST → 回 JSON”，没有本地状态；
 * 拆出来后 server.js 不再持有任何玩家相关的校验规则，改规则只改这一处。
 *
 * 行为保持不变：
 *  - 校验顺序、报错文案、返回字段与拆分前逐字一致；
 *  - 账户密码只走 REST 参数，不写进面板日志（日志里只记“谁改了密码”）。
 */

const { displayName, maskIp, parseAccountInfo, activeBans } = require('../lib/players');

function createPlayerRoutes(ctx) {
  const { route, json, readJsonBody, requireRunning, restCall, restCommand, addLog, players, groups } = ctx;

  route('GET', /^\/api\/players$/, async (req, res) => {
    requireRunning();
    json(res, 200, { players: await players.onlinePlayers() });
  });

  route('POST', /^\/api\/players\/action$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const name = String(body.name || '').trim();
    if (!name) throw new Error('缺少玩家名');
    const reason = String(body.reason || '').trim();
    let path;
    switch (body.action) {
      case 'kick':
        path = `/v2/players/kick?player=${encodeURIComponent(name)}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`;
        break;
      case 'kill':
        path = `/v2/players/kill?player=${encodeURIComponent(name)}`;
        break;
      case 'mute':
        path = `/v2/players/mute?player=${encodeURIComponent(name)}`;
        break;
      case 'unmute':
        path = `/v2/players/unmute?player=${encodeURIComponent(name)}`;
        break;
      case 'ban': {
        // 封禁优先按 IP（同一 IP 的换名小号也一起挡），拿不到 IP 才退回玩家名。
        const list = await players.onlinePlayers();
        const match = list.find((p) => displayName(p).toLowerCase() === name.toLowerCase());
        const identifier = match?.ip || name;
        const ban = await restCall(
          `/v3/bans/create?identifier=${encodeURIComponent(identifier)}&reason=${encodeURIComponent(reason || '被管理员封禁')}`,
        );
        json(res, 200, ban);
        return;
      }
      default:
        throw new Error('未知操作');
    }
    json(res, 200, await restCall(path));
  });

  route('GET', /^\/api\/bans$/, async (req, res) => {
    requireRunning();
    const data = await restCall('/v3/bans/list');
    // TShock 的“解封”只是把过期时间设成当前时间，接口仍会返回这些记录
    json(res, 200, { bans: activeBans(data.bans) });
  });

  route('POST', /^\/api\/bans\/add$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const identifier = String(body.identifier || '').trim();
    if (!identifier) throw new Error('请填写要封禁的玩家名或 IP');
    let path = `/v3/bans/create?identifier=${encodeURIComponent(identifier)}`;
    if (body.reason) path += `&reason=${encodeURIComponent(body.reason)}`;
    if (body.name) path += `&name=${encodeURIComponent(body.name)}`;
    json(res, 200, await restCall(path));
  });

  route('POST', /^\/api\/bans\/remove$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const ticket = Number(body.ticket);
    if (!Number.isFinite(ticket)) throw new Error('缺少回执号');
    json(res, 200, await restCall(`/v3/bans/destroy?ticketNumber=${ticket}`));
  });

  route('GET', /^\/api\/users$/, async (req, res) => {
    requireRunning();
    const data = await restCall('/v2/users/list');
    json(res, 200, { users: data.users || [] });
  });

  route('POST', /^\/api\/users\/add$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const user = String(body.user || '').trim();
    const group = String(body.group || 'guest').trim();
    const password = String(body.password || '');
    if (!user) throw new Error('请填写用户名');
    if (password.length < 4) throw new Error('密码至少 4 位');
    const path = `/v2/users/create?user=${encodeURIComponent(user)}&group=${encodeURIComponent(group)}&password=${encodeURIComponent(password)}`;
    json(res, 200, await restCall(path));
  });

  route('POST', /^\/api\/users\/remove$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const user = String(body.user || '').trim();
    if (!user) throw new Error('请填写用户名');
    json(res, 200, await restCall(`/v2/users/destroy?user=${encodeURIComponent(user)}`));
  });

  route('GET', /^\/api\/players\/detail$/, async (req, res, url) => {
    requireRunning();
    const name = String(url.searchParams.get('name') || '').trim();
    const reveal = url.searchParams.get('reveal') === '1';
    if (!name) throw new Error('缺少玩家名');

    const player = await players.findOnline(name);
    if (!player) throw new Error(`玩家「${name}」不在线`);

    const ip = String(player.ip || '');
    const username = player.username || '';

    let account = null;
    if (username) {
      try {
        const lines = await restCommand(`/accountinfo ${username}`);
        account = parseAccountInfo(lines);
      } catch (err) {
        account = { exists: false, error: err.message, raw: [] };
      }
    }

    if (reveal && ip) addLog('panel', `审计：查看了玩家 ${name} 的完整 IP（${maskIp(ip)}）`);

    json(res, 200, {
      player: {
        ...player,
        ip: reveal ? ip : maskIp(ip),
        ipMasked: maskIp(ip),
        revealed: reveal,
        name: displayName(player),
      },
      account,
      // 当前 TShock 没有公开的 SSC 读取接口，这里如实返回不可用
      sscInventory: { available: false, reason: '当前 TShock 版本没有提供读取 SSC 背包的接口' },
    });
  });

  route('GET', /^\/api\/users\/detail$/, async (req, res, url) => {
    requireRunning();
    const user = String(url.searchParams.get('user') || '').trim();
    if (!user) throw new Error('缺少用户名');
    const lines = await restCommand(`/accountinfo ${user}`);
    json(res, 200, parseAccountInfo(lines));
  });

  route('POST', /^\/api\/users\/password$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const user = String(body.user || '').trim();
    const password = String(body.password || '');
    if (!user) throw new Error('缺少用户名');
    if (password.length < 4) throw new Error('密码至少 4 位');
    if (password.length > 128) throw new Error('密码过长');
    // 密码只走 REST 参数，不写入面板日志
    const result = await restCall(
      `/v2/users/update?user=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}`,
    );
    addLog('panel', `修改了账户 ${user} 的密码`);
    json(res, 200, { ok: true, message: result['password-response'] || '密码已更新' });
  });

  route('POST', /^\/api\/users\/group$/, async (req, res) => {
    requireRunning();
    const body = await readJsonBody(req);
    const user = String(body.user || '').trim();
    const group = String(body.group || '').trim();
    if (!user) throw new Error('缺少用户名');
    if (!group) throw new Error('请选择目标组');
    if (group === 'superadmin') {
      throw new Error('不允许把账户直接设为 superadmin，请创建自定义管理组并分配所需权限。');
    }
    const list = await groups.listDetailed();
    if (!list.some((g) => g.name === group)) throw new Error(`用户组「${group}」不存在`);
    const result = await restCall(
      `/v2/users/update?user=${encodeURIComponent(user)}&group=${encodeURIComponent(group)}`,
    );
    addLog('panel', `把账户 ${user} 迁移到组 ${group}`);
    json(res, 200, { ok: true, message: result['group-response'] || '组已更新' });
  });
}

module.exports = { createPlayerRoutes };
