'use strict';

/* SSC 角色存档：初始物品编辑器
 *
 * 从 app.js 原样搬出（仅搬运，未改逻辑）。依赖 core 层与 10-state.js 的全局，
 * 由 index.html 按顺序加载；文件内不再声明任何新的全局状态。
 */

/* ------------------------------------------------------------------ */
/* SSC 初始物品                                                        */
/* ------------------------------------------------------------------ */

async function loadSscInventory() {
  try {
    await ensureItems();
    const data = await api('/api/ssc/inventory');
    app.sscInventory = Array.isArray(data.inventory) ? data.inventory.map((x) => ({ ...x })) : [];
    app.sscEnabled = !!data.enabled;
    renderSscInventory();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderSscInventory() {
  hideDropdown();
  const notice = $('#ssc-inventory-notice');
  if (notice) {
    notice.className = 'notice ' + (app.sscEnabled ? 'danger' : 'info');
    notice.innerHTML = app.sscEnabled
      ? 'SSC 已启用：玩家使用服务端保存的角色，这里的初始物品会<b>覆盖客户端本地的初始物品</b>，只影响之后新建的角色。'
      : 'SSC 当前未启用：这些初始物品暂时不会生效，需要先在「服务端角色（SSC）」里勾选「启用服务端角色存档」。';
  }
  const box = $('#ssc-inventory');
  if (!box) return;
  if (!app.sscInventory.length) {
    box.innerHTML = '<div class="empty">还没有初始物品，点击右上角「添加物品」。</div>';
    return;
  }
  box.innerHTML = app.sscInventory
    .map(
      (row, index) => `<div class="ssc-row" data-row="${index}">
        <div class="item-pick">
          <input class="input" data-role="item" data-netid="${row.netID}" value="${esc(itemLabel(row.netID))}"
                 placeholder="搜索中文名 / 英文名 / ID" autocomplete="off" />
        </div>
        <input class="input" data-role="prefix" type="number" min="0" max="255" value="${Number(row.prefix) || 0}" title="前缀 ID" />
        <input class="input" data-role="stack" type="number" min="1" max="9999" value="${Number(row.stack) || 1}" title="数量" />
        <button class="rm" data-action="ssc-remove-row" data-row="${index}" title="移除">×</button>
      </div>`,
    )
    .join('');
  bindSscRowPickers();
}

function bindSscRowPickers() {
  $$('#ssc-inventory .ssc-row').forEach((row) => {
    const input = row.querySelector('[data-role="item"]');
    if (!input) return;
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const query = input.value.trim();
        if (!query) {
          hideDropdown();
          return;
        }
        showItemDropdown(input, searchItems(query, 30), (id) => {
          input.dataset.netid = String(id);
          input.value = itemLabel(id);
        });
      }, 120);
    });
    input.addEventListener('focus', () => {
      // 聚焦时全选，方便直接覆盖输入；不自动弹出列表
      input.select();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideDropdown();
        input.blur();
      }
    });
  });
}
