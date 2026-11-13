// 用无头 Chrome 跑 tests/wx-harness.html（微信 API 替身），把结果打出来。
//   node scripts/run-wx-harness.mjs [chromePath]
// 这是"微信包能在小游戏 API 下跑起来"的本地证据，不等于真机验收。

import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.env.PORT || 5183;
const CANDIDATES = [
  process.argv[2],
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);

const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('找不到 Chrome，可用 `node scripts/run-wx-harness.mjs <chrome路径>` 指定');
  process.exit(2);
}

const url = `http://127.0.0.1:${PORT}/tests/wx-harness.html`;

// 没起服务器就自己起一个，跑完关掉
let server = null;
async function ensureServer() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/index.html`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) return;
  } catch {
    /* 没起 */
  }
  server = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/index.html`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return;
    } catch {
      /* 继续等 */
    }
  }
  throw new Error(`本地服务器没起来（端口 ${PORT}）`);
}
await ensureServer();
const profile = path.join(os.tmpdir(), `dsh-wx-harness-${Date.now()}`);
const args = [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-breakpad', '--disable-crash-reporter',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--window-size=900,1000',
  '--virtual-time-budget=6000', `--user-data-dir=${profile}`, '--dump-dom', url,
];

// 页面里有一个常驻 rAF 循环，Chrome 有时不肯自己退出；
// 超时后依然保留已经输出的 DOM，从中解析结果。
const res = spawnSync(chrome, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
const out = res.stdout || '';
const m = out.match(/WXHARNESS (\d+)\/(\d+)/);
const body = out.match(/<div id="result">([\s\S]*?)<\/div>/);

if (!m) {
  console.error('未拿到自测结果（页面可能没加载完，或 5183 端口的服务器没起）');
  if (body) console.error(body[1].slice(0, 600));
  if (server) server.kill();
  process.exit(1);
}
if (body) console.log(body[1].replace(/&lt;/g, '<').replace(/&amp;/g, '&').trim());
const [, pass, total] = m;
console.log(`\n${pass === total ? '✅' : '❌'} 微信包自测 ${pass}/${total}`);
if (server) server.kill();
process.exit(pass === total ? 0 : 1);
