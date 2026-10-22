'use strict';

/**
 * SSC 初始物品路由（2 条）：GET/POST /api/ssc/inventory。
 *
 * 逐行校验与视图在 lib/ssc-inventory.js；这里只负责读 body、写文件前备份、
 * 写回并提示“需要重启才生效”。
 */

const { normalizeInventory, viewOf, applyTo } = require('../lib/ssc-inventory');

function createSscRoutes(ctx) {
  const {
    route,
    json,
    readJsonBody,
    readJsonFile,
    writeFileAtomic,
    backupConfigFile,
    addLog,
    sscPath,
    findItem,
  } = ctx;

  route('GET', /^\/api\/ssc\/inventory$/, async (req, res) => {
    json(res, 200, viewOf(readJsonFile(sscPath, null), sscPath));
  });

  route('POST', /^\/api\/ssc\/inventory$/, async (req, res) => {
    const body = await readJsonBody(req);
    const cleaned = normalizeInventory(body.inventory, findItem);

    const config = readJsonFile(sscPath, null);
    applyTo(config, cleaned);
    backupConfigFile(sscPath, 'sscconfig.json');
    writeFileAtomic(sscPath, JSON.stringify(config, null, 2) + '\n');
    addLog('panel', `已更新 SSC 初始物品（${cleaned.length} 项）`);
    json(res, 200, { ok: true, restartRequired: true, inventory: cleaned });
  });
}

module.exports = { createSscRoutes };
