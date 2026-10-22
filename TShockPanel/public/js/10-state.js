'use strict';

/* 全局状态 —— 全部可变状态集中在这里定义，页面模块只读写、不新声明。
 *
 * 加载顺序：00-core.js -> 10-state.js -> 各页面模块 -> app.js（启动）。
 * 这里只放“数据”，不放逻辑；任何业务判断都属于页面模块或 core 层。
 */

/* 服务器 / 面板主状态 */
const app = {
  state: null,
  logs: [],
  lastLogId: 0,
  consoleClearedAt: 0,
  worlds: [],
  players: [],
  bans: [],
  users: [],
  config: null,
  schema: null,
  originalSettings: {},
  ssc: null,
  sscOriginal: {},
  view: 'dashboard',
  consoleFilter: 'all',
  settingsOpen: new Set(['basic']),
  busy: false,
  history: [],
  historyIndex: -1,
  pollTimer: null,
  items: null,
  itemsIndex: null,
  givePicked: null,
  giveHistory: [],
  events: null,
  groups: null,
  currentGroup: null,
  sscInventory: [],
  sscEnabled: false,
};

/* 浮层下拉的 DOM 引用（渲染在 body 上，避免被 card 的 overflow 裁切） */
const dropdown = { layer: null, anchor: null };

/* 外观偏好（主题、字号、密度） */
const appUi = {
  theme: 'dark',
  fontScale: 1,
  density: 'comfortable',
  iconSize: 18,
  showLabels: true,
  customTheme: null,
};

/* 传送点页面的本地状态 */
const warpState = { list: [], worldId: null, error: '', selected: new Set(), search: '' };
