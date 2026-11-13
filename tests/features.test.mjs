// 本轮新增机制的回归测试：双侧水晶、移除障碍、皮肤、广告回调、选关与存档迁移。
//   node tests/features.test.mjs

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { Game } = await import('../src/game.js');
const { LEVELS } = await import('../src/levels-live.js');
const { sceneToScreen } = await import('../src/layout.js');
const { WALL_L } = await import('../src/config.js');
const { ads } = await import('../src/ads.js');
const { SKINS } = await import('../src/skins.js');
const { mechanismForLevel, isBasicTutorial, teachesDualLight } = await import('../src/tutorial.js');

let pass = 0;
let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const run = (g, sec, dt = 1 / 60) => { for (let i = 0; i < Math.round(sec / dt); i++) g.update(dt); };
const teleport = (g, x, y, i = 0) => { g.lights[i].pos = { x, y }; g.lights[i].target = { x, y }; };

console.log('\n[1] 左侧水晶真实参与投影与遮挡');
{
  const g = new Game();
  g.startLevel(40); // 41 双门
  const leftIdx = g.crystals.findIndex((c) => c.def.side === 'l');
  ok(leftIdx >= 0 && g.crystals[leftIdx].x === WALL_L.cx, '左侧水晶贴在左墙面 (x=74)');
  let lit = 0;
  let dark = 0;
  const B = g.level.bounds;
  for (let y = B.y0; y <= B.y1; y += 40) {
    for (let x = B.x0; x <= B.x1; x += 40) {
      teleport(g, x, y);
      g.refresh();
      if (g.crystals[leftIdx].lit) lit++; else dark++;
    }
  }
  ok(lit > 0 && dark > 0, `左侧水晶会随位置明灭（亮 ${lit} / 灭 ${dark}）`);
  ok(g.bandsL.length > 0, '左墙确实收到影子（bandsL 非空）');
  ok(g.crystals.some((c) => (c.def.side || 'r') === 'r'), '同一关也有右侧水晶');
}

console.log('\n[2] 移除障碍同时作用于画面与判定，重开恢复');
{
  const g = new Game();
  g.startLevel(40);
  let darkPos = null;
  const B = g.level.bounds;
  for (let y = B.y0; y <= B.y1 && !darkPos; y += 30) {
    for (let x = B.x0; x <= B.x1; x += 30) {
      teleport(g, x, y);
      g.refresh();
      if (!g.allLit) { darkPos = { x, y }; break; }
    }
  }
  ok(!!darkPos, '存在被挡住的位置');
  const before = g.polys.length;
  g.level.blocks.forEach((_, i) => g.removed.add(`b${i}`));
  g.refresh();
  ok(g.polys.length < before, `移除后参与遮挡的物体变少（${before} → ${g.polys.length}）`);
  teleport(g, darkPos.x, darkPos.y);
  g.refresh();
  ok(g.allLit, '障碍移走后同一个位置可以全亮（说明确实影响判定）');
  g.restart();
  ok(g.removed.size === 0 && g.polys.length === before, '重开后障碍恢复');
}

console.log('\n[3] 皮肤只改观感，不改几何');
{
  for (const k of Object.keys(store)) delete store[k];
  const results = [];
  for (const sk of SKINS) {
    const g = new Game();
    g.save.skins.unlocked = SKINS.map((s) => s.id);
    g.equipSkin(sk.id);
    g.startLevel(36); // 37 双岸
    g.lights.forEach((l, i) => teleport(g, l.goal.x, l.goal.y, i));
    const sig = [];
    for (let k = 0; k < 40; k++) {
      g.update(1 / 60);
      sig.push(g.crystals.map((c) => (c.lit ? 1 : 0)).join(''));
    }
    results.push({ id: sk.id, sig: sig.join('|'), won: g.phase === 'win' || g.holdTime > 0 });
  }
  ok(results.every((r) => r.sig === results[0].sig), '四款皮肤下每帧的亮灭序列完全一致');
  for (const k of Object.keys(store)) delete store[k];
  ok(new Game().skin.id === 'default', '新存档默认使用免费皮肤');
}

console.log('\n[4] 广告：切关作废回调 / 不重复播放 / 暂停计时');
{
  const pending = [];
  const realShow = ads.showRewarded;
  ads.showRewarded = () => new Promise((res) => pending.push(res));

  const g = new Game();
  g.startLevel(19); // 第 20 关 tier 4，移障碍需要广告
  ok(!g.hintFree(2), '高难度关的移除需要看广告');
  g.enterRemoveMode();
  g.removeSel = { kind: 'block', index: 0 };
  g.confirmRemove();
  ok(g.modal === 'ad', '确认后进入广告');
  g.startAd(() => {}); // 重复点击
  ok(pending.length === 1, '广告播放中不会重复请求');

  g.startLevel(0); // 切关
  pending[0]('completed');
  await new Promise((r) => setTimeout(r, 0));
  ok(g.removed.size === 0, '切关后旧广告回调不会误改新关卡');
  ok(g.modal === null, '广告态已解除');

  // 暂停计时
  const g2 = new Game();
  g2.startLevel(36);
  g2.lights.forEach((l, i) => teleport(g2, l.goal.x, l.goal.y, i));
  run(g2, 1.2);
  const t0 = g2.levelTime;
  const h0 = g2.holdTime;
  g2.modal = 'ad';
  run(g2, 1.5);
  ok(g2.levelTime === t0 && g2.holdTime === h0, '广告期间关卡时间与保持进度都冻结');
  g2.modal = null;
  run(g2, 2.2);
  ok(g2.phase === 'win', '回到游戏后接着保持 3 秒仍然能通关');

  // 广告取消：不发奖
  const p2 = [];
  ads.showRewarded = () => new Promise((res) => p2.push(res));
  const g3 = new Game();
  g3.startLevel(19);
  g3.enterRemoveMode();
  g3.removeSel = { kind: 'block', index: 0 };
  g3.confirmRemove();
  p2[0]('cancelled');
  await new Promise((r) => setTimeout(r, 0));
  ok(g3.removed.size === 0, '广告未看完不会移除障碍');
  ok(g3.modal === null, '取消后回到游戏');

  ads.showRewarded = realShow;
}

console.log('\n[5] 皮肤解锁与持久化');
{
  for (const k of Object.keys(store)) delete store[k];
  const g = new Game();
  const target = SKINS.find((s) => !s.free);
  ok(!g.skinUnlocked(target.id), '付费皮肤初始锁定');
  g.unlockSkin(target.id); // 模拟广告
  g.save.skins.unlocked.push(target.id); // 直接给（此处只验证状态机）
  g.equipSkin(target.id);
  ok(g.skin.id === target.id && g.save.skins.equipped === target.id, '装备后写入存档');
  const g2 = new Game();
  ok(g2.skin.id === target.id, '重新载入后仍是已装备的皮肤');
}

console.log('\n[6] 旧存档迁移与选关状态');
{
  for (const k of Object.keys(store)) delete store[k];
  store['projection.save.v2'] = JSON.stringify({ unlocked: 35, best: { 36: { time: 12.5 } }, hints: {} });
  delete store['projection.save.v3'];
  const g = new Game();
  ok(g.save.unlocked === 36, '旧档打通 36 关但 unlocked=35，被修正为 36');
  ok(g.save.best[36] && g.save.best[36].time === 12.5, '历史成绩也保留');
  ok(g.isUnlocked(35), '第 36 关仍可进入');
  ok(g.isUnlocked(36), '通关第 36 关后第 37 关自动解锁');
  ok(!g.isUnlocked(37), '第 38 关仍然锁着');
  ok(g.levelCleared(35), '第 36 关显示为已通关');
  ok(g.skin.id === 'default' && g.skinUnlocked('default'), '旧档默认拥有免费皮肤');

  // 重玩旧关不降低解锁进度
  g.startLevel(0);
  g.crystals.forEach((c) => { c.lit = true; });
  g.holdTime = 3;
  g.win();
  ok(g.save.unlocked === 36, '重玩第 1 关不会把解锁进度改小');
  ok(g.save.best[36] && g.save.best[36].time === 12.5, '也不会覆盖旧关的更好成绩');
}

console.log('\n[7] 60 关都能从选关进入');
{
  const g = new Game();
  g.save.unlocked = LEVELS.length - 1;
  let bad = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const gg = new Game();
    gg.save.unlocked = LEVELS.length - 1;
    gg.startLevel(i);
    if (gg.phase !== 'play' || gg.crystals.length === 0) bad++;
  }
  ok(bad === 0, `全部 ${LEVELS.length} 关可以进入`);
  ok(LEVELS.length === 60, '关卡总数为 60');
  // 1–24 已镜像成"左目标"，37–60 本来就是双侧；25–36 只有右侧
  const leftLevels = LEVELS.filter((l) => l.crystals.some((c) => c.side === 'l'));
  ok(leftLevels.length === 48, `含左侧水晶的关卡 ${leftLevels.length} 关（1–24 镜像 + 37–60）`);
  ok(LEVELS.filter((l) => l.id >= 25 && l.id <= 36).every((l) => !l.crystals.some((c) => c.side === 'l')), '25–36 仍只有右侧目标');
}

console.log('\n[8] 底栏五个图标：顺序、命中、暂停、返回');
{
  for (const k of Object.keys(store)) delete store[k];
  const g = new Game();
  g.save.unlocked = LEVELS.length - 1;
  g.startLevel(4);
  const bar = (id) => g.bottomBar.find((b) => b.id === id);
  const tapBtn = (id) => g.pointerDown(bar(id).cx, bar(id).cy);

  ok(g.bottomBar.map((b) => b.id).join(',') === 'levels,restart,hint,skin,home', '顺序：选关→重来→提示→皮肤→首页');

  let overlap = false;
  for (let i = 0; i < g.bottomBar.length; i++) {
    for (let j = i + 1; j < g.bottomBar.length; j++) {
      const a = g.bottomBar[i];
      const b = g.bottomBar[j];
      if (a.hx < b.hx + b.hw && b.hx < a.hx + a.hw) overlap = true;
    }
  }
  ok(!overlap, '五个热区互不重叠');
  ok(g.bottomBar.every((b) => b.hw * (360 / 720) >= 44), '窄屏下热区 >= 44 CSS px');

  tapBtn('levels');
  ok(g.phase === 'levels' && !g.dragging, '点"选关"进入选关且不拖光源');
  g.pointerDown(g.ui.back.x + 10, g.ui.back.y + 10);
  ok(g.phase === 'play' && g.levelIndex === 4, '「继续游戏」回到原关卡');

  // 按"屏幕上光源的位置"点，而不是写死画布中央（布局随关卡内容变化）
  const lm = g.lights[g.active].pos;
  const sm = sceneToScreen(lm, g.sceneLayout, g.sceneDir);
  g.pointerDown(sm.x, sm.y);
  ok(g.phase === 'play' && g.dragging, '点光源即可恢复拖动');
  g.pointerUp();

  for (let i = 0; i < 30; i++) g.update(1 / 60);
  tapBtn('restart');
  ok(g.levelTime < 0.1, '点"重来"重置本局');

  tapBtn('hint');
  ok(g.modal === 'hint', '点"提示"打开提示面板');
  g.pointerDown(g.ui.close.x + 10, g.ui.close.y + 10);
  ok(g.modal === null, '关闭提示面板');

  tapBtn('skin');
  ok(g.modal === 'skins', '点"皮肤"打开面板');
  const h0 = g.holdTime;
  const t0 = g.levelTime;
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  ok(g.holdTime === h0 && g.levelTime === t0, '皮肤面板打开时关卡暂停');
  g.pointerDown(g.ui.skinClose.x + 10, g.ui.skinClose.y + 10);
  ok(g.modal === null && g.phase === 'play', '关闭皮肤面板回到关卡');

  tapBtn('home');
  ok(g.phase === 'title', '点"首页"回到首页');
  ok(g.modal === null && !g.dragging && g.holdTime === 0, '回首页清理遮罩/拖动/保持计时');
  ok(g.save.unlocked === LEVELS.length - 1, '回首页不丢解锁进度');
}

console.log('\n[9] 教学文案：只在机制首次引入关显示');
{
  const g = new Game();
  const firstWith = (pred) => LEVELS.find(pred).id;

  ok(mechanismForLevel(1)?.id === 'basic', '第 1 关：基础规则');
  ok(mechanismForLevel(2) === null, '第 2 关不再重复基础规则');
  ok(mechanismForLevel(firstWith((l) => l.crystals.length >= 2))?.id === 'multi', '多目标首关有教学');
  ok(mechanismForLevel(firstWith((l) => l.movers.length > 0))?.id === 'mover', '移动遮挡首关有教学');
  ok(mechanismForLevel(firstWith((l) => l.movers.some((m) => m.pulse)))?.id === 'roamer', '干扰角色首关有教学');
  ok(mechanismForLevel(firstWith((l) => l.lights.length > 1))?.id === 'dualLight', '双光源首关有教学');
  ok(mechanismForLevel(firstWith((l) => l.crystals.some((c) => c.lights.length > 1)))?.id === 'bothLights', '两灯同照首关有教学');
  ok(mechanismForLevel(firstWith((l) => l.crystals.some((c) => c.side === 'l') && l.crystals.some((c) => c.side !== 'l')))?.id === 'twoSides', '双侧水晶首关有教学');

  ok(mechanismForLevel(26) === null, '第 26 关不再显示双光源说明');
  ok(mechanismForLevel(38) === null, '第 38 关不再显示双侧说明');
  ok(mechanismForLevel(49) === null, '第 49 关组合关不重复任何旧说明');
  ok(mechanismForLevel(59) === null, '第 59 关无教学文案');
  ok(mechanismForLevel(60) === null, '第 60 关无教学文案');

  g.startLevel(0);
  ok(g.teach?.id === 'basic' && g.teachBasic, '第 1 关：基础教学 + 3 秒规则文字');
  g.startLevel(1);
  ok(g.teach === null && !g.teachBasic, '第 2 关：两条文字都不显示');
  g.startLevel(24);
  ok(g.teach?.id === 'dualLight' && g.teachDual, '第 25 关：显示双光源说明');
  g.startLevel(25);
  ok(g.teach === null && !g.teachDual, '第 26 关：双光源说明隐藏');
  g.startLevel(36);
  ok(g.teach?.id === 'twoSides' && !g.teachDual, '第 37 关：显示双侧说明');
  g.startLevel(37);
  ok(g.teach === null, '第 38 关：双侧说明隐藏');

  // 重玩教学关仍然显示（不因看过而永久隐藏）
  g.startLevel(36);
  const t = g.teach?.id;
  g.restart();
  ok(t === 'twoSides' && g.teach?.id === 'twoSides', '重玩第 37 关仍显示教学');
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
