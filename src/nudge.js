// 第 N 次"有效读秒失败"后的灯泡引导。
//
// 口径（可配置）：
//   * 有效尝试 = 一次"全部目标点亮 → 开始保持"的过程，且峰值 ≥ minHoldSeconds；
//   * 只有 allLit 由真变假才算一次失败（松手不算，暂停不算，通关不算）；
//   * 同一关同一次会话最多显示 maxShowsPerLevelSession 次，每局最多 maxShowsPerRun 次。

export const HELP_NUDGE = {
  failedAttempts: 4,
  minHoldSeconds: 0.3,
  visibleSeconds: 6,
  maxShowsPerRun: 1,
  maxShowsPerLevelSession: 2,
  restartCooldownSeconds: 60,
};

export function createNudgeState() {
  return {
    /** 本次尝试的峰值保持时间 */
    peak: 0,
    /** 是否正处在一次尝试中 */
    active: false,
    /** 有效失败次数（当前这一局） */
    failures: 0,
    /** 本局已显示次数 */
    shownThisRun: 0,
    /** 本关本次会话已显示次数（跨重开保留） */
    shownThisSession: 0,
    /** 冷却截止（游戏内秒） */
    cooldownUntil: 0,
    /** 是否已经排到待显示 */
    pending: false,
    /** 当前展示到期时间（游戏内秒），0 表示没在显示 */
    until: 0,
  };
}

/**
 * 推进一次尝试状态。
 * @param {object} s  nudge 状态
 * @param {{allLit:boolean, holdTime:number, won:boolean, now:number, cfg?:object}} e
 * @returns {{failed:boolean, trigger:boolean}}
 */
export function stepAttempt(s, e) {
  const cfg = e.cfg || HELP_NUDGE;
  let failed = false;
  let trigger = false;

  if (e.won) {
    // 成功不计失败，也不触发引导
    s.active = false;
    s.peak = 0;
    s.pending = false;
    s.until = 0;
    return { failed, trigger };
  }

  if (e.allLit) {
    if (!s.active) {
      s.active = true;
      s.peak = 0;
    }
    s.peak = Math.max(s.peak, e.holdTime || 0);
    return { failed, trigger };
  }

  // 由亮变灭：结束一次尝试
  if (s.active) {
    s.active = false;
    if (s.peak >= cfg.minHoldSeconds) {
      s.failures++;
      failed = true;
      if (
        s.failures >= cfg.failedAttempts &&
        s.pending === false &&
        s.until === 0 &&
        s.shownThisRun < cfg.maxShowsPerRun &&
        s.shownThisSession < cfg.maxShowsPerLevelSession &&
        e.now >= s.cooldownUntil
      ) {
        s.pending = true;
        trigger = true;
      }
    }
    s.peak = 0;
  }
  return { failed, trigger };
}

/** 真正显示出来（安全时机满足时调用） */
export function showNudge(s, now, cfg = HELP_NUDGE) {
  if (!s.pending) return false;
  s.pending = false;
  s.until = now + cfg.visibleSeconds;
  s.shownThisRun++;
  s.shownThisSession++;
  s.cooldownUntil = now + cfg.restartCooldownSeconds;
  return true;
}

/** 主动关闭 / 点了灯泡 / 通关 / 离开关卡 */
export function dismissNudge(s) {
  s.pending = false;
  s.until = 0;
}

export function nudgeVisible(s, now) {
  return s.until > 0 && now < s.until;
}

/** 重开：清本局计数，保留同关会话频次与冷却 */
export function resetRun(s) {
  s.active = false;
  s.peak = 0;
  s.failures = 0;
  s.shownThisRun = 0;
  s.pending = false;
  s.until = 0;
}

/** 换关：清得更彻底，但保留本次会话的同关记录由调用方决定 */
export function resetLevel(s) {
  resetRun(s);
  s.shownThisSession = 0;
  s.cooldownUntil = 0;
}
