// 持续判定 / 距离统计 / 重开清零 的自测。
// 在 Node 里直接驱动 Game，不依赖浏览器。
//   node tests/hold.test.mjs

globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const { Game } = await import('../src/game.js');
const { LEVELS } = await import('../src/levels-live.js');
const { HOLD_TIME } = await import('../src/config.js');
const { sceneToScreen } = await import('../src/layout.js');

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
};

/** 直接摆放光源（跳过拖动缓动），然后按固定步长推进 */
function run(game, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) game.update(dt);
}
function teleport(game, x, y, i = 0) {
  game.lights[i].pos = { x, y };
  game.lights[i].target = { x, y };
}

const game = new Game();

console.log('\n[1] 同时亮起一瞬间不能通关');
game.startLevel(0);
teleport(game, LEVELS[0].lights[0].goal.x, LEVELS[0].lights[0].goal.y);
game.update(1 / 60);
ok(game.crystals.every((c) => c.lit), '解位置上水晶全亮');
ok(game.phase === 'play', '单帧（1/60 秒）不会通关');
run(game, 0.5);
ok(game.phase === 'play', '0.5 秒仍未通关');

console.log('\n[2] 保持满 3 秒才通关，且只触发一次');
const before = game.phase;
run(game, 2.9 - 0.5);
ok(game.phase === 'play', `2.9 秒时仍在进行中（hold=${game.holdTime.toFixed(2)}）`);
run(game, 0.3);
ok(game.phase === 'win', '超过 3 秒后通关');
const t1 = game.levelTime;
run(game, 1);
ok(game.phase === 'win' && game.levelTime === t1, '通关后计时停止，不会重复结算');

console.log('\n[3] 中断立即清零，重新从 0 计时');
game.startLevel(1);
teleport(game, LEVELS[1].lights[0].goal.x, LEVELS[1].lights[0].goal.y);
run(game, 2.0);
const mid = game.holdTime;
ok(mid > 1.8 && mid < 2.2, `先保持到 ${mid.toFixed(2)} 秒`);
teleport(game, LEVELS[1].lights[0].start.x, LEVELS[1].lights[0].start.y);
game.update(1 / 60);
ok(game.holdTime === 0, '一熄灭，进度立刻归零');
teleport(game, LEVELS[1].lights[0].goal.x, LEVELS[1].lights[0].goal.y);
run(game, 2.0);
ok(game.phase === 'play', '重新满足 2 秒仍不通关（没有累计之前的 2 秒）');
run(game, 1.1);
ok(game.phase === 'win', '重新连续满 3 秒才通关');

console.log('\n[4] 移动距离：累计实际位移，重开清零');
game.startLevel(2);
const d0 = game.distance;
ok(d0 === 0, '开局距离为 0');
const s0 = sceneToScreen(LEVELS[2].lights[0].start, game.sceneLayout, game.sceneDir);
game.pointerDown(s0.x, s0.y);
// 画出 150px 的来回：去 100px 再回来 100px，净位移 0，但累计应为 200
const sx = game.lights[0].pos.x;
const B = game.level.bounds || { x0: 90, x1: 630 };
const dir = sx + 100 <= B.x1 ? 1 : -1; // 别撞到可拖拽区边界，否则量不准
game.lights[0].target = { x: sx + dir * 100, y: game.lights[0].pos.y };
run(game, 0.8);
const out = game.distance;
game.lights[0].target = { x: sx, y: game.lights[0].pos.y };
run(game, 0.8);
const back = game.distance;
ok(out > 60, `去程累计 ${out.toFixed(1)}px`);
ok(back > out + 60 && back < out * 2.2, `回程也算距离（共 ${back.toFixed(1)}px，净位移接近 0）`);
game.restart();
ok(game.distance === 0, '重开后距离清零');

console.log('\n[5] 双光源：点哪盏拖哪盏');
game.startLevel(24); // 第 25 关 双生
ok(game.lights.length === 2, '第 25 关有两盏灯');
ok(game.active === 0, '默认选中第 1 盏');
const L1 = game.lights[1].pos;
const s1 = sceneToScreen(L1, game.sceneLayout, game.sceneDir);
game.pointerDown(s1.x, s1.y);
ok(game.active === 1, '点在第 2 盏上就切到第 2 盏');
const before1 = game.lights[0].target.x;
const s2 = sceneToScreen({ x: L1.x - 40, y: L1.y }, game.sceneLayout, game.sceneDir);
game.pointerMove(s2.x, s2.y);
game.update(1 / 60);
ok(Math.abs(game.lights[0].target.x - before1) < 0.01, '拖动只影响选中的那一盏');

console.log('\n[6] 36 关都能进入，且解位置确实满足');
let allOk = true;
for (let i = 0; i < LEVELS.length; i++) {
  const gg = new Game();
  gg.startLevel(i);
  if (gg.crystals.length === 0) allOk = false;
  // 把每盏灯都放到设计解上，跑到出现干净窗口为止（最多等两个周期）
  LEVELS[i].lights.forEach((l, k) => teleport(gg, l.goal.x, l.goal.y, k));
  const period = Math.max(6, ...LEVELS[i].movers.map((m) => m.period));
  let waited = 0;
  while (gg.phase === 'play' && waited < period * 2 + 4) {
    gg.update(1 / 60);
    waited += 1 / 60;
  }
  if (gg.phase !== 'win') {
    allOk = false;
    console.log(`     ✗ 第 ${i + 1} 关 ${LEVELS[i].name} 等满两个周期仍未通关（hold=${gg.holdTime.toFixed(2)}）`);
  }
}
ok(allOk, `全部 ${LEVELS.length} 关在设计解上可以通关`);

console.log('\n[7] 开局不能已经通关');
let startBad = 0;
for (let i = 0; i < LEVELS.length; i++) {
  const gg = new Game();
  gg.startLevel(i);
  run(gg, 3.4);
  if (gg.phase === 'win') { startBad++; console.log(`     ✗ 第 ${i + 1} 关开局即通关`); }
}
ok(startBad === 0, '没有任何一关开局就通关');

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
