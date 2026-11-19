// 游戏状态机。渲染层只读这里的字段，不碰 canvas。
import { LEVELS, BOUNDS, WALL, WALL_L, HOLD_TIME } from './levels-live.js';
import { rayEnd, shadowIntervalOn, resolveLight, isVisibleAt, moverPoly, pointInPolygon } from './geometry.js';
import { sfx } from './audio.js';
import { ads, ERROR_TEXT } from './ads.js';
import { buildCard, saveCard } from './share.js';
import { SKINS, DEFAULT_SKIN, skinById } from './skins.js';
import { mechanismForLevel, isBasicTutorial, teachesDualLight } from './tutorial.js';
import { plat } from './platform.js';
import { createNudgeState, stepAttempt, showNudge, dismissNudge, nudgeVisible, resetRun, resetLevel } from './nudge.js';
import { inBand, screenToScene, sceneToScreen, screenDirToScene, resolveDir, computeSceneLayout } from './layout.js';
import { BeamSession } from './beam-game.js';

const SAVE_KEY = 'projection.save.v3';
const OLD_KEYS = ['projection.save.v2', 'projection.save.v1'];

function normalize(s) {
  const skins = s && s.skins ? s.skins : {};
  const unlocked = Array.isArray(skins.unlocked) ? skins.unlocked.slice() : [];
  if (!unlocked.includes(DEFAULT_SKIN.id)) unlocked.push(DEFAULT_SKIN.id);
  const best = (s && s.best) || {};
  // 旧版只有 36 关：打通最后一关时 unlocked 不会被写到 36，
  // 迁到 60 关后会卡在"第 37 关锁着"。这里用已通关记录兜底修正。
  const cleared = Object.keys(best).map((k) => Number(k) || 0);
  const unlocked0 = (s && s.unlocked) | 0;
  const unlockedFixed = Math.max(unlocked0, ...cleared, 0);
  const audio = (s && s.audio) || {};
  return {
    unlocked: unlockedFixed,
    best,
    hints: (s && s.hints) || {},
    skins: { unlocked, equipped: skins.equipped || DEFAULT_SKIN.id },
    // 音频偏好持久化，默认都开
    audio: { bgm: audio.bgm !== false, sfx: audio.sfx !== false },
  };
}

function loadSave() {
  try {
    const raw = plat.getStorage(SAVE_KEY);
    if (raw) return normalize(JSON.parse(raw));
    // 老档迁移：36 关版本的进度原样搬过来，第 37 关按 unlocked 顺延
    for (const k of OLD_KEYS) {
      const old = JSON.parse(plat.getStorage(k) || 'null');
      if (old) return normalize(old);
    }
  } catch {
    /* 隐私模式 / 存储不可用 */
  }
  return normalize(null);
}

function persist(s) {
  plat.setStorage(SAVE_KEY, JSON.stringify(s));
}

/** 标题页背景用的演示场景：没有遮挡物，只剩光、光柱和水晶 */
const ATTRACT = {
  name: '',
  crystals: [
    { x: WALL.cx, y: 300, lights: [0] },
    { x: WALL.cx, y: 640, lights: [0] },
    { x: WALL.cx, y: 980, lights: [0] },
  ],
  blocks: [],
  movers: [],
  lights: [{ start: { x: 150, y: 640 }, goal: { x: 150, y: 640 } }],
  hold: HOLD_TIME,
  tier: 1,
};

const DIRS = ['上', '右上', '右', '右下', '下', '左下', '左', '左上'];

export class Game {
  constructor() {
    this.save = loadSave();
    this.phase = 'title'; // title | levels | play | win
    this.mode = 'classic'; // classic | beam（V2 光学试玩）
    this.beam = null;
    this.modal = null; // null | 'hint' | 'ad' | 'share' | 'skins'
    this.skin = skinById(this.save.skins.equipped);
    this.removed = new Set(); // 'b0' 静态 / 'm1' 移动，只对当前这局有效
    this.removeMode = false;
    this.removeSel = null;
    this.trail = [];
    this.adToken = 0;
    this.pressedBtn = null;
    this.hoverBtn = null;
    this.levelsFrom = null;
    this.hidden = false; // 微信切后台 / 系统中断
    this.nudge = createNudgeState();
    if (this.save && this.save.audio) {
      sfx.setBgm(this.save.audio.bgm);
      sfx.setSfx(this.save.audio.sfx);
    }
    this.t = 0;
    this.levelIndex = 0;
    this.level = LEVELS[0];
    this.lights = [];
    this.active = 0;
    this.crystals = [];
    this.bands = [];
    this.holdTime = 0;
    this.levelTime = 0;
    this.totalTime = 0;
    this.distance = 0;
    this.winAt = 0;
    this.shake = 0;
    this.fade = 1;
    this.hint = null;
    this.hintTier = 0;
    this.adProgress = 0;
    this.shareCanvas = null;
    this.toastMsg = '';
    this.toastUntil = 0;
    this.result = null;
    this.dragging = false;
    this.attractLevel = ATTRACT;
    this.buildLevel(ATTRACT);
  }

  /* ---------------- 关卡 ---------------- */

  buildLevel(level) {
    this.level = level;
    this.lights = level.lights.map((l) => ({
      pos: { ...l.start },
      target: { ...l.start },
      goal: { ...(l.goal || l.start) },
    }));
    this.active = 0;
    this.crystals = level.crystals.map((c) => ({
      x: c.x,
      y: c.y,
      def: c,
      lit: false,
      glow: 0,
      flash: 0,
      seenBy: [],
      rayEnds: [],
    }));
    this.movers = level.movers || [];
    this.sceneT = 0;
    this.holdTime = 0;
    this.levelTime = 0;
    this.distance = 0;
    this.hint = null;
    this.hintTier = 0;
    this.modal = null;
    this.shareCanvas = null;
    this.result = null;
    // 教学只在"机制首次引入关"出现，和进入路径、重玩次数无关
    this.teach = mechanismForLevel(level.id);
    this.teachBasic = isBasicTutorial(level.id);
    this.teachDual = teachesDualLight(level.id);
    this.removed = new Set();
    this.removeMode = false;
    this.removeSel = null;
    this.trail = [];
    resetLevel(this.nudge);
    sfx.stopHold();
    this.adToken++; // 作废上一关还没回来的广告回调
    // 每关只为自己真正需要的墙面建投影带（镜像单侧关没有右墙）
    this.sceneDir = resolveDir(level); // 让目标墙落在玩法带上沿
    this.sceneLayout = computeSceneLayout(undefined, level.fitBox);
    this.wallR = level.mirrored ? null : WALL;
    this.wallL = level.wallL || (this.crystals.some((c) => c.def.side === 'l') ? WALL_L : null);
    this.polys = level.blocks.slice();
    this.refresh();
  }

  startLevel(i, { resetTime = false } = {}) {
    this.levelIndex = i;
    this.buildLevel(LEVELS[i]);
    this.clearTransient();
    this.phase = 'play';
    this.fade = 1;
    this.shake = 0;
    if (resetTime) this.totalTime = 0;
    this.refresh();
  }

  restart() {
    resetRun(this.nudge);
    this.totalTime = Math.max(0, this.totalTime - this.levelTime);
    this.buildLevel(LEVELS[this.levelIndex]);
    // buildLevel 会清掉 result；结算页点重玩时必须回到合法 play 状态，
    // 否则下一帧 drawWin 会读到 result=null
    this.clearTransient();
    this.phase = 'play';
    this.fade = 0.7;
  }

  /** 进入 V2 光学试玩：不改动经典 60 关的进度与存档 */
  startBeamDemo(index = 0) {
    this.mode = 'beam';
    this.phase = 'play';
    this.modal = null;
    this.dragging = false;
    this.pressedBtn = null;
    this.hoverBtn = null;
    this.removeMode = false;
    this.hint = null;
    this.result = null;
    this.beam = new BeamSession({
      start: index,
      onExit: () => this.exitBeamDemo(),
      onWin: () => sfx.win(),
    });
    this.fade = 1;
    sfx.unlock();
  }

  exitBeamDemo() {
    this.mode = 'classic';
    this.beam = null;
    this.phase = 'title';
    this.dragging = false;
    this.pressedBtn = null;
    this.hoverBtn = null;
    this.modal = null;
    this.result = null;
    this.buildLevel(this.attractLevel);
    this.fade = 1;
  }

  /** 进入新一局前必须清掉的输入/弹窗瞬态（不依赖调用者碰巧清理） */
  clearTransient() {
    this.dragging = false;
    this.pressedBtn = null;
    this.hoverBtn = null;
    this.removeMode = false;
    this.removeSel = null;
    this.trail = [];
    this.modal = null;
    this.adToken++; // 旧广告回调作废
  }

  next() {
    if (this.mode === 'beam') {
      if (this.beam) this.beam.next();
      return;
    }
    const n = this.levelIndex + 1;
    if (n < LEVELS.length) this.startLevel(n);
    else this.goHome(); // 末关按钮文案是"回到首页"，行为必须一致
  }

  isUnlocked(i) {
    return i <= Math.min(this.save.unlocked, LEVELS.length - 1);
  }

  /** 切后台 / 系统中断：与弹窗相互独立，任一个都算暂停 */
  setHidden(v) {
    this.hidden = !!v;
    if (v) {
      this.dragging = false;
      if (this.beam) this.beam.pointerUp();
    }
  }

  /** 是否有全屏界面挡着关卡 */
  get paused() {
    if (this.mode === 'beam') return !!this.hidden;
    return (
      this.hidden ||
      this.phase === 'levels' ||
      this.modal === 'ad' ||
      this.modal === 'skins' ||
      this.modal === 'hint' ||
      this.modal === 'share'
    );
  }

  /* ---------------- 每帧 ---------------- */

  update(dt) {
    this.t += dt;
    this.fade = Math.max(0, this.fade - dt * 2.2);
    this.shake = Math.max(0, this.shake - dt * 3);

    if (this.mode === 'beam') {
      if (!this.hidden && this.beam) this.beam.update(dt);
      return;
    }

    // 面板（广告 / 皮肤 / 提示 / 分享）和选关界面打开时冻结关卡：
    // 不走路、不计时、不累计保持时间，关掉之后也不会因为时间跳变直接通关
    if (this.paused) {
      sfx.stopHold(); // 面板/后台期间不留幽灵声
      return;
    }

    if (this.phase === 'title') {
      this.level = this.attractLevel;
      const t = this.t;
      const L = this.lights[0];
      L.pos = { x: 150 + Math.cos(t * 0.31) * 95, y: 640 + Math.sin(t * 0.23) * 330 };
      L.target = { ...L.pos };
      this.refresh();
      this.animateCrystals(dt);
      return;
    }

    if (this.phase === 'play') {
      this.sceneT += dt;
      const k = 1 - Math.exp(-dt * 22);
      for (const L of this.lights) {
        if (L.pos.x === L.target.x && L.pos.y === L.target.y) continue;
        const nx = L.pos.x + (L.target.x - L.pos.x) * k;
        const ny = L.pos.y + (L.target.y - L.pos.y) * k;
        const np = resolveLight({ x: nx, y: ny }, L.pos, this.level.bounds || BOUNDS, this.polys);
        // 距离按"实际位移"累计：走回头路也照算
        this.distance += Math.hypot(np.x - L.pos.x, np.y - L.pos.y);
        L.pos = np;
      }
      this.levelTime += dt;
      this.totalTime += dt;

      // 皮肤拖尾
      const L = this.lights[this.active];
      if (this.dragging && this.skin.trailN > 0) {
        this.trail.push({ x: L.pos.x, y: L.pos.y, life: 1 });
        while (this.trail.length > this.skin.trailN * 2) this.trail.shift();
      }
      for (const p of this.trail) p.life -= dt * 1.6;
      this.trail = this.trail.filter((p) => p.life > 0);
    }

    this.refresh();
    this.animateCrystals(dt);

    if (this.phase === 'play') {
      const allLit = this.crystals.every((c) => c.lit);
      if (allLit) {
        this.holdTime += dt;
        // 蓄力声只调参数，不新建振荡器；进度 0..1 驱动亮度
        sfx.setHold(this.holdTime / HOLD_TIME);
        if (this.holdTime >= HOLD_TIME) this.win();
      } else {
        if (this.holdTime > 0.15) sfx.holdBreak();
        this.holdTime = 0;
        sfx.stopHold();
      }
      // 读秒失败计数与灯泡引导
      stepAttempt(this.nudge, {
        allLit,
        holdTime: this.holdTime,
        won: this.phase === 'win',
        now: this.t,
      });
      const safeToShow =
        this.phase === 'play' && !this.dragging && !this.modal && !this.hidden && !this.removeMode;
      if (safeToShow && this.nudge.pending) showNudge(this.nudge, this.t);
    }
  }

  animateCrystals(dt) {
    for (const c of this.crystals) {
      const target = c.lit ? 1 : 0;
      c.glow += (target - c.glow) * (1 - Math.exp(-dt * 9));
      c.flash = Math.max(0, c.flash - dt * 1.6);
      if (c.lit && !c.wasLit) {
        c.flash = 1;
        if (this.phase === 'play') sfx.chime(this.crystals.indexOf(c));
      }
      c.wasLit = c.lit;
    }
  }

  /** 指定时刻仍然参与遮挡的障碍（移除的、被移除的移动物都不算） */
  polysAt(t) {
    const out = [];
    this.level.blocks.forEach((b, i) => {
      if (!this.removed.has(`b${i}`)) out.push(b);
    });
    this.movers.forEach((m, i) => {
      if (!this.removed.has(`m${i}`)) out.push(moverPoly(m, t));
    });
    return out;
  }

  activePolys() {
    return this.polysAt(this.sceneT);
  }

  refresh() {
    this.polys = this.activePolys();
    for (const c of this.crystals) {
      c.seenBy = [];
      c.rayEnds = [];
      let lit = true;
      for (const li of c.def.lights) {
        const L = this.lights[li];
        if (!L) continue;
        const end = rayEnd(L.pos, c, this.polys);
        c.seenBy[li] = !end.blocked;
        c.rayEnds[li] = end;
        if (end.blocked) lit = false;
      }
      c.lit = lit;
    }
    this.bandsR = [];
    this.bandsL = [];
    for (const L of this.lights) {
      for (const poly of this.polys) {
        if (this.wallR) {
          const r = shadowIntervalOn(L.pos, poly, this.wallR.cx);
          if (r) this.bandsR.push({ ...r, poly });
        }
        if (this.wallL) {
          const l = shadowIntervalOn(L.pos, poly, this.wallL.cx);
          if (l) this.bandsL.push({ ...l, poly });
        }
      }
    }
    this.bands = this.bandsR;
    this.allLit = this.crystals.every((c) => c.lit);
  }

  win(persistSave = true) {
    this.phase = 'win';
    this.winAt = this.t;
    this.shake = 1;
    this.holdTime = HOLD_TIME;
    sfx.win();

    const id = this.level.id || this.levelIndex + 1;
    const prev = this.save.best[id] || {};
    const newTime = prev.time === undefined || this.levelTime < prev.time;
    const newDist = prev.dist === undefined || this.distance < prev.dist;
    this.save.best[id] = {
      time: newTime ? this.levelTime : prev.time,
      dist: newDist ? this.distance : prev.dist,
    };
    this.result = {
      levelNo: this.levelIndex + 1,
      levelName: this.level.name,
      time: this.levelTime,
      distance: this.distance,
      optimal: this.level.distance ? this.level.distance.optimal : null,
      personal: this.save.best[id].dist,
      newRecord: newTime,
      newDistRecord: newDist,
    };
    const nxt = this.levelIndex + 1;
    if (nxt < LEVELS.length && nxt > this.save.unlocked) this.save.unlocked = nxt;
    if (persistSave) persist(this.save);
  }

  /* ---------------- 提示 ---------------- */

  /** 这盏灯附近最近的可行位置（粗网格；只在点提示时算一次） */
  findSolution(lightIndex, step = 8) {
    const L = this.lights[lightIndex];
    const mine = this.crystals.filter((c) => c.def.lights.includes(lightIndex));
    const needHold = this.movers.length > 0;
    // 用"当前这局"的有效障碍：已移除的不算，移动物按采样时刻求
    const blockedNow = (p) => this.polysAt(this.sceneT).some((poly) => pointInPolygon(p, poly));
    const okAt = (p) => {
      if (blockedNow(p)) return false; // 不能建议把光放进障碍内部
      if (!needHold) {
        return mine.every((c) => isVisibleAt(p, c, this.polysAt(this.sceneT), [], this.sceneT));
      }
      // 有移动障碍时要能连续保持 3 秒
      let run = 0;
      for (let k = 0; k < 140; k++) {
        const tt = this.sceneT + k * 0.08;
        const good = mine.every((c) => isVisibleAt(p, c, this.polysAt(tt), [], tt));
        run = good ? run + 0.08 : 0;
        if (run >= HOLD_TIME) return true;
      }
      return false;
    };
    let best = null;
    const B = this.level.bounds || BOUNDS;
    for (let y = B.y0; y <= B.y1; y += step) {
      for (let x = B.x0; x <= B.x1; x += step) {
        if (!okAt({ x, y })) continue;
        const d = Math.hypot(x - L.pos.x, y - L.pos.y);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    return best;
  }

  /** 当前挡得最多的一块遮挡物 */
  blockingPoly() {
    const L = this.lights[this.active];
    const mine = this.crystals.filter((c) => c.def.lights.includes(this.active) && !c.lit);
    let best = null;
    let bestN = 0;
    for (const poly of this.polys) {
      let n = 0;
      for (const c of mine) {
        if (rayEnd(L.pos, c, [poly]).blocked) n++;
      }
      if (n > bestN) {
        bestN = n;
        best = poly;
      }
    }
    return best;
  }

  computeHint(tier) {
    const L = this.lights[this.active];
    if (tier === 1) {
      const sol = this.findSolution(this.active);
      if (!sol) {
        this.hint = { tier, text: '这盏灯暂时找不到位置，先试试调另一盏' };
        return;
      }
      // 提示要说"屏幕上"的方向，所以先把两点投到屏幕再算角度
      const a = sceneToScreen(L.pos, this.sceneLayout, this.sceneDir);
      const b = sceneToScreen(sol, this.sceneLayout, this.sceneDir);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const oct = ((Math.round(ang / (Math.PI / 4)) + 2) % 8 + 8) % 8;
      this.hint = {
        tier,
        text: `光要往「${DIRS[oct]}」挪。离墙越远，影子越小`,
        point: null,
      };
    } else if (tier === 2) {
      const poly = this.blockingPoly();
      this.hint = {
        tier,
        text: poly ? '挡住光的是这一块，让它的影子挪开' : '光路暂时是通的，看影子什么时候扫过来',
        block: poly,
      };
    } else {
      const sol = this.findSolution(this.active, 6);
      this.hint = {
        tier,
        text: sol ? '把光放在这里，保持 3 秒' : '再等等，移动的障碍会让出位置',
        point: sol ? { x: sol.x, y: sol.y, until: this.t + 6 } : null,
      };
    }
  }

  hintFree(tier) {
    return this.level.tier <= 2 || tier === 1;
  }

  requestHint(tier) {
    if (tier <= this.hintTier) return;
    if (this.hintFree(tier)) {
      this.hintTier = tier;
      this.computeHint(tier);
      this.modal = null;
      sfx.hint();
      return;
    }
    this.startAd(() => {
      this.hintTier = tier;
      this.computeHint(tier);
      this.modal = null;
      sfx.hint();
      this.toast('广告奖励已到账：提示已解锁');
    });
  }

  startAd(onDone) {
    if (this.modal === 'ad' || ads.isBusy()) return; // 防重复点击 / 并发展示
    const token = ++this.adToken;
    this.modal = 'ad';
    this.adProgress = null; // null = 真实广告，进度未知
    sfx.suspend();

    // 无论成功、失败、同步抛错、Promise 拒绝，都必须把弹窗收掉
    const finish = (res) => {
      sfx.resume();
      if (token !== this.adToken) return; // 切关 / 重开：旧回调作废
      if (this.modal === 'ad') this.modal = null;
      this.adProgress = null;
      const status = res && res.status ? res.status : 'error';
      if (status === 'completed') {
        onDone();
        return;
      }
      this.toast(status === 'cancelled' ? '广告未看完，没有奖励' : ERROR_TEXT[status] || '广告不可用');
    };

    try {
      const p = ads.showRewarded((k) => {
        if (token === this.adToken) this.adProgress = k;
      });
      Promise.resolve(p).then(finish, (e) => finish({ status: 'error', detail: e }));
    } catch (e) {
      finish({ status: 'error', detail: e });
    }
  }

  /* ---------------- 分享 ---------------- */

  openShare() {
    if (!this.result) return;
    const r = this.result;
    this.shareCanvas = buildCard({
      levelName: r.levelName,
      levelNo: r.levelNo,
      totalLevels: LEVELS.length,
      time: r.time,
      distance: r.optimal !== null ? r.distance : undefined,
      optimal: r.optimal !== null ? r.optimal : undefined,
      personal: r.personal,
      newRecord: r.newRecord,
    });
    this.modal = 'share';
  }

  saveShare() {
    if (!this.shareCanvas) return;
    saveCard(this.shareCanvas, `projection-${this.result.levelNo}.png`).then((ok) => {
      this.toast(ok ? '图片已保存' : '保存失败，请长按图片保存');
    });
  }

  toast(msg) {
    this.toastMsg = msg;
    this.toastUntil = this.t + 2.2;
  }

  /** 底栏五个动作的唯一切入口（点击与无障碍按钮都走这里） */
  activate(id) {
    if (this.mode === 'beam') {
      if (id === 'restart') this.beam && this.beam.restart();
      else if (id === 'home') this.exitBeamDemo();
      return;
    }
    if (id === 'hint') {
      if (this.phase === 'play') {
        dismissNudge(this.nudge); // 玩家已经去看灯泡了
        this.modal = 'hint';
      }
    } else if (id === 'restart') {
      if (this.phase === 'play') this.restart();
    } else if (id === 'levels') this.openLevels();
    else if (id === 'skin') this.openSkins();
    else if (id === 'home') this.goHome();
  }

  /* ---------------- 移除障碍（二级提示） ---------------- */

  enterRemoveMode() {
    this.modal = null;
    this.removeMode = true;
    this.removeSel = null;
    this.hint = null;
    this.dragging = false;
  }

  exitRemoveMode() {
    this.removeMode = false;
    this.removeSel = null;
  }

  obstacleKey(kind, index) {
    return kind === 'block' ? `b${index}` : `m${index}`;
  }

  /** 点选障碍：静态挡板优先，其次是移动障碍（含干扰角色） */
  selectObstacleAt(x, y) {
    for (let i = 0; i < this.level.blocks.length; i++) {
      if (this.removed.has(`b${i}`)) continue;
      if (pointInPolygon({ x, y }, this.level.blocks[i])) return { kind: 'block', index: i };
    }
    for (let i = 0; i < this.movers.length; i++) {
      if (this.removed.has(`m${i}`)) continue;
      if (pointInPolygon({ x, y }, moverPoly(this.movers[i], this.sceneT))) return { kind: 'mover', index: i };
    }
    return null;
  }

  confirmRemove() {
    const sel = this.removeSel;
    if (!sel) return;
    const key = this.obstacleKey(sel.kind, sel.index);
    const apply = () => {
      this.removed.add(key);
      this.removeSel = null;
      this.removeMode = false;
      this.hintTier = Math.max(this.hintTier, 2);
      this.refresh();
      sfx.hint();
      this.toast('障碍已移除 · 重开会恢复');
    };
    if (this.hintFree(2)) apply();
    else this.startAd(apply);
  }

  /* ---------------- 皮肤 ---------------- */

  skinUnlocked(id) {
    return this.save.skins.unlocked.includes(id);
  }

  equipSkin(id) {
    if (!this.skinUnlocked(id)) return;
    this.save.skins.equipped = id;
    this.skin = skinById(id);
    persist(this.save);
    this.toast(`已换上「${this.skin.name}」`);
  }

  unlockSkin(id) {
    if (this.skinUnlocked(id)) {
      this.equipSkin(id);
      return;
    }
    this.startAd(() => {
      this.save.skins.unlocked.push(id);
      this.save.skins.equipped = id;
      this.skin = skinById(id);
      persist(this.save);
      this.toast(`已解锁「${this.skin.name}」`);
    });
  }

  /* ---------------- 选关 ---------------- */

  openLevels() {
    if (this.phase === 'levels') return; // 防重复
    this.levelsFrom = this.phase;
    this.phase = 'levels';
    this.modal = null;
    this.removeMode = false;
    this.dragging = false;
    this.pressedBtn = null;
    this.fade = 1;
  }

  /** 关掉选关：从关卡里进来的就回到那一关（暂停状态原样保留） */
  closeLevels() {
    const back = this.levelsFrom === 'play' ? 'play' : 'title';
    this.levelsFrom = null;
    this.phase = back;
    this.fade = 0.45;
  }

  /** 返回首页：清干净拖动 / 计时 / 遮罩，但保留存档 */
  goHome() {
    if (this.mode === 'beam') {
      this.exitBeamDemo();
      return;
    }
    this.dragging = false;
    this.removeMode = false;
    this.removeSel = null;
    this.modal = null;
    this.shareCanvas = null;
    this.result = null;
    this.hint = null;
    this.hintTier = 0;
    this.holdTime = 0;
    this.levelTime = 0;
    this.distance = 0;
    this.trail = [];
    this.pressedBtn = null;
    this.hoverBtn = null;
    this.levelsFrom = null;
    this.hidden = false; // 微信切后台 / 系统中断
    this.nudge = createNudgeState();
    if (this.save && this.save.audio) {
      sfx.setBgm(this.save.audio.bgm);
      sfx.setSfx(this.save.audio.sfx);
    }
    this.adToken++; // 作废还没回来的广告回调
    this.buildLevel(this.attractLevel);
    this.phase = 'title';
    this.fade = 1;
  }

  openSkins() {
    if (this.phase !== 'play' && this.phase !== 'title' && this.phase !== 'win') return;
    this.modal = 'skins';
  }

  levelCleared(i) {
    return !!this.save.best[LEVELS[i].id];
  }

  levelCell(i) {
    const cols = 5;
    const cw = 116;
    const ch = 58;
    const gx = 12;
    const gy = 7;
    const x0 = (720 - (cols * cw + (cols - 1) * gx)) / 2;
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { x: x0 + col * (cw + gx), y: 268 + row * (ch + gy), w: cw, h: ch };
  }

  /* ---------------- 输入 ---------------- */

  pointerDown(x, y) {
    if (this.mode === 'beam') {
      if (this.beam) this.beam.pointerDown(x, y);
      return;
    }
    if (this.modal === 'ad') return;

    if (this.modal === 'share') {
      if (this.inRect(this.ui.saveImg, x, y)) this.saveShare();
      else if (this.inRect(this.ui.close, x, y)) this.modal = null;
      return;
    }

    if (this.modal === 'skins') {
      SKINS.forEach((sk, i) => {
        if (this.inRect(this.skinRow(i), x, y)) {
          if (this.skinUnlocked(sk.id)) this.equipSkin(sk.id);
          else this.unlockSkin(sk.id);
        }
      });
      if (this.inRect(this.ui.skinClose, x, y)) this.modal = null;
      return;
    }

    if (this.modal === 'hint') {
      if (this.inRect(this.hintRow(0), x, y)) this.requestHint(1);
      else if (this.inRect(this.hintRow(1), x, y)) this.enterRemoveMode();
      else if (this.inRect(this.hintRow(2), x, y)) this.requestHint(3);
      else if (this.inRect(this.ui.close, x, y)) this.modal = null;
      return;
    }

    if (this.phase === 'levels') {
      for (let i = 0; i < LEVELS.length; i++) {
        if (this.inRect(this.levelCell(i), x, y)) {
          if (this.isUnlocked(i)) {
            sfx.unlock();
            this.startLevel(i);
          } else {
            this.toast('还没解锁，先通关前一关');
          }
          return;
        }
      }
      if (this.inRect(this.ui.back, x, y)) this.closeLevels();
      else if (this.inRect(this.ui.skinBtn, x, y)) this.modal = 'skins';
      return;
    }

    if (this.phase === 'title') {
      if (this.hitStart(x, y)) {
        sfx.unlock();
        this.startLevel(Math.min(this.save.unlocked, LEVELS.length - 1), { resetTime: true });
      } else if (this.inRect(this.ui.levels, x, y)) {
        sfx.unlock();
        this.openLevels();
      } else if (this.inRect(this.ui.skins, x, y)) {
        sfx.unlock();
        this.modal = 'skins';
      } else if (this.inRect(this.ui.beam, x, y)) {
        sfx.unlock();
        this.startBeamDemo();
      } else if (this.inRect(this.ui.audioBgm, x, y)) {
        this.toggleAudio('bgm');
      } else if (this.inRect(this.ui.audioSfx, x, y)) {
        this.toggleAudio('sfx');
      }
      return;
    }

    if (this.phase === 'win') {
      if (this.hitNext(x, y)) this.next();
      else if (this.hitAgain(x, y)) this.restart();
      else if (this.hitShare(x, y)) this.openShare();
      return;
    }

    // 移除模式：只处理选障碍和确认/取消
    if (this.removeMode) {
      if (this.inRect(this.ui.removeCancel, x, y)) {
        this.exitRemoveMode();
        return;
      }
      if (this.inRect(this.ui.removeOk, x, y)) {
        this.confirmRemove();
        return;
      }
      const sp = inBand({ x, y }, this.sceneLayout) ? screenToScene({ x, y }, this.sceneLayout, this.sceneDir) : null;
      const sel = sp ? this.selectObstacleAt(sp.x, sp.y) : null;
      if (sel) this.removeSel = sel;
      return;
    }

    // 底栏按钮：命中即处理并 return，绝不会顺手把光源拖起来
    const btn = this.buttonAt(x, y);
    if (btn) {
      this.pressedBtn = { name: btn, until: this.t + 0.18 };
      this.dragging = false;
      this.activate(btn);
      return;
    }

    if (!inBand({ x, y }, this.sceneLayout)) return; // 点在玩法带之外：不开始拖拽
    sfx.unlock();
    const sp = screenToScene({ x, y }, this.sceneLayout, this.sceneDir);
    // 点到哪盏灯就拖哪盏。旋转后命中半径按屏幕像素给，手感一致
    let pick = -1;
    let bd = 80;
    this.lights.forEach((L, i) => {
      const d = Math.hypot(L.pos.x - sp.x, L.pos.y - sp.y);
      if (d < bd) {
        bd = d;
        pick = i;
      }
    });
    if (pick >= 0) this.active = pick;
    this.dragging = true;
    this.lights[this.active].target = { x: sp.x, y: sp.y };
  }

  pointerMove(x, y) {
    if (this.mode === 'beam') {
      if (this.beam) this.beam.pointerMove(x, y);
      return;
    }
    if (!this.dragging || this.phase !== 'play' || this.modal || this.removeMode) return;
    // 拖动过程中允许手指移出玩法带，但坐标始终按同一套逆变换
    const sp = screenToScene({ x, y }, this.sceneLayout, this.sceneDir);
    this.lights[this.active].target = { x: sp.x, y: sp.y };
  }

  pointerUp() {
    if (this.mode === 'beam') {
      if (this.beam) this.beam.pointerUp();
      return;
    }
    this.dragging = false;
  }

  /** 音乐 / 音效开关（首页两个小胶囊），偏好写进存档 */
  toggleAudio(kind) {
    const a = this.save.audio || { bgm: true, sfx: true };
    a[kind] = !a[kind];
    this.save.audio = a;
    persist(this.save);
    if (kind === 'bgm') {
      sfx.setBgm(a.bgm);
      if (a.bgm) sfx.unlock();
      this.toast(a.bgm ? '音乐已开启' : '音乐已关闭');
    } else {
      sfx.setSfx(a.sfx);
      if (a.sfx) {
        sfx.unlock();
        sfx.hint();
      }
      this.toast(a.sfx ? '音效已开启' : '音效已关闭');
    }
  }

  nudge(dx, dy) {
    if (this.mode === 'beam') return;
    if (this.phase !== 'play' || this.modal || this.removeMode) return;
    // 传进来的是"屏幕方向"，先转成逻辑方向，玩家按上下左右才和画面对得上
    const d = screenDirToScene(dx, dy);
    dx = d.x;
    dy = d.y;
    const L = this.lights[this.active];
    const B = this.level.bounds || BOUNDS;
    L.target = {
      x: Math.max(B.x0, Math.min(B.x1, L.target.x + dx)),
      y: Math.max(B.y0, Math.min(B.y1, L.target.y + dy)),
    };
  }

  /* ---------------- 布局 ---------------- */

  get ui() {
    return {
      start: { x: 250, y: 690, w: 220, h: 78 },
      levels: { x: 250, y: 786, w: 220, h: 56 },
      skins: { x: 250, y: 862, w: 220, h: 56 },
      beam: { x: 250, y: 926, w: 220, h: 56 },
      audioBgm: { x: 128, y: 998, w: 212, h: 54 },
      audioSfx: { x: 380, y: 998, w: 212, h: 54 },
      // 底栏五个图标（见 bottomBar），这里不再保留文字按钮矩形
      back: { x: 172, y: 1090, w: 180, h: 56 },
      skinClose: { x: 250, y: 830, w: 220, h: 56 },
      skinBtn: { x: 372, y: 1090, w: 180, h: 56 },
      removeOk: { x: 180, y: 1002, w: 360, h: 64 },
      removeCancel: { x: 250, y: 1078, w: 220, h: 56 },
      next: { x: 186, y: 742, w: 348, h: 82 },
      again: { x: 250, y: 844, w: 220, h: 56 },
      share: { x: 250, y: 916, w: 220, h: 56 },
      saveImg: { x: 190, y: 980, w: 340, h: 62 },
      close: { x: 250, y: 1058, w: 220, h: 56 },
    };
  }

  /**
   * 底栏：选关 → 重来 → 提示 → 皮肤 → 首页。
   * 视觉圆 48，命中区 92×92（360 CSS 宽的手机上约 46 CSS px），相邻命中区不重叠。
   * 绘制、命中、悬停提示、无障碍顺序都读这一份数据。
   */
  get bottomBar() {
    const items = [
      { id: 'levels', label: '选关' },
      { id: 'restart', label: '重来' },
      { id: 'hint', label: '提示' },
      { id: 'skin', label: '光源皮肤' },
      { id: 'home', label: '返回首页' },
    ];
    const gap = 96;
    const cx0 = 360 - gap * 2;
    return items.map((it, i) => {
      const cx = cx0 + i * gap;
      const cy = 1174;
      return { ...it, cx, cy, x: cx - 24, y: cy - 24, w: 48, h: 48, hx: cx - 46, hy: cy - 46, hw: 92, hh: 92 };
    });
  }

  /** 底部按钮：返回 id，方便命中、悬停提示和无障碍 */
  buttonAt(x, y) {
    if (this.phase !== 'play' || this.modal || this.removeMode) return null;
    for (const b of this.bottomBar) {
      if (x >= b.hx && x <= b.hx + b.hw && y >= b.hy && y <= b.hy + b.hh) return b.id;
    }
    return null;
  }

  press(name) {
    this.pressedBtn = { name, until: this.t + 0.18 };
  }

  hintRow(i) {
    return { x: 76, y: 470 + i * 92, w: 568, h: 78 };
  }

  skinRow(i) {
    return { x: 76, y: 300 + i * 108, w: 568, h: 92 };
  }

  inRect(r, x, y) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
  hitStart(x, y) {
    return this.inRect(this.ui.start, x, y);
  }
  hitNext(x, y) {
    return this.inRect(this.ui.next, x, y);
  }
  hitAgain(x, y) {
    return this.inRect(this.ui.again, x, y);
  }
  hitShare(x, y) {
    return this.inRect(this.ui.share, x, y);
  }
  hitClose(x, y) {
    return this.inRect(this.ui.close, x, y);
  }
}
