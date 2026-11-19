// 渐进引导状态机回归测试。
//   node tests/tutorial-flow.test.mjs

import assert from 'node:assert/strict';
import {
  createTutorialState,
  currentTutorialStep,
  evaluateCondition,
  resetTutorial,
  skipTutorial,
  stepTutorial,
  tutorialAtLastStep,
  tutorialView,
} from '../src/tutorial-flow.js';

let n = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  n++;
  console.log(`  ✓ ${msg}`);
}

const config = {
  steps: [
    {
      toast: '把棱镜拖到光路上',
      dashedZones: [{ id: 'z1', x: 360, y: 640, r: 30 }],
      gesture: { targetType: 'prism', id: 'p0', to: { x: 360, y: 640 } },
      completeWhen: 'inZone:p0:z1',
    },
    { toast: '把发射角拨到正上方', completeWhen: 'angleNear:l0:-90:4' },
    { toast: '等机关开门', completeWhen: 'gate:g0:opened' },
    { toast: '全部点亮', completeWhen: 'allLit' },
  ],
};

console.log('\n[1] 四步依次推进');
{
  const st = createTutorialState(config);
  ok(!st.done && currentTutorialStep(st).toast.includes('棱镜'), '初始在第 1 步');
  let r = stepTutorial(st, { positions: { p0: { x: 400, y: 640 } } });
  ok(!r.changed && st.index === 0, '不在虚线框内不推进');
  r = stepTutorial(st, { positions: { p0: { x: 360, y: 640 } } });
  ok(r.changed && st.index === 1, '进入虚线框后到第 2 步');
  r = stepTutorial(st, { angles: { l0: -87 } });
  ok(r.changed && st.index === 2, '角度在 ±4° 内到第 3 步');
  r = stepTutorial(st, { gates: { g0: { open: false } } });
  ok(!r.changed && st.index === 2, '机关没开不推进');
  r = stepTutorial(st, { gates: { g0: { open: true } } });
  ok(r.changed && st.index === 3, '机关开门后到第 4 步');
  r = stepTutorial(st, { allLit: false });
  ok(!r.changed && st.index === 3, '未全亮不推进');
  r = stepTutorial(st, { allLit: true });
  ok(r.changed && r.done && st.done, '全亮后引导完成');
}

console.log('\n[2] 数组条件与函数条件');
{
  ok(evaluateCondition(['allLit', 'hold:3'], { allLit: true, hold: 3 }, null), '数组条件全部满足');
  ok(!evaluateCondition(['allLit', 'hold:3'], { allLit: true, hold: 2.9 }, null), '数组条件缺一不可');
  ok(evaluateCondition((ctx) => ctx.ok, { ok: true }, null), '函数条件');
  ok(!evaluateCondition('unknown', {}, null), '未知条件返回 false');
}

console.log('\n[3] 跳过与重置');
{
  const st = createTutorialState(config);
  stepTutorial(st, { positions: { p0: { x: 360, y: 640 } } });
  skipTutorial(st);
  ok(st.done && st.skipped, '跳过会标记 done/skipped');
  ok(currentTutorialStep(st) === null, '跳过后没有当前步骤');
  resetTutorial(st);
  ok(!st.done && !st.skipped && st.index === 0, '重置回到第 1 步');
}

console.log('\n[4] 视图与最后一步');
{
  const st = createTutorialState(config);
  const view = tutorialView(st);
  ok(view.index === 0 && view.total === 4 && view.dashedZones.length === 1, '视图包含步骤/虚线框');
  ok(view.gesture.targetType === 'prism', '视图包含手势配置');
  stepTutorial(st, { positions: { p0: { x: 360, y: 640 } } });
  stepTutorial(st, { angles: { l0: -90 } });
  stepTutorial(st, { gates: { g0: { open: true } } });
  ok(tutorialAtLastStep(st), '当前是最后一步');
}

console.log('\n[5] 空配置直接完成');
{
  const st = createTutorialState({ steps: [] });
  ok(st.done, '没有步骤时直接 done');
  const r = stepTutorial(st, {});
  ok(r.done && !r.changed, '空配置推进无副作用');
}

console.log(`\n✅ tutorial-flow: ${n} 项通过`);
