'use strict';

/**
 * lib/ui-state.js + routers/ui.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * 偏好文件是面板里唯一“用户改坏了也不该让面板起不来”的文件，所以重点锁：
 *   1. 文件缺失 / 不是对象 / 只有部分字段时都能回退到完整默认值；
 *   2. 字号与图标大小的边界校验（0.5–2、12–32）逐条钉住；
 *   3. 未知字段被忽略，不会写进 dsh.ui.json 污染文件；
 *   4. 落盘格式固定为 2 空格缩进 + 末尾换行，便于人工查看与 git 对比。
 *
 * 用法：node tools/ui-state.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createUiState, UI_DEFAULTS } = require('../TShockPanel/lib/ui-state');
const { createUiRoutes } = require('../TShockPanel/routers/ui');

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tshockpanel-ui-'));
const uiPath = path.join(root, 'dsh.ui.json');

const uiState = createUiState({
  uiStatePath: uiPath,
  readJsonFile: (file, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return fallback;
    }
  },
  writeFileAtomic: (file, content) => fs.writeFileSync(file, content, 'utf8'),
});

const routes = [];
const reply = { last: null };
createUiRoutes({
  route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
  json: (res, code, payload) => {
    reply.last = { code, payload };
  },
  readJsonBody: async (req) => req.body || {},
  uiState,
});

console.log('1) 缺失与损坏时回退默认值');
check('文件不存在返回默认', uiState.read(), UI_DEFAULTS);
fs.writeFileSync(uiPath, 'not json', 'utf8');
check('文件损坏返回默认', uiState.read(), UI_DEFAULTS);
fs.writeFileSync(uiPath, '[1,2,3]', 'utf8');
// 数组也是 object，沿用原行为：当作对象合并（不额外清洗），只确认不会抛错。
check('数组文件不报错且默认值仍生效', [uiState.read()[0], uiState.read().theme], [1, 'dark']);
check('每次返回新对象（不会共享引用）', uiState.read() === uiState.read(), false);

console.log('2) 部分字段与默认值合并');
fs.writeFileSync(uiPath, JSON.stringify({ theme: 'light', iconSize: 22 }), 'utf8');
const merged = uiState.read();
check('已有字段覆盖默认', [merged.theme, merged.iconSize], ['light', 22]);
check('缺失字段补默认', [merged.fontScale, merged.density, merged.showLabels], [1, 'comfortable', true]);
check('customThemes 缺失时给空对象', merged.customThemes, {});

console.log('3) 校验规则');
checkThrows('字号 0.49 被拒绝', () => uiState.patch({ fontScale: 0.49 }), '字号缩放不合法');
checkThrows('字号 2.01 被拒绝', () => uiState.patch({ fontScale: 2.01 }), '字号缩放不合法');
checkThrows('字号非数字被拒绝', () => uiState.patch({ fontScale: 'big' }), '字号缩放不合法');
checkThrows('图标 11 被拒绝', () => uiState.patch({ iconSize: 11 }), '图标大小不合法');
checkThrows('图标 33 被拒绝', () => uiState.patch({ iconSize: 33 }), '图标大小不合法');
checkThrows('图标不是数字被拒绝', () => uiState.patch({ iconSize: 'x' }), '图标大小不合法');
check('边界值 0.5 / 2 / 12 / 32 都接受', [
  uiState.patch({ fontScale: 0.5 }).fontScale,
  uiState.patch({ fontScale: 2 }).fontScale,
  uiState.patch({ iconSize: 12 }).iconSize,
  uiState.patch({ iconSize: 32 }).iconSize,
], [0.5, 2, 12, 32]);

console.log('4) 字段处理');
const patched = uiState.patch({ theme: 123, density: 'compact', showLabels: 0 });
check('theme/density 被转成字符串', [patched.theme, patched.density], ['123', 'compact']);
check('showLabels 被转成布尔', patched.showLabels, false);
const ignored = uiState.patch({ evil: 'x', __proto__: { bad: 1 } });
check('未知字段被忽略', 'evil' in ignored, false);
const fullTheme = {
  baseTheme: 'dark',
  background: '#111111',
  surface: '#1a1a1a',
  foreground: '#eeeeee',
  mutedForeground: '#999999',
  accent: '#2fd6a5',
  danger: '#f2657a',
  success: '#22b98d',
  warning: '#f5b544',
  border: '#2a3c54',
  selection: 'rgba(47, 214, 165, 0.12)',
  inputBackground: '#0b131d',
  fontFamily: 'system-ui, sans-serif',
  baseFontSize: '14px',
  radius: '16px',
  spacing: '13px',
  buttonMinHeight: '34px',
};
checkThrows('customThemes 不是对象', () => uiState.patch({ customThemes: 'str' }), 'customThemes 需要是一个对象');
check('customThemes 整体替换', uiState.patch({ customThemes: { custom: fullTheme } }).customThemes.custom.accent, '#2fd6a5');
checkThrows(
  '未知自定义主题名',
  () => uiState.patch({ customThemes: { my: fullTheme } }),
  '不支持的自定义主题名：my'
);
checkThrows(
  '颜色字段拒绝 CSS 片段',
  () => uiState.patch({ customThemes: { custom: { ...fullTheme, accent: 'red; background: url(x)' } } }),
  '主题「custom」的 accent 不是合法颜色：red; background: url(x)'
);
checkThrows(
  '未知令牌被拒绝',
  () => uiState.patch({ customThemes: { custom: { ...fullTheme, evil: '1px' } } }),
  '主题「custom」含未知令牌：evil'
);
checkThrows(
  'baseTheme 只能是三套内置主题',
  () => uiState.patch({ customThemes: { custom: { ...fullTheme, baseTheme: 'pink' } } }),
  '主题「custom」的 baseTheme 只能是 dark / light / high-contrast'
);
checkThrows(
  '尺寸令牌必须带单位',
  () => uiState.patch({ customThemes: { custom: { ...fullTheme, radius: '16' } } }),
  '主题「custom」的 radius 需要带单位（例如 14px）：16'
);
check('传 {} 可清除自定义配色', uiState.patch({ customThemes: {} }).customThemes, {});

console.log('5) 落盘格式');
const raw = fs.readFileSync(uiPath, 'utf8');
check('2 空格缩进', raw.split('\n')[1], '  "theme": "123",');
check('末尾有换行', raw.endsWith('\n'), true);
check('落盘后可读回', uiState.read().density, 'compact');

console.log('6) 路由');
check('注册 2 条', routes.length, 2);
check(
  'method + 路径',
  routes.map((r) => `${r.method} ${r.pattern.source}`),
  ['GET ^\\/api\\/ui$', 'POST ^\\/api\\/ui$']
);
(async () => {
  await routes[0].handler({}, {});
  check('GET 返回当前偏好', reply.last.payload.density, 'compact');
  await routes[1].handler({ body: { fontScale: 1.25 } }, {});
  check('POST 返回更新后的完整偏好', reply.last.payload.fontScale, 1.25);
  check('POST 的返回同时落盘', uiState.read().fontScale, 1.25);

  fs.rmSync(root, { recursive: true, force: true });

  console.log('');
  if (failed > 0) {
    console.error(`结果：${failed} 项失败`);
    process.exit(1);
  }
  console.log('结果：全部通过');
})();
