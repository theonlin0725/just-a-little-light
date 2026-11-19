// 定向光学核心的回归测试。
//   node tests/optics.test.mjs

import assert from 'node:assert/strict';
import {
  COLOR,
  applyFilter,
  acceptsColor,
  clampAngle,
  mixColors,
  prismChildren,
  rayCircle,
  reflectAcross,
  snapToPoint,
  traceScene,
} from '../src/optics.js';
import { OPTICS_SCENES } from '../src/optics-scenes.js';
import { createGateRuntime, stepGates, applyGateEffects } from '../src/gates.js';

let n = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  n++;
  console.log(`  ✓ ${msg}`);
}
function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}
function nearPoint(p, x, y, eps = 1e-5) {
  return near(p.x, x, eps) && near(p.y, y, eps);
}

console.log('\n[1] 3-bit RYB 颜色代数');
ok(mixColors([COLOR.RED, COLOR.BLUE]) === COLOR.PURPLE, '红 + 蓝 = 紫');
ok(mixColors([COLOR.RED, COLOR.YELLOW]) === COLOR.ORANGE, '红 + 黄 = 橙');
ok(mixColors([COLOR.YELLOW, COLOR.BLUE]) === COLOR.GREEN, '黄 + 蓝 = 绿');
ok(mixColors([COLOR.RED, COLOR.YELLOW, COLOR.BLUE]) === COLOR.WHITE, '红 + 黄 + 蓝 = 白');
ok(applyFilter(COLOR.WHITE, COLOR.RED) === COLOR.RED, '白光过红滤镜变红');
ok(applyFilter(COLOR.RED, COLOR.BLUE) === COLOR.NONE, '红光撞蓝滤镜被吸收');
ok(applyFilter(COLOR.PURPLE, COLOR.RED) === COLOR.RED, '紫光过红滤镜提纯红');
ok(acceptsColor({ requiredColor: COLOR.BLUE }, COLOR.BLUE), '蓝水晶接受蓝光');
ok(!acceptsColor({ requiredColor: COLOR.BLUE }, COLOR.WHITE), '蓝水晶不接受白光');
ok(acceptsColor({ requiredColor: COLOR.WHITE, acceptAny: true }, COLOR.RED), '白色通用水晶接受任意色');
ok(!acceptsColor({ requiredColor: COLOR.WHITE, acceptAny: false }, COLOR.RED), '纯白圣晶不接受单色');

console.log('\n[2] 射线与圆 / 反射');
ok(near(rayCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 }, 2), 8), '正面命中距离 8');
ok(rayCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 5 }, 2) === null, '偏离时不命中');
ok(near(rayCircle({ x: 10, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 }, 2), 2), '起点在圆内返回出射点');
const r45 = reflectAcross({ x: 1, y: 0 }, 45);
ok(nearPoint(r45, 0, 1, 1e-9), '沿 45° 镜面把 +x 反射成 +y');
const r45b = reflectAcross({ x: 1, y: 0 }, -45);
ok(nearPoint(r45b, 0, -1, 1e-9), '沿 -45° 镜面把 +x 反射成 -y');

console.log('\n[3] 棱镜子射线');
const left = prismChildren({ kind: 'deflect45L' }, { x: 1, y: 0 }, COLOR.WHITE);
ok(left.length === 1 && nearPoint(left[0].dir, Math.SQRT1_2, -Math.SQRT1_2, 1e-9), '45° 左偏把 +x 折成右上');
const right = prismChildren({ kind: 'deflect45R' }, { x: 1, y: 0 }, COLOR.WHITE);
ok(right.length === 1 && nearPoint(right[0].dir, Math.SQRT1_2, Math.SQRT1_2, 1e-9), '45° 右偏把 +x 折成右下');
const refl = prismChildren({ kind: 'reflect90', angle: 45 }, { x: 1, y: 0 }, COLOR.WHITE);
ok(refl.length === 1 && nearPoint(refl[0].dir, 0, 1, 1e-9), '90° 全反把 +x 折成 +y');
const back = prismChildren({ kind: 'reflect90', angle: 45 }, { x: -1, y: 0 }, COLOR.WHITE);
ok(back.length === 0, '90° 棱镜背面吸光');
const split = prismChildren({ kind: 'splitter', angle: 45 }, { x: 1, y: 0 }, COLOR.WHITE);
ok(split.length === 2 && nearPoint(split[0].dir, 1, 0) && nearPoint(split[1].dir, 0, 1, 1e-9), '分光镜同时给出直穿与 90° 侧向');
const disp = prismChildren({ kind: 'dispersion' }, { x: 1, y: 0 }, COLOR.WHITE);
ok(disp.length === 3 && disp.map((d) => d.color).join(',') === '1,2,4', '白光色散为红/黄/蓝三束');
const dispOrange = prismChildren({ kind: 'dispersion' }, { x: 1, y: 0 }, COLOR.ORANGE);
ok(dispOrange.length === 2 && dispOrange.map((d) => d.color).join(',') === '1,2', '橙光只拆出红/黄');

console.log('\n[4] 五个样板场景');
for (const key of ['prism', 'filter', 'joystick', 'spectrum', 'combiner']) {
  const scene = OPTICS_SCENES[key];
  const r = traceScene(scene);
  ok(r.allLit, `${scene.name} 初始状态可通关（${r.lit}/${r.crystals.length}）`);
}

console.log('\n[5] 机关场景：先开门，再点晶');
{
  const scene = OPTICS_SCENES.gate;
  const first = traceScene(scene);
  ok(!first.allLit, '门关着时水晶不亮');
  ok(first.gates[0].ok, '分光侧路照到锁存机关');
  const rt = createGateRuntime(scene);
  let active = scene;
  for (let i = 0; i < 60; i++) {
    const r = traceScene(active);
    stepGates(active, rt, r.gates, 1 / 60);
    active = applyGateEffects(active, rt).scene;
  }
  ok(rt.get('g0').open, '锁存机关 1 秒内永久开启');
  const after = traceScene(active);
  ok(after.allLit, '门开后直射光点亮水晶');
}

console.log('\n[6] 合光晶格：红+蓝=紫');
{
  const scene = OPTICS_SCENES.combiner;
  const r = traceScene(scene);
  ok(r.combiners.length === 1 && r.combiners[0].color === COLOR.PURPLE, '晶格合出紫光');
  ok(r.crystals[0].ok && r.crystals[0].mixed === COLOR.PURPLE, '紫水晶被紫光点亮');
}

console.log('\n[7] 教学样板：拖分光镜 -> 等开门 -> 点亮');
{
  const scene = OPTICS_SCENES.tutorial;
  const before = traceScene(scene);
  ok(!before.allLit && !before.gates[0].ok, '初始分光镜不在光路上');
  scene.prisms[0].x = 340;
  scene.prisms[0].y = 640;
  const moved = traceScene(scene);
  ok(moved.gates[0].ok, '拖进光路后机关被照亮');
  const rt = createGateRuntime(scene);
  let active = scene;
  for (let i = 0; i < 60; i++) {
    const r = traceScene(active);
    stepGates(active, rt, r.gates, 1 / 60);
    active = applyGateEffects(active, rt).scene;
  }
  ok(traceScene(active).allLit, '机关开门后水晶点亮');
}

console.log('\n[8] 软磁吸 / 角度夹紧');
{
  const s = snapToPoint({ x: 10, y: 10 }, { x: 14, y: 13 }, 8);
  ok(s.snapped && s.x === 14 && s.y === 13, '8px 内吸附到目标');
  const miss = snapToPoint({ x: 10, y: 10 }, { x: 30, y: 30 }, 8);
  ok(!miss.snapped, '超出半径不吸附');
  ok(clampAngle(-90, [-60, 60]) === -60, '扇区夹紧');
  ok(clampAngle(170, [150, -150]) === 170, '跨 ±180 的扇区保持原角');
}

console.log(`\n✅ optics: ${n} 项通过`);
