// 机关状态机回归测试。
//   node tests/gates.test.mjs

import assert from 'node:assert/strict';
import { createGateRuntime, stepGates, gateEffects, applyGateEffects, isBlockEnabled } from '../src/gates.js';
import { COLOR } from '../src/optics.js';

let n = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  n++;
  console.log(`  ✓ ${msg}`);
}

const scene = {
  blocks: [
    { id: 'door', poly: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
    { id: 'sub', poly: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], enabled: false },
  ],
  prisms: [{ id: 'p0', x: 10, y: 10 }],
  gates: [
    {
      id: 'latch',
      kind: 'latch',
      chargeTime: 0.8,
      actions: [{ type: 'openDoor', targetBlockId: 'door' }],
    },
    {
      id: 'hold',
      kind: 'hold',
      chargeTime: 0.8,
      holdGrace: 0.3,
      actions: [{ type: 'closeSubGate', targetBlockId: 'sub' }],
    },
    {
      id: 'slide',
      kind: 'latch',
      chargeTime: 0.2,
      slideDuration: 1,
      actions: [{ type: 'slideTrack', targetPrismId: 'p0', to: { x: 110, y: 10 } }],
    },
  ],
};

console.log('\n[1] 锁存型：连续充能 0.8s，之后永久保持');
{
  const rt = createGateRuntime(scene);
  const hit = [{ id: 'latch', ok: true, mixed: COLOR.WHITE }];
  stepGates(scene, rt, hit, 0.4);
  ok(!rt.get('latch').open, '0.4s 还没开');
  stepGates(scene, rt, hit, 0.5);
  ok(rt.get('latch').open, '累计 0.9s 后开启');
  stepGates(scene, rt, [], 5);
  ok(rt.get('latch').open, '断光后仍保持开启');
}

console.log('\n[2] 锁存型：中途断光会清零');
{
  const rt = createGateRuntime(scene);
  stepGates(scene, rt, [{ id: 'latch', ok: true }], 0.5);
  stepGates(scene, rt, [], 0.1);
  ok(rt.get('latch').charge === 0, '断光后充能清零');
  stepGates(scene, rt, [{ id: 'latch', ok: true }], 0.5);
  ok(!rt.get('latch').open, '重新充能 0.5s 仍未开');
}

console.log('\n[3] 保活型：断光 0.3s 缓冲后关门');
{
  const rt = createGateRuntime(scene);
  const hit = [{ id: 'hold', ok: true }];
  stepGates(scene, rt, hit, 0.8);
  ok(rt.get('hold').open, '持续照射 0.8s 后开门');
  stepGates(scene, rt, [], 0.2);
  ok(rt.get('hold').open, '断光 0.2s 仍在缓冲内');
  stepGates(scene, rt, [], 0.2);
  ok(!rt.get('hold').open, '断光超过 0.3s 后关门');
  ok(rt.get('hold').charge === 0, '关门后充能清零');
}

console.log('\n[4] 机关效果：开门 / 副闸 / 滑台');
{
  const rt = createGateRuntime(scene);
  rt.get('latch').open = true;
  rt.get('hold').open = true;
  rt.get('slide').open = true;
  rt.get('slide').slide = 0.5;
  const effects = gateEffects(scene, rt);
  ok(effects.disabled.has('door'), 'openDoor 禁用门 block');
  ok(effects.closed.has('sub'), 'closeSubGate 启用副闸');
  ok(!isBlockEnabled(scene.blocks[0], effects), '门 block 被禁用');
  ok(isBlockEnabled(scene.blocks[1], effects), '副闸 block 被启用');
  ok(effects.slides.get('p0').x === 60, '滑台走到一半');
  const active = applyGateEffects(scene, rt);
  ok(active.scene.blocks.length === 1 && active.scene.blocks[0].id === 'sub', '当帧场景只保留副闸');
  ok(active.scene.prisms[0].x === 60, '当帧棱镜跟随滑台');
}

console.log('\n[5] 颜色不匹配不充能');
{
  const rt = createGateRuntime(scene);
  stepGates(scene, rt, [{ id: 'latch', ok: false }], 2);
  ok(!rt.get('latch').open, '错色光不充能');
}

console.log(`\n✅ gates: ${n} 项通过`);
