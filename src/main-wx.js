// 微信小游戏入口。
// 复用同一套 Game / render / geometry / 关卡数据，只替换平台能力。
//
// 坐标只有一份真值：viewport.js 算出的 layout。
// 绘制用 drawTransform(layout, 实际 canvas 尺寸)，触摸用 toLogical(layout)，
// 两边都从同一个 layout 出发，不允许各算一套。

import { plat, initWxPlatform, refreshWxEnvironment } from './platform.js';
import { Game } from './game.js';
import { draw } from './render.js';
import { VIEW } from './levels-live.js';
import { ads } from './ads.js';
import { sfx } from './audio.js';
import { contentStamp } from './content.js';
import { installQa } from './qa-wx.js';
import { createFrameRunner } from './frame.js';
import { createCtxGuard } from './ctxguard.js';
import { createVisualClock } from './clock.js';
import { quality } from './quality.js';
import { computeLayout, toLogical, drawTransform, contentRectInBacking, WORLD } from './viewport.js';
import { createTouchTracker } from './input-wx.js';
import { planFrame, STEP } from './loop.js';

/* 构建时由 scripts/build-wechat.mjs 注入（直接引用，打包器才能常量折叠） */
const AD_UNIT_ID = __WX_AD_UNIT_ID__;
const BUILD_ID = __WX_BUILD_ID__;
const QA = __WX_QA__;

initWxPlatform(wx);

// 真实广告：provider 固定 wx。adUnitId 为空时 ads 内部直接返回 unavailable，不创建实例
ads.configure({ provider: 'wx', adUnitId: AD_UNIT_ID });
if (!AD_UNIT_ID) {
  console.warn('[ads] 未配置广告位 ID：激励视频返回"广告暂不可用"，不创建广告实例');
}

const canvas = plat.canvas;
const ctx = canvas.getContext('2d');
const guard = createCtxGuard(ctx);
const game = new Game();

/** 启动参数直达 V2 光学试玩：DevTools 里把编译模式/启动参数设为 beam=0..5 */
let launchQueryApplied = false;
function applyLaunchQuery(query) {
  if (launchQueryApplied || !query || query.beam === undefined) return;
  launchQueryApplied = true;
  const i = Math.max(0, Number(query.beam) || 0);
  game.startBeamDemo(i);
}
try {
  if (wx.getLaunchOptionsSync) applyLaunchQuery(wx.getLaunchOptionsSync().query);
} catch {
  /* 低版本或非小游戏环境没有该接口 */
}

// 微信端默认标准画质（DPR 上限 2），失败会继续降级到 safe
quality.set('standard');

/* ---------------- 视口 ---------------- */
let layout = computeLayout(plat.env);
let transform = drawTransform(layout, canvas.width, canvas.height);

function refreshViewport(reason) {
  refreshWxEnvironment(wx); // 重新读窗口/安全区/胶囊，并同步 canvas backing
  layout = computeLayout(plat.env);
  transform = drawTransform(layout, canvas.width, canvas.height);
  // 个别运行时首次赋值不生效：下一帧再试一次，并把差异打出来
  const wantW = Math.round(plat.env.winW * plat.env.dpr);
  const wantH = Math.round(plat.env.winH * plat.env.dpr);
  if ((canvas.width !== wantW || canvas.height !== wantH) && !refreshViewport.retried) {
    refreshViewport.retried = true;
    console.warn(`[viewport] canvas backing 未被接受：want ${wantW}x${wantH} got ${canvas.width}x${canvas.height}，下一帧重试`);
    setTimeout(() => {
      canvas.width = wantW;
      canvas.height = wantH;
      layout = computeLayout(plat.env);
      transform = drawTransform(layout, canvas.width, canvas.height);
    }, 80);
  }
  if (QA) {
    const r = contentRectInBacking(layout, canvas.width, canvas.height);
    console.log(
      `[viewport:${reason}] win=${plat.env.winW}x${plat.env.winH} dpr=${plat.env.dpr} ` +
        `safeTop=${plat.env.safeTop} safeBottom=${plat.env.safeBottom} capsuleBottom=${plat.env.capsuleBottom} ` +
        `canvas=${canvas.width}x${canvas.height} scale=${layout.scale.toFixed(4)} ` +
        `off=(${layout.offX.toFixed(1)},${layout.offY.toFixed(1)}) ` +
        `content=(${r.x.toFixed(1)},${r.y.toFixed(1)},${r.w.toFixed(1)},${r.h.toFixed(1)}) ` +
        `backingRatio=${transform.bx.toFixed(3)}/${transform.by.toFixed(3)}`
    );
  }
}

/* ---------------- 触摸 ---------------- */
const touch = createTouchTracker({
  onStart(cx, cy) {
    if (fatalInfo) {
      const p = toLogical(layout, cx, cy);
      if (p.x >= retryRect.x && p.x <= retryRect.x + retryRect.w && p.y >= retryRect.y && p.y <= retryRect.y + retryRect.h) {
        retryFromFatal();
      }
      return;
    }
    sfx.unlock();
    const p = toLogical(layout, cx, cy);
    game.pointerDown(p.x, p.y);
  },
  onMove(cx, cy) {
    if (!game.dragging && game.mode !== 'beam') return;
    const p = toLogical(layout, cx, cy);
    game.pointerMove(p.x, p.y);
  },
  onEnd() {
    game.pointerUp();
  },
});

wx.onTouchStart((e) => touch.touchStart(e));
wx.onTouchMove((e) => touch.touchMove(e));
wx.onTouchEnd((e) => touch.touchEnd(e));
wx.onTouchCancel(() => touch.touchCancel());

/* ---------------- 生命周期 ---------------- */
let last = Date.now();
wx.onHide(() => {
  game.setHidden(true);
  touch.reset(); // 切后台时把拖动状态清掉，避免回来还粘着
  sfx.suspend();
});
wx.onShow((res) => {
  refreshViewport('show'); // 旋转 / 分屏 / 从后台回来都可能改窗口
  last = Date.now();
  game.setHidden(false);
  sfx.resume();
  applyLaunchQuery(res && res.query);
});
if (wx.onWindowResize) {
  wx.onWindowResize(() => refreshViewport('resize'));
}

/* ---------------- 全局异常（只记录，不再抛） ---------------- */
const bootErrors = [];
function noteError(kind, msg) {
  if (bootErrors.length < 20) bootErrors.push({ kind, msg: String(msg).slice(0, 300), at: Date.now() });
}
try {
  if (wx.onError) wx.onError((e) => noteError('wx.onError', (e && (e.message || e.stack)) || e));
  if (wx.onUnhandledRejection) wx.onUnhandledRejection((e) => noteError('unhandledRejection', (e && e.reason) || e));
} catch {
  /* 低版本没有这些钩子 */
}

/* ---------------- 分享 ---------------- */
if (wx.showShareMenu) wx.showShareMenu({ withShareTicket: true });
if (wx.onShareAppMessage) {
  wx.onShareAppMessage(() => ({
    title: '就差一点光 · 拖动一点光，点亮所有水晶',
  }));
}

/* ---------------- 主循环：唯一定时器 + 帧级错误边界 ---------------- */
refreshViewport('boot');
let acc = 0;
let fatalInfo = null;
const clock = createVisualClock();
const retryRect = { x: 0, y: 0, w: 0, h: 0 };

// 注意：这里在逻辑坐标系（720×1280）里画，不是 CSS px
function drawFatal() {
  const winW = VIEW.w;
  const winH = VIEW.h;
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, winW, winH);
  ctx.fillStyle = 'rgba(248,244,236,0.92)';
  ctx.font = `500 34px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('画面出错了', winW / 2, winH / 2 - 60);
  ctx.fillStyle = 'rgba(200,212,230,0.7)';
  ctx.font = `400 22px sans-serif`;
  ctx.fillText('这一关没有丢，点下面重试', winW / 2, winH / 2 - 16);
  const w = Math.min(300, winW - 80);
  retryRect.w = w;
  retryRect.h = 64;
  retryRect.x = (winW - w) / 2;
  retryRect.y = winH / 2 + 24;
  ctx.fillStyle = 'rgba(255,214,160,0.16)';
  ctx.strokeStyle = 'rgba(255,214,160,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const r = 16;
  const { x, y } = retryRect;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + retryRect.h - r);
  ctx.quadraticCurveTo(x + w, y + retryRect.h, x + w - r, y + retryRect.h);
  ctx.lineTo(x + r, y + retryRect.h);
  ctx.quadraticCurveTo(x, y + retryRect.h, x, y + retryRect.h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(248,244,236,0.95)';
  ctx.font = `500 24px sans-serif`;
  ctx.fillText('重试本关', winW / 2, y + 42);
  ctx.textAlign = 'left';
}

const runner = createFrameRunner({
  update() {
    const now = Date.now();
    const deltaMs = now - last;
    last = now;
    // 视觉时钟：秒、单调、后台冻结（与判定用的 sceneT 各自独立，但单位一致）
    clock.tick(deltaMs, game.hidden);
    const plan = planFrame(acc, deltaMs / 1000);
    acc = plan.acc;
    for (let i = 0; i < plan.steps.length; i++) game.update(plan.steps[i]);
  },
  draw() {
    guard.reset(); // 上一帧若中途抛错，先把 save/clip/alpha 清干净
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(transform.a, 0, 0, transform.a, transform.e, transform.f);
    if (fatalInfo) {
      drawFatal();
      return;
    }
    // 注意：这里必须传"秒"。曾经把 RAF 的毫秒直接当秒传，相位快 1000 倍，
    // 真机表现为光点抽搐。
    draw(ctx, game, clock.time);
  },
  onEvent(kind, info) {
    if (kind === 'error') console.error(`[draw/update] ${info.phase}: ${info.message}`, info.stack || '');
    if (kind === 'degrade') {
      // 连续失败：先降画质，再重算 DPR
      if (quality.degrade()) {
        console.warn('[quality] 连续绘制失败，降级到', quality.tier.name);
        refreshViewport('degrade');
      }
    }
    if (kind === 'fatal') {
      fatalInfo = info;
      console.error('[fatal] 连续渲染失败，已停在这里等用户重试', info);
    }
  },
});

function retryFromFatal() {
  fatalInfo = null;
  guard.reset();
  game.restart();
  runner.retry();
}

runner.start();

/* ---------------- 内部 QA 口（正式包不包含） ---------------- */
if (QA) {
  installQa({
    game,
    buildId: BUILD_ID,
    adUnitId: AD_UNIT_ID,
    ads,
    layout: () => ({
      scale: layout.scale,
      offX: layout.offX,
      offY: layout.offY,
      content: contentRectInBacking(layout, canvas.width, canvas.height),
      win: { w: plat.env.winW, h: plat.env.winH },
      dpr: plat.env.dpr,
      safeTop: plat.env.safeTop,
      safeBottom: plat.env.safeBottom,
      capsuleBottom: plat.env.capsuleBottom,
      canvas: { w: canvas.width, h: canvas.height },
      backingRatio: { x: transform.bx, y: transform.by },
      step: STEP,
    }),
    extra: {
    refresh: () => refreshViewport('qa'),
    diag: () => ({
      build: BUILD_ID,
      quality: quality.tier.name,
      fatal: runner.fatal,
      consecutive: runner.consecutive,
      lastError: runner.lastError,
      errors: runner.errors,
      bootErrors,
      step: STEP,
    }),
    retry: () => retryFromFatal(),
    setQuality: (name) => {
      const ok = quality.set(name);
      if (ok) refreshViewport('quality');
      return { ok, tier: quality.tier.name, dpr: plat.dpr };
    },
    quality: () => quality.tier.name,
    },
  });
}

console.log(`[boot] ${contentStamp()} build=${BUILD_ID} platform=${plat.kind} world=${WORLD.w}x${WORLD.h}`);
