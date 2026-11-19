// 灯座的内芯 / 外延弧形摇杆的纯几何命中与角度换算。
//
// 规则来自 V2 定案：
//   * 内芯热区 r <= 28：按住拖动整座灯的位置；
//   * 外延圆柄距灯芯 56：按住拖动改变发射角，松手自锁；
//   * 摇杆在灯座下侧，手柄与光束关于竖轴对称：
//     手柄在正下方时灯向上照；手柄往右下拨，光往右上照。
//     因此手柄角 = -发射角（不是简单的 +180°）。
// 这里不碰 Canvas，游戏和测试共用同一套命中。

import { angleToDir } from './optics.js';

export const JOYSTICK = {
  coreR: 28,
  handleD: 56,
  handleR: 18,
  // 默认不加额外 slop：内芯 28 + 外柄 18，中心距 56，
  // 两个热区之间保留 10px 空隙；需要更宽容时可从 opts 覆盖。
  hitSlop: 0,
  defaultRange: [-150, -30],
};

export function wrapAngle(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

export function clampAngleToRange(deg, range) {
  if (!range || range.length !== 2) return wrapAngle(deg);
  const [min, max] = range;
  const v = wrapAngle(deg);
  if (min <= max) return Math.max(min, Math.min(max, v));
  if (v >= min || v <= max) return v;
  return Math.abs(v - min) <= Math.abs(v - max) ? min : max;
}

/** 光学软磁吸：发射角落在目标角 ±tolerance 内时吸过去 */
export function snapAngle(deg, targets, tolerance = 3) {
  let best = null;
  let bestD = Infinity;
  for (const target of targets || []) {
    const d = Math.abs(wrapAngle(deg - target));
    if (d <= tolerance && d < bestD) {
      best = target;
      bestD = d;
    }
  }
  return best === null ? deg : best;
}

export function joystickLayout(light, opts = {}) {
  const coreR = opts.coreR ?? JOYSTICK.coreR;
  const handleD = opts.handleD ?? JOYSTICK.handleD;
  const handleR = opts.handleR ?? JOYSTICK.handleR;
  const range = light.angleRange || opts.range || JOYSTICK.defaultRange;
  const emission = wrapAngle(light.angle ?? -90);
  const handleAngle = wrapAngle(-emission);
  const core = { x: light.x, y: light.y };
  const handle = {
    x: light.x + Math.cos((handleAngle * Math.PI) / 180) * handleD,
    y: light.y + Math.sin((handleAngle * Math.PI) / 180) * handleD,
  };
  return { core, handle, coreR, handleD, handleR, range, emission, handleAngle };
}

/** 点在摇杆的哪个热区：'core' | 'handle' | null */
export function hitJoystick(light, point, opts = {}) {
  if (!light || !point) return null;
  const L = joystickLayout(light, opts);
  const slop = opts.hitSlop ?? JOYSTICK.hitSlop;
  if (Math.hypot(point.x - L.core.x, point.y - L.core.y) <= L.coreR + slop) return 'core';
  if (Math.hypot(point.x - L.handle.x, point.y - L.handle.y) <= L.handleR + slop) return 'handle';
  return null;
}

/** 从手柄位置反推发射角（手柄角 - 180），并按扇区夹紧 */
export function angleFromHandle(light, point, opts = {}) {
  if (!light || !point) return wrapAngle(light && (light.angle ?? -90));
  const range = light.angleRange || opts.range || JOYSTICK.defaultRange;
  const handleAngle = (Math.atan2(point.y - light.y, point.x - light.x) * 180) / Math.PI;
  const clamped = clampAngleToRange(wrapAngle(-handleAngle), range);
  return snapAngle(clamped, light.snapAngles, opts.snapTolerance ?? 3);
}

/** 拖手柄：返回新的发射角（不修改入参） */
export function dragHandle(light, point, opts = {}) {
  return { ...light, angle: angleFromHandle(light, point, opts) };
}

/** 拖内芯：把灯座位置夹在 bounds 内（不修改入参） */
export function dragCore(light, point, bounds) {
  const B = bounds || { x0: 0, y0: 0, x1: 720, y1: 1280 };
  return {
    ...light,
    x: Math.max(B.x0, Math.min(B.x1, point.x)),
    y: Math.max(B.y0, Math.min(B.y1, point.y)),
  };
}

/** 绘制扇区弧线用的采样点：手柄在灯座下侧的弧上 */
export function handleArc(light, opts = {}, steps = 24) {
  const L = joystickLayout(light, opts);
  const [min, max] = L.range;
  const span = min <= max ? max - min : 360 - min + max;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const emission = wrapAngle(min + (span * i) / steps);
    const handleAngle = wrapAngle(-emission);
    pts.push({
      x: light.x + Math.cos((handleAngle * Math.PI) / 180) * L.handleD,
      y: light.y + Math.sin((handleAngle * Math.PI) / 180) * L.handleD,
      emission,
    });
  }
  return pts;
}

/** 手柄应该出现的点（供渲染/测试） */
export function handlePoint(light, opts = {}) {
  return joystickLayout(light, opts).handle;
}

/** 发射方向单位向量（供渲染虚线预览） */
export function emissionDir(light) {
  return angleToDir(light.angle ?? -90);
}
