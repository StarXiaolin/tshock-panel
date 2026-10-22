'use strict';

/**
 * lib/items.js 的单元测试（零依赖，读真实的 data/items.json）。
 *
 * 锁住三件事：
 *   1. 物品库能加载、按 ID 能查到、负数起始装备不在库里；
 *   2. 发放校验的顺序与错误文案与改造前逐字一致（前端会原样显示）；
 *   3. 边界值（0 / 负数 / 10000 / 256）都被拒绝。
 *
 * 用法：node tools/items.test.js
 */

const path = require('path');
const { createItemService, COUNT_RANGE, PREFIX_RANGE } = require('../TShockPanel/lib/items');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed += 1;
    console.error(`  [FAIL] ${name}\n         期望 ${JSON.stringify(expected)}\n         实际 ${JSON.stringify(actual)}`);
  } else {
    console.log(`  [OK]   ${name}`);
  }
}
function checkThrows(name, fn, message) {
  try {
    fn();
    check(name, 'no throw', message);
  } catch (err) {
    check(name, err.message, message);
  }
}

const itemsPath = path.join(__dirname, '..', 'TShockPanel', 'data', 'items.json');
const svc = createItemService({ itemsPath });

console.log('1) 加载与查询');
const all = svc.load();
check('物品库非空', all.length > 6000, true);
check('同一实例返回同一数组', svc.load() === all, true);
const zenith = all.find((it) => it.en === 'Zenith');
check('Zenith 在库中', Boolean(zenith), true);
check('按 ID 能查到同一条', svc.find(zenith.id), zenith);
check('不存在的 ID 返回 null', svc.find(999999), null);
check('负数起始装备在库中（与 README 一致）', svc.find(-15).special, true);

console.log('2) 合法请求');
check('普通物品', svc.validateGive({ netId: zenith.id, count: 1, prefix: 0 }).item.id, zenith.id);
check('负数 ID（起始装备）放行并带回物品', svc.validateGive({ netId: -15, count: 1, prefix: 0 }).item.id, -15);
check('边界数量 1', svc.validateGive({ netId: zenith.id, count: 1, prefix: 0 }).item.id, zenith.id);
check('边界数量 9999', svc.validateGive({ netId: zenith.id, count: 9999, prefix: 255 }).item.id, zenith.id);

console.log('3) 非法请求（顺序与文案）');
checkThrows('ID 为 0', () => svc.validateGive({ netId: 0, count: 1, prefix: 0 }), '物品 ID 不合法');
checkThrows('ID 不是整数', () => svc.validateGive({ netId: 1.5, count: 1, prefix: 0 }), '物品 ID 不合法');
checkThrows(
  'ID 不在库中',
  () => svc.validateGive({ netId: 999999, count: 1, prefix: 0 }),
  '物品 ID 999999 不在物品库中'
);
checkThrows(
  '数量为 0 时提示数量（而不是物品）',
  () => svc.validateGive({ netId: zenith.id, count: 0, prefix: 0 }),
  `数量需要是 ${COUNT_RANGE.min}–${COUNT_RANGE.max} 的整数`
);
checkThrows(
  '数量超上限',
  () => svc.validateGive({ netId: zenith.id, count: 10000, prefix: 0 }),
  `数量需要是 ${COUNT_RANGE.min}–${COUNT_RANGE.max} 的整数`
);
checkThrows(
  '前缀超上限',
  () => svc.validateGive({ netId: zenith.id, count: 1, prefix: 256 }),
  `前缀需要是 ${PREFIX_RANGE.min}–${PREFIX_RANGE.max} 的整数（0 表示无前缀）`
);
checkThrows(
  '前缀为负',
  () => svc.validateGive({ netId: zenith.id, count: 1, prefix: -1 }),
  `前缀需要是 ${PREFIX_RANGE.min}–${PREFIX_RANGE.max} 的整数（0 表示无前缀）`
);
// 顺序：物品错误优先于数量错误
checkThrows(
  '物品错误优先于数量错误',
  () => svc.validateGive({ netId: 0, count: 99999, prefix: 999 }),
  '物品 ID 不合法'
);

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
