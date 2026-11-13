// 镜像等价性：1–24 关水平反射后，谜题必须逐点等价。
import { LEVELS as RAW } from '../src/levels.js';
import { LEVELS as LIVE, MIRROR_THROUGH, WALL_SQUASH } from '../src/levels-live.js';
import { mirrorLevel, mirrorX, WALL_MIRRORED } from '../src/mirror.js';
import { isVisibleAt, moverPoly } from '../src/geometry.js';
import { VIEW } from '../src/levels.js';

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

console.log('\n[1] 只镜像 1–24；25–60 不做左右镜像（本轮只做沿墙压缩）');
{
  ok(LIVE.length === 60, `关卡总数 ${LIVE.length}`);
  // 沿墙压缩已经在生成器里固化，运行时 25–60 只做 fit（bounds/lights 夹取），几何应与数据完全一致
  const sameGeom = (live, raw) => JSON.stringify(live.crystals.map((c) => ({ x: c.x, y: c.y, lights: c.lights })))
      === JSON.stringify(raw.crystals.map((c) => ({ x: c.x, y: c.y, lights: c.lights })))
    && live.blocks.length === raw.blocks.length
    && live.blocks.every((poly, i) => poly.every((p, k) => Math.abs(p.y - raw.blocks[i][k].y) < 1e-6 && Math.abs(p.x - raw.blocks[i][k].x) < 1e-6));
  let mirrored = 0;
  for (let i = 0; i < RAW.length; i++) {
    if (LIVE[i].mirrored) mirrored++;
    if (RAW[i].id <= MIRROR_THROUGH) ok(!!LIVE[i].mirrored, `第 ${RAW[i].id} 关为镜像关`);
    else ok(!LIVE[i].mirrored && sameGeom(LIVE[i], RAW[i]), `第 ${RAW[i].id} 关未镜像，几何与数据一致`);
  }
  ok(mirrored === MIRROR_THROUGH, `共 ${mirrored} 关镜像`);
  ok(WALL_SQUASH > 0 && WALL_SQUASH < 1, `沿墙压缩系数 ${WALL_SQUASH}（已固化在生成数据）`);
}

console.log('\n[2] 墙几何按反射轴精确镜像');
{
  ok(WALL_MIRRORED.cx === VIEW.w - 582 && WALL_MIRRORED.x === VIEW.w - 566 - 40, `右墙 582/566 → ${WALL_MIRRORED.cx}/${WALL_MIRRORED.x}`);
  const l1 = LIVE[0];
  ok(l1.wallL && l1.wallL.cx === 138, '第 1 关的目标墙在 x=138');
  ok(!l1.wallR, '第 1 关没有多余的右墙');
  ok(l1.bounds.x0 === 440 && l1.bounds.x1 === 630, `可拖拽区 90–280 → ${l1.bounds.x0}–${l1.bounds.x1}`);
}

console.log('\n[3] 两次镜像还原（几何字段）');
{
  for (const id of [1, 7, 13, 16, 24]) {
    const src = RAW.find((l) => l.id === id);
    const twice = mirrorLevel(mirrorLevel(src));
    const pick = (l) => ({
      lights: l.lights,
      crystals: l.crystals.map((c) => ({ x: c.x, y: c.y, lights: c.lights })),
      blocks: l.blocks,
      movers: l.movers.map((m) => ({ path: m.path, shape: m.shape, period: m.period, phase: m.phase, mode: m.mode })),
      bounds: l.bounds || { x0: 90, x1: 280, y0: 220, y1: 1060 },
    });
    ok(JSON.stringify(pick(twice)) === JSON.stringify(pick(src)), `第 ${id} 关两次镜像后几何一致`);
  }
}

console.log('\n[4] 同一时刻、同一相对位置：点亮序列完全一致');
{
  let checked = 0;
  let mismatch = 0;
  for (const id of [1, 3, 12, 13, 16, 19, 24]) {
    const src = RAW.find((l) => l.id === id);
    const mir = mirrorLevel(src);
    const srcPolys = (t) => [...(src.blocks || []), ...(src.movers || []).map((m) => moverPoly(m, t))];
    const mirPolys = (t) => [...(mir.blocks || []), ...(mir.movers || []).map((m) => moverPoly(m, t))];
    for (let k = 0; k < 24; k++) {
      const p = { x: 100 + ((k * 137) % 520), y: 300 + ((k * 89) % 700) };
      const t = (k % 6) * 1.7;
      const srcLit = src.crystals.map((c) => isVisibleAt(p, c, srcPolys(t), [], t));
      const mirLit = mir.crystals.map((c) => isVisibleAt(mirrorX(p), c, mirPolys(t), [], t));
      checked++;
      if (JSON.stringify(srcLit) !== JSON.stringify(mirLit)) mismatch++;
    }
  }
  ok(mismatch === 0, `${checked} 组随机位置/时刻，镜像前后点亮序列一致`);
}

console.log('\n[5] 移动障碍：位置镜像、局部形状翻转');
{
  const src = RAW.find((l) => l.id === 13);
  const mir = mirrorLevel(src);
  for (const t of [0, 1.3, 4.4, 7.7]) {
    const a = moverPoly(src.movers[0], t);
    const b = moverPoly(mir.movers[0], t);
    const cx = a.reduce((s, p) => s + p.x, 0) / a.length;
    const cxb = b.reduce((s, p) => s + p.x, 0) / b.length;
    ok(near(VIEW.w - cx, cxb, 0.01), `t=${t}s 时轨迹中心镜像一致（${cx.toFixed(1)} → ${cxb.toFixed(1)}）`);
  }
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
