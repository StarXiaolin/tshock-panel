'use strict';

/**
 * lib/catalog.js 的数据完整性测试（零依赖，纯查表）。
 *
 * 这个模块是“数据”而不是“逻辑”：10 个分组、176 个权限节点、9 类世界事件。
 * 它没有算法可测，但数据错了 UI 会直接错（权限列表缺项、事件点了没反应），
 * 而且这类错误不像代码错误那样容易被发现。所以锁住形状与一致性：
 *   1. 每个分组都有 id/title/items，items 是 [权限节点, 中文说明] 二元组；
 *   2. 权限节点全局不重复（重复会让前端渲染出两个一样的勾选框）；
 *   3. allPermissionNodes() 展开的数量与分组内条目总数一致；
 *   4. 事件标签/权限映射齐全，且权限名统一前缀；
 *   5. 入侵与雨的子类型都有中文标签（下拉框不能出现裸 key）。
 *
 * 用法：node tools/catalog.test.js
 */

const {
  PERMISSION_GROUPS,
  EVENT_META,
  INVASION_META,
  RAIN_META,
  eventLabel,
  eventPermission,
  allPermissionNodes,
} = require('../TShockPanel/lib/catalog');

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

console.log('1) 权限分组形状');
check('有 10 个分组', PERMISSION_GROUPS.length, 10);
const badGroups = PERMISSION_GROUPS.filter(
  (g) => !g.id || !g.title || !Array.isArray(g.items) || g.items.length === 0
);
check('每个分组都有 id/title/items', badGroups.map((g) => g.id), []);
const badItems = [];
for (const group of PERMISSION_GROUPS) {
  for (const item of group.items) {
    if (!Array.isArray(item) || item.length !== 2) badItems.push([group.id, item]);
    else if (typeof item[0] !== 'string' || !item[0].startsWith('tshock.')) badItems.push([group.id, item]);
    else if (typeof item[1] !== 'string' || !item[1].trim()) badItems.push([group.id, item]);
  }
}
check('条目都是 [tshock.*, 中文说明]', badItems, []);

console.log('2) 权限节点唯一性');
const nodes = PERMISSION_GROUPS.flatMap((g) => g.items.map((it) => it[0]));
check('展开数量与条目总数一致', nodes.length, PERMISSION_GROUPS.reduce((n, g) => n + g.items.length, 0));
const seen = new Map();
const duplicates = [];
for (const node of nodes) {
  if (seen.has(node)) duplicates.push(node);
  seen.set(node, true);
}
check('没有重复节点', duplicates, []);
check('allPermissionNodes() 与展开结果一致', allPermissionNodes().length, nodes.length);
check('节点总数是 176', nodes.length, 176);

console.log('3) 世界事件目录');
const eventTypes = Object.keys(EVENT_META);
check('9 类事件', eventTypes.length, 9);
const badEvents = eventTypes.filter((type) => {
  const meta = EVENT_META[type];
  return !meta || !meta.label || !meta.icon || typeof meta.desc !== 'string';
});
check('每个事件都有 label/icon/desc', badEvents, []);
check('label 查表', eventLabel('bloodmoon'), '血月');
check('未知类型回退成 key', eventLabel('nope'), 'nope');
check('权限名前缀统一', eventTypes.filter((t) => !eventPermission(t).startsWith('tshock.world.events.')), []);
check('入侵权限按 invasion 算', eventPermission('invasion'), 'tshock.world.events.invasion');

console.log('4) 入侵与雨的子类型都有中文标签');
const invasionKeys = Object.keys(INVASION_META);
check('入侵子类型非空', invasionKeys.length > 0, true);
check('入侵标签都是字符串', invasionKeys.filter((k) => typeof INVASION_META[k] !== 'string' || !INVASION_META[k]), []);
const rainKeys = Object.keys(RAIN_META);
check('雨子类型非空', rainKeys.length > 0, true);
check('雨标签都是字符串', rainKeys.filter((k) => typeof RAIN_META[k] !== 'string' || !RAIN_META[k]), []);

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
