// 视觉时钟：RAF 的毫秒必须被当毫秒处理；视觉时间只用"秒"。
import { createVisualClock, MAX_VISUAL_DELTA } from '../src/clock.js';

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

console.log('\n[1] RAF 毫秒 → 秒');
{
  const c = createVisualClock();
  ok(c.time === 0, '初始为 0 秒');
  c.tick(16.667, false);
  ok(near(c.time, 0.016667, 1e-6), `一帧 16.667ms → ${c.time.toFixed(6)} 秒`);
  c.tick(16.667, false);
  ok(near(c.time, 0.033334, 1e-6), `两帧 → ${c.time.toFixed(6)} 秒（不是 33.3 秒）`);
}

console.log('\n[2] 30/60/120fps 在 1 秒真实时间内视觉时间一致');
{
  for (const fps of [30, 60, 120]) {
    const c = createVisualClock();
    const frames = fps;
    for (let i = 0; i < frames; i++) c.tick(1000 / fps, false);
    ok(near(c.time, 1, 1e-6), `${fps}fps 累计 ${c.time.toFixed(6)} 秒`);
  }
}

console.log('\n[3] 暂停不推进、不跳相');
{
  const c = createVisualClock();
  c.tick(16, false);
  const t0 = c.time;
  for (let i = 0; i < 60; i++) c.tick(16, true);
  ok(c.time === t0, '暂停期间视觉时间冻结');
  c.tick(16, false);
  ok(near(c.time - t0, 0.016, 1e-9), '恢复后按正常步长推进，没有补偿几十秒');
}

console.log('\n[4] 卡顿帧被限幅，不会跳相');
{
  const c = createVisualClock();
  c.tick(5000, false);
  ok(near(c.time, MAX_VISUAL_DELTA, 1e-9), `5 秒卡顿只推进 ${MAX_VISUAL_DELTA} 秒`);
}

console.log('\n[5] 同一真实时刻的动画相位等价');
{
  const phase = (fps, seconds, f) => {
    const c = createVisualClock();
    for (let i = 0; i < fps * seconds; i++) c.tick(1000 / fps, false);
    return Math.sin(2 * Math.PI * f * c.time);
  };
  const a = phase(30, 2, 0.5);
  const b = phase(120, 2, 0.5);
  ok(Math.abs(a - b) < 1e-3, `30fps 与 120fps 在同一时刻相位一致（${a.toFixed(4)} vs ${b.toFixed(4)}）`);
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
