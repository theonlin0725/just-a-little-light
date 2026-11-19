// 入口：画布尺寸、输入、主循环。游戏逻辑全在 game.js，绘制全在 render.js。
import { Game } from './game.js';
import { draw } from './render.js';
import { VIEW, LEVELS } from './levels-live.js';
import { computeLayout, toLogical as toLogicalIn, drawTransform } from './viewport.js';
import { planFrame } from './loop.js';
import { createVisualClock } from './clock.js';
import { skinById } from './skins.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: false });
const game = new Game();

let scale = 1;
let offX = 0;
let offY = 0;
let dpr = 1;
let layout = null;
let view = null;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  // 和微信端共用同一套视口换算；浏览器没有刘海/胶囊，pad 设 0 保持原样
  layout = computeLayout({ winW: w, winH: h, pad: 0 });
  scale = layout.scale;
  offX = layout.offX;
  offY = layout.offY;
  view = drawTransform(layout, canvas.width, canvas.height);
}

function toLogical(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const p = toLogicalIn(layout, clientX - r.left, clientY - r.top);
  return p;
}

/* ---------------- 输入 ---------------- */

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try {
    canvas.setPointerCapture?.(e.pointerId);
  } catch {
    /* 合成事件没有真实 pointerId，忽略 */
  }
  const p = toLogical(e.clientX, e.clientY);
  game.pointerDown(p.x, p.y);
});

canvas.addEventListener('pointermove', (e) => {
  const p = toLogical(e.clientX, e.clientY);
  // 鼠标才有悬停提示；触摸不依赖它
  if (e.pointerType === 'mouse') game.hoverBtn = game.buttonAt(p.x, p.y);
  if (!game.dragging && game.mode !== 'beam') return;
  e.preventDefault();
  game.pointerMove(p.x, p.y);
});

canvas.addEventListener('pointerleave', () => {
  game.hoverBtn = null;
});

const endDrag = () => game.pointerUp();
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 4 : 16;
  if (e.key === 'ArrowUp') game.nudge(0, -step);
  else if (e.key === 'ArrowDown') game.nudge(0, step);
  else if (e.key === 'ArrowLeft') game.nudge(-step, 0);
  else if (e.key === 'ArrowRight') game.nudge(step, 0);
  else if (e.key === 'r' || e.key === 'R') game.activate('restart');
  else if (e.key === 'h' || e.key === 'H') game.activate('hint');
  else if (e.key === 'Enter' && (game.phase === 'win' || (game.mode === 'beam' && game.beam && game.beam.phase === 'win'))) game.next();
  else return;
  e.preventDefault();
});

/* ---------------- 主循环 ---------------- */

let last = performance.now();
let acc = 0;
const clock = createVisualClock();

function frame(now) {
  const deltaMs = now - last;
  last = now;
  const delta = deltaMs / 1000;
  clock.tick(deltaMs, document.hidden);
  const plan = planFrame(acc, delta);
  acc = plan.acc;
  for (let i = 0; i < plan.steps.length; i++) game.update(plan.steps[i]);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.a, 0, 0, view.a, view.e, view.f);
  try {
    draw(ctx, game, clock.time);
  } catch (e) {
    if (!frame.__failed) {
      frame.__failed = true;
      console.error('[draw] 渲染异常：', (e && e.stack) || e);
    }
  }

  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
document.addEventListener('visibilitychange', () => {
  last = performance.now();
});

resize();
requestAnimationFrame(frame);

// 调试入口：?level=4&light=150,660&nofade=1
const q = new URLSearchParams(location.search);
if (q.has('beam')) {
  const i = Math.max(0, Number(q.get('beam')) || 0);
  game.startBeamDemo(i);
}
if (q.has('level')) {
  const i = Math.max(0, Math.min(LEVELS.length - 1, Number(q.get('level')) - 1));
  game.startLevel(i, { resetTime: true });
}
if (q.has('light')) {
  const [x, y] = q.get('light').split(',').map(Number);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    for (const L of game.lights) {
      L.pos = { x, y };
      L.target = { x, y };
    }
  }
}
if (q.has('nofade')) game.fade = 0;
if (q.has('win')) {
  // 调试用：直接摆成通关瞬间，方便看结算界面
  game.levelTime = Number(q.get('win')) || 37.4;
  game.distance = 412.7;
  game.crystals.forEach((c) => {
    c.lit = true;
    c.glow = 1;
  });
  game.win(false);
  game.winAt = -100;
}
if (q.has('sim')) {
  // 调试用：先快进 N 秒游戏时间，方便截到"保持到一半"这类状态
  const secs = Number(q.get('sim')) || 0;
  for (let i = 0; i < secs * 60; i++) game.update(1 / 60);
}
if (q.has('modal')) {
  const m = q.get('modal');
  if (m === 'share') game.openShare();
  else if (m === 'ad') game.startAd(() => {});
  else game.modal = m;
}
if (q.has('phase')) {
  if (q.get('phase') === 'levels') game.openLevels();
  else game.phase = q.get('phase');
}
if (q.has('remove')) game.enterRemoveMode();
if (q.has('hover')) game.hoverBtn = q.get('hover');
if (q.has('skin')) {
  game.save.skins.equipped = q.get('skin');
  game.skin = skinById(q.get('skin'));
}
if (q.has('active')) game.active = Number(q.get('active')) || 0;

// QA 钩子：只在 ?qa=1 时暴露，供真机/浏览器自动化读取状态和坐标换算
if (q.has('qa')) {
  window.__game = game;
  window.__toScreen = (x, y) => ({ x: offX + x * scale, y: offY + y * scale });
  window.__toLogical = (x, y) => toLogical(x, y);
}

/* ---------------- 无障碍：给两个图标按钮真实的可聚焦按钮 ---------------- */
const bind = (id, fn) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
};
bind('btn-levels', () => game.activate('levels'));
bind('btn-restart', () => game.activate('restart'));
bind('btn-hint', () => game.activate('hint'));
bind('btn-skins', () => game.activate('skin'));
bind('btn-home', () => game.activate('home'));

/** 屏幕阅读器读到的状态，不参与画面 */
function syncA11y() {
  const el = document.getElementById('a11y-status');
  if (!el) return;
  el.textContent =
    game.mode === 'beam' && game.beam
      ? `光学试玩，第 ${game.beam.index + 1} 关 ${game.beam.level.name}`
      : game.modal === 'skins'
        ? `光源皮肤面板，当前装备 ${game.skin.name}`
        : game.phase === 'levels'
          ? '选关界面'
          : game.phase === 'play'
            ? `第 ${game.levelIndex + 1} 关 ${game.level.name}`
            : '首页';
}
setInterval(syncA11y, 500);

/* ---------------- 浏览器端自测：验证坐标→点击→状态切换的完整链路 ---------------- */
function runSelfTest() {
  const out = [];
  const ok = (cond, msg) => out.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  const toScreen = (lx, ly) => ({ x: offX + lx * scale, y: offY + ly * scale });
  const tap = (lx, ly, pointerType = 'touch') => {
    const s = toScreen(lx, ly);
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: s.x, clientY: s.y, pointerType, bubbles: true, cancelable: true, pointerId: 7,
    }));
  };
  const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const bar = (id) => game.bottomBar.find((b) => b.id === id);
  const tapBtn = (id, type) => tap(bar(id).cx, bar(id).cy, type);

  game.startLevel(0, { resetTime: true });

  // 0. 底栏顺序与互不重叠
  const ids = game.bottomBar.map((b) => b.id).join(',');
  ok(ids === 'levels,restart,hint,skin,home', `底栏顺序 ${ids}`);
  let overlap = false;
  const bs = game.bottomBar;
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i];
      const b = bs[j];
      if (a.hx < b.hx + b.hw && b.hx < a.hx + a.hw) overlap = true;
    }
  }
  ok(!overlap, '五个热区互不重叠');
  ok(bs.every((b) => 92 * (360 / 720) >= 44), `窄屏(360px)热区 ${(92 * (360 / 720)).toFixed(1)} CSS px`);

  // 1. 旧的错误热区（画面中央）不再是热区
  tap(360, 800);
  ok(game.phase === 'play', '画面中央不再是选关隐形热区');
  game.pointerUp();

  // 2. 选关（触摸）
  tapBtn('levels', 'touch');
  ok(game.phase === 'levels', '触摸点"选关"进入选关界面');

  // 3. 选关里点第 1 关
  const c0 = center(game.levelCell(0));
  tap(c0.x, c0.y, 'touch');
  ok(game.phase === 'play' && game.levelIndex === 0, '选关里点关卡可以进入');

  // 4. 从关卡进选关再返回
  tapBtn('levels', 'mouse');
  ok(game.phase === 'levels', '鼠标点"选关"也生效');
  tap(center(game.ui.back).x, center(game.ui.back).y, 'mouse');
  ok(game.phase === 'play', '选关返回后回到正在玩的关卡');

  // 5. 重来
  for (let i = 0; i < 30; i++) game.update(1 / 60);
  tapBtn('restart');
  ok(game.levelTime < 0.1 && game.phase === 'play', '点"重来"重置本局计时');

  // 6. 提示
  tapBtn('hint');
  ok(game.modal === 'hint', '点"提示"打开提示面板');
  tap(center(game.ui.close).x, center(game.ui.close).y);
  ok(game.modal === null, '关闭提示面板');

  // 7. 皮肤
  tapBtn('skin');
  ok(game.modal === 'skins', '点"皮肤"打开皮肤面板');
  tap(center(game.ui.skinClose).x, center(game.ui.skinClose).y);
  ok(game.modal === null && game.phase === 'play', '关闭皮肤面板回到关卡');

  // 8. 首页
  tapBtn('home');
  ok(game.phase === 'title', '点"首页"返回首页');
  ok(game.modal === null && !game.dragging, '回到首页后没有残留遮罩或拖动');

  // 9. 反复开关不失效
  game.startLevel(0, { resetTime: true });
  let stable = true;
  for (let i = 0; i < 5; i++) {
    tapBtn('levels');
    if (game.phase !== 'levels') stable = false;
    tap(center(game.ui.back).x, center(game.ui.back).y);
    if (game.phase !== 'play') stable = false;
  }
  ok(stable, '连续开关选关 5 次仍然正常');

  // 10. 点按钮不会拖动光源
  const before = { ...game.lights[0].target };
  tapBtn('levels');
  ok(!game.dragging, '点按钮不会开始拖动光源');
  tap(center(game.ui.back).x, center(game.ui.back).y);
  ok(game.lights[0].target.x === before.x && game.lights[0].target.y === before.y, '光源位置没有被按钮带偏');

  // 10.2 桌面端悬停：pointermove 设置提示，pointerleave 清除
  const mv = (lx, ly) => {
    const p = toScreen(lx, ly);
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: p.x, clientY: p.y, pointerType: 'mouse', bubbles: true, cancelable: true, pointerId: 9,
    }));
  };
  mv(bar('restart').cx, bar('restart').cy);
  ok(game.hoverBtn === 'restart', '鼠标悬停命中"重来"提示');
  canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
  ok(game.hoverBtn === null, '移出画布清除悬停提示');

  // 10.5 键盘快捷键：H 开提示、R 重来
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
  ok(game.modal === 'hint', 'H 键打开提示面板');
  tap(center(game.ui.close).x, center(game.ui.close).y);
  for (let i = 0; i < 30; i++) game.update(1 / 60);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  ok(game.levelTime < 0.1, 'R 键重开本关');

  // 10.8 无障碍控件：五个隐藏按钮都能触发
  game.startLevel(0, { resetTime: true });
  const dom = (id) => document.getElementById(id);
  dom('btn-levels').click();
  ok(game.phase === 'levels', '无障碍按钮可打开选关');
  dom('btn-levels').click(); // 关不掉，用返回
  tap(center(game.ui.back).x, center(game.ui.back).y);
  dom('btn-restart').click();
  ok(game.levelTime < 0.1, '无障碍按钮可重来');
  dom('btn-hint').click();
  ok(game.modal === 'hint', '无障碍按钮可开提示');
  tap(center(game.ui.close).x, center(game.ui.close).y);
  dom('btn-skins').click();
  ok(game.modal === 'skins', '无障碍按钮可开皮肤');
  tap(center(game.ui.skinClose).x, center(game.ui.skinClose).y);
  dom('btn-home').click();
  ok(game.phase === 'title', '无障碍按钮可回首页');

  // 11. 面板打开时保持计时冻结
  game.startLevel(24);
  tapBtn('skin');
  const h0 = game.holdTime;
  const t0 = game.levelTime;
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  ok(game.holdTime === h0 && game.levelTime === t0, '皮肤面板打开时计时不走');
  tap(center(game.ui.skinClose).x, center(game.ui.skinClose).y);

  const pass = out.filter((l) => l.startsWith('PASS')).length;
  const el = document.createElement('div');
  el.id = 'selftest';
  el.textContent = `SELFTEST ${pass}/${out.length}\n${out.join('\n')}`;
  el.style.cssText = 'position:fixed;left:0;top:0;z-index:99;font:12px monospace;color:#0f0;background:#000;padding:4px;white-space:pre;';
  document.body.appendChild(el);
  document.title = `SELFTEST ${pass}/${out.length}`;
  return out;
}

// 方便调试
window.__game = game;// 方便调试
window.__game = game;
window.__toLogical = toLogical;
window.__viewport = () => ({ scale, offX, offY, dpr });

// 自测放到最后：此时按钮绑定、无障碍控件都已就位
if (q.has('selftest')) {
  // 同步跑，保证 --dump-dom 一定能抓到结果
  window.__selftest = runSelfTest();
}
