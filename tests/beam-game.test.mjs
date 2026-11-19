// BeamSession / Game 集成测试：入口、五关可解、保持、冻结、超时与返回。
//   node tests/beam-game.test.mjs

import assert from 'node:assert/strict';

globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const { Game } = await import('../src/game.js');
const { BeamSession } = await import('../src/beam-game.js');
const { BEAM_LEVELS } = await import('../src/beam-levels.js');

let n = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  n++;
  console.log(`  ✓ ${msg}`);
}
function run(session, seconds, dt = 1 / 60) {
  const count = Math.round(seconds / dt);
  for (let i = 0; i < count; i++) session.update(dt);
}
function solveLevel(session) {
  const id = session.level.id;
  if (id === 'beam-prism') session.place('p0', 360, 640);
  if (id === 'beam-filter') session.place('f0', 340, 640);
  if (id === 'beam-gate') session.place('p0', 340, 640);
  if (id === 'beam-joystick') session.setAngle('l0', -90);
  if (id === 'beam-spectrum') session.place('p0', 340, 640);
  if (id === 'beam-prism-time') session.place('p0', 360, 640);
  session.started = true;
}

console.log('\n[1] 六个光学演示关都可解，并在 3 秒保持后通关');
{
  for (let i = 0; i < BEAM_LEVELS.length; i++) {
    const s = new BeamSession({ start: i });
    ok(s.phase === 'play', `第 ${i + 1} 关进入 play`);
    solveLevel(s);
    run(s, 4.2);
    ok(s.phase === 'win', `${s.level.name} 保持 3 秒后通关`);
    ok(s.hold >= 3, `${s.level.name} 保持进度到 3 秒`);
    ok(s.winInfo && s.winInfo.index === i, `${s.level.name} 结算记录当前关`);
  }
}

console.log('\n[2] 引导步骤随操作推进');
{
  const s = new BeamSession({ start: 0 });
  ok(s.view.index === 0, '初始在引导第 1 步');
  s.place('p0', 360, 640);
  s.update(1 / 60);
  ok(s.view.index === 1, '分光镜进入虚线框后到第 2 步');
  run(s, 3.2);
  ok(s.tutorial.done, '全亮并保持后引导完成');
}

console.log('\n[3] 全亮冻结倒计时，保持中断后恢复');
{
  const level = JSON.parse(JSON.stringify(BEAM_LEVELS[0]));
  level.timeLimit = 8;
  level.tutorial = null;
  const s = new BeamSession({ levels: [level], start: 0 });
  s.started = true;
  run(s, 1);
  const before = s.elapsed;
  ok(before > 0.9 && before < 1.1, `未解题时计时前进（${before.toFixed(2)}s）`);
  s.place('p0', 360, 640);
  run(s, 1);
  ok(s.result.allLit && s.frozen, '全亮后倒计时冻结');
  ok(Math.abs(s.elapsed - before) < 0.02, '冻结期间 elapsed 不再增加');
  s.place('p0', 360, 800);
  run(s, 1);
  ok(!s.result.allLit && !s.frozen, '移走棱镜后保持中断、冻结解除');
  ok(s.elapsed > before + 0.9, '倒计时从冻结值继续');
  ok(s.hold === 0, '保持进度归零');
}

console.log('\n[4] 超时失败与重试');
{
  const level = JSON.parse(JSON.stringify(BEAM_LEVELS[0]));
  level.timeLimit = 2;
  level.tutorial = null;
  const s = new BeamSession({ levels: [level], start: 0 });
  s.started = true;
  run(s, 2.2);
  ok(s.phase === 'fail', '超过时限进入 fail');
  s.restart();
  ok(s.phase === 'play' && s.elapsed === 0 && !s.started, '重试重置计时和状态');
}

console.log('\n[5] 正式限时关：全亮冻结，保持通关');
{
  const s = new BeamSession({ start: BEAM_LEVELS.length - 1 });
  ok(s.timeLimit === 15, '限时关带 15 秒上限');
  s.started = true;
  run(s, 1);
  ok(s.elapsed > 0.9 && !s.result.allLit, '未解题时倒计时前进');
  solveLevel(s);
  run(s, 1);
  ok(s.result.allLit && s.frozen, '全亮后倒计时冻结');
  const frozen = s.elapsed;
  run(s, 2.5);
  ok(s.phase === 'win' && Math.abs(s.elapsed - frozen) < 0.02, '保持 3 秒通关，冻结期间不再计时');
}

console.log('\n[6] Game 入口 / 退出 / 经典模式不受影响');
{
  const g = new Game();
  ok(g.mode === 'classic' && g.phase === 'title', 'Game 默认经典首页');
  const r = g.ui.beam;
  g.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
  ok(g.mode === 'beam' && g.phase === 'play' && g.beam, '首页 V2 按钮进入光学试玩');
  g.activate('home');
  ok(g.mode === 'classic' && g.phase === 'title', '光学试玩返回经典首页');
  g.startLevel(0);
  ok(g.mode === 'classic' && g.phase === 'play' && g.level.id === 1, '经典第 1 关仍可进入');
}

console.log('\n[7] 下一关 / 最后一关返回');
{
  let exited = 0;
  const s = new BeamSession({ start: 0, onExit: () => { exited++; } });
  s.next();
  ok(s.index === 1, '下一关切到第 2 关');
  s.start(BEAM_LEVELS.length - 1);
  s.next();
  ok(exited === 1, '最后一关 next 触发返回');
}

console.log('\n[8] Game 层指针事件转发到 BeamSession');
{
  const g = new Game();
  g.startBeamDemo(0);
  g.pointerDown(360, 800);
  g.pointerMove(360, 640);
  g.pointerUp();
  ok(g.beam.scene.prisms[0].y === 640, 'Game.pointerMove 能拖动光学棱镜');
  ok(g.beam.started, '拖动后计时已启动');
  g.update(1 / 60);
  ok(g.beam.result.allLit, '拖到解位置后全亮');
  for (let i = 0; i < 240; i++) g.update(1 / 60);
  ok(g.beam.phase === 'win', 'Game.update 推进到 3 秒通关');
}

console.log(`\n✅ beam-game: ${n} 项通过`);
