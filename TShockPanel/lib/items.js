'use strict';

/**
 * 物品库服务：加载 data/items.json、按 ID 查物品、校验发放参数。
 *
 * 为什么单独一层：
 *   物品库是面板里唯一“离线可用”的数据源（6198 条，中文名 + 英文名 + 内部名）。
 *   原先加载、索引、以及“发物品前的参数校验”散在 server.js 的缓存变量和路由里，
 *   校验顺序也是写在路由中间的 if 链——既没法单测，也没法回答“到底允许发什么”。
 *
 * 约束：校验的错误文案与顺序必须与改造前逐字一致（前端会原样显示这些字符串）。
 */

const fs = require('fs');

/** 数量与前缀的合法区间，路由提示语里也要用，所以放在这里当唯一出处 */
const COUNT_RANGE = { min: 1, max: 9999 };
const PREFIX_RANGE = { min: 0, max: 255 };

/**
 * @param {object} deps
 * @param {string} deps.itemsPath data/items.json 的绝对路径
 */
function createItemService({ itemsPath }) {
  let cache = null;
  let index = null;

  function load() {
    if (cache) return cache;
    const list = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
    cache = list;
    index = new Map(list.map((it) => [it.id, it]));
    return cache;
  }

  function find(id) {
    load();
    return index.get(Number(id)) || null;
  }

  /**
   * 校验一次发放请求里的物品参数。
   * 顺序固定：物品 ID → 是否在库中 → 数量 → 前缀。
   * 合法则返回 { item }；负数 ID（起始装备）也在库里，但按原逻辑不强制校验。
   */
  function validateGive({ netId, count, prefix }) {
    if (!Number.isInteger(netId) || netId === 0) throw new Error('物品 ID 不合法');
    const item = find(netId);
    if (netId > 0 && !item) throw new Error(`物品 ID ${netId} 不在物品库中`);
    if (!Number.isInteger(count) || count < COUNT_RANGE.min || count > COUNT_RANGE.max) {
      throw new Error(`数量需要是 ${COUNT_RANGE.min}–${COUNT_RANGE.max} 的整数`);
    }
    if (!Number.isInteger(prefix) || prefix < PREFIX_RANGE.min || prefix > PREFIX_RANGE.max) {
      throw new Error(`前缀需要是 ${PREFIX_RANGE.min}–${PREFIX_RANGE.max} 的整数（0 表示无前缀）`);
    }
    return { item };
  }

  return { load, find, validateGive };
}

module.exports = { createItemService, COUNT_RANGE, PREFIX_RANGE };
