// 运行时关卡：1–24 关做水平镜像（左目标、右操作），25–60 保持生成数据原样。
//
// 只在这里变换一次：渲染、判定、提示、验证器读的都是这份结果，
// 不会出现"画在左边、判定按右边"。

import { LEVELS as RAW, VIEW, WALL, WALL_L, BOUNDS, BOUNDS_DUAL, HOLD_TIME } from './levels.js';
import { mirrorLevel } from './mirror.js';
import { fitLevel } from './fit.js';

/**
 * 沿墙方向（世界 y）统一压缩。
 * 这是本轮的关卡几何调整：把沿墙的内容跨度缩到原来的 0.75，
 * 旋转后缩放就能从 0.76 提到 ~1.15，上下光柱随之拉开约 25%。
 * 仿射变换保持共线与相交关系，所以遮挡/点亮关系不变；难度靠重新校验把关。
 */
export const WALL_SQUASH = 0.75; // 已固化在生成数据里，运行时不再重复压缩
const CY = 640;

function squashY(level) {
  const k = WALL_SQUASH;
  const f = (y) => CY + (y - CY) * k;
  const squashMover = (m) => ({
    ...m,
    path: (m.path || []).map((p) => ({ ...p, y: f(p.y) })),
    shape: (m.shape || []).map((p) => ({ ...p, y: p.y * k })),
  });
  return {
    ...level,
    squashed: true,
    crystals: (level.crystals || []).map((c) => ({ ...c, y: f(c.y) })),
    blocks: (level.blocks || []).map((poly) => poly.map((p) => ({ ...p, y: f(p.y) }))),
    movers: (level.movers || []).map(squashMover),
    lights: (level.lights || []).map((l) => ({
      ...l,
      start: { ...l.start, y: f(l.start.y) },
      start0: l.start0 ? { ...l.start0, y: f(l.start0.y) } : l.start0,
      goal: l.goal ? { ...l.goal, y: f(l.goal.y) } : l.goal,
    })),
    bounds: level.bounds ? { ...level.bounds, y0: f(level.bounds.y0), y1: f(level.bounds.y1) } : level.bounds,
    distance: level.distance || null,
  };
}

export { VIEW, WALL, WALL_L, BOUNDS, BOUNDS_DUAL, HOLD_TIME };

/** 默认镜像到第几关（含） */
export const MIRROR_THROUGH = 24;

// 展示层改名：墙面从左右变上下后，个别关卡名不再贴切（不改数据，只改显示）
const RENAME = { 39: '上下' };

export const LEVELS = RAW.map((l) => {
  const base = l.id <= MIRROR_THROUGH ? mirrorLevel(l) : l;
  const squashed = base;
  const fit = fitLevel(squashed, squashed.bounds || BOUNDS);
  const out = {
    ...squashed,
    bounds: fit.bounds,
    fitBox: fit.fitBox,
    lights: fit.lights.length ? fit.lights : squashed.lights,
  };
  return RENAME[l.id] ? { ...out, name: RENAME[l.id] } : out;
});

export const LEVEL_COUNT = LEVELS.length;
