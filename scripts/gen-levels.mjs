// 关卡生成器：把 36 关的配方（水晶位置、解的光源位置、遮挡物尺寸）编译成
// src/levels.js。
//
// 为什么要有生成器：手填坐标必然出现"无解"或"开局就过"的关。
// 这里换一种顺序 —— 先定"解"在哪，再反推每块挡板该放在哪一行，
// 让它在解位置投出的影子正好落进两条缝之间。这样几何上天然可解。
//
// 用法：node scripts/gen-levels.mjs [--write]

import { writeFileSync } from 'node:fs';
import { WALL, WALL_L, BOUNDS, BOUNDS_DUAL, HOLD_TIME, VIEW } from '../src/config.js';
import { shadowIntervalOn, pointInPolygon, isVisibleAt } from '../src/geometry.js';
import {
  crystalsForLight,
  lightSatisfied,
  regionForLight,
  components,
  shortestDistance,
  holdCheck,
} from './lib/solve.mjs';

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/* ---------------- 沿墙压缩 ---------------- */
// 与运行时一致：把沿墙方向（世界 y）压到 0.75，让上层布局能把上下光柱拉开。
// 必须在"算距离/校验"之前执行，距离才是最终几何上的参考值。
const WALL_SQUASH = 0.75;
const SQUASH_CY = 640;
function squashLevel(level) {
  const k = WALL_SQUASH;
  const f = (y) => SQUASH_CY + (y - SQUASH_CY) * k;
  level.crystals.forEach((c) => { c.y = f(c.y); });
  level.blocks.forEach((poly) => poly.forEach((p) => { p.y = f(p.y); }));
  (level.movers || []).forEach((m) => {
    (m.path || []).forEach((p) => { p.y = f(p.y); });
    (m.shape || []).forEach((p) => { p.y *= k; });
  });
  level.lights.forEach((l) => {
    l.start = { x: l.start.x, y: f(l.start.y) };
    l.start0 = { x: l.start0.x, y: f(l.start0.y) };
    l.goal = { x: l.goal.x, y: f(l.goal.y) };
  });
  if (level.bounds) level.bounds = { ...level.bounds, y0: f(level.bounds.y0), y1: f(level.bounds.y1) };
  level.squashed = true;
  return level;
}

/* ---------------- 挡板反推 ---------------- */

/** 某一盏灯的水晶把墙切成若干"缝" */
const wallXOf = (side) => (side === 'l' ? WALL_L.cx : WALL.cx);

function gapsFor(level, lightIndex, side = 'r') {
  const ys = crystalsForLight(level, lightIndex)
    .filter((c) => (c.side || 'r') === side)
    .map((c) => c.y)
    .sort((a, b) => a - b);
  const edges = [WALL.top, ...ys, WALL.bottom];
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    out.push({ a: edges[i], b: edges[i + 1], used: false, i });
  }
  return out;
}

/** 挡板不压住任何一盏灯的解位置 */
function clearOfLights(level, poly) {
  for (const l of level.lights) {
    if (pointInPolygon(l.start, poly)) return false;
  }
  return true;
}

/** 任意两盏灯投出的影子都不能盖住它们各自负责的水晶 */
function crystalsClear(level, poly) {
  for (let i = 0; i < level.lights.length; i++) {
    for (const side of ['l', 'r']) {
      const band = shadowIntervalOn(level.lights[i].start, poly, wallXOf(side));
      if (!band) continue;
      for (const c of crystalsForLight(level, i)) {
        if ((c.side || 'r') !== side) continue;
        if (c.y >= band.y0 && c.y <= band.y1) return false;
      }
    }
  }
  return true;
}

function overlaps(a, b) {
  const A = { x0: Math.min(...a.map((p) => p.x)), x1: Math.max(...a.map((p) => p.x)) };
  const A2 = { y0: Math.min(...a.map((p) => p.y)), y1: Math.max(...a.map((p) => p.y)) };
  const B = { x0: Math.min(...b.map((p) => p.x)), x1: Math.max(...b.map((p) => p.x)) };
  const B2 = { y0: Math.min(...b.map((p) => p.y)), y1: Math.max(...b.map((p) => p.y)) };
  return A.x0 < B.x1 - 4 && B.x0 < A.x1 - 4 && A2.y0 < B2.y1 - 4 && B2.y0 < A2.y1 - 4;
}

/**
 * 在指定缝隙里给挡板找一行 y，让它在 forLight 这盏灯下的影子完整落进缝里。
 * 同时要求：不挡住这盏灯负责的水晶、不压住解位置、不和已有挡板重叠。
 */
/** 收集某块挡板在这个光源下、能完整落进某条缝的所有位置 */
function collectY(level, spec, gaps, margin) {
  const { x, w, h, forLight } = spec;
  const usable = gaps.filter((g) => !spec.gap || spec.gap === g.i);
  const out = [];
  const xs = [x, x + 20, x + 40, x - 20, x + 60];
  // 单侧关卡沿用老规则（挡板必须在光源右侧）；双侧关卡允许贴两侧墙
  const lo = level.multiWall ? 96 : 300;
  const B = level.bounds || BOUNDS;
  for (const x0 of xs) {
    if (x0 < lo || x0 + w > 552) continue;
    for (const hh of [h, Math.round(h * 0.8), Math.round(h * 0.62)]) {
    for (const gap of usable) {
    for (let y = 150; y <= 1130 - hh; y += 2) {
      const poly = rect(x0, y, w, hh);
      const band = shadowIntervalOn(level.lights[forLight].start, poly, wallXOf(spec.side));
      if (!band) continue;
      if (band.y0 < gap.a + margin || band.y1 > gap.b - margin) continue;
      if (!clearOfLights(level, poly)) continue;
      if (!crystalsClear(level, poly)) continue;
      const centerErr = Math.abs((band.y0 + band.y1) / 2 - (gap.a + gap.b) / 2);
      const score = centerErr + (x0 - x) * 1.2 + (h - hh) * 3;
      out.push({ poly, y, band, score });
    }
    }
    }
  }
  out.sort((p, q) => p.score - q.score);
  return out;
}

/** 在候选里挑一组互不重叠的（约束最多的先挑，剪枝更狠） */
function pickNonOverlapping(lists, idx = 0, chosen = []) {
  if (idx >= lists.length) return chosen;
  const cands = lists[idx];
  for (let i = 0; i < cands.length && i < 80; i++) {
    const c = cands[i];
    if (chosen.every((q) => !overlaps(q.poly, c.poly))) {
      const r = pickNonOverlapping(lists, idx + 1, [...chosen, c]);
      if (r) return r;
    }
  }
  return null;
}

/**
 * 放不下就逐级放宽：先缩高度，再收边距。
 * 反正最后有校验器兜底，这里只求"几何上一定有解"。
 */
function placeBlocks(level, specs, margin) {
  for (const shrink of [1, 0.88, 0.76, 0.64, 0.54]) {
    for (const m of [margin, Math.round(margin * 0.72), Math.round(margin * 0.45), 6]) {
      const lists = specs.map((spec) => {
        const h = Math.max(54, Math.round(spec.h * shrink));
        const side = spec.side || 'r';
        return collectY(level, { ...spec, side, h }, gapsFor(level, spec.forLight ?? 0, side), m);
      });
      if (lists.some((l) => l.length === 0)) continue;
      const order = lists.map((l, i) => i).sort((a, b) => lists[a].length - lists[b].length);
      const picked = pickNonOverlapping(order.map((i) => lists[i]));
      if (picked) {
        // 还原成原始顺序
        const byIdx = new Map();
        order.forEach((origIdx, k) => byIdx.set(origIdx, picked[k]));
        return lists.map((_, i) => byIdx.get(i));
      }
    }
  }
  return null;
}

/* ---------------- 移动遮挡物 ---------------- */

function makeMover(spec) {
  const { w, h } = spec;
  const shape = rect(-w / 2, -h / 2, w, h);
  if (spec.kind === 'v') {
    return {
      shape,
      path: [
        { x: spec.x, y: spec.y0 },
        { x: spec.x, y: spec.y1 },
      ],
      period: spec.period,
      phase: spec.phase || 0,
      mode: 'pingpong',
    };
  }
  if (spec.kind === 'h') {
    return {
      shape,
      path: [
        { x: spec.x0, y: spec.y },
        { x: spec.x1, y: spec.y },
      ],
      period: spec.period,
      phase: spec.phase || 0,
      mode: 'pingpong',
    };
  }
  // orbit / roam：绕一个圈，可选周期性胀大
  const n = 10;
  const path = [];
  const rx = spec.rx ?? spec.r;
  const ry = spec.ry ?? spec.r;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    path.push({ x: spec.cx + Math.cos(a) * rx, y: spec.cy + Math.sin(a) * ry });
  }
  return {
    shape,
    path,
    period: spec.period,
    phase: spec.phase || 0,
    mode: 'loop',
    pulse: spec.pulse || null,
  };
}

/* ---------------- 自动松弛移动障碍 ---------------- */

function relaxScene(level, k, dx = 0) {
  return level.movers.map((m) => ({
    ...m,
    shape: m.shape.map((p) => ({ x: p.x * k, y: p.y * k })),
    path: m.path.map((p) => ({ x: p.x + dx, y: p.y })),
    pulse: m.pulse ? { ...m.pulse, amp: m.pulse.amp * k } : null,
    _path: undefined,
  }));
}

/**
 * 移动障碍的职责是"制造窗口"，不是"永久封死"，也不是"从不挡光"。
 * 这里在缩放(k) × 上下平移(dy) 里搜一遍，取"仍然留出 >=4.2 秒干净窗口"里面
 * 挡得最狠的那一组 —— 窗口越短说明它参与得越多。
 */
function moverVariant(m, k, dy) {
  const cy = m.path.reduce((s, p) => s + p.y, 0) / m.path.length;
  return {
    ...m,
    shape: m.shape.map((p) => ({ x: p.x * k, y: p.y * k })),
    path: m.path.map((p) => ({ x: p.x, y: p.y + dy })),
    pulse: m.pulse ? { ...m.pulse, amp: m.pulse.amp * k } : null,
    _path: undefined,
    _cy: cy,
  };
}

function tuneMoversBasic(level, positions) {
  if (!level.movers.length) return;
  const orig = level.movers;
  let chosen = null;
  const tries = [];
  for (const dx of [0, 16, 32, 48]) {
    for (const k of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.32, 0.25, 0.18]) tries.push({ k, dx });
  }
  for (const { k, dx } of tries) {
    level.movers = relaxScene({ movers: orig }, k, dx);
    const h = holdCheck(level, positions, 99).best;
    if (h >= 4.2 && h !== Infinity) {
      chosen = level.movers;
      break;
    }
    if (h >= 4.2 && h === Infinity && !chosen) chosen = level.movers;
  }
  level.movers = chosen || relaxScene({ movers: orig }, 0.18, 48);
}

function tuneMoversAdvanced(level, positions) {
  if (!level.movers.length) return;
  const base = level.movers.slice();
  for (let idx = 0; idx < base.length; idx++) {
    let best = null;
    for (const dy of [0, -60, 60, -120, 120, -180, 180, -240, 240, -300, 300, -360, 360]) {
      for (const k of [1, 0.85, 0.7, 0.55]) {
        const trial = level.movers.slice();
        trial[idx] = moverVariant(base[idx], k, dy);
        level.movers = trial;
        const h = holdCheck(level, positions, 99).best;
        if (h >= 4.2 && h < Infinity && (!best || h < best.h)) best = { h, movers: trial };
      }
    }
    level.movers = best ? best.movers : base.map((m) => moverVariant(m, 0.55, 0));
  }
}

/* ---------------- 起始位置 ---------------- */

/**
 * 选手的初始位置：必须在 t=0 时是"没解开"的，否则这一关开局就过。
 * 优先选离解区远、且靠左下（手指好够到）的点。
 */
function lightCanHold3(level, i, p) {
  const mine = crystalsForLight(level, i);
  if (!level.movers.length) {
    return mine.every((c) => isVisibleAt(p, c, level.blocks, [], 0));
  }
  let run = 0;
  for (let k = 0; k < 160; k++) {
    const good = mine.every((c) => isVisibleAt(p, c, level.blocks, level.movers, k * 0.08));
    run = good ? run + 0.08 : 0;
    if (run >= HOLD_TIME) return true;
  }
  return false;
}

/**
 * 起始位置：必须"开局不成立"。静态关就是看不见；动态关还要检查
 * 它在整个周期里都凑不出 3 秒窗口，否则一进关就自动通关。
 */
function pickStart(level, lightIndex) {
  const sol = level.lights[lightIndex].goal || level.lights[lightIndex].start;
  const B = level.bounds || BOUNDS;
  const cands = [];
  for (let y = B.y0 + 20; y <= B.y1 - 20; y += 12) {
    for (let x = B.x0 + 10; x <= B.x1 - 10; x += 12) {
      const p = { x, y };
      // t=0 就已经照到的不算起点（便宜的先筛掉，动态关再补时间检查）
      if (lightSatisfied(level, lightIndex, p, 0)) continue;
      if (!clearOfLights(level, [{ x: p.x, y: p.y }])) continue;
      const far = Math.hypot(p.x - sol.x, p.y - sol.y);
      const low = ((p.y - B.y0) / (B.y1 - B.y0)) * 120;
      cands.push({ score: far + low + p.x * 0.2, p });
    }
  }
  // 稳定排序：同分时保持扫描顺序，和旧版选法一致
  cands.sort((a, b) => b.score - a.score);
  for (let i = 0; i < Math.min(cands.length, 120); i++) {
    if (!lightCanHold3(level, lightIndex, cands[i].p)) return cands[i].p;
  }
  const last = cands[cands.length - 1] || { p: { x: B.x0 + 50, y: B.y1 - 50 } };
  return last.p;
}

/* ---------------- 编译一关 ---------------- */

function compile(recipe) {
  const multiWall = recipe.cry.some((c) => c.side === 'l');
  const bounds = recipe.bounds || (multiWall ? BOUNDS_DUAL : BOUNDS);
  const level = {
    id: 0,
    name: recipe.name,
    tier: recipe.tier,
    tip: recipe.tip || '',
    multiWall,
    bounds,
    lights: recipe.L.map(([x, y]) => ({ start: { x, y } })),
    crystals: recipe.cry.map((c) => ({
      x: wallXOf(c.side || 'r'),
      y: c.y,
      side: c.side || 'r',
      lights: c.l === 'b' ? [0, 1] : [c.l ?? 0],
    })),
    blocks: [],
    movers: (recipe.movers || []).map(makeMover),
    hold: HOLD_TIME,
    distance: null,
  };
  if (recipe.roam) {
    level.movers.push(
      makeMover({
        kind: 'orbit',
        w: recipe.roam.w,
        h: recipe.roam.h,
        cx: recipe.roam.cx,
        cy: recipe.roam.cy,
        rx: recipe.roam.rx,
        ry: recipe.roam.ry,
        period: recipe.roam.period,
        phase: recipe.roam.phase || 0,
        pulse: recipe.roam.pulse,
      })
    );
  }

  // 反推挡板
  const margin = recipe.margin ?? 26;
  const specs = (recipe.blocks || []).map((b) => ({ ...b, forLight: b.forLight ?? 0 }));
  if (recipe.fixed) {
    level.blocks = specs.map((b) => rect(b.x, b.y, b.w, b.h));
  } else if (specs.length) {
    const picked = placeBlocks(level, specs, margin);
    if (!picked) throw new Error(`${recipe.name}: 挡板放不进任何缝`);
    level.blocks = picked.map((p) => p.poly);
  }

  if (recipe.fixed) {
    level.lights.forEach((l, i) => {
      const r = regionForLight(level, i, { step: 4 });
      const c = components(r)[0];
      if (!c) throw new Error(`${recipe.name}: 固定布局无解`);
      l.goal = { x: Math.round(c.sx / c.n), y: Math.round(c.sy / c.n) };
    });
  } else {
    level.lights.forEach((l) => {
      l.goal = l.start;
    });
  }

  // 移动障碍调参：保证设计解处有够长的干净窗口
  const tune = level.multiWall ? tuneMoversAdvanced : tuneMoversBasic;
  tune(level, level.lights.map((l) => l.goal));

  // 起始位置：要保证"开局不能已经能保持 3 秒"，否则这关开局就过
  const starts = level.lights.map((_, i) => pickStart(level, i));
  level.lights.forEach((l, i) => {
    l.start0 = starts[i];
  });

  // 布局压缩放在距离计算之前：距离参考必须基于最终几何
  squashLevel(level);

  // 最优距离：只给"静态 + 至少两个互不相连的解区"的关卡开
  if (recipe.distance && !level.movers.length) {
    const regions = level.lights.map((_, i) => regionForLight(level, i, { step: 4 }));
    const comps = regions.map((r) => components(r));
    if (comps.some((c) => c.length >= 2)) {
      let total = 0;
      let ok = true;
      regions.forEach((r, i) => {
        const d = shortestDistance(level, i, level.lights[i].start0, r);
        if (!isFinite(d)) ok = false;
        total += d;
      });
      if (ok) level.distance = { optimal: Math.round(total * 10) / 10 };
      else console.log(`  · ${recipe.name}: 距离不可达，跳过最优距离`);
    } else {
      console.log(`  · ${recipe.name}: 解区只有 1 块，跳过最优距离`);
    }
  }
  return level;
}

/* ---------------- 36 关配方 ---------------- */
// cry: [{y, l}]  l=0/1 表示必须由哪盏灯照亮，'b' 表示两盏都要
// L:   解的灯位（可以有多盏）
// blocks: {x, w, h, forLight}  forLight 决定它要挡哪盏灯的光路

const RECIPES = [
  // ---- 第 1 组：基础（单光源、单目标、认识影子） ----
  { name: '初次投光', tier: 1, tip: '拖动光源，让墙上的水晶亮起来',
    cry: [{ y: 470 }], L: [[200, 780]], blocks: [{ x: 330, w: 170, h: 200 }], margin: 34 },
  // 第 2 关：挡板横在光源与水晶之间，要换一个位置让光从缝里过（和 1 关不同方向）
  { name: '一线天', tier: 1, tip: '挡板挡住了，换个位置让光从缝里过去',
    cry: [{ y: 1000 }], L: [[150, 320]], blocks: [{ x: 330, w: 170, h: 260 }], margin: 30 },
  // 第 3 关：两颗目标一上一下，必须找一个能同时照顾两边的位置
  { name: '双星', tier: 1, tip: '两颗都要亮，位置要同时照顾上下',
    cry: [{ y: 300 }, { y: 980 }], L: [[250, 640]], blocks: [{ x: 330, w: 160, h: 120 }], margin: 32 },
  { name: '三影', tier: 1, tip: '三颗一起亮，站位要一次装下',
    cry: [{ y: 300 }, { y: 640 }, { y: 980 }], L: [[250, 1020]],
    blocks: [{ x: 340, w: 130, h: 140 }, { x: 430, w: 90, h: 170 }], margin: 30 },
  { name: '交叠', tier: 1, fixed: true, distance: true,
    cry: [{ y: 460 }, { y: 1040 }], L: [[150, 700]],
    blocks: [{ x: 420, y: 600, w: 120, h: 60 }, { x: 370, y: 840, w: 100, h: 60 }, { x: 410, y: 270, w: 120, h: 90 }] },
  { name: '小满', tier: 1,
    cry: [{ y: 260 }, { y: 620 }, { y: 980 }], L: [[160, 700]],
    blocks: [{ x: 340, w: 160, h: 120 }, { x: 440, w: 100, h: 150 }], margin: 28 },

  // ---- 第 2 组：静态遮挡 + 多目标 ----
  { name: '窄门', tier: 2, tip: '门在另一头：先往里贴，再往上找缝',
    cry: [{ y: 320 }, { y: 720 }, { y: 1080 }], L: [[250, 360]],
    blocks: [{ x: 330, w: 150, h: 130 }, { x: 430, w: 110, h: 160 }], margin: 24 },
  { name: '漏光', tier: 2, tip: '这次要贴墙才漏得过去',
    cry: [{ y: 300 }, { y: 700 }, { y: 1060 }], L: [[104, 980]],
    blocks: [{ x: 350, w: 130, h: 120 }, { x: 440, w: 100, h: 190 }], margin: 22 },
  { name: '对峙', tier: 2, fixed: true, distance: true,
    cry: [{ y: 440 }, { y: 1060 }], L: [[150, 700]],
    blocks: [{ x: 310, y: 500, w: 100, h: 160 }, { x: 380, y: 210, w: 120, h: 120 }] },
  { name: '密林', tier: 2, tip: '树多，缝窄：贴墙反而更难，往外退一点',
    cry: [{ y: 280 }, { y: 640 }, { y: 1000 }], L: [[262, 300]],
    blocks: [{ x: 320, w: 140, h: 110 }, { x: 420, w: 120, h: 130 }, { x: 360, w: 130, h: 90 }], margin: 18 },
  { name: '心宿', tier: 2, tip: '四颗星，只有一个背影能装下',
    cry: [{ y: 260 }, { y: 560 }, { y: 860 }, { y: 1100 }], L: [[110, 300]],
    blocks: [{ x: 340, w: 120, h: 80 }, { x: 450, w: 100, h: 140 }, { x: 350, w: 120, h: 70 }], margin: 14 },
  { name: '回路', tier: 2, fixed: true, distance: true,
    cry: [{ y: 280 }, { y: 960 }], L: [[150, 700]],
    blocks: [{ x: 430, y: 430, w: 120, h: 60 }, { x: 340, y: 650, w: 80, h: 120 }] },

  // ---- 第 3 组：移动遮挡（可观察、可预判） ----
  { name: '走影', tier: 3, tip: '影子会跟着挡板一起移动，等它走到另一头',
    cry: [{ y: 340 }, { y: 900 }], L: [[236, 980]],
    blocks: [{ x: 340, w: 170, h: 150 }], margin: 28,
    movers: [{ kind: 'v', x: 372, y0: 300, y1: 520, w: 64, h: 70, period: 10, phase: 0.15 }] },
  { name: '摆渡', tier: 3, tip: '船来回走，等它让开再停',
    cry: [{ y: 300 }, { y: 700 }, { y: 1060 }], L: [[230, 520]],
    blocks: [{ x: 340, w: 150, h: 130 }], margin: 24,
    movers: [{ kind: 'h', y: 500, x0: 330, x1: 430, w: 80, h: 60, period: 9, phase: 0.3 }] },
  { name: '双摆', tier: 3,
    cry: [{ y: 320 }, { y: 700 }, { y: 1040 }], L: [[170, 700]],
    blocks: [{ x: 330, w: 150, h: 120 }, { x: 440, w: 100, h: 150 }], margin: 22,
    movers: [
      { kind: 'v', x: 358, y0: 280, y1: 470, w: 70, h: 64, period: 9, phase: 0 },
      { kind: 'v', x: 392, y0: 760, y1: 950, w: 64, h: 70, period: 11, phase: 0.4 },
    ] },
  { name: '缓流', tier: 3,
    cry: [{ y: 280 }, { y: 640 }, { y: 1000 }], L: [[140, 860]],
    blocks: [{ x: 350, w: 140, h: 110 }, { x: 440, w: 100, h: 160 }], margin: 20,
    movers: [{ kind: 'orbit', cx: 380, cy: 560, rx: 45, ry: 150, w: 64, h: 64, period: 12, phase: 0.2 }] },
  { name: '逆旅', tier: 3,
    cry: [{ y: 300 }, { y: 660 }, { y: 1020 }], L: [[180, 620]],
    blocks: [{ x: 330, w: 150, h: 130 }], margin: 22,
    movers: [
      { kind: 'v', x: 352, y0: 280, y1: 520, w: 70, h: 64, period: 10, phase: 0.1 },
      { kind: 'v', x: 386, y0: 700, y1: 940, w: 64, h: 70, period: 12, phase: 0.55 },
    ] },
  { name: '潮汐', tier: 3,
    cry: [{ y: 260 }, { y: 560 }, { y: 880 }, { y: 1090 }], L: [[150, 720]],
    blocks: [{ x: 340, w: 130, h: 80 }, { x: 450, w: 100, h: 130 }], margin: 14,
    movers: [{ kind: 'v', x: 366, y0: 320, y1: 760, w: 70, h: 66, period: 13, phase: 0.25 }] },

  // ---- 第 4 组：动态干扰角色（有前摇、可应对） ----
  { name: '呼吸', tier: 4, tip: '它鼓起来之前会亮一圈，等它缩回去',
    cry: [{ y: 340 }, { y: 900 }], L: [[170, 620]],
    blocks: [{ x: 340, w: 160, h: 150 }], margin: 26,
    roam: { cx: 372, cy: 620, rx: 40, ry: 150, w: 64, h: 64, period: 14,
            pulse: { period: 7, hold: 1.8, amp: 0.65, warn: 0.8 } } },
  { name: '蛰伏', tier: 4,
    cry: [{ y: 300 }, { y: 700 }, { y: 1060 }], L: [[140, 820]],
    blocks: [{ x: 350, w: 140, h: 120 }], margin: 22,
    roam: { cx: 380, cy: 760, rx: 40, ry: 190, w: 66, h: 62, period: 15,
            pulse: { period: 8, hold: 2.0, amp: 0.7, warn: 0.9 } } },
  { name: '吞吐', tier: 4,
    cry: [{ y: 320 }, { y: 700 }, { y: 1040 }], L: [[180, 700]],
    blocks: [{ x: 330, w: 150, h: 130 }, { x: 440, w: 100, h: 140 }], margin: 18,
    roam: { cx: 376, cy: 520, rx: 36, ry: 140, w: 62, h: 66, period: 13,
            pulse: { period: 6.5, hold: 1.6, amp: 0.6, warn: 0.7 } } },
  { name: '巡夜', tier: 4,
    cry: [{ y: 280 }, { y: 620 }, { y: 980 }], L: [[120, 880]],
    blocks: [{ x: 340, w: 130, h: 110 }, { x: 440, w: 90, h: 150 }], margin: 16,
    roam: { cx: 368, cy: 700, rx: 40, ry: 180, w: 62, h: 64, period: 16,
            pulse: { period: 9, hold: 2.2, amp: 0.65, warn: 1.0 } } },
  { name: '徘徊', tier: 4,
    cry: [{ y: 300 }, { y: 640 }, { y: 1000 }], L: [[160, 660]],
    blocks: [{ x: 330, w: 140, h: 120 }, { x: 440, w: 100, h: 160 }], margin: 14,
    roam: { cx: 384, cy: 620, rx: 46, ry: 170, w: 64, h: 62, period: 17,
            pulse: { period: 10, hold: 2.4, amp: 0.7, warn: 1.1 } } },
  { name: '潮汐 II', tier: 4,
    cry: [{ y: 260 }, { y: 560 }, { y: 860 }, { y: 1080 }], L: [[140, 760]],
    blocks: [{ x: 340, w: 120, h: 80 }, { x: 450, w: 100, h: 130 }], margin: 12,
    roam: { cx: 374, cy: 660, rx: 42, ry: 200, w: 62, h: 66, period: 18,
            pulse: { period: 11, hold: 2.6, amp: 0.7, warn: 1.2 } } },

  // ---- 第 5 组：双光源、多角度 ----
  { name: '双生', tier: 5, tip: '点亮的那盏会亮一圈，点它就能拖',
    cry: [{ y: 300, l: 0 }, { y: 560, l: 1 }, { y: 820, l: 0 }, { y: 1080, l: 1 }],
    L: [[150, 760], [160, 460]],
    blocks: [{ x: 340, w: 150, h: 120, forLight: 0 }, { x: 440, w: 100, h: 150, forLight: 1 },
             { x: 380, w: 90, h: 90, forLight: 1 }], margin: 20 },
  { name: '对望', tier: 5,
    cry: [{ y: 280, l: 0 }, { y: 520, l: 1 }, { y: 760, l: 1 }, { y: 1000, l: 0 }],
    L: [[140, 700], [180, 380]],
    blocks: [{ x: 330, w: 150, h: 110, forLight: 0 }, { x: 440, w: 100, h: 140, forLight: 1 },
             { x: 370, w: 90, h: 80, forLight: 0 }], margin: 14 },
  { name: '两仪', tier: 5,
    cry: [{ y: 320, l: 'b' }, { y: 620, l: 1 }, { y: 900, l: 'b' }],
    L: [[150, 560], [170, 880]],
    blocks: [{ x: 340, w: 140, h: 120, forLight: 0 }, { x: 450, w: 100, h: 150, forLight: 1 },
             { x: 380, w: 90, h: 90, forLight: 0 }], margin: 14 },
  { name: '交辉', tier: 5,
    cry: [{ y: 260, l: 0 }, { y: 520, l: 'b' }, { y: 800, l: 'b' }, { y: 1060, l: 1 }],
    L: [[140, 480], [160, 880]],
    blocks: [{ x: 330, w: 150, h: 110, forLight: 0 }, { x: 440, w: 110, h: 150, forLight: 1 }], margin: 18 },
  { name: '分光', tier: 5,
    cry: [{ y: 300, l: 1 }, { y: 560, l: 0 }, { y: 820, l: 1 }, { y: 1080, l: 0 }],
    L: [[130, 820], [180, 440]],
    blocks: [{ x: 340, w: 140, h: 110, forLight: 0 }, { x: 450, w: 100, h: 150, forLight: 1 },
             { x: 380, w: 90, h: 80, forLight: 1 }], margin: 12 },
  { name: '双全', tier: 5,
    cry: [{ y: 280, l: 0 }, { y: 520, l: 1 }, { y: 800, l: 0 }, { y: 1060, l: 1 }],
    L: [[150, 720], [170, 400]],
    blocks: [{ x: 330, w: 150, h: 110, forLight: 0 }, { x: 440, w: 100, h: 140, forLight: 1 },
             { x: 400, w: 90, h: 80, forLight: 1 }], margin: 14 },

  // ---- 第 6 组：综合 ----
  { name: '合流', tier: 6,
    cry: [{ y: 280, l: 0 }, { y: 560, l: 1 }, { y: 840, l: 0 }, { y: 1080, l: 1 }],
    L: [[160, 780], [150, 480]],
    blocks: [{ x: 340, w: 150, h: 120, forLight: 0 }, { x: 440, w: 100, h: 150, forLight: 1 }], margin: 16,
    movers: [{ kind: 'v', x: 390, y0: 720, y1: 960, w: 64, h: 70, period: 11, phase: 0.2 }] },
  { name: '千影', tier: 6,
    cry: [{ y: 260 }, { y: 520 }, { y: 800 }, { y: 1080 }], L: [[150, 700]],
    blocks: [{ x: 340, w: 130, h: 70 }, { x: 450, w: 100, h: 120 }, { x: 350, w: 120, h: 60 }], margin: 12,
    movers: [{ kind: 'orbit', cx: 380, cy: 760, rx: 44, ry: 170, w: 62, h: 62, period: 13, phase: 0.3 }] },
  { name: '心电', tier: 6,
    cry: [{ y: 300 }, { y: 640 }, { y: 980 }], L: [[140, 820]],
    blocks: [{ x: 330, w: 140, h: 110 }, { x: 450, w: 100, h: 140 }], margin: 14,
    roam: { cx: 480, cy: 640, rx: 70, ry: 260, w: 80, h: 80, period: 12,
            pulse: { period: 7, hold: 2.4, amp: 0.9, warn: 0.9 } },
    movers: [{ kind: 'h', y: 420, x0: 330, x1: 430, w: 76, h: 56, period: 10, phase: 0.5 }] },
  { name: '双柱', tier: 6,
    cry: [{ y: 300, l: 0 }, { y: 600, l: 1 }, { y: 880, l: 0 }, { y: 1080, l: 1 }],
    L: [[150, 640], [170, 880]],
    blocks: [{ x: 340, w: 150, h: 110, forLight: 0 }, { x: 450, w: 100, h: 140, forLight: 1 },
             { x: 400, w: 90, h: 90, forLight: 1 }], margin: 14 },
  { name: '终夜', tier: 6,
    cry: [{ y: 280 }, { y: 600 }, { y: 920 }], L: [[160, 760]],
    blocks: [{ x: 330, w: 150, h: 120 }, { x: 450, w: 100, h: 150 }], margin: 12,
    roam: { cx: 490, cy: 600, rx: 70, ry: 220, w: 80, h: 80, period: 10,
            pulse: { period: 6, hold: 2, amp: 0.85, warn: 0.8 } },
    movers: [
      { kind: 'v', x: 356, y0: 280, y1: 480, w: 66, h: 62, period: 11, phase: 0.1 },
      { kind: 'v', x: 392, y0: 800, y1: 980, w: 62, h: 66, period: 13, phase: 0.6 },
    ] },
  { name: '尽处', tier: 6,
    cry: [{ y: 260 }, { y: 540 }, { y: 820 }, { y: 1080 }], L: [[130, 700]],
    blocks: [{ x: 340, w: 130, h: 70 }, { x: 450, w: 100, h: 130 }, { x: 350, w: 120, h: 60 }], margin: 10,
    roam: { cx: 378, cy: 680, rx: 40, ry: 200, w: 62, h: 62, period: 19,
            pulse: { period: 12, hold: 2.8, amp: 0.7, warn: 1.2 } },
    movers: [{ kind: 'v', x: 408, y0: 380, y1: 700, w: 58, h: 60, period: 16, phase: 0.35 }] },
  // ===== 第 7 组（37–40）：双侧水晶教学 =====
  { name: '双岸', tier: 7, tip: '左右两侧的水晶要同时亮着',
    cry: [{ y: 400, side: 'l' }, { y: 900 }], L: [[320, 660]],
    blocks: [{ x: 104, w: 44, h: 150, side: 'l' }, { x: 492, w: 52, h: 150, side: 'r' }], margin: 34 },
  { name: '对开', tier: 7,
    cry: [{ y: 300, side: 'l' }, { y: 820, side: 'l' }, { y: 420 }, { y: 980 }], L: [[300, 720]],
    blocks: [{ x: 106, w: 44, h: 130, side: 'l' }, { x: 496, w: 52, h: 130, side: 'r' }], margin: 30 },
  { name: '左右', tier: 7,
    cry: [{ y: 300, side: 'l' }, { y: 860, side: 'l' }, { y: 520 }, { y: 1000 }], L: [[340, 700]],
    blocks: [{ x: 104, w: 44, h: 120, side: 'l' }, { x: 494, w: 52, h: 120, side: 'r' }], margin: 28 },
  { name: '缝间', tier: 7,
    cry: [{ y: 280, side: 'l' }, { y: 840, side: 'l' }, { y: 460 }, { y: 1020 }], L: [[300, 640]],
    blocks: [{ x: 108, w: 44, h: 130, side: 'l' }, { x: 490, w: 54, h: 120, side: 'r' }], margin: 26 },

  // ===== 第 8 组（41–44）：双侧静态解谜 =====
  { name: '双门', tier: 8,
    cry: [{ y: 300, side: 'l' }, { y: 860, side: 'l' }, { y: 520 }, { y: 1000 }], L: [[340, 720]],
    blocks: [{ x: 104, w: 44, h: 110, side: 'l' }, { x: 110, w: 44, h: 100, side: 'l' },
             { x: 496, w: 52, h: 100, side: 'r' }, { x: 502, w: 52, h: 110, side: 'r' }], margin: 22 },
  { name: '交错', tier: 8,
    cry: [{ y: 260, side: 'l' }, { y: 720, side: 'l' }, { y: 420 }, { y: 980 }], L: [[300, 640]],
    blocks: [{ x: 106, w: 44, h: 100, side: 'l' }, { x: 112, w: 44, h: 95, side: 'l' },
             { x: 492, w: 54, h: 105, side: 'r' }, { x: 498, w: 54, h: 100, side: 'r' }], margin: 20 },
  { name: '深缝', tier: 8,
    cry: [{ y: 320, side: 'l' }, { y: 700, side: 'l' }, { y: 1010, side: 'l' }, { y: 540 }, { y: 900 }],
    L: [[380, 760]],
    blocks: [{ x: 104, w: 44, h: 100, side: 'l' }, { x: 110, w: 44, h: 95, side: 'l' },
             { x: 498, w: 52, h: 100, side: 'r' }, { x: 504, w: 52, h: 95, side: 'r' }], margin: 18 },
  { name: '分界', tier: 8,
    cry: [{ y: 340, side: 'l' }, { y: 940, side: 'l' }, { y: 300 }, { y: 680 }, { y: 1060 }],
    L: [[260, 680]],
    blocks: [{ x: 106, w: 44, h: 100, side: 'l' }, { x: 112, w: 44, h: 95, side: 'l' },
             { x: 494, w: 52, h: 100, side: 'r' }, { x: 500, w: 52, h: 95, side: 'r' }], margin: 16 },

  // ===== 第 9 组（45–48）：双侧 + 移动障碍 =====
  { name: '潮间带', tier: 9,
    cry: [{ y: 320, side: 'l' }, { y: 760, side: 'l' }, { y: 500 }, { y: 1000 }], L: [[320, 700]],
    blocks: [{ x: 104, w: 44, h: 110, side: 'l' }, { x: 494, w: 52, h: 110, side: 'r' }], margin: 24,
    movers: [{ kind: 'v', x: 430, y0: 320, y1: 620, w: 60, h: 64, period: 11, phase: 0.2 }] },
  { name: '摆渡双岸', tier: 9,
    cry: [{ y: 320, side: 'l' }, { y: 780, side: 'l' }, { y: 520 }, { y: 1020 }], L: [[360, 640]],
    blocks: [{ x: 104, w: 44, h: 110, side: 'l' }, { x: 496, w: 52, h: 110, side: 'r' }], margin: 22,
    movers: [{ kind: 'h', y: 700, x0: 250, x1: 420, w: 76, h: 56, period: 10, phase: 0.35 }] },
  { name: '双流', tier: 9,
    cry: [{ y: 300, side: 'l' }, { y: 840, side: 'l' }, { y: 460 }, { y: 1000 }], L: [[300, 700]],
    blocks: [{ x: 104, w: 44, h: 105, side: 'l' }, { x: 494, w: 52, h: 110, side: 'r' }], margin: 20,
    movers: [
      { kind: 'v', x: 250, y0: 320, y1: 560, w: 60, h: 60, period: 11, phase: 0.1 },
      { kind: 'v', x: 420, y0: 760, y1: 980, w: 56, h: 60, period: 13, phase: 0.5 }] },
  { name: '汐止', tier: 9,
    cry: [{ y: 300, side: 'l' }, { y: 720, side: 'l' }, { y: 1020, side: 'l' }, { y: 540 }, { y: 940 }],
    L: [[380, 760]],
    blocks: [{ x: 104, w: 44, h: 100, side: 'l' }, { x: 498, w: 52, h: 105, side: 'r' }], margin: 16,
    movers: [{ kind: 'orbit', cx: 300, cy: 620, rx: 46, ry: 150, w: 58, h: 58, period: 13, phase: 0.25 }] },

  // ===== 第 10 组（49–52）：双侧 + 双光源 + 移动 =====
  { name: '双灯双岸', tier: 10, tip: '点哪盏灯就拖哪盏',
    cry: [{ y: 300, side: 'l', l: 0 }, { y: 860, side: 'l', l: 1 }, { y: 620, side: 'l', l: 0 },
          { y: 420, l: 1 }, { y: 1000, l: 0 }],
    L: [[260, 560], [390, 880]],
    blocks: [{ x: 104, w: 44, h: 110, side: 'l', forLight: 0 }, { x: 110, w: 44, h: 100, side: 'l', forLight: 1 },
             { x: 496, w: 52, h: 110, side: 'r', forLight: 1 }, { x: 502, w: 52, h: 100, side: 'r', forLight: 0 }], margin: 18 },
  { name: '分工', tier: 10,
    cry: [{ y: 300, side: 'l', l: 0 }, { y: 780, side: 'l', l: 0 }, { y: 1020, side: 'l', l: 1 },
          { y: 700, side: 'l', l: 1 }, { y: 520, l: 1 }, { y: 940, l: 0 }],
    L: [[240, 640], [400, 780]],
    blocks: [{ x: 104, w: 44, h: 110, side: 'l', forLight: 0 }, { x: 494, w: 52, h: 110, side: 'r', forLight: 1 }], margin: 18,
    movers: [{ kind: 'v', x: 430, y0: 300, y1: 560, w: 56, h: 58, period: 12, phase: 0.3 }] },
  { name: '对置', tier: 10,
    cry: [{ y: 320, side: 'l', l: 0 }, { y: 700, side: 'l', l: 1 }, { y: 1000, side: 'l', l: 0 },
          { y: 460, l: 1 }, { y: 880, l: 0 }, { y: 1040, l: 1 }],
    L: [[280, 520], [380, 960]],
    blocks: [{ x: 104, w: 44, h: 100, side: 'l', forLight: 0 }, { x: 110, w: 44, h: 95, side: 'l', forLight: 1 },
             { x: 496, w: 52, h: 100, side: 'r', forLight: 1 }], margin: 14,
    movers: [{ kind: 'h', y: 600, x0: 240, x1: 400, w: 70, h: 54, period: 11, phase: 0.15 }] },
  { name: '并流', tier: 10,
    cry: [{ y: 300, side: 'l', l: 0 }, { y: 820, side: 'l', l: 1 }, { y: 560, side: 'l', l: 0 },
          { y: 460, l: 1 }, { y: 1040, l: 0 }],
    L: [[250, 700], [400, 560]],
    blocks: [{ x: 104, w: 44, h: 100, side: 'l', forLight: 1 }, { x: 494, w: 52, h: 105, side: 'r', forLight: 0 }], margin: 14,
    movers: [
      { kind: 'v', x: 250, y0: 300, y1: 520, w: 56, h: 56, period: 12, phase: 0.2 },
      { kind: 'v', x: 430, y0: 800, y1: 1020, w: 56, h: 56, period: 14, phase: 0.6 }] },

  // ===== 第 11 组（53–56）：双侧 + 干扰角色 =====
  { name: '呼吸两岸', tier: 11, tip: '它能胀大，等它缩回去',
    cry: [{ y: 320, side: 'l' }, { y: 780, side: 'l' }, { y: 500 }, { y: 1000 }], L: [[330, 720]],
    blocks: [{ x: 104, w: 44, h: 110, side: 'l' }, { x: 492, w: 52, h: 110, side: 'r' }], margin: 20,
    roam: { cx: 400, cy: 640, rx: 40, ry: 160, w: 60, h: 60, period: 15,
            pulse: { period: 8, hold: 2.0, amp: 0.65, warn: 0.9 } } },
  { name: '巡岸', tier: 11,
    cry: [{ y: 320, side: 'l' }, { y: 760, side: 'l' }, { y: 540 }, { y: 1000 }], L: [[300, 700]],
    blocks: [{ x: 104, w: 44, h: 105, side: 'l' }, { x: 496, w: 52, h: 105, side: 'r' }], margin: 18,
    movers: [{ kind: 'v', x: 240, y0: 320, y1: 560, w: 56, h: 56, period: 12, phase: 0.1 }],
    roam: { cx: 420, cy: 820, rx: 36, ry: 150, w: 58, h: 58, period: 16,
            pulse: { period: 9, hold: 2.2, amp: 0.6, warn: 1.0 } } },
  { name: '蛰伏 II', tier: 11,
    cry: [{ y: 280, side: 'l' }, { y: 640, side: 'l' }, { y: 980, side: 'l' }, { y: 460 }, { y: 860 }],
    L: [[360, 740]],
    blocks: [{ x: 104, w: 44, h: 100, side: 'l' }, { x: 496, w: 52, h: 100, side: 'r' }], margin: 14,
    roam: { cx: 410, cy: 620, rx: 44, ry: 180, w: 58, h: 58, period: 17,
            pulse: { period: 10, hold: 2.4, amp: 0.65, warn: 1.1 } } },
  { name: '潮生', tier: 11,
    cry: [{ y: 300, side: 'l' }, { y: 820, side: 'l' }, { y: 560 }, { y: 1040 }], L: [[320, 660]],
    blocks: [{ x: 104, w: 44, h: 100, side: 'l' }, { x: 494, w: 52, h: 100, side: 'r' }], margin: 14,
    movers: [{ kind: 'h', y: 420, x0: 250, x1: 410, w: 70, h: 52, period: 12, phase: 0.4 }],
    roam: { cx: 400, cy: 900, rx: 36, ry: 130, w: 56, h: 56, period: 16,
            pulse: { period: 9, hold: 2.2, amp: 0.6, warn: 1.0 } } },

  // ===== 第 12 组（57–60）：综合 =====
  { name: '合流 II', tier: 12,
    cry: [{ y: 300, side: 'l', l: 0 }, { y: 820, side: 'l', l: 0 }, { y: 1020, side: 'l', l: 1 },
          { y: 700, side: 'l', l: 1 }, { y: 500, l: 1 }, { y: 940, l: 0 }],
    L: [[260, 620], [400, 900]],
    blocks: [{ x: 104, w: 44, h: 100, side: 'l', forLight: 0 }, { x: 496, w: 52, h: 100, side: 'r', forLight: 1 },
             { x: 110, w: 44, h: 95, side: 'l', forLight: 1 }], margin: 12,
    movers: [{ kind: 'v', x: 420, y0: 300, y1: 520, w: 56, h: 56, period: 13, phase: 0.25 }] },
  { name: '千影 II', tier: 12,
    cry: [{ y: 280, side: 'l' }, { y: 700, side: 'l' }, { y: 1020, side: 'l' },
          { y: 480 }, { y: 900 }],
    L: [[340, 700]],
    blocks: [{ x: 104, w: 44, h: 95, side: 'l' }, { x: 110, w: 44, h: 95, side: 'l' },
             { x: 496, w: 52, h: 95, side: 'r' }], margin: 12,
    movers: [{ kind: 'orbit', cx: 300, cy: 640, rx: 44, ry: 160, w: 56, h: 56, period: 14, phase: 0.3 }] },
  { name: '长夜', tier: 12,
    cry: [{ y: 300, side: 'l', l: 0 }, { y: 760, side: 'l', l: 1 }, { y: 1000, side: 'l', l: 0 },
          { y: 520, l: 1 }, { y: 940, l: 0 }, { y: 1060, l: 1 }],
    L: [[270, 560], [400, 880]],
    blocks: [{ x: 104, w: 44, h: 95, side: 'l', forLight: 1 }, { x: 496, w: 52, h: 95, side: 'r', forLight: 0 }], margin: 12,
    movers: [
      { kind: 'v', x: 250, y0: 320, y1: 520, w: 54, h: 54, period: 12, phase: 0.15 },
      { kind: 'v', x: 430, y0: 820, y1: 1000, w: 54, h: 54, period: 14, phase: 0.55 }] },
  { name: '尽处 II', tier: 12, tip: '最后一关：两侧、两盏灯、会动的影子',
    cry: [{ y: 300, side: 'l', l: 0 }, { y: 620, side: 'l', l: 1 }, { y: 980, side: 'l', l: 0 },
          { y: 440, l: 1 }, { y: 800, l: 0 }, { y: 1080, l: 1 }],
    L: [[260, 600], [400, 900]],
    blocks: [{ x: 104, w: 44, h: 92, side: 'l', forLight: 0 }, { x: 110, w: 44, h: 92, side: 'l', forLight: 1 },
             { x: 496, w: 52, h: 92, side: 'r', forLight: 0 }, { x: 502, w: 52, h: 92, side: 'r', forLight: 1 }], margin: 10,
    movers: [{ kind: 'v', x: 430, y0: 320, y1: 540, w: 54, h: 54, period: 13, phase: 0.2 }],
    roam: { cx: 300, cy: 700, rx: 40, ry: 160, w: 56, h: 56, period: 18,
            pulse: { period: 11, hold: 2.6, amp: 0.6, warn: 1.2 } } },

];

/* ---------------- 输出 ---------------- */

const rectSrc = (poly) => {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return `rect(${Math.min(...xs)}, ${Math.min(...ys)}, ${Math.max(...xs) - Math.min(...xs)}, ${Math.max(...ys) - Math.min(...ys)})`;
};

const fmt = (n) => Number(n.toFixed(1));

function emit(levels) {
  const parts = [];
  parts.push(`// 由 scripts/gen-levels.mjs 自动生成，不要手改。
// 想调关卡：改生成器里的 RECIPES，然后 ${'`'}node scripts/gen-levels.mjs --write${'`'}。
//
// 每一关都是"先定解、再反推挡板"生成的，所以几何上天然可解；
// 是否好玩（解区大小、是否开局就过）由 scripts/validate-levels.mjs 验收。

import { VIEW, WALL, WALL_L, BOUNDS, BOUNDS_DUAL, HOLD_TIME } from './config.js';

export { VIEW, WALL, WALL_L, BOUNDS, BOUNDS_DUAL, HOLD_TIME };

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

export const LEVELS = [
`);
  for (const lv of levels) {
    const cry = lv.crystals
      .map((c) => `{ x: ${c.x}, y: ${c.y}, lights: [${c.lights.join(', ')}]${c.side === 'l' ? ", side: 'l'" : ''} }`)
      .join(', ');
    const blocks = lv.blocks.map((b) => rectSrc(b)).join(', ');
    const movers = lv.movers.length
      ? lv.movers.map((m) => `{
        shape: [${m.shape.map((p) => `{ x: ${fmt(p.x)}, y: ${fmt(p.y)} }`).join(', ')}],
        path: [${m.path.map((p) => `{ x: ${fmt(p.x)}, y: ${fmt(p.y)} }`).join(', ')}],
        period: ${m.period}, phase: ${m.phase}, mode: '${m.mode}'${m.pulse ? `,
        pulse: { period: ${m.pulse.period}, hold: ${m.pulse.hold}, amp: ${m.pulse.amp}, warn: ${m.pulse.warn} }` : ''},
      }`).join(', ')
      : '';
    parts.push(`  {
    id: ${lv.id}, name: '${lv.name}', tier: ${lv.tier},${lv.tip ? `\n    tip: '${lv.tip}',` : ''}
    lights: [${lv.lights.map((l) => `{ start: { x: ${l.start0.x}, y: ${l.start0.y} }, goal: { x: ${l.goal.x}, y: ${l.goal.y} } }`).join(', ')}],
    crystals: [${cry}],
    blocks: [${blocks}],
    movers: [${movers}],
    hold: ${lv.hold},${lv.multiWall ? `
    bounds: { x0: ${lv.bounds.x0}, x1: ${lv.bounds.x1}, y0: ${lv.bounds.y0}, y1: ${lv.bounds.y1} },` : ''}
    distance: ${lv.distance ? JSON.stringify(lv.distance) : 'null'},
  },`);
  }
  parts.push('];\n');
  return parts.join('\n');
}

/* ---------------- 主流程 ---------------- */

const write = process.argv.includes('--write');
const out = [];
let fail = 0;

RECIPES.forEach((recipe, i) => {
  recipe = { ...recipe };
  let level;
  try {
    level = compile(recipe);
  } catch (e) {
    console.error(`✗ ${String(i + 1).padStart(2)} ${recipe.name}: ${e.message}`);
    fail++;
    return;
  }
  level.id = i + 1;
  out.push(level);

  // 解位置的连续保持时长（移动障碍关卡要确认 3 秒窗口真的存在）
  const positions = level.lights.map((l) => l.goal);
  const hold = holdCheck(level, positions, 99);
  // 有移动障碍时，逐点算完整区域太慢，生成阶段只看解位置能不能保持
  const regions = level.movers.length
    ? level.lights.map(() => ({ count: 0 }))
    : level.lights.map((_, k) => regionForLight(level, k, { step: 5 }));
  const comps = regions.map((r) => (r.count ? components(r) : []));
  const startOk = level.lights.map((l, k) => holdCheck(level, level.lights.map((q) => ({ ...q.start0 }))).ok);

  console.log(
    `${String(i + 1).padStart(2)} ${recipe.name.padEnd(6, '　')} ` +
      `水晶${level.crystals.length} 门${level.blocks.length} 动${level.movers.length} ` +
      `保持${hold.best >= 3 ? '✓' : '✗'}${hold.best === Infinity ? '∞' : hold.best.toFixed(1) + 's'} ` +
      `解区[${regions.map((r) => ((r.count * 25) / 1000).toFixed(1) + 'k').join(' ')}] ` +
      `块[${comps.map((c) => c.length).join(' ')}] ` +
      `${startOk.some(Boolean) ? '⚠️开局已解' : ''}`
  );
  if (hold.best < 3) fail++;
});

if (write) {
  writeFileSync(new URL('../src/levels.js', import.meta.url), emit(out), 'utf8');
  console.log(`\n已写入 src/levels.js（${out.length} 关）`);
} else {
  console.log(`\n共 ${out.length} 关，失败 ${fail} 关。加 --write 写入 src/levels.js`);
}
