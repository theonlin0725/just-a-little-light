// 定向光束关卡的运行时：输入、机关、引导、倒计时冻结与 3 秒保持。
//
// 与现有 point-light Game 分开，避免一次改动把 60 关老逻辑卷进来；
// Game 只在 mode === 'beam' 时把 update / pointer 事件转给这里。
//
// 计时口径（跟 V2 方案一致）：
//   * 首次有效拖动才开始计时；
//   * 全目标点亮瞬间冻结关卡倒计时，另起 3 秒保持；
//   * 保持中断 -> 保持归零，倒计时从冻结值继续；
//   * 面板/后台由 Game 层暂停，不补算现实时间。

import { traceScene, elementRadius } from './optics.js';
import {
  applyGateEffects,
  createGateRuntime,
  stepGates,
} from './gates.js';
import { angleFromHandle, dragCore, hitJoystick } from './joystick.js';
import {
  createTutorialState,
  skipTutorial,
  stepTutorial,
  tutorialView,
} from './tutorial-flow.js';
import { BEAM_LEVELS } from './beam-levels.js';

const DEFAULT_HOLD = 3;
const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class BeamSession {
  constructor({ levels = BEAM_LEVELS, start = 0, onExit = null, onWin = null } = {}) {
    this.levels = levels;
    this.onExit = onExit;
    this.onWin = onWin;
    this.start(start);
  }

  get level() {
    return this.levels[this.index];
  }

  get hasNext() {
    return this.index + 1 < this.levels.length;
  }

  get holdTarget() {
    return this.level.hold || DEFAULT_HOLD;
  }

  get timeLimit() {
    return this.level.timeLimit || 0;
  }

  start(index) {
    this.index = Math.max(0, Math.min(this.levels.length - 1, index | 0));
    this.scene = clone(this.level);
    this.runtime = (this.scene.gates || []).length ? createGateRuntime(this.scene) : null;
    this.tutorial = this.scene.tutorial ? createTutorialState(this.scene.tutorial) : null;
    this.tutorialDoneAt = 0;
    this.active = this.scene;
    this.result = traceScene(this.scene);
    this.t = 0;
    this.elapsed = 0;
    this.hold = 0;
    this.frozen = false;
    this.started = false;
    this.phase = 'play'; // play | win | fail
    this.drag = null;
    this.winInfo = null;
    this.failAt = 0;
    this.winAt = 0;
    this.selected = null;
  }

  restart() {
    this.start(this.index);
  }

  next() {
    if (this.hasNext) this.start(this.index + 1);
    else this.exit();
  }

  exit() {
    if (this.onExit) this.onExit();
  }

  /* ---------------- 每帧 ---------------- */

  update(dt) {
    this.t += dt;
    if (this.phase !== 'play') return;

    let active = this.scene;
    if (this.runtime) {
      active = applyGateEffects(this.scene, this.runtime).scene;
      const before = traceScene(active);
      stepGates(active, this.runtime, before.gates, dt);
      active = applyGateEffects(this.scene, this.runtime).scene;
    }
    this.active = active;
    this.result = traceScene(active);

    if (this.tutorial) {
      const wasDone = this.tutorial.done;
      stepTutorial(this.tutorial, this.tutorialContext(active, this.result));
      if (!wasDone && this.tutorial.done) this.tutorialDoneAt = this.t;
    }

    const allLit = this.result.allLit;
    if (allLit) {
      this.frozen = true;
      this.hold += dt;
      if (this.hold >= this.holdTarget) this.win();
    } else {
      this.frozen = false;
      this.hold = 0;
      if (this.started) this.elapsed += dt;
      if (this.timeLimit > 0 && this.elapsed >= this.timeLimit) this.fail();
    }
  }

  tutorialContext(active, result) {
    const positions = {};
    for (const l of active.lights || []) positions[l.id] = l;
    for (const p of active.prisms || []) positions[p.id] = p;
    for (const f of active.filters || []) positions[f.id] = f;
    for (const m of active.combiners || []) positions[m.id] = m;
    const angles = {};
    for (const l of active.lights || []) angles[l.id] = l.angle;
    const gates = {};
    if (this.runtime) for (const [id, st] of this.runtime) gates[id] = st;
    const crystals = {};
    for (const c of result.crystals || []) crystals[c.id] = c;
    return { positions, angles, gates, crystals, allLit: result.allLit, hold: this.hold };
  }

  get view() {
    return tutorialView(this.tutorial);
  }

  win() {
    this.phase = 'win';
    this.winAt = this.t;
    this.hold = this.holdTarget;
    this.frozen = true;
    this.drag = null;
    if (this.tutorial && !this.tutorial.done) skipTutorial(this.tutorial);
    this.winInfo = {
      level: this.level.name,
      index: this.index,
      time: this.elapsed,
      hold: this.holdTarget,
      last: !this.hasNext,
    };
    if (this.onWin) this.onWin(this.winInfo);
  }

  fail() {
    this.phase = 'fail';
    this.failAt = this.t;
    this.hold = 0;
    this.drag = null;
  }

  /* ---------------- 输入 ---------------- */

  get ui() {
    return {
      back: { x: 20, y: 24, w: 92, h: 44 },
      next: { x: 186, y: 760, w: 348, h: 76 },
      retry: { x: 250, y: 850, w: 220, h: 56 },
      home: { x: 250, y: 922, w: 220, h: 52 },
    };
  }

  inRect(r, x, y) {
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  lightById(id) {
    return (this.scene.lights || []).find((l) => l.id === id) || null;
  }

  pickElement(x, y) {
    const p = { x, y };
    for (const l of this.scene.lights || []) {
      if (Math.hypot(p.x - l.x, p.y - l.y) <= 34) return { type: l.joystick ? 'core' : 'light', el: l };
    }
    for (const list of [this.scene.prisms, this.scene.filters, this.scene.combiners]) {
      for (const el of list || []) {
        if (el.draggable === false) continue;
        if (Math.hypot(p.x - el.x, p.y - el.y) <= elementRadius(el) + 12) {
          return { type: el.kind === 'dispersion' || el.kind === 'splitter' || el.kind ? 'prism' : 'element', el };
        }
      }
    }
    return null;
  }

  pointerDown(x, y) {
    const ui = this.ui;
    if (this.phase === 'win') {
      if (this.inRect(ui.next, x, y)) {
        if (this.hasNext) this.next();
        else this.exit();
      } else if (this.inRect(ui.retry, x, y)) this.restart();
      else if (this.inRect(ui.home, x, y)) this.exit();
      return;
    }
    if (this.phase === 'fail') {
      if (this.inRect(ui.retry, x, y)) this.restart();
      else if (this.inRect(ui.home, x, y)) this.exit();
      return;
    }
    if (this.inRect(ui.back, x, y)) {
      this.exit();
      return;
    }

    const jl = (this.scene.lights || []).find((l) => l.joystick);
    if (jl) {
      const zone = hitJoystick(jl, { x, y });
      if (zone === 'handle') {
        this.drag = { type: 'handle', id: jl.id };
        jl.angle = angleFromHandle(jl, { x, y });
        this.started = true;
        return;
      }
      if (zone === 'core') {
        this.drag = { type: 'core', id: jl.id, dx: jl.x - x, dy: jl.y - y };
        this.started = true;
        return;
      }
    }

    const picked = this.pickElement(x, y);
    if (!picked) return;
    this.selected = picked.el.id;
    this.started = true;
    this.drag = { type: picked.type, id: picked.el.id, dx: picked.el.x - x, dy: picked.el.y - y };
  }

  pointerMove(x, y) {
    if (!this.drag || this.phase !== 'play') return;
    this.started = true;
    if (this.drag.type === 'handle') {
      const l = this.lightById(this.drag.id);
      if (l) l.angle = angleFromHandle(l, { x, y });
      return;
    }
    const B = this.scene.bounds || { x0: 0, y0: 0, x1: 720, y1: 1280 };
    if (this.drag.type === 'light' || this.drag.type === 'core') {
      const l = this.lightById(this.drag.id);
      if (l) {
        const lB = l.bounds || B;
        const moved = dragCore(l, { x: x + this.drag.dx, y: y + this.drag.dy }, lB);
        l.x = moved.x;
        l.y = moved.y;
      }
      return;
    }

    const el =
      (this.scene.prisms || []).find((p) => p.id === this.drag.id) ||
      (this.scene.filters || []).find((f) => f.id === this.drag.id) ||
      (this.scene.combiners || []).find((m) => m.id === this.drag.id);
    if (!el) return;
    const r = elementRadius(el) + 8;
    el.x = clamp(x + this.drag.dx, B.x0 + r, B.x1 - r);
    el.y = clamp(y + this.drag.dy, B.y0 + r, B.y1 - r);

    // 引导虚线框吸附：当前步骤的手势对象进入 ±snapRadius 就居中
    if (this.tutorial && !this.tutorial.done) {
      const step = this.tutorial.steps[this.tutorial.index];
      const zone = step && step.dashedZones && step.dashedZones[0];
      const gesture = step && step.gesture;
      if (zone && gesture && gesture.id === el.id) {
        const d = Math.hypot(el.x - zone.x, el.y - zone.y);
        if (d <= (zone.snapRadius || 18)) {
          el.x = zone.x;
          el.y = zone.y;
        }
      }
    }
  }

  pointerUp() {
    this.drag = null;
  }

  /** 渲染层用的颜色辅助：目标当前是否被正确色光点亮 */
  crystalState(id) {
    return (this.result.crystals || []).find((c) => c.id === id) || null;
  }

  gateState(id) {
    return this.runtime ? this.runtime.get(id) || null : null;
  }

  /** 当前帧的倒计时文案用值 */
  get clock() {
    if (this.timeLimit > 0) return { limit: this.timeLimit, left: Math.max(0, this.timeLimit - this.elapsed), elapsed: this.elapsed };
    return { limit: 0, left: 0, elapsed: this.elapsed };
  }

  /** 供测试/调试：直接摆一个元素到坐标 */
  place(id, x, y) {
    for (const list of [this.scene.lights, this.scene.prisms, this.scene.filters, this.scene.combiners]) {
      const el = (list || []).find((e) => e.id === id);
      if (el) {
        el.x = x;
        el.y = y;
        return true;
      }
    }
    return false;
  }

  setAngle(id, deg) {
    const l = this.lightById(id);
    if (!l) return false;
    l.angle = deg;
    return true;
  }
}
