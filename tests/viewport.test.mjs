// 视口换算单测：窗口/DPR/安全区/胶囊/画布 backing 的多种组合。
//   node tests/viewport.test.mjs

import { computeLayout, toLogical, drawTransform, contentRectInBacking, WORLD } from '../src/viewport.js';

let pass = 0;
let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

console.log('\n[1] iPhone 12/13：刘海 + 胶囊 + home indicator');
{
  const L = computeLayout({ winW: 390, winH: 844, safeTop: 47, safeBottom: 34, capsuleBottom: 86 });
  ok(L.padTop === 92, `顶部让出胶囊 92px（47/86 取大 + 6）`);
  ok(near(L.padTop, 92), '');
  ok(L.content.y >= L.padTop - 0.01, `内容不进入胶囊区 (y=${L.content.y.toFixed(1)})`);
  ok(L.content.y + L.content.h <= 844 - 40 + 0.01, '内容不进入 home indicator 区');
  ok(near(L.content.x + L.content.w / 2, 390 / 2, 0.01), '水平居中');
  ok(near(L.scale, Math.min(390 / WORLD.w, (844 - 92 - 40) / WORLD.h)), '等比缩放');
}

console.log('\n[2] 安全区/胶囊缺失时的兜底');
{
  const L = computeLayout({ winW: 375, winH: 667 });
  ok(L.padTop === 6 && L.padBottom === 6, '没有安全区时只留 6px 呼吸边');
  ok(L.content.x >= 0 && L.content.x + L.content.w <= 375.01, '不左右溢出');
  const L2 = computeLayout({ winW: 375, winH: 667, safeTop: null, safeBottom: null, capsuleBottom: null });
  ok(L2.padTop === 6, 'null 值不炸');
}

console.log('\n[3] DPR 1 / 2 / 3');
{
  for (const dpr of [1, 2, 3]) {
    const L = computeLayout({ winW: 390, winH: 844, pad: 0 });
    const t = drawTransform(L, 390 * dpr, 844 * dpr);
    ok(near(t.bx, dpr) && near(t.by, dpr), `dpr=${dpr} 时 backing 比例正确`);
    const r = contentRectInBacking(L, 390 * dpr, 844 * dpr);
    ok(near(r.x, L.offX * dpr, 0.5) && near(r.w, WORLD.w * L.scale * dpr, 0.5), `dpr=${dpr} 时内容矩形跟着放大`);
  }
}

console.log('\n[4] 窄屏 / 长屏：不溢出、居中');
{
  for (const [w, h] of [[320, 568], [360, 740], [430, 932], [768, 1024]]) {
    const L = computeLayout({ winW: w, winH: h, safeTop: 24, safeBottom: 20, capsuleBottom: 60 });
    const fits = L.content.x >= -0.01 && L.content.x + L.content.w <= w + 0.01
      && L.content.y >= L.padTop - 0.01 && L.content.y + L.content.h <= h - L.padBottom + 0.01;
    ok(fits, `${w}x${h} 内容完全落在可用区内`);
    ok(near(L.content.x * 2 + L.content.w, w, 0.01), `${w}x${h} 水平居中`);
  }
}

console.log('\n[5] 运行时忽略 canvas 尺寸时不能画歪');
{
  const L = computeLayout({ winW: 390, winH: 844, pad: 0 });
  // 运行时拒绝了 backing 设置，canvas 仍是 390×844（backingRatio=1）
  const t = drawTransform(L, 390, 844);
  ok(near(t.bx, 1) && near(t.by, 1), 'backingRatio 退回 1');
  ok(near(t.a, L.scale), '变换按 1 倍算，内容仍铺满宽度');
  const r = contentRectInBacking(L, 390, 844);
  ok(near(r.w, 390, 0.5), `内容宽度 ≈ 窗口宽度（${r.w.toFixed(1)}）`);
  ok(near(r.x + r.w / 2, 195, 0.5), '仍然居中');
}

console.log('\n[6] 画布比窗口大 / 两轴比例不一致');
{
  const L = computeLayout({ winW: 390, winH: 844, pad: 0 });
  const t2 = drawTransform(L, 1170, 2532);
  ok(near(t2.bx, 3) && near(t2.by, 3), '3 倍 backing');
  const mixed = drawTransform(L, 1170, 1688);
  ok(near(mixed.used, 2), '两轴不一致时取较小比例，避免变形');
  const r = contentRectInBacking(L, 1170, 1688);
  ok(r.x >= -0.5 && r.x + r.w <= 1170.5, '仍在画布内');
}

console.log('\n[7] 触摸换算与绘制共用同一份 layout');
{
  const L = computeLayout({ winW: 390, winH: 844, safeTop: 47, safeBottom: 34, capsuleBottom: 86 });
  const lx = 360;
  const ly = 640;
  const cx = L.offX + lx * L.scale;
  const cy = L.offY + ly * L.scale;
  const back = toLogical(L, cx, cy);
  ok(near(back.x, lx, 0.001) && near(back.y, ly, 0.001), '逻辑→屏幕→逻辑 往返一致');
  // 底栏五个图标中心都必须落在窗口内
  for (const bx of [168, 264, 360, 456, 552]) {
    const x = L.offX + bx * L.scale;
    ok(x > 0 && x < 390, `底栏图标 x=${bx} 在窗口内`);
  }
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
