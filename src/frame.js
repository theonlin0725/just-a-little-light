// 帧级错误边界与唯一定时器。
//
// 目标：
//   * update / draw 任何一步抛错都不能让 RAF 链断掉（真机就死在这一步）；
//   * 同一时刻只有一个循环在跑（防重入、防双 RAF）；
//   * 连续失败要先降级（safe 画质），再熔断成"可重试"的暂停态，而不是无限黑屏；
//   * 错误按签名限频记录，不做逐帧日志。

export const MAX_CONSECUTIVE = 8;
export const DEGRADE_AT = 3;

/**
 * @param {object} o
 * @param {(now:number)=>void} o.update
 * @param {(now:number)=>void} o.draw
 * @param {(kind:string, info:object)=>void} [o.onEvent]
 * @param {(cb:Function)=>number} [o.requestFrame]
 */
export function createFrameRunner({ update, draw, onEvent, requestFrame }) {
  const raf = requestFrame || ((cb) => requestAnimationFrame(cb));
  let scheduled = false;
  let inStep = false;
  let running = false;
  let consecutive = 0;
  let fatal = false;
  let degraded = false;
  const errors = Object.create(null);
  let lastError = null;

  function record(phase, e) {
    const msg = (e && (e.message || String(e))) || 'unknown';
    const key = `${phase}:${msg}`;
    const n = (errors[key] || 0) + 1;
    errors[key] = n;
    lastError = { phase, message: msg, at: Date.now() };
    // 同一签名只详细记录一次
    if (n === 1 && onEvent) onEvent('error', { phase, message: msg, stack: e && e.stack, count: n });
  }

  function step(now) {
    scheduled = false;
    if (inStep) return; // 防重入
    inStep = true;
    try {
      if (!fatal) {
        let ok = true;
        try {
          update(now);
        } catch (e) {
          ok = false;
          record('update', e);
        }
        try {
          draw(now);
        } catch (e) {
          ok = false;
          record('draw', e);
        }
        if (ok) {
          consecutive = 0;
        } else {
          consecutive++;
          if (consecutive >= DEGRADE_AT && !degraded) {
            degraded = true;
            onEvent && onEvent('degrade', { consecutive });
          }
          if (consecutive >= MAX_CONSECUTIVE) {
            fatal = true;
            onEvent && onEvent('fatal', { consecutive, lastError });
          }
        }
      } else {
        // 熔断后只画恢复界面，不再推进仿真，避免"看不见但在通关"
        try {
          draw(now);
        } catch (e) {
          record('fatal-draw', e);
        }
      }
    } finally {
      inStep = false;
      schedule();
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    raf(step);
  }

  return {
    start() {
      if (running) return;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      fatal = true; // 停止后不再调度
    },
    /** 用户点"重试"：清计数，允许继续推进 */
    retry() {
      consecutive = 0;
      fatal = false;
      lastError = null;
      inStep = false;
      if (!running) {
        running = true;
        schedule();
      } else if (!scheduled) {
        schedule();
      }
    },
    get fatal() {
      return fatal;
    },
    get degraded() {
      return degraded;
    },
    get consecutive() {
      return consecutive;
    },
    get lastError() {
      return lastError;
    },
    get errorCount() {
      return Object.keys(errors).length;
    },
    errors,
  };
}
