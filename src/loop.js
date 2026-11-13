// 固定步长推进 + 真实时间不丢失。
//
// 为什么不能直接把 dt 截断成 50ms：低帧率下（比如 10fps）3 秒会被拉长成 6 秒，
// "连续保持 3 秒"的规则就变成了 6 秒。这里用固定步长推进仿真，
// 追不上时用一个粗步把剩余时间补齐，保证"累计仿真时间 == 真实经过时间"。

export const STEP = 1 / 60;
export const MAX_STEPS_PER_FRAME = 8;
/** 单帧最多认领的真实时间，防止长时间卡顿后一次补太多 */
export const MAX_FRAME_DELTA = 0.5;
/** 补齐用的最大单步：再粗就可能跨过移动障碍的短暂遮挡 */
export const MAX_SUBSTEP = 1 / 30;
export const MAX_SUBSTEPS = 16;

/**
 * @param {number} acc   上一帧剩下的时间
 * @param {number} delta 这一帧真实经过的时间（秒）
 * @returns {{steps:number[], acc:number, dropped:number}}
 */
export function planFrame(acc, delta) {
  const d = Math.max(0, Math.min(delta, MAX_FRAME_DELTA));
  const dropped = Math.max(0, delta - d);
  let left = acc + d;
  const steps = [];
  while (left >= STEP && steps.length < MAX_STEPS_PER_FRAME) {
    steps.push(STEP);
    left -= STEP;
  }
  // 步数用完还有剩余：切成不超过 1/30 秒的小步补齐，
  // 避免一个粗步跨过移动障碍的短暂遮挡（那会漏判"中断"）
  if (left > 1e-6) {
    const pieces = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(left / MAX_SUBSTEP)));
    const each = left / pieces;
    for (let i = 0; i < pieces; i++) steps.push(each);
    left = 0;
  }
  return { steps, acc: left, dropped };
}
