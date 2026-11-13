// 关卡水平镜像：把"左侧目标、右侧操作"的世界反射到右边。
//
// 只镜像游戏世界内容（灯、水晶、挡板、动态轨迹、边界、墙），
// 不碰任何 UI 坐标；运行时只做一次，渲染和判定读同一份镜像结果。
//
// 反射轴 x = VIEW.w / 2 = 360。

import { VIEW, WALL, BOUNDS } from './levels.js';

const W = VIEW.w;

/** 点关于画布中线的反射 */
export function mirrorX(p) {
  return { ...p, x: W - p.x };
}

/** 多边形镜像后顶点顺序会反，必须倒序保持绕序一致 */
function mirrorPoly(poly) {
  return poly.map((p) => ({ ...p, x: W - p.x })).reverse();
}

/** 镜像后的墙几何：右墙 582/566 变成 138/114，宽度不变 */
export function mirrorWall(wall) {
  return {
    ...wall,
    cx: W - wall.cx,
    x: W - wall.x - wall.w,
  };
}

export const WALL_MIRRORED = mirrorWall(WALL);

/**
 * 镜像一关。纯函数，不改输入。
 * @param {object} level
 */
export function mirrorLevel(level) {
  const out = {
    ...level,
    mirrored: true,
    lights: (level.lights || []).map((l) => ({
      ...l,
      start: mirrorX(l.start),
      goal: l.goal ? mirrorX(l.goal) : l.goal,
    })),
    crystals: (level.crystals || []).map((c) => ({
      ...c,
      x: W - c.x,
      // 原来贴在右墙的水晶，镜像后贴在左墙
      side: c.side === 'r' ? 'l' : c.side === 'l' ? 'r' : 'l',
    })),
    blocks: (level.blocks || []).map(mirrorPoly),
    movers: (level.movers || []).map((m) => {
      // 丢掉预编译缓存（_path 等），否则镜像后仍按旧坐标运动
      const { _path, ...rest } = m;
      return {
      ...rest,
      // 轨迹是"世界坐标"，取反射
      path: (m.path || []).map((p) => ({ ...p, x: W - p.x })),
      // 局部形状是"相对坐标"，只翻转 x，不能再用 W - x
      shape: (m.shape || []).map((p) => ({ ...p, x: -p.x })).reverse(),
      };
    }),
    // 单侧墙：镜像后目标墙在左边
    wallL: WALL_MIRRORED,
    wallR: null,
  };

  // 没写 bounds 的关卡用默认单侧范围，镜像后同样要反射
  const base = level.bounds || BOUNDS;
  out.bounds = { ...base, x0: W - base.x1, x1: W - base.x0 };
  return out;
}

/** 镜像是否可逆（自检用） */
export function isInvolutive(level) {
  return JSON.stringify(mirrorLevel(mirrorLevel(level))) === JSON.stringify({ ...level, wallL: null, wallR: null });
}
