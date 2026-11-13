// 关卡求解 / 评估的公共逻辑。
// 生成器（gen-levels.mjs）和校验器（validate-levels.mjs）都调用这里，
// 保证"设计时"和"验收时"用的是同一套判定。

import { isVisibleAt, pointInPolygon } from '../../src/geometry.js';
import { BOUNDS, HOLD_TIME } from '../../src/config.js';

/** 某一盏灯负责的水晶 */
export function crystalsForLight(level, i) {
  return level.crystals.filter((c) => c.lights.includes(i));
}

/** t 时刻，第 i 盏灯在这个位置，能否点亮它负责的全部水晶 */
export function lightSatisfied(level, i, pos, t) {
  for (const c of crystalsForLight(level, i)) {
    if (!isVisibleAt(pos, { x: c.x, y: c.y }, level.blocks, level.movers || [], t)) return false;
  }
  return true;
}

/** t 时刻，整关是否满足（所有灯都照到各自的水晶） */
export function levelSatisfied(level, positions, t) {
  for (let i = 0; i < level.lights.length; i++) {
    if (!lightSatisfied(level, i, positions[i], t)) return false;
  }
  return true;
}

/** 时间采样步长：够密，能抓住移动障碍扫过光路的那一下 */
export const DT = 0.08;

/** 场景周期：所有移动物周期的最小公倍（用最大周期近似即可） */
export function cycleOf(level) {
  const list = [];
  if (level.movers) for (const m of level.movers) list.push(m.period || 6);
  return list.length ? Math.max(...list) : 0;
}

/**
 * 位置组合能否连续保持 hold 秒。
 * 返回 { ok, best }：best 是最长的连续保持时长（秒）。
 */
export function holdCheck(level, positions, hold = HOLD_TIME) {
  const cycle = cycleOf(level);
  if (!cycle) {
    const ok = levelSatisfied(level, positions, 0);
    return { ok, best: ok ? Infinity : 0 };
  }
  const n = Math.ceil(cycle / DT);
  let run = 0;
  let best = 0;
  // 多扫一个周期，保证跨周期边界的连续段也能被找到
  for (let k = 0; k < n * 2; k++) {
    const t = k * DT;
    if (levelSatisfied(level, positions, t)) {
      run += DT;
      if (run > best) best = run;
      if (run >= hold) return { ok: true, best: hold };
    } else {
      run = 0;
    }
  }
  return { ok: false, best };
}

/** 该位置组合最长能保持多久（设计时用） */
export function maxHold(level, positions) {
  return holdCheck(level, positions).best;
}

/**
 * 单盏灯的可解区域（网格）。
 * 返回 Uint8Array + 网格信息，1 表示"在这个点能连续保持 hold 秒"。
 */
export function regionForLight(level, i, { step = 4, hold = HOLD_TIME, base = null } = {}) {
  const B = level.bounds || BOUNDS;
  const cols = Math.floor((B.x1 - B.x0) / step) + 1;
  const rows = Math.floor((B.y1 - B.y0) / step) + 1;
  const mask = new Uint8Array(cols * rows);
  const hasMover = (level.movers || []).length > 0;
  // 其它灯固定在各自的设计解位置上，只扫描第 i 盏灯
  const basePos = base || level.lights.map((l) => l.goal);
  let n = 0;
  for (let j = 0; j < rows; j++) {
    const y = B.y0 + j * step;
    for (let c = 0; c < cols; c++) {
      const x = B.x0 + c * step;
      const positions = basePos.slice();
      positions[i] = { x, y };
      let ok;
      if (hasMover) {
        ok = holdCheck(level, positions, hold).ok;
      } else {
        ok = levelSatisfied(level, positions, 0);
      }
      if (ok) {
        mask[j * cols + c] = 1;
        n++;
      }
    }
  }
  return { mask, cols, rows, step, count: n, area: n * step * step, bounds: B };
}

/** 连通块（4 邻域），按面积从大到小 */
export function components(region) {
  const { mask, cols, rows, step } = region;
  const B = region.bounds || BOUNDS;
  const label = new Int32Array(mask.length).fill(-1);
  const out = [];
  const stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = out.length;
    const c0 = { id, n: 0, sx: 0, sy: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const cur = stack.pop();
      const ci = cur % cols;
      const cj = (cur / cols) | 0;
      const px = B.x0 + ci * step;
      const py = B.y0 + cj * step;
      c0.n++;
      c0.sx += px;
      c0.sy += py;
      if (px < c0.minX) c0.minX = px;
      if (px > c0.maxX) c0.maxX = px;
      if (py < c0.minY) c0.minY = py;
      if (py > c0.maxY) c0.maxY = py;
      const nb = [
        ci > 0 ? cur - 1 : -1,
        ci < cols - 1 ? cur + 1 : -1,
        cj > 0 ? cur - cols : -1,
        cj < rows - 1 ? cur + cols : -1,
      ];
      for (const k of nb) {
        if (k >= 0 && mask[k] && label[k] < 0) {
          label[k] = id;
          stack.push(k);
        }
      }
    }
    out.push(c0);
  }
  out.sort((a, b) => b.n - a.n);
  return out;
}

/** 点是否落在任意遮挡物里（静态 + 移动的初始位置） */
export function pointFree(level, x, y) {
  for (const b of level.blocks) if (pointInPolygon({ x, y }, b)) return false;
  return true;
}

/**
 * 从起点到"可解区域"的最短移动距离（8 邻域 Dijkstra）。
 * 只对静态场景有意义（有移动障碍时"最优距离"依赖时机，不纳入成绩）。
 */
export function shortestDistance(level, i, start, region) {
  const { mask, cols, rows, step } = region;
  const B = region.bounds || BOUNDS;
  const N = cols * rows;
  const dist = new Float64Array(N).fill(Infinity);
  const si = Math.round((start.x - B.x0) / step);
  const sj = Math.round((start.y - B.y0) / step);
  const startIdx = sj * cols + si;
  if (startIdx < 0 || startIdx >= N) return Infinity;

  // 起点若压在方块里，先挪到最近的可走格子
  const free = new Uint8Array(N);
  for (let j = 0; j < rows; j++) {
    for (let c = 0; c < cols; c++) {
      const x = B.x0 + c * step;
      const y = B.y0 + j * step;
      free[j * cols + c] = pointFree(level, x, y) ? 1 : 0;
    }
  }

  let s = startIdx;
  if (!free[s]) {
    let bd = Infinity;
    for (let k = 0; k < N; k++) {
      if (!free[k]) continue;
      const dx = ((k % cols) - si) * step;
      const dy = (((k / cols) | 0) - sj) * step;
      const d = Math.hypot(dx, dy);
      if (d < bd) {
        bd = d;
        s = k;
      }
    }
  }

  // 简单二叉堆
  const heap = [];
  const push = (v, d) => {
    heap.push([v, d]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][1] <= heap[k][1]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][1] < heap[m][1]) m = l;
        if (r < heap.length && heap[r][1] < heap[m][1]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };

  dist[s] = 0;
  push(s, 0);
  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  while (heap.length) {
    const [v, d] = pop();
    if (d > dist[v]) continue;
    const ci = v % cols;
    const cj = (v / cols) | 0;
    for (const [dx, dy, w] of DIRS) {
      const ni = ci + dx;
      const nj = cj + dy;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nv = nj * cols + ni;
      if (!free[nv]) continue;
      const nd = d + w * step;
      if (nd < dist[nv] - 1e-9) {
        dist[nv] = nd;
        push(nv, nd);
      }
    }
  }

  let best = Infinity;
  for (let k = 0; k < N; k++) {
    if (mask[k] && dist[k] < best) best = dist[k];
  }
  return best;
}
