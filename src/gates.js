// 光学机关状态机：锁存型（0.8s 永久开门）与保活型（断光 0.3s 回落）。
//
// 这一层只做“光是否照到机关 -> 门/护罩/滑台是否打开”的状态推进，
// 不负责画图，也不直接改关卡数据；渲染/沙盒调用 applyGateEffects() 得到当帧场景。
//
// 约定：
//   * traceScene(scene).gates 里每个机关带 ok（颜色匹配）与 mixed（合成色）；
//   * 锁存型：连续命中 chargeTime 后 open=true，之后永久保持；
//   * 保活型：命中时充能，断光后 holdGrace 内仍保持，超过后关闭并清零；
//   * 机关动作：openDoor / dropShield -> 打开时移除目标 block；
//                 closeSubGate -> 打开时启用目标 block（副闸落下）；
//                 slideTrack -> 打开时把目标棱镜沿直线推到 to。

const DEFAULT_CHARGE = 0.8;
const DEFAULT_GRACE = 0.3;

export function createGateRuntime(scene) {
  const runtime = new Map();
  for (const gate of scene.gates || []) {
    runtime.set(gate.id, {
      id: gate.id,
      kind: gate.kind || 'latch',
      charge: 0,
      open: false,
      grace: 0,
      slide: 0,
    });
  }
  return runtime;
}

function resultById(results) {
  const map = new Map();
  for (const r of results || []) map.set(r.id, r);
  return map;
}

/**
 * 推进一帧机关状态。
 * @param {object} scene 当前场景（含 gates 定义）
 * @param {Map} runtime createGateRuntime 的返回值
 * @param {Array} results traceScene(scene).gates
 * @param {number} dt 秒
 */
export function stepGates(scene, runtime, results, dt) {
  const byId = resultById(results);
  const step = Math.max(0, Number(dt) || 0);

  for (const gate of scene.gates || []) {
    let state = runtime.get(gate.id);
    if (!state) {
      state = { id: gate.id, kind: gate.kind || 'latch', charge: 0, open: false, grace: 0, slide: 0 };
      runtime.set(gate.id, state);
    }
    const hit = byId.get(gate.id);
    const lit = !!(hit && hit.ok);
    const chargeTime = gate.chargeTime ?? DEFAULT_CHARGE;
    const graceTime = gate.holdGrace ?? DEFAULT_GRACE;

    if ((gate.kind || 'latch') === 'hold') {
      if (lit) {
        state.grace = 0;
        state.charge = Math.min(chargeTime, state.charge + step);
        if (state.charge >= chargeTime) state.open = true;
      } else if (state.open) {
        state.grace += step;
        if (state.grace > graceTime) {
          state.open = false;
          state.charge = 0;
          state.grace = 0;
        }
      } else {
        state.charge = 0;
        state.grace = 0;
      }
    } else {
      if (lit) {
        state.charge = Math.min(chargeTime, state.charge + step);
        if (state.charge >= chargeTime) state.open = true;
      } else if (!state.open) {
        state.charge = 0;
      }
    }

    if (state.open) {
      const duration = gate.slideDuration ?? 0;
      if (duration > 0) state.slide = Math.min(1, state.slide + step / duration);
      else state.slide = 1;
    }
  }

  return runtime;
}

/**
 * 根据机关状态计算当帧的开关效果。
 * 返回 { disabled, closed, slides }，不修改原场景。
 */
export function gateEffects(scene, runtime) {
  const disabled = new Set();
  const closed = new Set();
  const slides = new Map();

  for (const gate of scene.gates || []) {
    const state = runtime.get(gate.id);
    if (!state || !state.open) continue;
    for (const action of gate.actions || []) {
      if (action.type === 'openDoor' || action.type === 'dropShield') {
        if (action.targetBlockId) disabled.add(action.targetBlockId);
      } else if (action.type === 'closeSubGate') {
        if (action.targetBlockId) closed.add(action.targetBlockId);
      } else if (action.type === 'slideTrack') {
        const prism = (scene.prisms || []).find((p) => p.id === action.targetPrismId);
        if (!prism || !action.to) continue;
        const t = Math.max(0, Math.min(1, state.slide || 0));
        slides.set(prism.id, {
          x: prism.x + (action.to.x - prism.x) * t,
          y: prism.y + (action.to.y - prism.y) * t,
          t,
        });
      }
    }
  }

  return { disabled, closed, slides };
}

/** 某个 block 在当前机关状态下是否仍然挡光 */
export function isBlockEnabled(block, effects) {
  if (!block || !effects) return true;
  const id = block.id;
  if (id !== undefined && effects.disabled.has(id)) return false;
  if (id !== undefined && effects.closed.has(id)) return true;
  return block.enabled !== false;
}

/** 生成“当前帧”的场景：门/护罩/副闸已按机关状态开合，滑台棱镜已移动 */
export function applyGateEffects(scene, runtime) {
  const effects = gateEffects(scene, runtime);
  const blocks = (scene.blocks || []).filter((b) => isBlockEnabled(b, effects));
  const prisms = (scene.prisms || []).map((p) => {
    const slide = effects.slides.get(p.id);
    return slide ? { ...p, x: slide.x, y: slide.y } : p;
  });
  return { scene: { ...scene, blocks, prisms }, effects };
}

/** 给 UI 用的机关文案 */
export function gateLabel(gate, state) {
  if (!gate || !state) return '';
  if (state.open) return gate.kind === 'hold' ? '常亮门 · 开' : '锁存门 · 已开';
  if (state.charge > 0) return gate.kind === 'hold' ? '常亮门 · 照射中' : '锁存门 · 充能中';
  return gate.kind === 'hold' ? '常亮门 · 待照射' : '锁存门 · 待照射';
}

export function gateChargeRatio(gate, state) {
  if (!gate || !state) return 0;
  const need = gate.chargeTime ?? DEFAULT_CHARGE;
  return need > 0 ? Math.max(0, Math.min(1, state.charge / need)) : 0;
}
