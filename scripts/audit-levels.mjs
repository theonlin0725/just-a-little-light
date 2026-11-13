// 逐关审查：以**运行时关卡**（镜像 + 压缩 + 收紧边界之后）为对象，
// 计算机制、可行解区、起点到解区的动作、动态窗口，并给出相邻关相似度。
//
//   node scripts/audit-levels.mjs            # 打印表格
//   node scripts/audit-levels.mjs --md       # 输出 markdown 表格（写 docs/LEVEL-AUDIT.md）
import { writeFileSync } from 'node:fs';
import { LEVELS } from '../src/levels-live.js';
import { regionForLight, components, shortestDistance, holdCheck, maxHold } from './lib/solve.mjs';
import { WALL, WALL_L } from '../src/config.js';

const MD = process.argv.includes('--md');

function mechOf(lv) {
  const tags = [];
  tags.push(lv.lights.length > 1 ? '双光源' : '单光源');
  const hasL = lv.crystals.some((c) => c.side === 'l');
  const hasR = lv.crystals.some((c) => c.side !== 'l');
  tags.push(hasL && hasR ? '双侧' : '单侧');
  if (lv.movers.some((m) => m.pulse)) tags.push('干扰');
  if (lv.movers.some((m) => !m.pulse)) tags.push('移动');
  if (lv.crystals.some((c) => (c.lights || []).length > 1)) tags.push('双照');
  return tags.join('·');
}

const STEP = 6;

function regionOf(lv, i) {
  const region = regionForLight(lv, i, { step: STEP });
  const comps = components(region);
  if (!comps.length) return null;
  const best = comps.slice().sort((a, b) => b.n - a.n)[0];
  if (!best || best.n < 2) return null;
  return {
    region,
    area: best.n * STEP * STEP,
    cx: best.sx / best.n,
    cy: best.sy / best.n,
    count: comps.length,
    x0: best.minX, x1: best.maxX, y0: best.minY, y1: best.maxY,
  };
}

const rows = [];
for (const lv of LEVELS) {
  const r = regionOf(lv, 0);
  const start = lv.lights[0].start;
  let action = null;
  let dist = null;
  if (r) {
    const dx = r.cx - start.x;
    const dy = r.cy - start.y;
    const len = Math.hypot(dx, dy) || 1;
    action = { dx: dx / len, dy: dy / len, len };
    const d = shortestDistance(lv, 0, start, r.region);
    dist = Number.isFinite(d) ? d : null;
  }
  let win = 0;
  if (r) {
    const positions = lv.lights.map((l) => ({ x: l.goal.x, y: l.goal.y }));
    positions[0] = { x: r.cx, y: r.cy };
    win = Math.max(0, maxHold(lv, positions) || 0);
  }
  rows.push({
    id: lv.id, name: lv.name, mech: mechOf(lv),
    area: r ? Math.round(r.area) : 0,
    comps: r ? r.count : 0,
    goal: { x: Math.round(lv.lights[0].goal.x), y: Math.round(lv.lights[0].goal.y) },
    start, action, dist, window: win,
    box: r ? { x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 } : null,
  });
}

/** 相邻关相似度：动作方向 + 解区中心距离 */
const sims = [];
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1];
  const b = rows[i];
  let cos = 0;
  let gap = 999;
  if (a.action && b.action) {
    cos = a.action.dx * b.action.dx + a.action.dy * b.action.dy;
    gap = Math.hypot(a.goal.x - b.goal.x, a.goal.y - b.goal.y);
  }
  sims.push({ a: a.id, b: b.id, cos, gap, sameMech: a.mech === b.mech });
}

if (!MD) {
  console.log('id  name        mech           解区面积  可达距离  动作(dx,dy)      相邻cos  相邻goal距');
  for (const r of rows) {
    const s = sims.find((x) => x.b === r.id);
    const act = r.action ? `(${r.action.dx.toFixed(2)},${r.action.dy.toFixed(2)})` : '—';
    console.log(
      String(r.id).padStart(2), (r.name || '').padEnd(10), r.mech.padEnd(16),
      String(r.area).padStart(7), String(Math.round(r.dist)).padStart(7), act.padEnd(18),
      (s ? s.cos.toFixed(2) : '—').padStart(7), (s ? Math.round(s.gap) : '—').toString().padStart(9)
    );
  }
  console.log('\n高度相似的相邻关（cos>0.98 且 goal 距<90）：');
  for (const s of sims) if (s.cos > 0.98 && s.gap < 90) console.log(`  L${s.a} → L${s.b}  cos=${s.cos.toFixed(3)} gap=${s.gap.toFixed(0)}`);
} else {
  const lines = [
    '# 60 关逐关审查表（运行时关卡）',
    '',
    '> 数据来源：`node scripts/audit-levels.mjs`，对象是**运行时关卡**（镜像、沿墙压缩、边界收紧之后）。',
    '> 解区为 6px 网格搜索的最大连通区；动作 = 起点到解区中心的方向；窗口 = 该解区能保持的最长连续时间。',
    '',
    '| # | 关卡 | 机制 | 解区面积 | 可达距离 | 起点 | 解区中心 | 动作 | 窗口 | 相邻相似度 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const s = sims.find((x) => x.b === r.id);
    const act = r.action ? `${r.action.dx > 0.3 ? '→' : r.action.dx < -0.3 ? '←' : ''}${r.action.dy > 0.3 ? '↓' : r.action.dy < -0.3 ? '↑' : ''}` : '—';
    lines.push(`| ${r.id} | ${r.name} | ${r.mech} | ${r.area} | ${Math.round(r.dist)} | (${Math.round(r.start.x)},${Math.round(r.start.y)}) | (${r.goal.x},${r.goal.y}) | ${act} | ${r.window.toFixed(1)}s | ${s ? s.cos.toFixed(2) : '—'} |`);
  }
  writeFileSync(new URL('../docs/LEVEL-AUDIT.md', import.meta.url), lines.join('\n') + '\n');
  console.log('写入 docs/LEVEL-AUDIT.md：' + rows.length + ' 行');
}
