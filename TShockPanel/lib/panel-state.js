'use strict';

/**
 * 面板自己的设置（TShockPanel/panel.json）：默认值、加载合并、令牌生成、保存。
 *
 * 为什么单独一层：
 *  - 这里有一条**安全语义**：没有 REST 令牌就随机生成一个（否则 TShock 的 REST
 *    接口不可用；用固定默认值则等于没有令牌）。原先它和普通字段合并写在一起，
 *    很容易在“合并默认值”时被顺手删掉；
 *  - 加载必须对“文件不存在 / 内容坏掉 / 只写了一部分字段”三种情况都成立，
 *    否则面板会因为一个 JSON 语法错误起不来。
 *
 * 行为与拆分前一致：浅合并 + launch 深合并一层、令牌只补不清、保存 2 空格缩进。
 */

const DEFAULT_WORLDS_SUBDIR = ['Documents', 'My Games', 'Terraria', 'Worlds'];

/** 默认世界目录：Windows 上是 %USERPROFILE%\Documents\My Games\Terraria\Worlds。 */
function defaultWorldsDir(env, os, path) {
  const home = env.USERPROFILE || os.homedir();
  return path.join(home, ...DEFAULT_WORLDS_SUBDIR);
}

function createPanelState({ statePath, fs, crypto, path, os, env = process.env, writeFileAtomic }) {
  /** 一份全新的默认值（每次调用都返回新对象，避免调用方互相污染）。 */
  function defaults() {
    return {
      panelPort: 13087,
      restPort: 7878,
      restToken: '',
      worldsDir: defaultWorldsDir(env, os, path),
      launch: { world: '', port: 7777, maxPlayers: 8, password: '' },
      backupOnStart: true,
      autoRestart: false,
    };
  }

  /** 读取并合并 panel.json；坏文件按“没有文件”处理，缺令牌则随机生成。 */
  function load() {
    let loaded = {};
    try {
      loaded = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (err) {
      loaded = {};
    }
    const base = defaults();
    const merged = {
      ...base,
      ...(loaded && typeof loaded === 'object' ? loaded : {}),
      launch: { ...base.launch, ...((loaded && loaded.launch) || {}) },
    };
    if (!merged.restToken) merged.restToken = crypto.randomBytes(18).toString('hex');
    return merged;
  }

  /** 保存整份面板设置（原子写由 lib/files.js 保证）。 */
  function save(state) {
    writeFileAtomic(statePath, JSON.stringify(state, null, 2) + '\n');
  }

  return { defaults, load, save };
}

module.exports = { createPanelState, defaultWorldsDir, DEFAULT_WORLDS_SUBDIR };
