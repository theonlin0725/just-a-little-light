// 视口换算：游戏逻辑（720×1280）↔ 触摸 CSS px ↔ Canvas backing px。
// 绘制与触摸共用这一份结果，任何时候只允许有一个真值来源。
//
// 关键点：Canvas 的 backing store 可能被运行时改写或忽略赋值，
// 所以绘制变换不直接假设 dpr，而是用"实际 backing / 窗口 CSS"反推比例。

export const WORLD = { w: 720, h: 1280 };

/**
 * 计算逻辑画面在窗口中的位置（单位：CSS px）。
 * @param {{winW:number, winH:number, safeTop?:number, safeBottom?:number, capsuleBottom?:number}} env
 */
export function computeLayout(env) {
  const winW = Math.max(1, env.winW || 1);
  const winH = Math.max(1, env.winH || 1);
  const pad = env.pad === undefined ? 6 : env.pad;
  // 顶部同时避开刘海(safeArea.top)与右上角胶囊(capsule.bottom)，取更靠下的那个
  const topInset = Math.max(env.safeTop || 0, env.capsuleBottom || 0);
  const padTop = Math.max(0, topInset + pad);
  const padBottom = Math.max(0, (env.safeBottom || 0) + pad);
  const availH = Math.max(1, winH - padTop - padBottom);

  // 等比、居中、允许对称留边
  const scale = Math.min(winW / WORLD.w, availH / WORLD.h);
  const w = WORLD.w * scale;
  const h = WORLD.h * scale;
  const offX = (winW - w) / 2;
  const offY = padTop + (availH - h) / 2;

  return {
    winW,
    winH,
    padTop,
    padBottom,
    availH,
    scale,
    offX,
    offY,
    content: { x: offX, y: offY, w, h },
  };
}

/**
 * 把窗口坐标（CSS px）映射到游戏逻辑坐标。
 * layout 必须是 computeLayout 的返回值，和绘制用的是同一份。
 */
export function toLogical(layout, clientX, clientY) {
  return {
    x: (clientX - layout.offX) / layout.scale,
    y: (clientY - layout.offY) / layout.scale,
  };
}

/**
 * 绘制变换：逻辑坐标 → backing store 像素。
 *
 * backingRatioX/Y 是"每 CSS px 几个 backing px"，由实际 canvas.width/height 反推。
 * 正常情况下它等于 dpr；如果运行时没接受我们设置的尺寸，也不会画歪。
 */
export function drawTransform(layout, canvasW, canvasH) {
  const bx = canvasW / layout.winW;
  const by = canvasH / layout.winH;
  // 两轴比例不一致说明运行时把画布拉伸了，取小的那个避免变形
  const b = Math.min(bx, by);
  return {
    a: layout.scale * b,
    e: layout.offX * b + (canvasW - layout.winW * b) / 2,
    f: layout.offY * b + (canvasH - layout.winH * b) / 2,
    bx,
    by,
    used: b,
  };
}

/**
 * 逻辑画面在 backing store 里的实际像素矩形。
 * 变换把逻辑原点 (0,0) 放到 (e,f)，所以矩形就是 (e, f, 720*a, 1280*a)。
 */
export function contentRectInBacking(layout, canvasW, canvasH) {
  const t = drawTransform(layout, canvasW, canvasH);
  return { x: t.e, y: t.f, w: WORLD.w * t.a, h: WORLD.h * t.a };
}
