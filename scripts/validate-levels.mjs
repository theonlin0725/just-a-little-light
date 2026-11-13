// 36 关体检。验收标准里的"逐关验证"就是跑这个。
//
//   node scripts/validate-levels.mjs [步长]
//
// 检查项：
//   1. 每盏灯都有非空的解区（移动障碍关卡要求能连续保持 3 秒）
//   2. 开局不能已经满足（否则这关没内容）
//   3. 解区不能大得像没有谜题，也不能小到要像素级操作
//   4. 标了"最优距离"的关，重新求解并和存档值比对

import { LEVELS } from '../src/levels-live.js';
import { HOLD_TIME, BOUNDS } from '../src/config.js';
import { regionForLight, components, shortestDistance, holdCheck } from './lib/solve.mjs';

const STEP = Number(process.argv[2] || 5);
const areaOfBounds = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
let bad = 0;
const rows = [];

const areaOf = (r) => r.count * r.step * r.step;

for (const lv of LEVELS) {
  const notes = [];
  const hold = holdCheck(lv, lv.lights.map((l) => l.goal), 99).best;
  if (hold < HOLD_TIME) notes.push(`❌ 设计解保持 ${hold.toFixed(1)}s`);

  const startHold = holdCheck(lv, lv.lights.map((l) => l.start), 99).best;
  if (startHold >= HOLD_TIME) notes.push('❌ 开局即通关');

  const B = lv.bounds || BOUNDS;
  const AREA_TOTAL = areaOfBounds(B);
  const regions = [];
  const comps = [];
  for (let i = 0; i < lv.lights.length; i++) {
    const r = regionForLight(lv, i, { step: STEP });
    regions.push(r);
    const c = components(r);
    comps.push(c);
    const a = areaOf(r);
    if (a === 0) notes.push(`❌ 第${i + 1}盏灯无解`);
    else if (a < 1400) notes.push(`⚠️ 第${i + 1}盏灯解区过小 ${(a / 1000).toFixed(1)}k`);
    else if (lv.tier > 1 && a / AREA_TOTAL > 0.62) notes.push(`⚠️ 第${i + 1}盏灯解区过大 ${Math.round((a / AREA_TOTAL) * 100)}%`);
  }

  if (lv.distance) {
    // 最优距离统一用 4px 网格复算，和生成器保持一致，避免步长不同算出不同值
    let total = 0;
    let reachable = true;
    lv.lights.forEach((_, i) => {
      const r = regionForLight(lv, i, { step: 4 });
      const d = shortestDistance(lv, i, lv.lights[i].start, r);
      if (!isFinite(d)) reachable = false;
      total += d;
    });
    if (!reachable) notes.push('❌ 距离不可达');
    else if (Math.abs(total - lv.distance.optimal) > 2) {
      // 1–24 关在运行时做了水平镜像；距离在连续空间等价，
      // 但离散网格的相位不同，允许 1% 的差（网格量化误差，不是几何变化）
      const tol = lv.mirrored ? Math.max(4, lv.distance.optimal * 0.01) : 2;
      if (Math.abs(total - lv.distance.optimal) > tol) {
        notes.push(`❌ 最优距离不符：存档 ${lv.distance.optimal} / 复算 ${total.toFixed(1)}`);
      }
    }
    if (!comps.some((c) => c.length >= 2)) notes.push('❌ 多解关只剩一个解区');
  }

  rows.push({ lv, hold, regions, comps, notes });
  if (notes.some((n) => n.startsWith('❌'))) bad++;
}

for (const { lv, hold, regions, comps, notes } of rows) {
  const areas = regions.map((r) => `${(areaOf(r) / 1000).toFixed(1)}k`).join(' ');
  const cc = comps.map((c) => c.length).join(' ');
  console.log(
    `${String(lv.id).padStart(2)}. ${lv.name.padEnd(7, '　')} ` +
      `灯${lv.lights.length} 晶${lv.crystals.length}(${lv.crystals.filter((c) => c.side === 'l').length}左) 障${lv.blocks.length} 动${lv.movers.length} ` +
      `| 保持 ${hold === Infinity ? '∞' : hold.toFixed(1) + 's'} ` +
      `| 解区 ${areas}（块 ${cc}）` +
      `${lv.distance ? ` | 最优 ${lv.distance.optimal}` : ''}` +
      `${notes.length ? '\n     ' + notes.join('   ') : ''}`
  );
}

console.log(`\n共 ${LEVELS.length} 关，${bad ? bad + ' 关有问题' : '全部通过'}（步长 ${STEP}px）`);
process.exit(bad ? 1 : 0);
