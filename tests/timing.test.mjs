// 低帧率下的真实 3 秒规则：用 planFrame 驱动真实 Game，而不是直接喂固定 dt。
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const { Game } = await import('../src/game.js');
const { LEVELS } = await import('../src/levels-live.js');
const { HOLD_TIME } = await import('../src/config.js');
const { planFrame } = await import('../src/loop.js');

let pass = 0;
let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

function teleport(g, x, y, i = 0) { g.lights[i].pos = { x, y }; g.lights[i].target = { x, y }; }

/** 用真实帧间隔驱动，返回累计仿真时间 */
function runRealSeconds(g, seconds, fps) {
  let acc = 0;
  let total = 0;
  const frames = Math.floor(seconds * fps);
  for (let i = 0; i < frames; i++) {
    const p = planFrame(acc, 1 / fps);
    acc = p.acc;
    for (const s of p.steps) { g.update(s); total += s; }
  }
  return total;
}

console.log(`\n[1] 10fps 下 ${HOLD_TIME} 秒规则不能被拉长`);
{
  const g = new Game();
  g.startLevel(0);
  teleport(g, LEVELS[0].lights[0].goal.x, LEVELS[0].lights[0].goal.y);
  g.update(1 / 60);
  const t29 = runRealSeconds(g, 2.85, 10);
  ok(g.phase === 'play', `真实 ${t29.toFixed(2)} 秒仍在进行中`);
  runRealSeconds(g, 0.25, 10);
  ok(g.phase === 'win', '真实约 3.1 秒时通关');
}

console.log('\n[2] 5fps 下同样按真实时间计时');
{
  const g = new Game();
  g.startLevel(0);
  teleport(g, LEVELS[0].lights[0].goal.x, LEVELS[0].lights[0].goal.y);
  g.update(1 / 60);
  runRealSeconds(g, 2.9, 5);
  ok(g.phase === 'play', '2.9 秒未通关');
  runRealSeconds(g, 0.2, 5);
  ok(g.phase === 'win', '3.1 秒通关');
}

console.log('\n[3] 中断后重新计时（低帧率下也一样）');
{
  const g = new Game();
  g.startLevel(1);
  const goal = LEVELS[1].lights[0].goal;
  const start = LEVELS[1].lights[0].start;
  teleport(g, goal.x, goal.y);
  runRealSeconds(g, 2.0, 10);
  const mid = g.holdTime;
  ok(mid > 1.9, `先保持到 ${mid.toFixed(2)} 秒`);
  teleport(g, start.x, start.y);
  g.update(1 / 60);
  ok(g.holdTime === 0, '一熄灭立即归零');
  teleport(g, goal.x, goal.y);
  runRealSeconds(g, 2.0, 10);
  ok(g.phase === 'play', '重新满足 2 秒仍不通关');
  runRealSeconds(g, 1.2, 10);
  ok(g.phase === 'win', '再连续满 3 秒才通关');
}

console.log('\n[4] 面板打开时不计时，关闭后不补算');
{
  const g = new Game();
  g.startLevel(36);
  g.lights.forEach((l, i) => teleport(g, l.goal.x, l.goal.y, i));
  runRealSeconds(g, 1.0, 10);
  const t0 = g.levelTime;
  const h0 = g.holdTime;
  g.modal = 'skins';
  runRealSeconds(g, 2.0, 10);
  ok(g.levelTime === t0 && g.holdTime === h0, '面板打开期间计时冻结');
  g.modal = null;
  runRealSeconds(g, 0.3, 10);
  ok(g.phase === 'play' || g.holdTime < 3, '关闭后从原进度续接，不会因停留时间直接通关');
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
