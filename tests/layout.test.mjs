// 旋转布局：坐标往返、玩法带、方向映射、以及全 60 关渲染冒烟。
import { computeSceneLayout, sceneToScreen, screenToScene, screenDirToScene, inBand, SCENE_BOX } from '../src/layout.js';
import { LEVELS } from '../src/levels-live.js';
import { VIEW } from '../src/levels.js';

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const L = computeSceneLayout();

console.log('\n[1] 玩法带：铺满宽度、等比、在 HUD 与底栏之间');
{
  ok(near(L.band.w, 720), `带子宽度 ${L.band.w}（铺满）`);
  ok(L.band.h > 320 && L.band.h < 620, `带子高度 ${L.band.h.toFixed(1)}（按内容框等比缩放）`);
  ok(L.band.y >= 128 && L.band.y + L.band.h <= 1002, `带子 ${L.band.y}..${(L.band.y + L.band.h).toFixed(0)} 不压 HUD 与底栏`);
  ok(near(L.scale, (720 - 80) / (SCENE_BOX.y1 - SCENE_BOX.y0), 1e-9), '缩放系数 = (带宽-左右留边) / 内容框长边');
}

console.log('\n[2] 坐标往返（随机点）');
{
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const p = { x: SCENE_BOX.x0 + Math.random() * (SCENE_BOX.x1 - SCENE_BOX.x0), y: SCENE_BOX.y0 + Math.random() * (SCENE_BOX.y1 - SCENE_BOX.y0) };
    const s = sceneToScreen(p, L);
    const b = screenToScene(s, L);
    if (!near(b.x, p.x) || !near(b.y, p.y)) bad++;
  }
  ok(bad === 0, '200 个随机点 scene→screen→scene 完全一致');
}

console.log('\n[3] 墙在水晶上方（单侧关）');
{
  const wallY = sceneToScreen({ x: 138, y: 470 }, L).y; // 镜像后 1–24 关的目标墙
  const lightY = sceneToScreen({ x: 452, y: 1032 }, L).y; // 第 1 关光源起点
  ok(wallY < lightY, `墙 y=${wallY.toFixed(0)} 在光源 y=${lightY.toFixed(0)} 上方`);
}

console.log('\n[4] 双侧关：两面墙分居上下，光源在中间');
{
  const top = sceneToScreen({ x: 74, y: 470 }, L).y;
  const bottom = sceneToScreen({ x: 582, y: 470 }, L).y;
  ok(top < bottom, `上墙 ${top.toFixed(0)} < 下墙 ${bottom.toFixed(0)}`);
  ok(bottom - top > L.band.h * 0.6, `两墙间距 ${(bottom - top).toFixed(0)} 足够放下光源`);
}

console.log('\n[5] 方向映射：屏幕方向 ↔ 逻辑方向');
{
  const cases = [
    [[0, -1], '上'], [[1, 0], '右'], [[0, 1], '下'], [[-1, 0], '左'],
  ];
  for (const [[dx, dy], label] of cases) {
    const d = screenDirToScene(dx, dy);
    const L0 = sceneToScreen({ x: 400, y: 700 }, L);
    const L1 = sceneToScreen({ x: 400 + d.x, y: 700 + d.y }, L);
    const sx = L1.x - L0.x;
    const sy = L1.y - L0.y;
    const okX = Math.abs(sx) > Math.abs(sy) ? Math.sign(sx) === Math.sign(dx) : true;
    const okY = Math.abs(sy) >= Math.abs(sx) ? Math.sign(sy) === Math.sign(dy) : true;
    ok(okX && okY, `屏幕${label} → 逻辑 (${d.x},${d.y}) 实际位移 (${sx.toFixed(0)},${sy.toFixed(0)})`);
  }
}

console.log('\n[6] 玩法带命中判定');
{
  ok(inBand({ x: 360, y: L.band.y + 10 }, L), '带内点判为带内');
  ok(!inBand({ x: 360, y: L.band.y - 10 }, L), '带外点判为带外');
  ok(!inBand({ x: 360, y: 1174 }, L), '底栏区域不在玩法带里');
}

console.log('\n[7] 60 关渲染冒烟（不得抛错）');
{
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 720, height: 1280 };
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => grad;
      if (k === 'measureText') return () => ({ width: 20 });
      if (k === 'createImageData' || k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (typeof k === 'string' && /^(save|restore|beginPath|closePath|moveTo|lineTo|arc|rect|fill|stroke|fillRect|strokeRect|clip|translate|rotate|scale|transform|setTransform|setLineDash|quadraticCurveTo|bezierCurveTo|fillText|clearRect|drawImage|putImageData|ellipse|arcTo)$/.test(k)) return () => {};
      return undefined;
    },
    set() { return true; },
  });
  globalThis.localStorage = { _d: {}, getItem() { return null; }, setItem() {}, removeItem() {} };
  const { Game } = await import('../src/game.js');
  const { draw } = await import('../src/render.js');
  let threw = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const g = new Game();
    g.startLevel(i);
    try { draw(ctx, g, 1.7); } catch (e) { threw++; console.log('   ✗ L' + LEVELS[i].id + ': ' + e.message); }
  }
  ok(threw === 0, `60 关绘制无异常（${threw} 次失败）`);
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
