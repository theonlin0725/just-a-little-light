// 微信触摸状态机：多指、非活动指松开、cancel、切后台。
import { createTouchTracker } from '../src/input-wx.js';

let pass = 0;
let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

function make() {
  const log = [];
  const t = createTouchTracker({
    onStart: (x, y) => log.push(['start', x, y]),
    onMove: (x, y) => log.push(['move', x, y]),
    onEnd: () => log.push(['end']),
  });
  return { t, log };
}
const touch = (id, x, y) => ({ identifier: id, clientX: x, clientY: y });

console.log('\n[1] 第一根手指才开始拖动');
{
  const { t, log } = make();
  t.touchStart({ changedTouches: [touch(1, 100, 200)] });
  t.touchMove({ touches: [touch(1, 110, 210)] });
  t.touchEnd({ changedTouches: [touch(1, 110, 210)] });
  ok(log.length === 3 && log[0][0] === 'start' && log[1][0] === 'move' && log[2][0] === 'end', 'start→move→end 顺序正确');
  ok(t.activeId === null, '结束后没有残留活动指');
}

console.log('\n[2] 第二根手指不能抢走拖动');
{
  const { t, log } = make();
  t.touchStart({ changedTouches: [touch(1, 100, 200)] });
  t.touchStart({ changedTouches: [touch(2, 300, 400)] }); // 第二根按下
  ok(log.filter((l) => l[0] === 'start').length === 1, '第二根手指不会触发新的 start');
  t.touchMove({ touches: [touch(1, 105, 205), touch(2, 305, 405)] });
  ok(log[log.length - 1][0] === 'move' && log[log.length - 1][1] === 105, 'move 跟着活动指走');
}

console.log('\n[3] 非活动指松开不会中断');
{
  const { t, log } = make();
  t.touchStart({ changedTouches: [touch(1, 100, 200)] });
  t.touchEnd({ changedTouches: [touch(2, 300, 400)] }); // 松开的是第二根
  ok(log.filter((l) => l[0] === 'end').length === 0, '别的手指松开不触发 end');
  ok(t.activeId === 1, '活动指仍是第一根');
  t.touchEnd({ changedTouches: [touch(1, 100, 200)] });
  ok(log.filter((l) => l[0] === 'end').length === 1, '活动指松开才 end');
}

console.log('\n[4] touchcancel / 切后台清理状态');
{
  const { t, log } = make();
  t.touchStart({ changedTouches: [touch(7, 10, 20)] });
  t.touchCancel();
  ok(log[log.length - 1][0] === 'end' && t.activeId === null, 'cancel 立即结束拖动');
  const { t: t2, log: log2 } = make();
  t2.touchStart({ changedTouches: [touch(7, 10, 20)] });
  t2.reset();
  ok(log2[log2.length - 1][0] === 'end' && t2.activeId === null, '切后台 reset 结束拖动');
  t2.touchMove({ touches: [touch(7, 50, 60)] });
  ok(log2.filter((l) => l[0] === 'move').length === 0, 'reset 之后 move 不再生效（防粘手）');
}

console.log('\n[5] 没有 identifier 的旧基础库也能用');
{
  const { t, log } = make();
  t.touchStart({ changedTouches: [{ clientX: 1, clientY: 2 }] });
  t.touchMove({ touches: [{ clientX: 3, clientY: 4 }] });
  ok(log.length === 2, '缺 identifier 时按 0 处理');
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
