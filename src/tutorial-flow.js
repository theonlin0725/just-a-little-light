// 渐进引导的纯状态机：数据驱动 steps，渲染层只读 currentStep / view。
//
// 与旧 tutorial.js 的区别：
//   * 旧版按“机制首次出现”显示一句静态文案；
//   * 新版按 steps[] 依次完成，支持虚线框、幽灵手势、门控 Toast；
//   * 任何一步只要玩家已经做到，就自动推进，不锁操作。
//
// completeWhen 支持：
//   'inZone:<lightId>:<zoneId>'      光源进入虚线框
//   'angleNear:<lightId>:<角度>:<容差>' 发射角接近目标
//   'gate:<gateId>:opened'           机关已开
//   'crystal:<crystalId>:lit'        指定水晶已亮
//   'allLit'                         全部水晶亮
//   'hold:<秒>'                      保持进度达到 N 秒
// 也可以直接传函数，或数组（全部满足）。

const EPS = 1e-6;

function wrapAngle(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

function findLight(ctx, id) {
  if (!ctx) return null;
  if (ctx.positions && ctx.positions[id]) return ctx.positions[id];
  if (Array.isArray(ctx.lights)) return ctx.lights.find((l) => l.id === id) || null;
  return null;
}

function findZone(step, ctx, id) {
  if (ctx && ctx.zones && ctx.zones[id]) return ctx.zones[id];
  return ((step && step.dashedZones) || []).find((z) => z.id === id) || null;
}

export function createTutorialState(config) {
  const steps = (config && config.steps) || [];
  return {
    steps,
    index: 0,
    done: steps.length === 0,
    skipped: false,
    changedAt: 0,
  };
}

export function currentTutorialStep(state) {
  if (!state || state.done || state.skipped) return null;
  return state.steps[state.index] || null;
}

/** 渲染层用的当前视图；不修改状态 */
export function tutorialView(state) {
  const step = currentTutorialStep(state);
  if (!step) {
    return {
      done: !state || state.done || state.skipped,
      index: state ? state.index : 0,
      total: state ? state.steps.length : 0,
      toast: '',
      dashedZones: [],
      gesture: null,
    };
  }
  return {
    done: false,
    index: state.index,
    total: state.steps.length,
    toast: step.toast || '',
    dashedZones: step.dashedZones || [],
    gesture: step.gesture || null,
    step,
  };
}

function evalInZone(step, ctx, lightId, zoneId) {
  const light = findLight(ctx, lightId);
  const zone = findZone(step, ctx, zoneId);
  if (!light || !zone) return false;
  return Math.hypot(light.x - zone.x, light.y - zone.y) <= (zone.r || zone.snapRadius || 0);
}

function evalAngleNear(ctx, lightId, deg, tol) {
  const angle = ctx && ctx.angles ? ctx.angles[lightId] : null;
  if (angle === null || angle === undefined) {
    const light = findLight(ctx, lightId);
    if (!light || light.angle === undefined) return false;
    return Math.abs(wrapAngle(light.angle - deg)) <= tol;
  }
  return Math.abs(wrapAngle(angle - deg)) <= tol;
}

function evalGate(ctx, gateId) {
  if (!ctx || !ctx.gates) return false;
  const gate = ctx.gates[gateId] || (Array.isArray(ctx.gates) ? ctx.gates.find((g) => g.id === gateId) : null);
  return !!(gate && gate.open);
}

function evalCrystal(ctx, crystalId) {
  if (!ctx || !ctx.crystals) return false;
  const c = ctx.crystals[crystalId] || (Array.isArray(ctx.crystals) ? ctx.crystals.find((x) => x.id === crystalId) : null);
  return !!(c && c.ok);
}

export function evaluateCondition(cond, ctx, step) {
  if (typeof cond === 'function') return !!cond(ctx, step);
  if (Array.isArray(cond)) return cond.every((c) => evaluateCondition(c, ctx, step));
  if (!cond || typeof cond !== 'string') return false;

  const parts = cond.split(':');
  const op = parts[0];
  if (op === 'inZone') return evalInZone(step, ctx, parts[1], parts[2]);
  if (op === 'angleNear') return evalAngleNear(ctx, parts[1], Number(parts[2]), Number(parts[3] || 4));
  if (op === 'gate') return evalGate(ctx, parts[1]);
  if (op === 'crystal') return evalCrystal(ctx, parts[1]);
  if (op === 'allLit') return !!(ctx && ctx.allLit);
  if (op === 'hold') return !!(ctx && Number(ctx.hold || 0) + EPS >= Number(parts[1] || 0));
  return false;
}

/**
 * 推进引导；玩家已经做到当前步骤时自动进入下一步。
 * 返回 { changed, done, step, view }。
 */
export function stepTutorial(state, ctx) {
  if (!state || state.done || state.skipped) {
    return { changed: false, done: true, step: null, view: tutorialView(state) };
  }
  const step = currentTutorialStep(state);
  if (!step) {
    state.done = true;
    return { changed: false, done: true, step: null, view: tutorialView(state) };
  }
  if (!evaluateCondition(step.completeWhen, ctx, step)) {
    return { changed: false, done: false, step, view: tutorialView(state) };
  }

  state.index += 1;
  state.changedAt = Date.now();
  if (state.index >= state.steps.length) state.done = true;
  return {
    changed: true,
    done: state.done,
    step: currentTutorialStep(state),
    view: tutorialView(state),
  };
}

/** 老玩家直接完成/跳过，不锁屏 */
export function skipTutorial(state) {
  if (!state) return state;
  state.done = true;
  state.skipped = true;
  return state;
}

export function resetTutorial(state) {
  if (!state) return state;
  state.index = 0;
  state.done = state.steps.length === 0;
  state.skipped = false;
  state.changedAt = 0;
  return state;
}

/** 给调试/验收用：当前步骤是否只剩最后一步 */
export function tutorialAtLastStep(state) {
  return !!state && !state.done && !state.skipped && state.index === state.steps.length - 1;
}
