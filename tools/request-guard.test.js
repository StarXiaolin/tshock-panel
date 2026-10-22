'use strict';

/**
 * lib/request-guard.js 的单元测试（零依赖，不启动 HTTP 服务）。
 *
 * 防护规则很简单，但写错一个字符就会把正常访问也挡掉（或者根本挡不住），所以逐条锁住：
 *   1. Host 必须是本机名且端口一致 —— 这是防 DNS rebinding 的那一半；
 *   2. Origin 不存在就放行（curl / 脚本），存在就必须是本机同端口 —— 这是防 CSRF 的那一半；
 *   3. 两者同时不合法时，先报 Host 的原因。
 *
 * 用法：node tools/request-guard.test.js
 */

const { checkRequest, checkHost, checkOrigin, splitHostPort } = require('../TShockPanel/lib/request-guard');

const PORT = 13087;

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

console.log('1) 拆 host:port');
check('常规', splitHostPort('127.0.0.1:13087'), { host: '127.0.0.1', port: '13087' });
check('IPv6 带端口', splitHostPort('[::1]:13087'), { host: '[::1]', port: '13087' });
check('没有端口', splitHostPort('localhost'), { host: 'localhost', port: '' });
check('空值', splitHostPort(''), { host: '', port: '' });
check('大小写归一', splitHostPort('LOCALHOST:13087'), { host: 'localhost', port: '13087' });

console.log('2) Host：只接受本机');
check('127.0.0.1 同端口放行', checkHost('127.0.0.1:13087', PORT), null);
check('localhost 同端口放行', checkHost('localhost:13087', PORT), null);
check('IPv6 回环放行', checkHost('[::1]:13087', PORT), null);
check('缺 Host 头拒绝', checkHost(undefined, PORT), '缺少 Host 头');
check('外部域名拒绝', checkHost('evil.com:13087', PORT), '只接受本机地址访问（收到 Host: evil.com）');
check('本机但端口不对拒绝', checkHost('127.0.0.1:13088', PORT), 'Host 端口与面板端口不一致（13088 ≠ 13087）');
check('不写端口按 80 算、不匹配拒绝', checkHost('127.0.0.1', PORT), 'Host 端口与面板端口不一致（80 ≠ 13087）');
check('形似本机的域名拒绝', checkHost('127.0.0.1.evil.com:13087', PORT), '只接受本机地址访问（收到 Host: 127.0.0.1.evil.com）');

console.log('3) Origin：不存在放行，存在必须本机同端口');
check('没有 Origin（curl/脚本）放行', checkOrigin(undefined, PORT), null);
check('空字符串放行', checkOrigin('', PORT), null);
check('同源 127.0.0.1 放行', checkOrigin('http://127.0.0.1:13087', PORT), null);
check('同源 localhost 放行', checkOrigin('http://localhost:13087', PORT), null);
check('大小写混写放行', checkOrigin('HTTP://127.0.0.1:13087', PORT), null);
check('Origin: null 拒绝', checkOrigin('null', PORT), '拒绝来源不明的跨站请求（Origin: null）');
check('外部站点拒绝', checkOrigin('https://evil.com', PORT), '拒绝跨站请求（来源 https://evil.com）');
check('https 回环也拒绝（面板只跑 http）', checkOrigin('https://127.0.0.1:13087', PORT), '只接受 http 来源（收到 https://127.0.0.1:13087）');
check('端口不一致拒绝', checkOrigin('http://127.0.0.1:13088', PORT), '来源端口与面板端口不一致（13088 ≠ 13087）');
check('无法识别的 Origin 拒绝', checkOrigin('chrome-extension://abc', PORT), '无法识别的 Origin：chrome-extension://abc');

console.log('4) checkRequest：Host 优先报原因');
check('两者都合法放行', checkRequest({ headers: { host: '127.0.0.1:13087', origin: 'http://127.0.0.1:13087' } }, PORT), null);
check(
  'Host 非法时报 Host 的原因',
  checkRequest({ headers: { host: 'evil.com:13087', origin: 'https://evil.com' } }, PORT),
  '只接受本机地址访问（收到 Host: evil.com）',
);
check(
  'Host 合法但 Origin 非法时报 Origin 的原因',
  checkRequest({ headers: { host: '127.0.0.1:13087', origin: 'https://evil.com' } }, PORT),
  '拒绝跨站请求（来源 https://evil.com）',
);
check('没有 headers 时按缺 Host 处理', checkRequest({}, PORT), '缺少 Host 头');

console.log('');
if (failed > 0) {
  console.error(`结果：${failed} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
