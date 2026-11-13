// 微信小游戏运行时不支持的 API 静态扫描。
// 只扫"两个平台共用"的模块，web 专属代码（main.js / share.js 的 DOM 部分）不算。
import { readFileSync, readdirSync } from 'node:fs';

let pass = 0;
let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const SHARED = [
  'render.js', 'game.js', 'geometry.js', 'levels.js', 'config.js',
  'content.js', 'ads.js', 'audio.js', 'skins.js', 'tutorial.js',
  'viewport.js', 'input-wx.js', 'loop.js', 'platform.js', 'qa-wx.js', 'main-wx.js',
];

// 这些在微信小游戏里不存在或不可靠
// 所有共享模块都禁止（运行时不提供）
const BANNED_ALL = [
  { re: /new Path2D\s*\(/, why: 'Path2D 在微信小游戏不存在' },
  { re: /ctx\.filter\s*=/, why: 'canvas filter 不被支持' },
  { re: /requestIdleCallback/, why: '不存在' },
  { re: /structuredClone/, why: '低版本基础库不存在' },
];
// platform.js 里是浏览器分支的实现，允许出现 DOM/localStorage
const BANNED_PURE = [
  { re: /document\./, why: '共享模块里不能碰 DOM' },
  { re: /\bwindow\.(?!__)/, why: '共享模块里不能碰 window' },
  { re: /\blocalStorage\b/, why: '应走 plat.getStorage/setStorage' },
];

const dir = new URL('../src/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => SHARED.includes(f));
ok(files.length >= 14, `扫描 ${files.length} 个共享模块`);

const pure = files.filter((f) => f !== 'platform.js');
const checks = [
  ...BANNED_ALL.map((b) => ({ ...b, scope: files })),
  ...BANNED_PURE.map((b) => ({ ...b, scope: pure })),
];
for (const { re, why, scope } of checks) {
  const hits = [];
  for (const f of scope) {
    const src = readFileSync(dir + f, 'utf8');
    src.split('\n').forEach((line, i) => {
      // 跳过注释行
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
      if (re.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  ok(hits.length === 0, `${why}${hits.length ? ' → ' + hits.join(', ') : ''}`);
}

// 叠加模式必须经过 addMode()，不能直接写死 'lighter'
{
  const src = readFileSync(dir + 'render.js', 'utf8');
  const direct = src.split('\n').filter((l) => /globalCompositeOperation\s*=\s*'lighter'/.test(l));
  ok(direct.length === 0, `render.js 没有直接使用 'lighter'（${direct.length} 处）`);
  ok(/addMode\s*\(\)/.test(src), '叠加模式统一走 addMode()');
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
