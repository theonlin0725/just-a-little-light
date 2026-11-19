// 定向光束 / 棱镜 / 滤镜 / 合光晶格 的纯几何核心。
//
// 设计约束：
//   * 不碰 DOM / Canvas / wx，浏览器、微信小游戏、Node 求解器共用同一份代码；
//   * 渲染和判定都读 traceScene() 的同一份结果，避免“画亮了但没判定上”；
//   * 坐标沿用 720 x 1280 竖屏逻辑坐标，y 向下，角度单位为度：0 = 向右，-90 = 向上。
//
// 颜色采用本作约定的 3-bit RYB 掩码（不是物理光谱）：
//   红 001、黄 010、蓝 100；红+黄=橙 011、红+蓝=紫 101、黄+蓝=绿 110、三色=白 111。
// 滤镜是“只放行自己的位”：out = in & filter；合光是按位或：mixed = a | b。

import { clamp, pointInPolygon, segIntersect } from './geometry.js';

/* ---------------- 颜色 ---------------- */

export const COLOR = {
  NONE: 0b000,
  RED: 0b001,
  YELLOW: 0b010,
  BLUE: 0b100,
  ORANGE: 0b011,
  PURPLE: 0b101,
  GREEN: 0b110,
  WHITE: 0b111,
};

export const COLOR_NAMES = {
  0: '无光',
  1: '红',
  2: '黄',
  3: '橙',
  4: '蓝',
  5: '紫',
  6: '绿',
  7: '白',
};

const MASK_BY_NAME = {
  none: 0,
  red: 1,
  yellow: 2,
  blue: 4,
  orange: 3,
  purple: 5,
  green: 6,
  white: 7,
};

/** 把数字 / 颜色名 / 颜色对象统一成 3-bit 掩码 */
export function toMask(value, fallback = COLOR.NONE) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') return value & 0b111;
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase();
    if (key in MASK_BY_NAME) return MASK_BY_NAME[key];
  }
  if (typeof value === 'object' && typeof value.mask === 'number') return value.mask & 0b111;
  return fallback;
}

export function colorName(mask) {
  return COLOR_NAMES[mask & 0b111] || '无光';
}

/** 同一目标/合光晶格收到多束光时的合成色 */
export function mixColors(colors) {
  let out = 0;
  for (const c of colors || []) out |= toMask(c);
  return out & 0b111;
}

/** 滤镜透射：只保留滤镜允许的位；0 表示被吸收截断 */
export function applyFilter(color, filter) {
  return toMask(color) & toMask(filter);
}

/** 白色通用水晶/机关接受任意色光；纯白目标要求 111；彩色目标要求精确匹配 */
export function acceptsColor(target, mixed) {
  const mask = toMask(mixed);
  if (!mask) return false;
  const required = toMask(target && target.requiredColor, COLOR.WHITE);
  const acceptAny = target && target.acceptAny !== undefined ? !!target.acceptAny : required === COLOR.WHITE;
  return acceptAny ? mask > 0 : mask === required;
}

/** 用于 UI / 色盲符号：每种颜色一个形状名 */
export function colorGlyph(mask) {
  switch (mask & 0b111) {
    case COLOR.RED: return '△';
    case COLOR.YELLOW: return '✦';
    case COLOR.BLUE: return '◇';
    case COLOR.ORANGE: return '☀';
    case COLOR.PURPLE: return '✡';
    case COLOR.GREEN: return '❖';
    case COLOR.WHITE: return '○';
    default: return '·';
  }
}

const RGB_BY_BIT = [
  [COLOR.RED, [255, 104, 96]],
  [COLOR.YELLOW, [255, 211, 110]],
  [COLOR.BLUE, [116, 178, 255]],
];

/** 颜色掩码 -> 近似 RGB；用于 Canvas，不参与判定 */
export function colorRgb(mask) {
  const m = toMask(mask);
  if (!m) return [180, 190, 205];
  if (m === COLOR.WHITE) return [255, 246, 222];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const [bit, rgb] of RGB_BY_BIT) {
    if (!(m & bit)) continue;
    r += rgb[0];
    g += rgb[1];
    b += rgb[2];
    n++;
  }
  if (!n) return [255, 246, 222];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

export function colorCss(mask, alpha = 1) {
  const [r, g, b] = colorRgb(mask);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ---------------- 向量 / 射线 ---------------- */

export const EPS = 1e-5;
export const DEFAULT_BOUNDS = { x0: 0, y0: 0, x1: 720, y1: 1280 };
export const DEFAULT_RADIUS = 28;

export function angleToDir(deg) {
  const r = (deg * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
}

export function dirToAngle(dir) {
  return (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
}

export function normDir(dir) {
  const l = Math.hypot(dir.x, dir.y) || 1;
  return { x: dir.x / l, y: dir.y / l };
}

export function rotateDir(dir, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c };
}

/** 关于一条过原点、方向为 lineAngle 的直线做镜面反射 */
export function reflectAcross(dir, lineAngle) {
  const m = angleToDir(lineAngle);
  const d = 2 * (dir.x * m.x + dir.y * m.y);
  return normDir({ x: d * m.x - dir.x, y: d * m.y - dir.y });
}

export function pointAt(origin, dir, t) {
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
}

/** 射线与圆的最近正向交点距离；起点在圆内时返回出射点 */
export function rayCircle(origin, dir, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const b = ox * dir.x + oy * dir.y;
  const c = ox * ox + oy * oy - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t <= EPS) t = -b + s;
  return t > EPS ? t : null;
}

const FAR = 4000;

/** 射线与多边形边的最近交点；起点在多边形内时忽略（避免自遮挡死循环） */
export function rayPolygon(origin, dir, poly) {
  if (!poly || poly.length < 3) return null;
  if (pointInPolygon(origin, poly)) return null;
  const end = { x: origin.x + dir.x * FAR, y: origin.y + dir.y * FAR };
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const hit = segIntersect(origin, end, a, b);
    if (!hit) continue;
    const t = hit.t * FAR;
    if (t <= EPS) continue;
    if (!best || t < best.t) best = { t, x: hit.x, y: hit.y };
  }
  return best;
}

/** 射线离开矩形边界的距离；没有交点返回 null */
export function rayBoundsExit(origin, dir, bounds = DEFAULT_BOUNDS) {
  const B = bounds || DEFAULT_BOUNDS;
  let best = null;
  const consider = (t) => {
    if (t > EPS && (!best || t < best)) best = t;
  };
  if (Math.abs(dir.x) > EPS) {
    consider((B.x0 - origin.x) / dir.x);
    consider((B.x1 - origin.x) / dir.x);
  }
  if (Math.abs(dir.y) > EPS) {
    consider((B.y0 - origin.y) / dir.y);
    consider((B.y1 - origin.y) / dir.y);
  }
  return best;
}

/* ---------------- 元件形状 ---------------- */

export function elementRadius(el) {
  return (el && el.r) || DEFAULT_RADIUS;
}

export function polyOf(block) {
  if (!block) return null;
  return Array.isArray(block) ? block : block.poly;
}

function rotatePoint(p, angle) {
  const r = angleToDir(angle);
  return { x: p.x * r.x - p.y * r.y, y: p.x * r.y + p.y * r.x };
}

/** 棱镜的绘制轮廓（圆内接多边形，光学命中仍用圆，保证手机容错） */
export function prismShape(prism) {
  const r = elementRadius(prism);
  const kind = prism.kind || 'deflect45R';
  let base;
  if (kind === 'splitter') {
    base = [{ x: r, y: 0 }, { x: 0, y: r }, { x: -r, y: 0 }, { x: 0, y: -r }];
  } else if (kind === 'reflect90') {
    base = [{ x: r, y: 0 }, { x: -r, y: r }, { x: -r, y: -r }];
  } else if (kind === 'dispersion') {
    base = [{ x: r, y: 0 }, { x: -r * 0.62, y: r * 0.84 }, { x: -r * 0.62, y: -r * 0.84 }];
  } else {
    base = [{ x: r, y: 0 }, { x: -r * 0.72, y: r * 0.72 }, { x: -r * 0.72, y: -r * 0.72 }];
  }
  const angle = prism.angle || 0;
  return base.map((p) => {
    const q = rotatePoint(p, angle);
    return { x: prism.x + q.x, y: prism.y + q.y };
  });
}

/* ---------------- 单条射线 ---------------- */

function isIgnored(ignore, el) {
  return !!(el && el.id !== undefined && ignore.has(el.id));
}

function hitPoint(origin, dir, t) {
  return pointAt(origin, dir, t);
}

function nearestHit(scene, origin, dir, ignore) {
  let best = null;
  const consider = (t, kind, el) => {
    if (t <= EPS) return;
    if (!best || t < best.t) best = { t, kind, el, point: hitPoint(origin, dir, t) };
  };

  for (const block of scene.blocks || []) {
    if (block && block.enabled === false) continue;
    const poly = polyOf(block);
    const hit = rayPolygon(origin, dir, poly);
    if (hit) consider(hit.t, 'block', block);
  }

  for (const prism of scene.prisms || []) {
    if (isIgnored(ignore, prism)) continue;
    const t = rayCircle(origin, dir, prism, elementRadius(prism));
    if (t) consider(t, 'prism', prism);
  }

  for (const filter of scene.filters || []) {
    if (isIgnored(ignore, filter)) continue;
    const t = rayCircle(origin, dir, filter, elementRadius(filter));
    if (t) consider(t, 'filter', filter);
  }

  for (const crystal of scene.crystals || []) {
    if (isIgnored(ignore, crystal)) continue;
    const t = rayCircle(origin, dir, crystal, elementRadius(crystal));
    if (t) consider(t, 'crystal', crystal);
  }

  for (const gate of scene.gates || []) {
    if (isIgnored(ignore, gate)) continue;
    const t = rayCircle(origin, dir, gate, elementRadius(gate));
    if (t) consider(t, 'gate', gate);
  }

  for (const combiner of scene.combiners || []) {
    if (isIgnored(ignore, combiner)) continue;
    const t = rayCircle(origin, dir, combiner, elementRadius(combiner));
    if (t) consider(t, 'combiner', combiner);
  }

  return best;
}

/**
 * 棱镜对入射光的作用。
 * 返回子射线方向/颜色数组；空数组表示被吸收。
 */
export function prismChildren(prism, dir, color) {
  const kind = prism.kind || 'deflect45R';
  if (kind === 'deflect45L') {
    return [{ dir: rotateDir(dir, -45), color }];
  }
  if (kind === 'deflect45R') {
    return [{ dir: rotateDir(dir, 45), color }];
  }
  if (kind === 'reflect90') {
    // 镜面线由 prism.angle 给出；从“背面”射入会被暗背吸收。
    const frontNormal = angleToDir((prism.angle || 0) + 90);
    if (dir.x * frontNormal.x + dir.y * frontNormal.y > 0) return [];
    return [{ dir: reflectAcross(dir, prism.angle || 0), color }];
  }
  if (kind === 'splitter') {
    const side = reflectAcross(dir, prism.angle || 0);
    return [
      { dir, color },
      { dir: side, color },
    ];
  }
  if (kind === 'dispersion') {
    const parts = [
      { bit: COLOR.RED, deg: -25 },
      { bit: COLOR.YELLOW, deg: 0 },
      { bit: COLOR.BLUE, deg: 25 },
    ];
    return parts
      .filter((p) => color & p.bit)
      .map((p) => ({ dir: rotateDir(dir, p.deg), color: p.bit }));
  }
  return [{ dir, color }];
}

/**
 * 追踪一条射线，返回本段线段、命中的目标、合光输入和待处理的子射线。
 * 子射线由 traceScene 统一排队，保证分光/色散的多条路径都能被统计。
 */
export function traceRay(scene, ray, opts = {}) {
  const maxBounces = opts.maxBounces ?? scene.maxBounces ?? 4;
  const bounds = scene.bounds || DEFAULT_BOUNDS;
  const segments = [];
  const targets = [];
  const combinerHits = [];
  const next = [];

  let origin = { x: ray.origin.x, y: ray.origin.y };
  let dir = normDir(ray.dir);
  let color = toMask(ray.color, COLOR.WHITE);
  let bounces = ray.bounces || 0;
  const ignore = new Set(ray.ignore || []);

  for (let guard = 0; guard < 48; guard++) {
    const hit = nearestHit(scene, origin, dir, ignore);
    if (!hit) {
      const t = rayBoundsExit(origin, dir, bounds);
      const end = t ? pointAt(origin, dir, t) : pointAt(origin, dir, 2000);
      if (color) segments.push({ from: origin, to: end, color, kind: 'beam' });
      break;
    }

    if (hit.kind !== 'block') {
      segments.push({
        from: origin,
        to: hit.point,
        color,
        kind: 'beam',
        hit: { kind: hit.kind, id: hit.el && hit.el.id },
      });
    } else if (color) {
      segments.push({ from: origin, to: hit.point, color, kind: 'beam' });
    }

    if (hit.kind === 'block') break;

    if (hit.kind === 'crystal') {
      targets.push({ type: 'crystal', id: hit.el.id, color, point: hit.point });
      if (!hit.el.passThrough) break;
      origin = hit.point;
      ignore.add(hit.el.id);
      continue;
    }

    if (hit.kind === 'gate') {
      targets.push({ type: 'gate', id: hit.el.id, color, point: hit.point });
      if (!hit.el.passThrough) break;
      origin = hit.point;
      ignore.add(hit.el.id);
      continue;
    }

    if (hit.kind === 'combiner') {
      combinerHits.push({ id: hit.el.id, color, point: hit.point });
      break;
    }

    if (hit.kind === 'filter') {
      const out = applyFilter(color, hit.el.color);
      if (!out) {
        segments.push({ from: hit.point, to: hit.point, color: 0, kind: 'absorb', id: hit.el.id });
        break;
      }
      color = out;
      origin = hit.point;
      ignore.add(hit.el.id);
      continue;
    }

    if (hit.kind === 'prism') {
      if (bounces >= maxBounces) {
        segments.push({ from: hit.point, to: hit.point, color: 0, kind: 'absorb', id: hit.el.id });
        break;
      }
      const children = prismChildren(hit.el, dir, color);
      if (!children.length) {
        segments.push({ from: hit.point, to: hit.point, color: 0, kind: 'absorb', id: hit.el.id });
        break;
      }
      const childIgnore = new Set(ignore);
      childIgnore.add(hit.el.id);
      const center = { x: hit.el.x, y: hit.el.y };
      const radius = elementRadius(hit.el);
      for (const child of children) {
        const dirChild = normDir(child.dir);
        // 从入射边走到出射边：出射点按新方向落在圆上，
        // 这样分光/折反的下一段从晶体边缘出发，不会因为“从入射点拐弯”而整体偏移。
        const exit = pointAt(center, dirChild, radius);
        segments.push({
          from: hit.point,
          to: exit,
          color: child.color,
          kind: 'inside',
          id: hit.el.id,
        });
        next.push({
          origin: exit,
          dir: dirChild,
          color: child.color,
          bounces: bounces + 1,
          ignore: childIgnore,
          source: ray.source,
        });
      }
      break;
    }
  }

  return { segments, targets, combinerHits, next };
}

/* ---------------- 整场景 ---------------- */

function aggregateTargets(scene, targets) {
  const byCrystal = new Map();
  const byGate = new Map();
  for (const t of targets) {
    if (t.type === 'crystal') {
      if (!byCrystal.has(t.id)) byCrystal.set(t.id, []);
      byCrystal.get(t.id).push(t);
    } else if (t.type === 'gate') {
      if (!byGate.has(t.id)) byGate.set(t.id, []);
      byGate.get(t.id).push(t);
    }
  }

  const crystals = (scene.crystals || []).map((c) => {
    const hits = byCrystal.get(c.id) || [];
    const colors = hits.map((h) => h.color);
    const mixed = mixColors(colors);
    return {
      id: c.id,
      colors,
      mixed,
      ok: hits.length > 0 && acceptsColor(c, mixed),
      hits,
    };
  });

  const gates = (scene.gates || []).map((g) => {
    const hits = byGate.get(g.id) || [];
    const colors = hits.map((h) => h.color);
    const mixed = mixColors(colors);
    return {
      id: g.id,
      colors,
      mixed,
      ok: hits.length > 0 && acceptsColor(g, mixed),
      hits,
    };
  });

  return { crystals, gates };
}

/**
 * 追踪整个场景：多光源、分光/色散产生的子射线、合光晶格的多级输出。
 * 返回的 rays / crystals / gates / combiners 都是渲染与判定共用的结果。
 */
export function traceScene(scene, opts = {}) {
  const maxBounces = opts.maxBounces ?? scene.maxBounces ?? 4;
  const maxRays = opts.maxRays ?? 256;
  const pending = (scene.lights || []).map((light) => ({
    origin: { x: light.x, y: light.y },
    dir: angleToDir(light.angle ?? 0),
    color: toMask(light.color, COLOR.WHITE),
    bounces: 0,
    ignore: new Set(),
    source: light.id,
  }));

  const rays = [];
  const targets = [];
  const combinerInputs = new Map();
  const emitted = new Set();
  const combiners = [];
  let queue = pending;
  let round = 0;

  while (queue.length && rays.length < maxRays && round <= maxBounces + 4) {
    const next = [];
    for (const ray of queue) {
      if (rays.length >= maxRays) break;
      const res = traceRay(scene, ray, { maxBounces });
      rays.push(...res.segments);
      targets.push(...res.targets);
      for (const hit of res.combinerHits) {
        if (!combinerInputs.has(hit.id)) combinerInputs.set(hit.id, []);
        combinerInputs.get(hit.id).push(hit.color);
      }
      next.push(...res.next);
    }

    for (const combiner of scene.combiners || []) {
      const inputs = combinerInputs.get(combiner.id) || [];
      const minInputs = combiner.minInputs ?? 2;
      if (inputs.length < minInputs || emitted.has(combiner.id)) continue;
      emitted.add(combiner.id);
      const mixed = mixColors(inputs);
      if (!mixed) continue;
      combiners.push({
        id: combiner.id,
        inputs: inputs.slice(),
        color: mixed,
        point: { x: combiner.x, y: combiner.y },
      });
      next.push({
        origin: { x: combiner.x, y: combiner.y },
        dir: angleToDir(combiner.outAngle ?? 0),
        color: mixed,
        bounces: round + 1,
        ignore: new Set([combiner.id]),
        source: `combiner:${combiner.id}`,
      });
    }

    queue = next;
    round++;
  }

  const aggregated = aggregateTargets(scene, targets);
  return {
    rays,
    targets,
    crystals: aggregated.crystals,
    gates: aggregated.gates,
    combiners,
    combinerInputs,
    rounds: round,
    lit: aggregated.crystals.filter((c) => c.ok).length,
    allLit: aggregated.crystals.length > 0 && aggregated.crystals.every((c) => c.ok),
  };
}

/** 便捷函数：只关心是否所有水晶都亮 */
export function sceneSolved(scene, opts) {
  return traceScene(scene, opts).allLit;
}

/** 软磁吸：把拖动中的元件位置向最近的有效光路交点靠拢 */
export function snapToPoint(point, target, radius = 8) {
  if (!target) return { ...point, snapped: false, distance: Infinity };
  const d = Math.hypot(point.x - target.x, point.y - target.y);
  return d <= radius ? { x: target.x, y: target.y, snapped: true, distance: d } : { ...point, snapped: false, distance: d };
}

/** 角度限制在 [min, max]，用于摇杆扇区 */
export function clampAngle(deg, range) {
  if (!range) return deg;
  let v = ((deg + 180) % 360 + 360) % 360 - 180;
  const [min, max] = range;
  if (min <= max) return clamp(v, min, max);
  // 跨 ±180 的扇区
  if (v >= min || v <= max) return v;
  return Math.abs(v - min) < Math.abs(v - max) ? min : max;
}
