// 灯座内芯 / 外延摇杆的几何测试。
//   node tests/joystick.test.mjs

import assert from 'node:assert/strict';
import {
  JOYSTICK,
  angleFromHandle,
  clampAngleToRange,
  dragCore,
  dragHandle,
  handleArc,
  handlePoint,
  hitJoystick,
  joystickLayout,
  snapAngle,
  wrapAngle,
} from '../src/joystick.js';

let n = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  n++;
  console.log(`  ✓ ${msg}`);
}
function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

const light = { id: 'l0', x: 360, y: 1000, angle: -90, joystick: true, angleRange: [-150, -30] };

console.log('\n[1] 布局：内芯 + 下置外柄');
{
  const L = joystickLayout(light);
  ok(L.core.x === 360 && L.core.y === 1000, '内芯在灯座中心');
  ok(L.handle.x === 360 && L.handle.y === 1056, '发射角向上时手柄在正下方 56px');
  ok(near(Math.hypot(L.handle.x - L.core.x, L.handle.y - L.core.y), 56), '手柄中心距 56px');
  ok(JOYSTICK.coreR + JOYSTICK.handleR < JOYSTICK.handleD, '两个热区半径之和小于中心距');
}

console.log('\n[2] 命中热区');
{
  ok(hitJoystick(light, { x: 360, y: 1000 }) === 'core', '点内芯命中 core');
  ok(hitJoystick(light, { x: 360, y: 1056 }) === 'handle', '点手柄命中 handle');
  ok(hitJoystick(light, { x: 360, y: 1030 }) === null, '两个热区之间不误触');
  ok(hitJoystick(light, { x: 10, y: 10 }) === null, '远处不命中');
}

console.log('\n[3] 手柄角度 -> 发射角');
{
  const down = handlePoint(light);
  ok(near(angleFromHandle(light, down), -90), '手柄正下方 -> 发射角 -90（向上）');
  const right = { x: 360 + 56, y: 1000 };
  ok(near(angleFromHandle(light, right), -30), '手柄拉到右侧 -> 发射角 -30');
  const left = { x: 360 - 56, y: 1000 };
  ok(near(angleFromHandle(light, left), -150), '手柄拉到左侧 -> 发射角 -150');
  const beyond = { x: 360 + 56 * Math.cos((170 * Math.PI) / 180), y: 1000 + 56 * Math.sin((170 * Math.PI) / 180) };
  ok(near(angleFromHandle(light, beyond), -150), '手柄拨出扇区外会被夹到 -150');
}

console.log('\n[4] 扇区夹紧与角度归一');
{
  ok(clampAngleToRange(-90, [-60, 60]) === -60, '下方夹到 -60');
  ok(clampAngleToRange(90, [-60, 60]) === 60, '上方夹到 60');
  ok(clampAngleToRange(170, [150, -150]) === 170, '跨 ±180 扇区保持 170');
  ok(clampAngleToRange(-170, [150, -150]) === -170, '跨 ±180 扇区保持 -170');
  ok(wrapAngle(540) === -180, '540° 归一为 -180');
  ok(wrapAngle(-190) === 170, '-190° 归一为 170');
}

console.log('\n[5] 拖内芯 / 拖手柄不修改入参');
{
  const moved = dragCore(light, { x: -100, y: 2000 }, { x0: 120, y0: 900, x1: 600, y1: 1100 });
  ok(moved.x === 120 && moved.y === 1100, '内芯位置被 bounds 夹紧');
  ok(light.x === 360 && light.y === 1000, '原灯座没有被修改');
  const rotated = dragHandle(light, { x: 360, y: 1056 });
  ok(near(rotated.angle, -90) && light.angle === -90, '拖手柄返回新灯座，原对象不变');
}

console.log('\n[6] 角度软磁吸');
{
  ok(snapAngle(-88, [-90, -45], 3) === -90, '±3° 内吸到 -90');
  ok(snapAngle(-80, [-90, -45], 3) === -80, '超出 3° 不吸');
  const snapLight = { ...light, snapAngles: [-90, -45] };
  const near90 = { x: 360 + 56 * Math.cos((88 * Math.PI) / 180), y: 1000 + 56 * Math.sin((88 * Math.PI) / 180) };
  ok(near(angleFromHandle(snapLight, near90), -90), '手柄接近目标角度时吸到 -90');
}

console.log('\n[7] 弧线与手柄点');
{
  const arc = handleArc(light, {}, 10);
  ok(arc.length === 11, '弧线采样 11 个点');
  ok(arc[0].emission === -150 && arc[10].emission === -30, '弧线覆盖完整扇区');
  const p = handlePoint({ ...light, angle: -30 });
  const L = joystickLayout({ ...light, angle: -30 });
  ok(near(L.handleAngle, 30) && p.x > 360 && p.y > 1000, '发射角 -30 时手柄在右下弧');
}

console.log(`\n✅ joystick: ${n} 项通过`);
