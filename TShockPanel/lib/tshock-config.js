'use strict';

/**
 * tshock/*.json 的统一读写入口。
 *
 * 这一层只做“文件怎么改才安全”，不关心 HTTP、不关心面板状态：
 *   - 任何写入前先备份（同一 label 保留最近 30 份）；
 *   - 写入用临时文件 + rename，避免写一半断电；
 *   - 只改认识的字段，未知字段原样保留（TShock 升级新增的配置项不会被抹掉）。
 *
 * 依赖方向：tshock-config → files/schema。反过来不允许，所以这里不 require server.js。
 *
 * 用工厂而不是模块级单例，是为了不把 CONFIG_PATH / 面板状态（REST 端口与令牌）
 * 这些“由 server.js 决定的东西”硬编码进来——那样模块就没法独立测试了。
 */

const fs = require('fs');
const path = require('path');

const { writeFileAtomic, readJsonFile, timestamp } = require('./files');
const { buildSchema, HIDDEN } = require('./schema');

/** 每个 label 最多保留多少份配置备份 */
const BACKUP_KEEP = 30;

/**
 * @param {object} deps
 * @param {string} deps.configPath   tshock/config.json 绝对路径
 * @param {string} deps.sscPath      tshock/sscconfig.json 绝对路径
 * @param {string} deps.backupDir    配置备份目录（backups/config）
 * @param {() => number} deps.getRestPort 面板要写入 config.json 的 REST 端口
 * @param {() => string} deps.getRestToken 面板自己的 REST 令牌
 * @param {(text: string) => void} deps.log 写一条面板日志
 */
function createConfigStore({ configPath, sscPath, backupDir, getRestPort, getRestToken, log }) {
  /** 备份任意配置文件；失败只记日志，不阻断保存流程（与原实现一致）。 */
  function backupFile(file, label) {
    try {
      if (!fs.existsSync(file)) return;
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const stamp = timestamp();
      // 备份名只精确到秒，同一秒内连续两次备份会撞名，直接 copy 会把前一份覆盖掉。
      // 与 lib/backups.js 的快照目录同一处理方式：撞名就加自增后缀。
      let name = `${stamp}_${label}`;
      let suffix = 2;
      while (fs.existsSync(path.join(backupDir, name))) {
        name = `${stamp}_${label}-${suffix}`;
        suffix += 1;
      }
      const target = path.join(backupDir, name);
      fs.copyFileSync(file, target);
      const files = fs
        .readdirSync(backupDir)
        .filter((f) => f.includes(`_${label}`))
        .sort();
      while (files.length > BACKUP_KEEP) {
        const old = files.shift();
        try {
          fs.unlinkSync(path.join(backupDir, old));
        } catch (err) {
          /* ignore */
        }
      }
    } catch (err) {
      log(`配置备份失败：${err.message}`);
    }
  }

  /**
   * 把面板需要的 REST 配置写进 tshock/config.json。
   * 幂等：已经配好就一个字节都不写（冒烟测试用哈希守着这一点）。
   */
  function ensureRestConfig() {
    if (!fs.existsSync(configPath)) {
      return { ok: false, reason: '还没有生成 tshock/config.json，服务器第一次启动后才会创建。' };
    }
    const config = readJsonFile(configPath, null);
    if (!config || typeof config !== 'object') {
      return { ok: false, reason: 'tshock/config.json 无法解析，请先手动修复。' };
    }
    const restPort = Number(getRestPort());
    const restToken = getRestToken();

    const settings = (config.Settings = config.Settings || {});
    let changed = false;

    if (settings.RestApiEnabled !== true) {
      settings.RestApiEnabled = true;
      changed = true;
    }
    if (Number(settings.RestApiPort) !== restPort) {
      settings.RestApiPort = restPort;
      changed = true;
    }
    const tokens = (settings.ApplicationRestTokens = settings.ApplicationRestTokens || {});
    const existing = tokens[restToken];
    if (!existing || existing.UserGroupName !== 'superadmin') {
      tokens[restToken] = { Username: 'panel', UserGroupName: 'superadmin' };
      changed = true;
    }

    if (changed) {
      backupFile(configPath, 'config.json');
      writeFileAtomic(configPath, JSON.stringify(config, null, 2) + '\n');
      log(`已写入面板所需的 REST 配置（端口 ${restPort}）。`);
    }
    return { ok: true };
  }

  function getConfig() {
    const config = readJsonFile(configPath, null);
    if (!config || typeof config !== 'object') {
      throw new Error('读取 tshock/config.json 失败，文件可能不存在或格式错误。');
    }
    config.Settings = config.Settings || {};
    const schema = buildSchema(config.Settings);
    // 注意：不要从返回值里删掉 ApplicationRestTokens，
    // 否则“原始 JSON”模式保存时会把面板自己的令牌弄丢。
    return { settings: config.Settings, schema };
  }

  function validateSetting(key, value, current) {
    if (value === undefined) return current;
    if (key === 'PvPMode') {
      if (!['normal', 'always', 'disabled'].includes(value)) throw new Error('PvPMode 只能是 normal / always / disabled');
      return value;
    }
    if (key === 'ForceTime') {
      if (!['normal', 'day', 'night'].includes(value)) throw new Error('ForceTime 只能是 normal / day / night');
      return value;
    }
    if (key === 'StorageType') {
      if (!['sqlite', 'mysql'].includes(value)) throw new Error('StorageType 只能是 sqlite / mysql');
      return value;
    }
    if (typeof current === 'boolean') return !!value;
    if (typeof current === 'number') {
      const num = Number(value);
      if (!Number.isFinite(num)) throw new Error(`${key} 需要是数字`);
      return num;
    }
    if (typeof current === 'string') return String(value);
    if (Array.isArray(current)) {
      if (!Array.isArray(value)) throw new Error(`${key} 需要是数组`);
      return value.map((v) => Number(v)).map((v) => (Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0));
    }
    return value;
  }

  function saveConfig(nextSettings, rawText) {
    const config = readJsonFile(configPath, null);
    if (!config || typeof config !== 'object') throw new Error('读取 tshock/config.json 失败。');
    config.Settings = config.Settings || {};

    if (rawText) {
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        throw new Error('JSON 格式错误：' + err.message);
      }
      if (!parsed || typeof parsed !== 'object' || !parsed.Settings) throw new Error('配置缺少 Settings 节点。');
      backupFile(configPath, 'config.json');
      writeFileAtomic(configPath, JSON.stringify(parsed, null, 2) + '\n');
      return { ok: true, restartRequired: true };
    }

    const applied = [];
    for (const [key, value] of Object.entries(nextSettings || {})) {
      if (HIDDEN.has(key)) continue;
      if (!(key in config.Settings)) continue;
      config.Settings[key] = validateSetting(key, value, config.Settings[key]);
      applied.push(key);
    }
    if (applied.length === 0) return { ok: true, restartRequired: false, applied };

    backupFile(configPath, 'config.json');
    writeFileAtomic(configPath, JSON.stringify(config, null, 2) + '\n');
    return { ok: true, restartRequired: true, applied };
  }

  function getSsc() {
    const config = readJsonFile(sscPath, null);
    if (!config) throw new Error('读取 tshock/sscconfig.json 失败。');
    config.Settings = config.Settings || {};
    return { settings: config.Settings };
  }

  function saveSsc(settings) {
    const config = readJsonFile(sscPath, null);
    if (!config) throw new Error('读取 tshock/sscconfig.json 失败。');
    config.Settings = config.Settings || {};
    for (const key of ['Enabled', 'StartingHealth', 'StartingMana', 'ServerSideCharacterSave', 'LogonDiscardThreshold', 'WarnPlayersAboutBypassPermission', 'KeepPlayerAppearance']) {
      if (settings && key in settings) {
        const cur = config.Settings[key];
        if (typeof cur === 'boolean') config.Settings[key] = !!settings[key];
        else if (typeof cur === 'number') config.Settings[key] = Number(settings[key]) || 0;
        else config.Settings[key] = settings[key];
      }
    }
    backupFile(sscPath, 'sscconfig.json');
    writeFileAtomic(sscPath, JSON.stringify(config, null, 2) + '\n');
    return { ok: true, restartRequired: true };
  }

  return { backupFile, ensureRestConfig, getConfig, validateSetting, saveConfig, getSsc, saveSsc };
}

module.exports = { createConfigStore, BACKUP_KEEP };
