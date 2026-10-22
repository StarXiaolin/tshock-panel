'use strict';

/**
 * 世界事件（血月/日食/入侵/雨…）：能力探测、触发与冲突预判。
 *
 * 为什么单独一层：
 *   TShock 没有“查询支持哪些事件”的 REST 接口，只能跑 `/worldevent` 把中文帮助
 *   打出来再解析。这段解析 + 5 分钟缓存 + 触发校验原先散在 server.js 的三个
 *   函数和两个 handler 里，既不好测也不好改。现在收敛成一个服务：
 *   - 探测结果缓存 5 分钟，`refresh` 可强制刷新；
 *   - 触发前做类型/子类型/波数校验，再拼一条 TShock 命令；
 *   - 血月与日食互斥，冲突时返回 conflict 让路由回 409（由前端二次确认）。
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

/** 从中文帮助里取出“有效的事件类型：a, b, c。”这类列表。 */
function parseListFromText(text, keyword) {
  const re = new RegExp(keyword + '[：:]\\s*([^。\\n]+)');
  const match = re.exec(text);
  if (!match) return null;
  return match[1]
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 从 `/worldevent rain` 的帮助里取出雨类型（形如 `/worldevent rain meteor`）。 */
function parseRainTypes(text) {
  const matches = String(text || '').match(/\/worldevent rain ([a-z ]+)/g) || [];
  return [
    ...new Set(matches.map((m) => m.replace('/worldevent rain', '').trim().split(/\s+/).pop())),
  ].filter(Boolean);
}

function createEventDiscovery({ restCommand, meta, ttlMs = CACHE_TTL_MS }) {
  const { EVENT_META, INVASION_META, RAIN_META, eventPermission } = meta;
  let cache = null;
  let cachedAt = 0;

  async function discover(force = false) {
    if (cache && !force && Date.now() - cachedAt < ttlMs) return cache;

    // 串行调用：TShock 的 rawcmd 在并发时可能互相等待，这里一次只发一条
    const root = await restCommand('/worldevent', 8000).catch(() => []);
    const invasion = await restCommand('/worldevent invasion', 8000).catch(() => []);
    const rain = await restCommand('/worldevent rain', 8000).catch(() => []);

    const rootText = root.join('\n');
    const invasionText = invasion.join('\n');
    const rainText = rain.join('\n');

    const types = parseListFromText(rootText, '有效的事件类型') || Object.keys(EVENT_META);
    const invasions = parseListFromText(invasionText, '入侵类型') || Object.keys(INVASION_META);
    const rains = parseRainTypes(rainText);
    const rainTypes = rains.length ? rains : Object.keys(RAIN_META);

    cache = {
      types: types.map((type) => ({
        type,
        label: (EVENT_META[type] && EVENT_META[type].label) || type,
        desc: (EVENT_META[type] && EVENT_META[type].desc) || '',
        icon: (EVENT_META[type] && EVENT_META[type].icon) || '●',
        permission: eventPermission(type),
        known: !!EVENT_META[type],
      })),
      invasions: invasions.map((key) => ({
        key,
        label: INVASION_META[key] || key,
        permission: eventPermission('invasion'),
      })),
      rains: rainTypes.map((key) => ({
        key,
        label: RAIN_META[key] || key,
        permission: eventPermission('rain'),
      })),
      raw: { root, invasion, rain },
      at: Date.now(),
    };
    cachedAt = Date.now();
    return cache;
  }

  /** 只给测试用：清掉缓存，模拟“面板刚启动”。 */
  function reset() {
    cache = null;
    cachedAt = 0;
  }

  return { discover, reset };
}

function createWorldEventService({ restCall, restCommand, addLog, discovery }) {
  let lastResult = null;

  /** 血月状态：拿不到就不做冲突预判（返回 null）。 */
  async function bloodmoonState() {
    try {
      const data = await restCall('/v3/world/bloodmoon', 4000);
      const text = String(data.response || '');
      if (/Enabled/i.test(text)) return true;
      if (/Disabled/i.test(text)) return false;
    } catch (err) {
      /* 忽略：拿不到状态就不做冲突预判 */
    }
    return null;
  }

  /** GET /api/world-events 的数据：能力清单 + 当前状态。 */
  async function describe({ refresh = false } = {}) {
    const meta = await discovery.discover(refresh);
    return { ...meta, status: { bloodmoon: await bloodmoonState(), last: lastResult } };
  }

  /**
   * 触发一个世界事件。
   * 成功返回结果对象；需要前端二次确认时返回 { conflict: 'bloodmoon' }。
   */
  async function trigger(body) {
    const type = String(body.type || '').trim();
    const sub = String(body.sub || '').trim();
    const waves = body.waves === '' || body.waves === undefined || body.waves === null ? '' : String(body.waves);
    const force = !!body.force;

    const meta = await discovery.discover();
    const known = meta.types.find((t) => t.type === type);
    if (!known) throw new Error(`当前 TShock 不支持事件类型「${type}」`);

    if (type === 'invasion') {
      if (sub && !meta.invasions.some((x) => x.key === sub)) throw new Error(`无效的入侵类型「${sub}」`);
      if (waves && !/^\d{1,3}$/.test(waves)) throw new Error('波数需要是 1–999 的整数');
    }
    if (type === 'rain' && sub && !meta.rains.some((x) => x.key === sub)) {
      throw new Error(`无效的雨类型「${sub}」`);
    }

    // 冲突预判：血月与日食互斥
    const state = await bloodmoonState();
    if (type === 'eclipse' && state === true && !force) {
      return {
        conflict: 'bloodmoon',
        message: '血月正在进行中，日食与血月互斥。继续触发会先结束血月，是否继续？',
      };
    }

    let command = `/worldevent ${type}`;
    if (type === 'invasion') {
      if (sub) command += ` ${sub}`;
      if (waves) command += ` ${waves}`;
    }
    if (type === 'rain' && sub) command += ` ${sub}`;

    const output = await restCommand(command);
    const failed = output.some((line) => /格式错误|无效|不存在|不能|无法/.test(line));
    lastResult = {
      at: Date.now(),
      type,
      label: known.label,
      sub: sub || '',
      waves: waves || '',
      command,
      ok: !failed,
      output,
    };
    addLog('panel', `世界事件：${command}${output.length ? ' → ' + output.join(' / ') : ''}`);
    return lastResult;
  }

  return { describe, trigger, bloodmoonState, last: () => lastResult };
}

module.exports = { CACHE_TTL_MS, parseListFromText, parseRainTypes, createEventDiscovery, createWorldEventService };
