// 视觉时钟：所有装饰动画统一用"秒"，且不受后台/暂停跳变影响。
//
// 背景：RAF 回调给的是毫秒，早前直接当秒传进渲染，相位速度被放大约 1000 倍，
// 真机上就表现成光点"抽搐"。这里把单位转换和时钟域收敛到一处。

export const MAX_VISUAL_DELTA = 0.05; // 单帧最多推进 50ms，防止卡顿后跳相

export function createVisualClock() {
  let t = 0;
  return {
    /** 当前视觉时间（秒） */
    get time() {
      return t;
    },
    /**
     * 推进一帧。
     * @param {number} deltaMs 真实帧间隔（毫秒）
     * @param {boolean} paused 后台/暂停时冻结
     */
    tick(deltaMs, paused) {
      if (paused) return t;
      const d = Math.max(0, Math.min(deltaMs / 1000, MAX_VISUAL_DELTA));
      t += d;
      return t;
    },
    reset() {
      t = 0;
    },
  };
}
