/* 魔鱼世界 · 无头浏览器验证
   用法：
     node tools/probe.mjs <url> [表达式文件] [截图输出路径]

   url 可以是 file:///... 也可以是 http://...
   省略表达式文件时，只报告页面基本信息与所有报错。
   给了截图路径就顺手截一张，用来肉眼确认界面有没有画歪。

   两个踩过的坑，改这个文件前先看：
   1. 连上目标后必须等 document.readyState === 'complete' 再求值，
      否则会撞上解析竞态 —— 拿到 null，或者脚本还没执行。
   2. 不要用 --virtual-time-budget 配合 setTimeout 做超时兜底。
      虚拟时钟会把定时器提前触发，产生假阴性（IndexedDB 就这样被误判过）。

   实现上先开 about:blank，连上调试协议、打开日志收集，再导航到目标地址。
   这样页面加载早期的报错也能抓到。 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('找不到浏览器。可以用 EDGE_PATH 环境变量指定可执行文件路径。');
  process.exit(1);
}

const url = process.argv[2];
if (!url) {
  console.error('用法：node tools/probe.mjs <url> [表达式文件]');
  process.exit(1);
}
const exprArg = process.argv[3];
const exprFile = exprArg && exprArg !== '-' ? exprArg : null;   /* 传 - 表示不跑表达式，只要截图 */
const shotPath = process.argv[4];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 启动 ---------- */

const profile = join(tmpdir(), 'moyu-probe-' + Date.now());
const child = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  /* 想换窗口大小：PROBE_SIZE=1600,900 node tools/probe.mjs ... */
  '--window-size=' + (process.env.PROBE_SIZE || '1440,860'),
  '--user-data-dir=' + profile,
  '--remote-debugging-port=0',
  'about:blank',
], { stdio: 'ignore' });

async function devtoolsPort() {
  const file = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 60; i++) {
    try {
      const text = await readFile(file, 'utf8');
      const port = Number(text.split('\n')[0]);
      if (port) return port;
    } catch {}
    await sleep(250);
  }
  throw new Error('浏览器没起来（读不到 DevToolsActivePort）');
}

/* ---------- 连接 ---------- */

const port = await devtoolsPort();

async function pageTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('找不到页面目标');
}

const target = await pageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let seq = 0;
const pending = new Map();
const problems = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);

  if (msg.id && pending.has(msg.id)) {
    const { resolve: ok, reject: bad } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? bad(new Error(JSON.stringify(msg.error))) : ok(msg.result);
    return;
  }

  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    problems.push('未捕获异常：' + (d.exception?.description || d.text));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    problems.push('console.error：' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    problems.push('浏览器日志：' + msg.params.entry.text);
  }
});

const send = (method, params) => new Promise((ok, bad) => {
  const id = ++seq;
  pending.set(id, { resolve: ok, reject: bad });
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

/* 固定视口。光给浏览器传 --window-size 不可靠：无头模式下视口常常跟它对不上，
   截图尺寸也就跟着飘，宽屏布局根本测不到。这里显式锁死，PROBE_SIZE 才真的算数。 */
const [vw, vh] = (process.env.PROBE_SIZE || '1440,860').split(',').map(Number);
await send('Emulation.setDeviceMetricsOverride', {
  width: vw, height: vh, deviceScaleFactor: 1, mobile: false,
});

/* ---------- 导航并等待 ---------- */

await send('Page.navigate', { url });

let ready = '';
for (let i = 0; i < 100; i++) {
  const st = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
  ready = st.result?.value;
  if (ready === 'complete') break;
  await sleep(100);
}
if (ready !== 'complete') problems.push('页面没加载完（readyState = ' + ready + '）');
await sleep(300);   /* 给启动逻辑一点时间跑完 */

/* ---------- 求值 ---------- */

const expression = exprFile
  ? await readFile(resolve(ROOT, exprFile), 'utf8')
  : '({ title: document.title, url: location.href, readyState: document.readyState })';

const res = await send('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,   /* 让需要用户手势的接口（如文件选择器）能过第一步校验 */
});

if (res.exceptionDetails) {
  problems.push('求值抛错：' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
} else {
  const v = res.result?.value;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
}

/* ---------- 收尾 ---------- */

if (shotPath) {
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const abs = resolve(ROOT, shotPath);
    await writeFile(abs, Buffer.from(shot.data, 'base64'));
    console.log('\n截图已保存：' + shotPath);
  } catch (e) {
    problems.push('截图失败：' + e.message);
  }
}

if (problems.length) {
  console.error('\n发现 ' + problems.length + ' 个问题：');
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('');
}

ws.close();
child.kill();
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(problems.length ? 1 : 0);
