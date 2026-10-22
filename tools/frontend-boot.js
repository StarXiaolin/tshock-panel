'use strict';

/**
 * 前端“启动冒烟”：把 index.html 里的脚本按顺序放进一个最小 DOM 桩里执行，
 * 用一个假的 fetch 打到真实运行中的面板，看 boot() 能不能跑完。
 *
 * 本机没有可用的 Electron 浏览器（dsh 内置浏览器不可用），所以用这个补上
 * “脚本能加载、boot 不炸”这一层验证；它不能替代真人点页面，但能抓住
 * 拆分脚本时最容易出现的 ReferenceError / 初始化异常。
 *
 * 前置：面板必须已经在 13087 端口运行（node TShockPanel/server.js --no-open）。
 * 用法：node tools/frontend-boot.js [--port 13087]
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'TShockPanel', 'public');
const portArg = process.argv.indexOf('--port');
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 13087;
const base = `http://127.0.0.1:${port}`;

const errors = [];
const consoleErrors = [];
process.on('unhandledRejection', (err) => errors.push(err));

/** 任何属性都当函数调用的桩（style.removeProperty / style.setProperty 之类） */
function makeCallableObject() {
  const target = {};
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (typeof key === 'string') return () => {};
      return undefined;
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    },
  });
}

function makeEl(tag = 'DIV') {
  const target = {
    tagName: tag,
    nodeType: 1,
    style: makeCallableObject(),
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    childNodes: [],
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0,
    offsetHeight: 0,
    offsetWidth: 0,
    selectedIndex: 0,
    options: [],
    files: [],
  };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      switch (key) {
        case 'appendChild':
        case 'insertBefore':
        case 'removeChild':
        case 'remove':
        case 'addEventListener':
        case 'removeEventListener':
        case 'setAttribute':
        case 'removeAttribute':
        case 'focus':
        case 'blur':
        case 'click':
        case 'submit':
        case 'reset':
        case 'scrollIntoView':
        case 'insertAdjacentHTML':
        case 'replaceChildren':
        case 'getAttribute':
          return () => null;
        case 'querySelector':
          return () => makeEl();
        case 'querySelectorAll':
          return () => [];
        case 'closest':
          return () => makeEl();
        case 'getBoundingClientRect':
          return () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 });
        case 'hasAttribute':
          return () => false;
        case 'matches':
          return () => false;
        case Symbol.toPrimitive:
          return () => '';
        default:
          return undefined;
      }
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    },
  });
}

const documentStub = {
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  getElementById: () => makeEl(),
  createElement: (tag) => makeEl(String(tag).toUpperCase()),
  addEventListener() {},
  removeEventListener() {},
  hidden: false,
  cookie: '',
  body: makeEl('BODY'),
  documentElement: makeEl('HTML'),
};

const sandbox = {
  console: {
    log: () => {},
    warn: () => {},
    error: (...args) => {
      consoleErrors.push(args.map((a) => (a && a.stack ? a.stack : String(a))).join(' '));
    },
  },
  document: documentStub,
  EventSource: class {
    constructor() {}
    addEventListener() {}
    close() {}
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { href: `${base}/`, reload() {}, assign() {} },
  navigator: { userAgent: 'node-frontend-boot', clipboard: { writeText: async () => {} } },
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  fetch: async (url, opts) => {
    const target = String(url).startsWith('http') ? String(url) : `${base}${url}`;
    const res = await fetch(target, opts);
    return res;
  },
  alert: () => {},
  confirm: () => true,
  prompt: () => null,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map((m) => m[1]);

console.log('前端启动冒烟');
console.log(`  目标面板：${base}`);
console.log(`  脚本顺序：${scriptSrcs.join(' -> ')}`);

const context = vm.createContext(sandbox);

(async () => {
  // 前置检查：面板必须已经跑着，否则 boot 必然失败，报错会误导成“前端坏了”
  try {
    const probe = await fetch(`${base}/api/state`);
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (err) {
    console.error(`\n面板没有在 ${base} 运行（${err.message}）。`);
    console.error('请先另开一个窗口执行：node TShockPanel/server.js --no-open');
    process.exit(2);
  }

  for (const src of scriptSrcs) {
    const file = path.join(publicDir, src);
    if (!fs.existsSync(file)) {
      errors.push(new Error(`脚本不存在：${src}`));
      continue;
    }
    const code = fs.readFileSync(file, 'utf8');
    try {
      vm.runInContext(code, context, { filename: src });
      console.log(`  [OK]   ${src} 已执行`);
    } catch (err) {
      errors.push(new Error(`${src} 执行失败：${err.message}`));
    }
  }

  // 给 boot() 的异步链留点时间
  await new Promise((resolve) => setTimeout(resolve, 2500));

  // 注意：顶层 const 不会挂在 sandbox 上，要用 runInContext 读全局词法绑定
  const state = vm.runInContext('typeof app === "undefined" ? null : app', context);
  if (!state) {
    errors.push(new Error('脚本执行后找不到全局 app 对象'));
  } else {
    console.log(`  [INFO] app.state = ${state.state ? '已加载' : '未加载'}；app.view = ${state.view}`);
    if (!state.state) {
      errors.push(new Error('boot() 没有把 /api/state 加载进 app.state（初始化中断）'));
    }
  }
  for (const text of consoleErrors) {
    errors.push(new Error(`页面初始化期间报错：${text.split('\n')[0]}`));
  }

  // 抽查关键渲染函数是否真的被调用过（只要不抛错即可）
  for (const fn of ['toast', 'api', 'modal', 'confirmDialog', 'esc']) {
    if (typeof sandbox[fn] !== 'function') errors.push(new Error(`全局函数 ${fn} 未定义`));
  }

  console.log('');
  if (errors.length > 0) {
    console.error(`结果：${errors.length} 项失败`);
    for (const err of errors) console.error(`  - ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
