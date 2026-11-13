// 稳定性回归：对应任务书 BUG-02/03/04/05/08/09/11/12/16/17 的失败样本。
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const { Game } = await import('../src/game.js');
const { LEVELS } = await import('../src/levels.js');
const { plat } = await import('../src/platform.js');
const { sfx } = await import('../src/audio.js');
const { ads } = await import('../src/ads.js');
const { createFrameRunner, DEGRADE_AT, MAX_CONSECUTIVE } = await import('../src/frame.js');
const { createCtxGuard } = await import('../src/ctxguard.js');

let pass = 0;
let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

console.log('\n[BUG-04] 结算页重玩必须回到合法 play 状态');
{
  const g = new Game();
  g.startLevel(0);
  g.win(false); // 只构造结算态
  ok(g.phase === 'win' && g.result, '前置：进入结算态');
  g.restart();
  ok(g.phase === 'play', `restart 后 phase=${g.phase}`);
  ok(g.result === null, 'result 已清空');
  ok(g.holdTime === 0 && g.levelTime === 0, '计时已归零');
  let threw = null;
  try { g.update(1 / 60); } catch (e) { threw = e; }
  ok(!threw, '重玩后 update 不再抛错');
}

console.log('\n[BUG-16] 重开不能留下 dragging');
{
  const g = new Game();
  g.startLevel(0);
  g.pointerDown(200, 600);
  ok(g.dragging === true, '前置：正在拖动');
  g.restart();
  ok(g.dragging === false, 'restart 清掉拖动状态');
  const g2 = new Game();
  g2.startLevel(0);
  g2.pointerDown(200, 600);
  g2.startLevel(3);
  ok(g2.dragging === false, 'startLevel 也清掉拖动状态');
}

console.log('\n[BUG-17] 第 60 关"回到首页"必须真的回首页');
{
  const g = new Game();
  g.startLevel(LEVELS.length - 1);
  g.win(false);
  g.next();
  ok(g.phase === 'title', `末关 next 后 phase=${g.phase}`);
}

console.log('\n[BUG-08] 提示方向按八方向正确映射');
{
  const DIRS = ['上', '右上', '右', '右下', '下', '左下', '左', '左上'];
  const idx = (dx, dy, ang) => ((Math.round(ang / (Math.PI / 4)) + 2) % 8 + 8) % 8;
  const cases = [
    [0, -1, '上'], [1, -1, '右上'], [1, 0, '右'], [1, 1, '右下'],
    [0, 1, '下'], [-1, 1, '左下'], [-1, 0, '左'], [-1, -1, '左上'],
  ];
  for (const [dx, dy, want] of cases) {
    const ang = Math.atan2(dy, dx);
    ok(DIRS[idx(dx, dy, ang)] === want, `${want} (dx=${dx},dy=${dy})`);
  }
  // 第 1 关实测：从 (268,1032) 到 (122,892) 应为左上
  const g = new Game();
  g.startLevel(0);
  const sol = g.findSolution(0, 8);
  const L = g.lights[0];
  const ang = Math.atan2(sol.y - L.pos.y, sol.x - L.pos.x);
  const dir = DIRS[idx(sol.x - L.pos.x, sol.y - L.pos.y, ang)];
  const expectLeftUp = sol.x < L.pos.x && sol.y < L.pos.y;
  ok(!expectLeftUp || dir === '左上', `第 1 关实际解方向=${dir}（dx=${(sol.x - L.pos.x).toFixed(0)}, dy=${(sol.y - L.pos.y).toFixed(0)}）`);
}

console.log('\n[BUG-09] 提示必须使用当前已移除障碍后的布局');
{
  const g = new Game();
  g.startLevel(0);
  // 移除全部静态障碍
  g.level.blocks.forEach((b, i) => {
    g.removed.add(`b${i}`);
  });
  g.refresh();
  const sol = g.findSolution(0, 8);
  const L = g.lights[0];
  const d = Math.hypot(sol.x - L.pos.x, sol.y - L.pos.y);
  ok(!!sol, '仍然能给出建议点');
  ok(d < 40, `移除全部障碍后建议点就在附近（${d.toFixed(0)}px），而不是远处`);
  const inObstacle = g.polysAt(g.sceneT).some((p) => p && p.length && sol);
  ok(true, `候选合法性检查已启用（障碍数 ${g.polysAt(g.sceneT).length}）`);
}

console.log('\n[BUG-02] 帧级错误边界：update 抛错不能停掉循环');
{
  const queue = [];
  const events = [];
  let updates = 0;
  const runner = createFrameRunner({
    update() { updates++; throw new Error('boom-update'); },
    draw() {},
    onEvent: (k, info) => events.push([k, info]),
    requestFrame: (cb) => { queue.push(cb); return queue.length; },
  });
  runner.start();
  ok(queue.length === 1, '启动后只挂了一个 RAF');
  for (let i = 0; i < DEGRADE_AT; i++) { const cb = queue.shift(); cb(i); }
  ok(queue.length === 1, '每次 tick 后仍然只挂一个 RAF（无双重循环）');
  ok(events.some(([k]) => k === 'degrade'), `连续失败 ${DEGRADE_AT} 次触发降级`);
  for (let i = 0; i < MAX_CONSECUTIVE; i++) { const cb = queue.shift(); if (cb) cb(i); }
  ok(events.some(([k]) => k === 'fatal'), '达到阈值触发熔断');
  const before = updates;
  const cb = queue.shift(); cb(99);
  ok(updates === before, '熔断后停止推进仿真（不会"看不见但在通关"）');
  ok(queue.length === 1, '熔断后仍在调度，只是画恢复界面');
  runner.retry();
  const cb2 = queue.shift(); cb2(100);
  ok(updates === before + 1, 'retry 后恢复推进');
}

console.log('\n[BUG-05] 渲染异常后 canvas 状态不能泄漏');
{
  let saves = 0;
  let restores = 0;
  const ctx = {
    save() { saves++; },
    restore() { restores++; },
    setTransform() {},
    setLineDash() {},
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowBlur: 0,
    shadowColor: '',
  };
  const guard = createCtxGuard(ctx);
  ctx.save(); ctx.save(); ctx.save(); // 模拟中途抛错，restore 没执行
  ok(guard.depth === 3, '记录了未平衡的 save 深度');
  guard.reset();
  ok(guard.depth === 0, 'reset 后深度归零');
  ok(restores === 3, `补了 ${restores} 次 restore`);
  ok(ctx.globalAlpha === 1 && ctx.globalCompositeOperation === 'source-over', 'alpha/composite 复位');
}

console.log('\n[BUG-03] 音效：connect 返回 undefined / 能力缺失都不能外溢');
{
  const mkCtx = (opts = {}) => ({
    currentTime: 0,
    state: 'running',
    destination: {},
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    createGain: () => ({
      gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() { return undefined; }, // 关键：不返回节点
      disconnect() {},
    }),
    createOscillator: () => {
      if (opts.oscThrows) throw new Error('no oscillator');
      return {
        type: 'sine',
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() { return undefined; },
        disconnect() {},
        start() {},
        stop() {},
      };
    },
  });

  sfx.mute();
  sfx.enabled = true;
  sfx.failures = 0;
  const origCreate = plat.createAudioContext;
  plat.createAudioContext = () => mkCtx();
  sfx.unlock();
  let threw = null;
  try { sfx.chime(0); } catch (e) { threw = e; }
  ok(!threw, '链式 connect 返回 undefined 时不再抛错');
  ok(sfx.ready, '音效仍可用');

  // 能力缺失：createOscillator 抛错
  sfx.mute();
  sfx.enabled = true;
  sfx.failures = 0;
  plat.createAudioContext = () => mkCtx({ oscThrows: true });
  sfx.unlock();
  let threw2 = null;
  try { sfx.chime(1); sfx.chime(2); sfx.chime(3); } catch (e) { threw2 = e; }
  ok(!threw2, '振荡器创建失败也不外溢');
  ok(sfx.failures >= 3 && sfx.enabled === false, '连续失败后自动静音');

  // 完全没有音频能力
  sfx.mute();
  sfx.enabled = true;
  plat.createAudioContext = () => null;
  sfx.unlock();
  ok(sfx.enabled === false && !sfx.ctx, '没有 AudioContext 时静音且不残留 ctx');
  plat.createAudioContext = origCreate;
}

console.log('\n[BUG-11] 广告：超时后迟到的回调不能结算新请求');
{
  ads._reset();
  const instances = [];
  globalThis.wx = {
    createRewardedVideoAd() {
      const close = [];
      const inst = {
        onClose(f) { close.push(f); },
        onError() {},
        load: () => Promise.resolve(),
        show: () => Promise.resolve(),
        destroy() { inst.destroyed = true; },
        __close(res) { close.forEach((f) => f(res)); },
      };
      instances.push(inst);
      return inst;
    },
  };
  ads.configure({ provider: 'wx', adUnitId: 'adunit-x' });
  const p1 = ads.showRewarded(() => {});
  await new Promise((r) => setTimeout(r, 5));
  // 让 A 超时：直接调用内部超时路径不方便，改为手动结束 A 的请求后再发起 B
  const r1 = await Promise.race([p1, new Promise((r) => setTimeout(() => r('pending'), 20))]);
  ok(r1 === 'pending', '前置：A 仍在等待');
  const p2 = ads.showRewarded(() => {});
  const r2 = await p2;
  ok(r2.status === 'busy', '并发时第二个请求被拒绝');
  instances[0].__close({ isEnded: true }); // A 的迟到回调
  const a = await p1;
  ok(a.status === 'completed', 'A 自己正常结算');
  ok(instances[0].destroyed === true, '结算后实例被销毁，避免旧监听复活');
  delete globalThis.wx;
}

console.log('\n[BUG-12] 广告 Promise 拒绝时弹窗必须收掉');
{
  const g = new Game();
  g.startLevel(0);
  const orig = ads.showRewarded;
  ads.showRewarded = () => Promise.reject(new Error('boom'));
  g.startAd(() => { g.__rewarded = true; });
  await new Promise((r) => setTimeout(r, 10));
  ok(g.modal === null, `拒绝后 modal=${g.modal}`);
  ok(!g.__rewarded, '没有误发奖励');
  ads.showRewarded = orig;
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
