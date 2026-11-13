// 帧步进：低帧率下仿真时间必须等于真实时间（否则 3 秒规则会变长）。
import { planFrame, STEP, MAX_FRAME_DELTA, MAX_SUBSTEP, MAX_SUBSTEPS, MAX_STEPS_PER_FRAME } from '../src/loop.js';

let pass = 0;
let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const sum = (a) => a.reduce((s, v) => s + v, 0);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

console.log('\n[1] 60fps / 30fps / 10fps 下时间都不丢');
for (const fps of [60, 30, 10]) {
  let acc = 0;
  let total = 0;
  const frames = fps * 3; // 3 秒
  for (let i = 0; i < frames; i++) {
    const p = planFrame(acc, 1 / fps);
    acc = p.acc;
    total += sum(p.steps);
  }
  ok(near(total, 3, 1e-6), `${fps}fps 跑 3 秒，仿真累计 ${total.toFixed(4)} 秒`);
}

console.log('\n[2] 极低帧率（2fps）也不丢');
{
  let acc = 0;
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const p = planFrame(acc, 0.5);
    acc = p.acc;
    total += sum(p.steps);
  }
  ok(near(total, 2, 1e-6), `2fps 跑 2 秒，仿真累计 ${total.toFixed(3)} 秒`);
}

console.log('\n[3] 单帧上限：极端卡顿不会一次补太多，但会记录丢弃');
{
  const p = planFrame(0, 5);
  ok(near(sum(p.steps), MAX_FRAME_DELTA), `5 秒卡顿只推进 ${MAX_FRAME_DELTA} 秒`);
  ok(p.dropped > 4, `丢弃 ${p.dropped.toFixed(1)} 秒并被记录`);
}

console.log('\n[4] 剩余时间切成小步补齐（不能一步跨过短暂遮挡）');
{
  const p = planFrame(0, 0.4);
  ok(near(sum(p.steps), 0.4, 1e-9), `总时长精确等于 0.4 秒（${sum(p.steps).toFixed(6)}）`);
  ok(p.steps.length <= MAX_STEPS_PER_FRAME + MAX_SUBSTEPS, `步数受控（${p.steps.length} 步）`);
  ok(p.steps.every((v) => v <= MAX_SUBSTEP + 1e-9), '每一步都不超过 1/30 秒');
  ok(p.acc === 0, '余量为 0，不累积漂移');
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
