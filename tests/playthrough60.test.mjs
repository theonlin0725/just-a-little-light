// 60 关交互层回归：用真实的 pointerDown/Move/Up + update 推进，
// 不直接改 lights.pos / phase / holdTime / unlocked。
// 说明：这是"交互集成层"证据，不是真机证据。

globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const { Game } = await import('../src/game.js');
const { LEVELS } = await import('../src/levels-live.js');
const { pointInPolygon } = await import('../src/geometry.js');
const { sceneToScreen: toScreen } = await import('../src/layout.js');
const { BOUNDS } = await import('../src/config.js');

let pass = 0;
let fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log(`  ✗ ${m}`); } };
const STEP = 1 / 60;

/** 在自由空间里用 BFS 规划一条绕开静态障碍的路径（测试工具，不参与游戏逻辑） */
function planPath(g, from, to) {
  const B = g.level.bounds || BOUNDS;
  const step = 16;
  const cols = Math.floor((B.x1 - B.x0) / step) + 1;
  const rows = Math.floor((B.y1 - B.y0) / step) + 1;
  const cellOf = (p) => ({
    c: Math.max(0, Math.min(cols - 1, Math.round((p.x - B.x0) / step))),
    r: Math.max(0, Math.min(rows - 1, Math.round((p.y - B.y0) / step))),
  });
  const posOf = (c, r) => ({ x: B.x0 + c * step, y: B.y0 + r * step });
  const blocks = g.level.blocks || [];
  const blocked = (c, r) => {
    const p = posOf(c, r);
    return blocks.some((b) => pointInPolygon(p, b));
  };
  const start = cellOf(from);
  const goal = cellOf(to);
  const key = (c, r) => r * cols + c;
  const prev = new Map();
  const seen = new Set([key(start.c, start.r)]);
  const q = [start];
  let found = false;
  while (q.length) {
    const cur = q.shift();
    if (cur.c === goal.c && cur.r === goal.r) { found = true; break; }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = cur.c + dc;
      const r = cur.r + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const k = key(c, r);
      if (seen.has(k) || blocked(c, r)) continue;
      seen.add(k);
      prev.set(k, cur);
      q.push({ c, r });
    }
  }
  if (!found) return [to];
  const path = [];
  let cur = goal;
  while (cur) {
    path.push(posOf(cur.c, cur.r));
    cur = prev.get(key(cur.c, cur.r));
  }
  path.reverse();
  path.push(to);
  return path;
}

/** 用真实指针事件沿路径把某盏灯拖到设计解位置 */
function dragLightTo(g, li, tx, ty) {
  const L = g.lights[li];
  const path = planPath(g, { x: L.pos.x, y: L.pos.y }, { x: tx, y: ty });
  const p0 = toScreen({ x: L.pos.x, y: L.pos.y }, g.sceneLayout, g.sceneDir);
  g.pointerDown(p0.x, p0.y);
  for (const wp of path) {
    for (let guard = 0; guard < 200; guard++) {
      const dx = wp.x - L.pos.x;
      const dy = wp.y - L.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) break;
      const wpS = toScreen({ x: wp.x, y: wp.y }, g.sceneLayout, g.sceneDir);
      g.pointerMove(wpS.x, wpS.y);
      g.update(STEP);
    }
  }
  const stepLen = 9;
  for (let iter = 0; iter < 900; iter++) {
    const dx = tx - L.pos.x;
    const dy = ty - L.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 2.5) break;
    const ux = dx / d;
    const uy = dy / d;
    const before = { x: L.pos.x, y: L.pos.y };
    g.pointerMove(L.pos.x + ux * stepLen, L.pos.y + uy * stepLen);
    g.update(STEP);
    const moved = Math.hypot(L.pos.x - before.x, L.pos.y - before.y);
    if (moved < 1) {
      // 被挡：沿垂直方向滑一下，哪边动就往哪边绕
      const px = -uy;
      const py = ux;
      let slid = false;
      for (const sign of [1, -1]) {
        const sd = toScreen({ x: L.pos.x + px * stepLen * sign, y: L.pos.y + py * stepLen * sign }, g.sceneLayout, g.sceneDir);
        g.pointerMove(sd.x, sd.y);
        g.update(STEP);
        if (Math.hypot(L.pos.x - before.x, L.pos.y - before.y) > 1) { slid = true; break; }
      }
      if (!slid) break; // 彻底卡住，交给断言暴露
    }
  }
  // 让缓动收敛到精确位置
  const tip = toScreen({ x: tx, y: ty }, g.sceneLayout, g.sceneDir);
  g.pointerMove(tip.x, tip.y);
  for (let k = 0; k < 20; k++) g.update(STEP);
  g.pointerUp();
}

/** 松手后空转，直到通关或超时 */
function holdUntilWin(g, maxSeconds = 30) {
  const frames = Math.round(maxSeconds / STEP);
  for (let i = 0; i < frames; i++) {
    if (g.phase === 'win') return i * STEP;
    g.update(STEP);
  }
  return g.phase === 'win' ? maxSeconds : -1;
}

const rows = [];
for (let i = 0; i < LEVELS.length; i++) {
  const g = new Game();
  g.save.unlocked = i; // 只为进入该关，不写回存档
  g.startLevel(i);

  // 1) 不操作不能自动通关
  for (let k = 0; k < 60; k++) g.update(STEP);
  const autoWin = g.phase === 'win';

  // 2) 每盏灯拖到设计解
  const goals = g.lights.map((l) => l.goal || l.pos);
  for (let li = 0; li < g.lights.length; li++) {
    dragLightTo(g, li, goals[li].x, goals[li].y);
  }

  // 3) 保持
  const t = holdUntilWin(g);
  rows.push({ id: LEVELS[i].id, name: LEVELS[i].name, win: g.phase === 'win', t, autoWin, lights: g.lights.length });
  ok(!autoWin, `第 ${LEVELS[i].id} 关不操作就不会通关`);
  ok(g.phase === 'win', `第 ${LEVELS[i].id} 关 ${LEVELS[i].name} 通过真实拖动通关（${t.toFixed(2)}s）`);
}

const won = rows.filter((r) => r.win).length;
const slow = rows.filter((r) => r.win && r.t > 4).map((r) => r.id);
console.log(`\n逻辑/交互层：${won}/${LEVELS.length} 关通过`);
if (slow.length) console.log(`  保持超过 4 秒才通关的关卡（等待移动障碍窗口）：${slow.join(', ')}`);
const auto = rows.filter((r) => r.autoWin).length;
console.log(`  不操作自动通关：${auto} 关（应为 0）`);
console.log(`${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
