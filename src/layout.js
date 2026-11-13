// 呈现布局：把游戏世界"旋转 90°"放进竖屏。
//
// 关键决定：**不改关卡数据和判定逻辑**。
// 世界仍然是 720×1280 的逻辑坐标（墙是竖的、光从左/右照），
// 只在绘制时整体旋转 90° 并铺到屏幕上方的一条"玩法带"里，
// 触摸再用同一个变换的逆变换映射回逻辑坐标。
// 这样几何、遮挡、3 秒判定、距离成绩都没有任何变化。

import { VIEW } from './levels.js';

// 世界内容的外接框（墙 + 水晶 + 可拖拽区都在这之内）
export const SCENE_BOX = { x0: 34, y0: 168, x1: 622, y1: 1112 };

/** 旋转后内容尺寸：宽 = 世界高，高 = 世界宽 */
const ROT_W = SCENE_BOX.y1 - SCENE_BOX.y0; // 944
const ROT_H = SCENE_BOX.x1 - SCENE_BOX.x0; // 588

/**
 * 计算玩法带的位置。
 * 玩法带宽度铺满 720，高度按等比缩放（≈448），垂直居中在 HUD 与底栏之间。
 */
export function computeSceneLayout(view = VIEW, box = SCENE_BOX) {
  const along = Math.max(120, box.y1 - box.y0); // 沿墙方向 → 屏幕宽
  const perp = Math.max(120, box.x1 - box.x0); // 垂直于墙 → 屏幕高
  const top = 128; // HUD 下沿
  const bottom = 1000; // 读秒条/说明之上
  const maxH = bottom - top;
  const sideMargin = 40; // 左右各留 40，内容不贴屏幕边
  const s = Math.min((view.w - sideMargin * 2) / along, maxH / perp, 1.22);
  const bandH = perp * s;
  const bandY = Math.round(top + (maxH - bandH) / 2);
  return { scale: s, band: { x: sideMargin - (along * s - (view.w - sideMargin * 2)) / 2 - sideMargin + sideMargin, y: bandY, w: view.w, h: bandH }, box, along, perp, sideMargin };
}

/**
 * 旋转方向：让"目标墙"落在玩法带上沿。
 * 墙在世界左侧（x 小）→ 顺时针；墙在世界右侧（x 大）→ 逆时针。
 */
export function resolveDir(level) {
  const cs = (level && level.crystals) || [];
  if (!cs.length) return 'cw';
  const left = cs.filter((c) => c.side === 'l').length;
  const right = cs.length - left;
  if (left === 0 && right > 0) return 'ccw'; // 只有右墙
  return 'cw';
}

/** 逻辑坐标 → 屏幕坐标 */
export function sceneToScreen(p, L = computeSceneLayout(), dir = 'cw') {
  const B = L.box || SCENE_BOX;
  const u = dir === 'ccw' ? p.y - B.y0 : B.y1 - p.y;
  const v = dir === 'ccw' ? B.x1 - p.x : p.x - B.x0;
  return { x: L.band.x + u * L.scale, y: L.band.y + v * L.scale };
}

/** 屏幕坐标 → 逻辑坐标（逆变换）*/
export function screenToScene(p, L = computeSceneLayout(), dir = 'cw') {
  const B = L.box || SCENE_BOX;
  const u = (p.x - L.band.x) / L.scale;
  const v = (p.y - L.band.y) / L.scale;
  return dir === 'ccw'
    ? { x: B.x1 - v, y: B.y0 + u }
    : { x: B.x0 + v, y: B.y1 - u };
}

/** 逻辑方向 → 屏幕方向（用于方向键微调、方向提示）*/
export function sceneDirToScreen(dx, dy) {
  return { x: -dy, y: dx };
}

/** 屏幕方向 → 逻辑方向 */
export function screenDirToScene(dx, dy) {
  return { x: dy, y: -dx };
}

/** 屏幕点是否落在玩法带里 */
export function inBand(p, L = computeSceneLayout()) {
  return p.x >= L.band.x && p.x <= L.band.x + L.band.w && p.y >= L.band.y && p.y <= L.band.y + L.band.h;
}

/** 场景变换矩阵（供 ctx.transform 用）：screen = M · scene */
export function sceneMatrix(L = computeSceneLayout(), dir = 'cw') {
  const B = L.box || SCENE_BOX;
  if (dir === 'ccw') {
    return { a: 0, b: -L.scale, c: L.scale, d: 0, e: L.band.x - B.y0 * L.scale, f: L.band.y + B.x1 * L.scale };
  }
  return { a: 0, b: L.scale, c: -L.scale, d: 0, e: L.band.x + B.y1 * L.scale, f: L.band.y - B.x0 * L.scale };
}
