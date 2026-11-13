// 极简 2D 几何 / 光照求交。
// 全部坐标使用逻辑坐标（720 x 1280 竖屏），与真实像素无关。

export const EPS = 1e-6;

/* ---------------- 向量 ---------------- */

export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function norm(a) {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
}

/* ---------------- 基础判定 ---------------- */

/** 线段求交。返回沿 a->b 的参数 t、沿 c->d 的 u，以及交点。 */
export function segIntersect(a, b, c, d) {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null; // 平行 / 共线
  const qp = sub(c, a);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: a.x + r.x * t, y: a.y + r.y * t };
}

/** 射线法判断点是否在多边形内。 */
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

export function closestPointOnSegment(p, a, b) {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  if (l2 < EPS) return { ...a };
  let t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2;
  t = clamp(t, 0, 1);
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

export function centroid(poly) {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/** 多边形整体是否连接（这里假设输入都是简单的实心多边形）。 */

/* ---------------- 光照 ---------------- */

/**
 * 从光源 L 出发、穿过点 P 的射线，打到 x = wallX 的墙上的 y 坐标。
 * 若射线不朝墙（P 在光源背后），返回 null。
 */
export function projectToWall(L, P, wallX) {
  const dx = P.x - L.x;
  if (dx < EPS) return null; // 只处理朝右的投影
  const t = (wallX - L.x) / dx;
  if (t <= 0) return null;
  return L.y + (P.y - L.y) * t;
}

/** 左侧墙的投影：只处理朝左的射线 */
export function projectToWallL(L, P, wallX) {
  const dx = P.x - L.x;
  if (dx > -EPS) return null; // 只处理朝左的投影
  const t = (wallX - L.x) / dx;
  if (t <= 0) return null;
  return L.y + (P.y - L.y) * t;
}

/** Sutherland–Hodgman：保留 x <= maxX 的部分。 */
export function clipMaxX(poly, maxX) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ain = a.x <= maxX;
    const bin = b.x <= maxX;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (maxX - a.x) / (b.x - a.x);
      out.push({ x: maxX, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Sutherland–Hodgman：保留 x >= minX 的部分。 */
export function clipMinX(poly, minX) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ain = a.x >= minX;
    const bin = b.x >= minX;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (minX - a.x) / (b.x - a.x);
      out.push({ x: minX, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/**
 * 一个遮挡物在墙上的投影区间（影子的上沿 / 下沿）。
 * 光源背后的部分不投影，先按 x > L.x 裁掉。
 */
export function shadowInterval(L, poly, wallX) {
  const clipped = clipMinX(poly, L.x + 8);
  if (clipped.length < 3) return null;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of clipped) {
    const y = projectToWall(L, p, wallX);
    if (y === null) continue;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!isFinite(y0) || !isFinite(y1)) return null;
  return { y0, y1 };
}

/**
 * 在任意一面墙上求影子区间：墙在光源右边走右向投影，在左边走左向投影。
 * 墙在光源"背后"时返回 null（这块遮挡物对那面墙不投影）。
 */
export function shadowIntervalOn(L, poly, wallX) {
  if (wallX > L.x + 1) return shadowInterval(L, poly, wallX);
  if (wallX < L.x - 1) {
    const clipped = clipMaxX(poly, L.x - 8);
    if (clipped.length < 3) return null;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of clipped) {
      const y = projectToWallL(L, p, wallX);
      if (y === null) continue;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (!isFinite(y0) || !isFinite(y1)) return null;
    return { y0, y1 };
  }
  return null;
}

/**
 * 从 from 向 to 投射一条光线，返回最近的遮挡点。
 * 端点附近的极短线段会被忽略，避免贴边误判。
 */
export function castRay(from, to, polys) {
  let best = null;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const hit = segIntersect(from, to, poly[i], poly[(i + 1) % poly.length]);
      if (!hit) continue;
      if (hit.t < 1e-4 || hit.t > 1 - 1e-4) continue;
      if (!best || hit.t < best.t) best = hit;
    }
  }
  return best;
}

/** 目标点是否被直接照亮（视线无遮挡）。 */
export function isVisible(L, target, polys) {
  return castRay(L, target, polys) === null;
}

/** 从 L 到 target 的可见射线终点：被挡住就是遮挡点，否则是目标点。 */
export function rayEnd(L, target, polys) {
  const hit = castRay(L, target, polys);
  return hit ? { x: hit.x, y: hit.y, blocked: true } : { x: target.x, y: target.y, blocked: false };
}

/**
 * 把光源位置限制在可拖拽区域内，并且不允许待在遮挡物里面。
 * prev 是上一帧的合法位置，用来兜底防穿透。
 */
export function resolveLight(p, prev, bounds, polys) {
  let q = {
    x: clamp(p.x, bounds.x0, bounds.x1),
    y: clamp(p.y, bounds.y0, bounds.y1),
  };
  for (const poly of polys) {
    if (!pointInPolygon(q, poly)) continue;
    // 顶到最近的多边形边上，再沿法线推出几像素
    let best = null;
    let bd = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const cp = closestPointOnSegment(q, poly[i], poly[(i + 1) % poly.length]);
      const d = dist(cp, q);
      if (d < bd) {
        bd = d;
        best = cp;
      }
    }
    const c = centroid(poly);
    const dir = norm(sub(best, c));
    q = add(best, mul(dir, 3));
  }
  // 推出后如果仍然在别的块里，就退回上一帧
  for (const poly of polys) {
    if (pointInPolygon(q, poly)) return { ...prev };
  }
  return q;
}

/* ---------------- 移动遮挡物 ---------------- */

/** 把路径预编译成累计长度，每帧调用时不用重算 */
export function compilePath(mover) {
  if (mover._path) return mover._path;
  const pts = mover.path;
  const seg = [];
  let total = 0;
  const closed = mover.mode !== 'pingpong' || pts.length > 2;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const l = dist(a, b);
    seg.push({ a, b, l, s0: total });
    total += l;
  }
  mover._path = { seg, total };
  return mover._path;
}

/** 轨迹上按弧长取点。mode: loop 循环；pingpong 往返 */
export function pathPoint(mover, t) {
  const { seg, total } = compilePath(mover);
  if (!seg.length || total <= 0) return { x: 0, y: 0 };
  const period = mover.period || 6;
  let u = (t / period + (mover.phase || 0)) % 1;
  if (u < 0) u += 1;
  if (mover.mode === 'pingpong') {
    // 三角波：0->1->0
    const tri = u < 0.5 ? u * 2 : (1 - u) * 2;
    u = tri;
  }
  const s = u * total;
  for (const sg of seg) {
    if (s <= sg.s0 + sg.l || sg === seg[seg.length - 1]) {
      const k = sg.l > 0 ? (s - sg.s0) / sg.l : 0;
      return { x: sg.a.x + (sg.b.x - sg.a.x) * k, y: sg.a.y + (sg.b.y - sg.a.y) * k };
    }
  }
  return { ...seg[0].a };
}

/**
 * 周期性胀大。返回 { scale, warn }：
 * scale 用在本帧的多边形上，warn 是"下一次胀大前的预警强度" 0..1。
 */
export function pulseAt(pulse, t) {
  if (!pulse) return { scale: 1, warn: 0, phase: 0 };
  const T = pulse.period || 6;
  const hold = pulse.hold ?? T * 0.45;
  const ramp = pulse.ramp ?? 0.25;
  const warnT = pulse.warn ?? 0.6;
  const ph = ((t % T) + T) % T;
  let scale = 1;
  if (ph < ramp) scale = 1 + pulse.amp * (ph / ramp);
  else if (ph < hold) scale = 1 + pulse.amp;
  else if (ph < hold + ramp) scale = 1 + pulse.amp * (1 - (ph - hold) / ramp);
  const before = (T - ph) % T;
  const warn = before < warnT && before > 1e-6 ? 1 - before / warnT : 0;
  return { scale, warn, phase: ph / T };
}

/** 取移动遮挡物在 t 时刻的世界坐标多边形 */
export function moverPoly(mover, t) {
  const c = pathPoint(mover, t);
  // 轨迹中心偏移：shape 的局部原点默认对应 path 上的点
  const { scale } = pulseAt(mover.pulse, t);
  const k = scale;
  const out = new Array(mover.shape.length);
  for (let i = 0; i < mover.shape.length; i++) {
    const p = mover.shape[i];
    out[i] = { x: c.x + p.x * k, y: c.y + p.y * k };
  }
  return out;
}

/** 当前时刻参与遮挡的全部多边形 */
export function scenePolys(blocks, movers, t) {
  const out = blocks.slice();
  if (movers) for (const m of movers) out.push(moverPoly(m, t));
  return out;
}

/** 光在 t 时刻是否照到目标（要考虑移动遮挡物） */
export function isVisibleAt(L, target, blocks, movers, t) {
  for (const b of blocks) {
    if (castRay(L, target, [b])) return false;
  }
  if (movers) {
    for (const m of movers) {
      if (castRay(L, target, [moverPoly(m, t)])) return false;
    }
  }
  return true;
}
