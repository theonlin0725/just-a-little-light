// 灯泡引导：有效失败计数与频控
import { createNudgeState, stepAttempt, showNudge, dismissNudge, nudgeVisible, resetRun, HELP_NUDGE } from '../src/nudge.js';

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

/** 模拟一次"亮起 hold 秒再熄灭" */
function attempt(s, holdSeconds, now, won = false) {
  let trig = false;
  for (let t = 0; t < holdSeconds; t += 1 / 60) {
    const r = stepAttempt(s, { allLit: true, holdTime: t, won: false, now });
    trig = trig || r.trigger;
  }
  const r = stepAttempt(s, { allLit: false, holdTime: 0, won, now });
  return trig || r.trigger;
}

console.log('\n[1] 0.1 秒闪亮 10 次不算失败');
{
  const s = createNudgeState();
  for (let i = 0; i < 10; i++) {
    stepAttempt(s, { allLit: true, holdTime: 0.05, won: false, now: i });
    stepAttempt(s, { allLit: false, holdTime: 0, won: false, now: i });
  }
  ok(s.failures === 0, `失败计数 ${s.failures}（阈值 ${HELP_NUDGE.minHoldSeconds}s）`);
  ok(!s.pending, '没有触发引导');
}

console.log(`\n[2] 前 ${HELP_NUDGE.failedAttempts - 1} 次不触发，第 ${HELP_NUDGE.failedAttempts} 次触发一次`);
{
  const N = HELP_NUDGE.failedAttempts;
  const s = createNudgeState();
  let triggered = 0;
  for (let i = 1; i < N; i++) {
    if (attempt(s, 1.2, i * 2)) triggered++;
    ok(!triggered, `第 ${i} 次失败后仍未引导（failures=${s.failures}）`);
  }
  if (attempt(s, 1.2, N * 2)) triggered++;
  ok(s.failures === N, `第 ${N} 次失败计数 ${s.failures}`);
  ok(triggered === 1 && s.pending === true, `第 ${N} 次恰好触发一次`);
}

console.log('\n[3] 一次 2.9 秒只算一次尝试');
{
  const s = createNudgeState();
  attempt(s, 2.9, 0);
  ok(s.failures === 1, `2.9 秒中断记 1 次（${s.failures}）`);
}

console.log('\n[4] 直接保持到通关不算失败');
{
  const s = createNudgeState();
  for (let t = 0; t < 3.1; t += 1 / 60) stepAttempt(s, { allLit: true, holdTime: t, won: false, now: 0 });
  stepAttempt(s, { allLit: false, holdTime: 0, won: true, now: 0 });
  ok(s.failures === 0, '通关不累计失败');
  ok(!s.pending, '通关不触发引导');
}

console.log('\n[5] 展示时长与关闭');
{
  const s = createNudgeState();
  for (let i = 0; i < HELP_NUDGE.failedAttempts; i++) attempt(s, 1, i);
  ok(s.pending, '前置：已挂起');
  ok(showNudge(s, 100), '安全时机显示');
  ok(nudgeVisible(s, 101), '显示中');
  ok(!nudgeVisible(s, 100 + HELP_NUDGE.visibleSeconds + 0.1), '超过 6 秒自动消失');
  const s2 = createNudgeState();
  for (let i = 0; i < HELP_NUDGE.failedAttempts; i++) attempt(s2, 1, i);
  showNudge(s2, 50);
  dismissNudge(s2);
  ok(!nudgeVisible(s2, 51), '点灯泡后立刻消失');
}

console.log('\n[6] 频控：每局最多 1 次，同关会话最多 2 次');
{
  const s = createNudgeState();
  for (let i = 0; i < HELP_NUDGE.failedAttempts; i++) attempt(s, 1, i);
  showNudge(s, 10);
  dismissNudge(s);
  s.failures = 0;
  for (let i = 0; i < HELP_NUDGE.failedAttempts; i++) attempt(s, 1, 100);
  ok(!s.pending, '同一局内不会第二次弹出');
  resetRun(s);
  s.failures = 0;
  for (let i = 0; i < HELP_NUDGE.failedAttempts; i++) attempt(s, 1, 200);
  ok(s.pending, '重开清空本局计数后可以再触发（仍受冷却）');
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
