'use strict';

/**
 * SSC 初始物品（sscconfig.json 的 Settings.StartingInventory）的校验与视图。
 *
 * 这一段是面板里唯一会批量写 200 行物品数据的入口，任何一行不合法都要
 * 明确指出“第几行、哪个字段”，否则用户很难定位。所以把逐行校验规则独立出来。
 *
 * 规则（与拆分前逐字一致）：
 *  - inventory 必须是数组，最多 200 项；
 *  - netID 必须是整数；0 表示空槽，负数（起始装备）不校验是否在库中；
 *  - prefix 0–255、stack 1–9999。
 */

const MAX_ITEMS = 200;
const PREFIX_RANGE = { min: 0, max: 255 };
const STACK_RANGE = { min: 1, max: 9999 };

/**
 * 逐行校验并清洗前端提交的列表。
 * @param {Array} list 前端提交的 inventory
 * @param {(id:number)=>object|null} findItem 物品库查询
 */
function normalizeInventory(list, findItem) {
  if (!Array.isArray(list)) throw new Error('inventory 需要是数组');
  if (list.length > MAX_ITEMS) throw new Error(`初始物品最多 ${MAX_ITEMS} 项`);

  return list.map((entry, index) => {
    const netID = Number(entry.netID);
    const prefix = Number(entry.prefix ?? 0);
    const stack = Number(entry.stack ?? 1);
    if (!Number.isInteger(netID)) throw new Error(`第 ${index + 1} 行：netID 需要是整数`);
    if (netID !== 0 && netID > 0 && !findItem(netID)) {
      throw new Error(`第 ${index + 1} 行：物品 ID ${netID} 不存在`);
    }
    if (!Number.isInteger(prefix) || prefix < PREFIX_RANGE.min || prefix > PREFIX_RANGE.max) {
      throw new Error(`第 ${index + 1} 行：prefix 需要是 ${PREFIX_RANGE.min}–${PREFIX_RANGE.max} 的整数`);
    }
    if (!Number.isInteger(stack) || stack < STACK_RANGE.min || stack > STACK_RANGE.max) {
      throw new Error(`第 ${index + 1} 行：stack 需要是 ${STACK_RANGE.min}–${STACK_RANGE.max} 的整数`);
    }
    return { netID, prefix, stack };
  });
}

/** 取前端需要的三个字段（enabled / inventory / path）。 */
function viewOf(config, sscPath) {
  if (!config) throw new Error('读取 sscconfig.json 失败');
  const settings = config.Settings || {};
  return {
    enabled: !!settings.Enabled,
    inventory: Array.isArray(settings.StartingInventory) ? settings.StartingInventory : [],
    path: sscPath,
  };
}

/** 把清洗后的列表写回配置对象（只改内存，落盘由路由负责）。 */
function applyTo(config, list) {
  if (!config) throw new Error('读取 sscconfig.json 失败');
  config.Settings = config.Settings || {};
  config.Settings.StartingInventory = list;
  return config;
}

module.exports = { MAX_ITEMS, PREFIX_RANGE, STACK_RANGE, normalizeInventory, viewOf, applyTo };
