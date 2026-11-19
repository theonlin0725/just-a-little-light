// 全部画面都是代码画的，没有任何图片资源。
import { VIEW, WALL, WALL_L, LEVELS, HOLD_TIME } from './levels-live.js';
import { moverPoly, pulseAt } from './geometry.js';
import { SKINS } from './skins.js';
import { plat } from './platform.js';
import { quality } from './quality.js';
import { nudgeVisible } from './nudge.js';
import { computeSceneLayout, sceneMatrix, sceneToScreen } from './layout.js';
import { ads } from './ads.js';
import { drawBeam } from './beam-render.js';

/**
 * 叠加模式：Web 用 'lighter' 保持既有观感；
 * 微信小游戏不支持 'lighter'（'screen' 也不保证），退回 source-over。
 * 只影响光晕/光柱的叠加方式，不影响任何几何与判定。
 */
const addMode = () => (plat.kind === 'wx' ? 'source-over' : 'lighter');

const FONT_UI =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
const FONT_TITLE = '"Songti SC", "STSong", "Noto Serif SC", "SimSun", serif';

const WARM = '255, 205, 140';
const COOL = '150, 240, 255';

/* ---------------- 小工具 ---------------- */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 从区间集合里挖掉若干"影子"区间 */
function litIntervals(top, bottom, bands) {
  let segs = [[top, bottom]];
  for (const b of bands) {
    const next = [];
    for (const [a, z] of segs) {
      if (b.y1 <= a || b.y0 >= z) {
        next.push([a, z]);
        continue;
      }
      if (b.y0 > a) next.push([a, Math.min(b.y0, z)]);
      if (b.y1 < z) next.push([Math.max(b.y1, a), z]);
    }
    segs = next;
  }
  return segs.filter(([a, z]) => z - a > 0.5);
}

function polyPath(ctx, poly) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

/* ---------------- 预生成噪点 ---------------- */

// 噪点三态：0=未尝试 1=可用 2=永久停用（失败只尝试一次，不每帧重建 canvas）
let noiseState = 0;
let noisePattern = null;
function ensureNoise(ctx) {
  if (noiseState === 1) return noisePattern;
  if (noiseState === 2) return null;
  noiseState = 2; // 先假定失败，成功再改回 1
  try {
    const c = plat.createCanvas(128, 128);
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + Math.random() * 135;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const p = ctx.createPattern ? ctx.createPattern(c, 'repeat') : null;
    if (!p) return null;
    noisePattern = p;
    noiseState = 1;
    return p;
  } catch {
    return null;
  }
}

const DUST = Array.from({ length: 110 }, () => ({
  x: 40 + Math.random() * 640,
  y: Math.random() * VIEW.h,
  ax: 8 + Math.random() * 30,
  ay: 10 + Math.random() * 40,
  s: 0.06 + Math.random() * 0.22,
  p: Math.random() * Math.PI * 2,
  r: 0.7 + Math.random() * 1.5,
}));

/* ---------------- 背景 ---------------- */

function drawBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, VIEW.w * 0.4, VIEW.h);
  g.addColorStop(0, '#0a0c14');
  g.addColorStop(0.55, '#070810');
  g.addColorStop(1, '#040509');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

function drawVignette(ctx) {
  const g = ctx.createRadialGradient(VIEW.w * 0.42, VIEW.h * 0.46, 120, VIEW.w * 0.42, VIEW.h * 0.46, VIEW.h * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.62, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0.78)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

function drawNoise(ctx) {
  if (!quality.tier.noise) return;
  const p = ensureNoise(ctx);
  if (!p) return;
  ctx.save();
  ctx.globalAlpha = 0.028;
  ctx.globalCompositeOperation = addMode() === 'lighter' ? 'screen' : 'source-over';
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.restore();
}

function drawAirlight(ctx, g) {
  ctx.save();
  ctx.globalCompositeOperation = addMode();
  for (const L of g.lights) {
    const grad = ctx.createRadialGradient(L.pos.x, L.pos.y, 0, L.pos.x, L.pos.y, 520);
    grad.addColorStop(0, `rgba(${WARM},0.16)`);
    grad.addColorStop(0.35, `rgba(${WARM},0.055)`);
    grad.addColorStop(1, `rgba(${WARM},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }
  ctx.restore();
}

/* ---------------- 墙 ---------------- */

function drawWallPanel(ctx, g, wall, bands, side) {
  const { x, w, top, bottom, cx } = wall;
  const lit = litIntervals(top, bottom, bands || []);

  ctx.save();
  roundRect(ctx, x, top, w, bottom - top, 18);
  const base = ctx.createLinearGradient(x, 0, x + w, 0);
  base.addColorStop(0, '#101522');
  base.addColorStop(0.45, '#161c2a');
  base.addColorStop(1, '#090d15');
  ctx.fillStyle = base;
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,180,220,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (!lit.length) return;

  // 微信小游戏没有 Path2D，改用普通路径；fill / clip 各自重建一次
  const buildLitPath = () => {
    ctx.beginPath();
    for (const [a, z] of lit) ctx.rect(x - 1, a, w + 2, z - a);
  };

  ctx.save();
  ctx.globalCompositeOperation = addMode();
  ctx.shadowColor = `rgba(${WARM},0.55)`;
  ctx.shadowBlur = quality.tier.shadows ? 20 : 0;
  ctx.fillStyle = `rgba(${WARM},0.11)`;
  buildLitPath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, top, w, bottom - top, 18);
  ctx.clip();
  buildLitPath();
  ctx.clip();

  ctx.fillStyle = 'rgba(255,244,222,0.16)';
  ctx.fillRect(x, top, w, bottom - top);

  // 每盏灯各打一个光斑，墙才像被两束光一起照着
  ctx.globalCompositeOperation = addMode();
  for (const L of g.lights) {
    const warm = ctx.createRadialGradient(cx, L.pos.y, 0, cx, L.pos.y, 520);
    warm.addColorStop(0, 'rgba(255,253,248,0.62)');
    warm.addColorStop(0.1, 'rgba(255,243,222,0.40)');
    warm.addColorStop(0.34, 'rgba(255,216,172,0.15)');
    warm.addColorStop(0.7, 'rgba(255,192,142,0.05)');
    warm.addColorStop(1, 'rgba(255,180,130,0.015)');
    ctx.fillStyle = warm;
    ctx.fillRect(x, top, w, bottom - top);
  }
  ctx.globalCompositeOperation = 'source-over';

  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let yy = top; yy < bottom; yy += 13) ctx.fillRect(x, yy, w, 1);
  ctx.globalAlpha = 1;

  const edge = ctx.createLinearGradient(x, 0, x + w, 0);
  if (side === 'l') {
    // 左墙的受光面朝右，明暗要镜像
    edge.addColorStop(0, 'rgba(0,0,0,0.34)');
    edge.addColorStop(0.2, 'rgba(0,0,0,0.12)');
    edge.addColorStop(0.8, 'rgba(255,255,255,0.02)');
    edge.addColorStop(1, 'rgba(255,255,255,0.10)');
  } else {
    edge.addColorStop(0, 'rgba(255,255,255,0.10)');
    edge.addColorStop(0.2, 'rgba(255,255,255,0.02)');
    edge.addColorStop(0.8, 'rgba(0,0,0,0.12)');
    edge.addColorStop(1, 'rgba(0,0,0,0.34)');
  }
  ctx.fillStyle = edge;
  ctx.fillRect(x, top, w, bottom - top);
  ctx.restore();

  // 影子边界的锐利高光
  ctx.save();
  ctx.globalCompositeOperation = addMode();
  ctx.fillStyle = 'rgba(255,246,226,0.7)';
  for (const [a, z] of lit) {
    if (a > top + 1) ctx.fillRect(x + 1, a - 1, w - 2, 1.5);
    if (z < bottom - 1) ctx.fillRect(x + 1, z - 0.5, w - 2, 1.5);
  }
  ctx.restore();
}

/* ---------------- 光柱 ---------------- */

function drawBeams(ctx, g, time) {
  ctx.save();
  ctx.globalCompositeOperation = addMode();
  ctx.lineCap = 'round';

  g.crystals.forEach((c, ci) => {
    for (const li of c.def.lights) {
      const L = g.lights[li];
      const end = c.rayEnds[li];
      if (!L || !end) continue;
      const shimmer = 0.86 + 0.14 * Math.sin(time * 2.2 + ci * 1.9 + li);
      const grad = ctx.createLinearGradient(L.pos.x, L.pos.y, end.x, end.y);
      const bw = g.skin.beamW;
      if (end.blocked) {
        grad.addColorStop(0, `rgba(255,190,120,${0.38 * shimmer})`);
        grad.addColorStop(0.85, 'rgba(190,120,60,0.09)');
        grad.addColorStop(1, 'rgba(150,90,50,0)');
      } else {
        grad.addColorStop(0, `rgba(${g.skin.beam},${0.88 * shimmer})`);
        grad.addColorStop(0.7, `rgba(${g.skin.beam},${0.5 * shimmer})`);
        grad.addColorStop(1, `rgba(${g.skin.core},${0.45 * shimmer})`);
      }
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(L.pos.x, L.pos.y);
      ctx.lineTo(end.x, end.y);

      ctx.globalAlpha = end.blocked ? 0.05 : 0.075;
      ctx.lineWidth = 16 * bw;
      ctx.stroke();
      ctx.globalAlpha = end.blocked ? 0.09 : 0.18;
      ctx.lineWidth = 5.5 * bw;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = (end.blocked ? 1.2 : 2) * bw;
      ctx.stroke();

      const hit = end.blocked ? 12 : 26;
      const rg = ctx.createRadialGradient(end.x, end.y, 0, end.x, end.y, hit);
      if (end.blocked) {
        rg.addColorStop(0, `rgba(255,190,130,${0.3 * shimmer})`);
        rg.addColorStop(1, 'rgba(255,150,90,0)');
      } else {
        rg.addColorStop(0, `rgba(190,250,255,${0.45 * shimmer})`);
        rg.addColorStop(1, 'rgba(150,240,255,0)');
      }
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(end.x, end.y, hit, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

/* ---------------- 水晶 ---------------- */

function diamond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.62, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.62, y);
  ctx.closePath();
}

function drawCrystals(ctx, g, time) {
  for (const c of g.crystals) {
    const glow = c.glow;
    const pulse = 0.85 + 0.15 * Math.sin(time * 3.2 + c.y * 0.01);
    // 部分满足：至少被一盏灯照到（但还差另一盏）
    const partial = !c.lit && c.seenBy.some(Boolean);

    if (glow > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = addMode();
      const R = 26 + 48 * glow;
      const rg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
      rg.addColorStop(0, `rgba(200,252,255,${0.8 * glow})`);
      rg.addColorStop(0.35, `rgba(${COOL},${0.32 * glow})`);
      rg.addColorStop(1, `rgba(${COOL},0)`);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (partial) {
      ctx.save();
      ctx.globalCompositeOperation = addMode();
      const rg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 26);
      rg.addColorStop(0, `rgba(${WARM},0.30)`);
      rg.addColorStop(1, `rgba(${WARM},0)`);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    diamond(ctx, c.x, c.y, 10 + glow * 3);
    if (glow > 0.05) {
      ctx.shadowColor = `rgba(${COOL},${0.95 * glow})`;
      ctx.shadowBlur = quality.tier.shadows ? 24 * glow : 0;
      ctx.fillStyle = `rgba(238,255,255,${0.4 + 0.6 * glow * pulse})`;
    } else if (partial) {
      ctx.fillStyle = 'rgba(120,96,60,0.9)';
    } else {
      ctx.fillStyle = 'rgba(30,38,54,0.95)';
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = glow > 0.05
      ? `rgba(226,252,255,${0.9 * glow})`
      : partial
        ? 'rgba(255,205,140,0.7)'
        : 'rgba(96,110,140,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // 需要两盏灯的水晶，标两个点
    if (c.def.lights.length > 1) {
      for (let k = 0; k < c.def.lights.length; k++) {
        ctx.beginPath();
        ctx.fillStyle = c.seenBy[c.def.lights[k]] ? `rgba(${COOL},0.9)` : 'rgba(120,132,158,0.5)';
        ctx.arc(c.x - 8 + k * 16, c.y + 26, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (c.flash > 0.01) {
      const k = 1 - c.flash;
      ctx.save();
      ctx.globalCompositeOperation = addMode();
      ctx.strokeStyle = `rgba(${COOL},${0.5 * c.flash})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 10 + k * 52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/* ---------------- 遮挡物 ---------------- */

function drawSlab(ctx, g, poly, { moving = false } = {}) {
  const L = g.lights[g.active] || g.lights[0];
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  ctx.save();
  polyPath(ctx, poly);
  const fill = ctx.createLinearGradient(minX, minY, maxX, maxY);
  fill.addColorStop(0, moving ? '#1a2536' : '#1b2333');
  fill.addColorStop(0.55, '#121826');
  fill.addColorStop(1, '#0a0e16');
  ctx.fillStyle = fill;
  ctx.fill();

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const el = Math.hypot(ex, ey) || 1;
    const nx = ey / el;
    const ny = -ex / el;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = L.pos.x - mx;
    const dy = L.pos.y - my;
    const dl = Math.hypot(dx, dy) || 1;
    const facing = (nx * dx + ny * dy) / dl;
    if (facing <= 0.02) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = moving
      ? `rgba(${COOL},${0.5 * facing})`
      : `rgba(${WARM},${0.72 * facing})`;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(minX, minY + 1);
  ctx.lineTo(maxX, minY + 1);
  ctx.strokeStyle = moving ? `rgba(${COOL},0.22)` : 'rgba(168,192,226,0.14)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawBlocks(ctx, g) {
  g.level.blocks.forEach((poly, i) => {
    if (g.removed && g.removed.has(`b${i}`)) return;
    drawSlab(ctx, g, poly);
  });
}

function drawMovers(ctx, g, time) {
  if (!g.movers.length || g.phase === 'title') return;
  // 轨迹预览：让玩家能预判
  ctx.save();
  ctx.setLineDash([5, 8]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(${COOL},0.16)`;
  for (const m of g.movers) {
    ctx.beginPath();
    m.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (m.mode === 'loop') ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();

  for (let mi = 0; mi < g.movers.length; mi++) {
    if (g.removed && g.removed.has(`m${mi}`)) continue;
    const m = g.movers[mi];
    const poly = moverPoly(m, g.sceneT);
    // 前摇：胀大之前先亮一圈，给玩家反应时间
    const { warn, scale } = pulseAt(m.pulse, g.sceneT);
    if (warn > 0.01) {
      const c = poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), { x: 0, y: 0 });
      ctx.save();
      ctx.globalCompositeOperation = addMode();
      ctx.strokeStyle = `rgba(${COOL},${0.35 * warn})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 34 + (1 - warn) * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    drawSlab(ctx, g, poly, { moving: true });
    if (scale > 1.02) {
      ctx.save();
      ctx.globalCompositeOperation = addMode();
      ctx.strokeStyle = `rgba(${COOL},0.28)`;
      ctx.lineWidth = 1.5;
      polyPath(ctx, poly);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/* ---------------- 光源 ---------------- */

function drawLights(ctx, g, time) {
  const sk = g.skin;
  // 拖尾：只影响观感，不参与任何计算
  if (quality.tier.trails && g.trail.length) {
    ctx.save();
    ctx.globalCompositeOperation = addMode();
    for (const t of g.trail) {
      const a = Math.max(0, t.life) * 0.16;
      ctx.fillStyle = `rgba(${sk.trail},${a})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 8 * t.life + 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  g.lights.forEach((L, i) => {
    const active = i === g.active && g.phase === 'play';
    const p = L.pos;
    ctx.save();
    ctx.globalCompositeOperation = addMode();
    const hr = active ? sk.haloR : sk.haloR * 0.76;
    const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, hr);
    halo.addColorStop(0, `rgba(${sk.glow},${active ? 0.32 : 0.11})`);
    halo.addColorStop(0.25, `rgba(${sk.glow},${active ? 0.13 : 0.04})`);
    halo.addColorStop(1, `rgba(${sk.glow},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(p.x, p.y, hr, 0, Math.PI * 2);
    ctx.fill();

    const cr = active ? 34 : 26;
    const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, cr);
    core.addColorStop(0, `rgba(${sk.core},0.98)`);
    core.addColorStop(0.18, `rgba(${sk.mid},0.92)`);
    core.addColorStop(0.45, `rgba(${sk.glow},0.35)`);
    core.addColorStop(1, `rgba(${sk.glow},0)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(p.x, p.y, cr, 0, Math.PI * 2);
    ctx.fill();

    // 星砂：核心外面撒几颗碎光
    if (sk.sparkle && active) {
      for (let k = 0; k < 5; k++) {
        const a = time * 1.6 + k * 1.3;
        const r = 18 + 10 * Math.sin(time * 2 + k);
        ctx.fillStyle = `rgba(${sk.mid},${0.5 + 0.3 * Math.sin(time * 4 + k)})`;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    if (g.phase !== 'play') return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (active) {
      ctx.rotate(time * 0.6);
      ctx.strokeStyle = `rgba(${WARM},0.4)`;
      ctx.lineWidth = 1.6;
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, 32, k * Math.PI, k * Math.PI + 1.15);
        ctx.stroke();
      }
      // 保持进度环
      if (g.holdTime > 0.02) {
        const k = Math.min(1, g.holdTime / HOLD_TIME);
        ctx.rotate(-time * 0.6 - Math.PI / 2);
        ctx.strokeStyle = 'rgba(4,6,10,0.55)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, 46, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${COOL},${0.55 + 0.4 * k})`;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, 46, 0, Math.PI * 2 * k);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = `rgba(${WARM},0.16)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  });
}

/* ---------------- 尘埃 ---------------- */

function drawDust(ctx, g, time) {
  ctx.save();
  ctx.globalCompositeOperation = addMode();
  const dustN = Math.min(DUST.length, quality.tier.dust);
  for (let di = 0; di < dustN; di++) {
    const d = DUST[di];
    const x = d.x + Math.sin(time * d.s + d.p) * d.ax;
    const y = d.y + Math.cos(time * d.s * 0.8 + d.p * 1.7) * d.ay;
    let near = 0;
    for (const L of g.lights) {
      const dx = x - L.pos.x;
      const dy = y - L.pos.y;
      near = Math.max(near, 1 / (1 + (dx * dx + dy * dy) / 42000));
    }
    const tw = 0.55 + 0.45 * Math.sin(time * 1.7 + d.p * 3);
    const a = (0.03 + near * 0.5) * tw;
    if (a < 0.02) continue;
    ctx.fillStyle = `rgba(255,226,180,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------------- 界面 ---------------- */

const fmtT = (t) => `${t.toFixed(1)}″`;

function pill(ctx, r, { active = false, label, sub, alpha = 1, dim = false, pressed = false } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const rr = pressed ? 0.96 : 1;
  const px = r.x + (r.w * (1 - rr)) / 2;
  const py = r.y + (r.h * (1 - rr)) / 2;
  roundRect(ctx, px, py, r.w * rr, r.h * rr, Math.min(r.h / 2, 18));
  ctx.fillStyle = pressed ? `rgba(${WARM},0.20)` : active ? `rgba(${WARM},0.14)` : 'rgba(255,255,255,0.045)';
  ctx.fill();
  ctx.strokeStyle = active ? `rgba(${WARM},0.5)` : 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = dim ? 'rgba(160,172,192,0.42)' : active ? 'rgba(255,240,215,0.96)' : 'rgba(214,224,238,0.72)';
  ctx.font = `500 ${sub ? 25 : 23}px ${FONT_UI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + (sub ? -8 : 1));
  if (sub) {
    ctx.fillStyle = 'rgba(190,204,224,0.5)';
    ctx.font = `400 17px ${FONT_UI}`;
    ctx.fillText(sub, r.x + r.w / 2, r.y + r.h / 2 + 15);
  }
  ctx.restore();
}

/* ---------------- 底部图标按钮 ---------------- */

function drawHomeGlyph(ctx, cx, cy, r) {
  ctx.save();
  ctx.strokeStyle = 'rgba(226,236,250,0.82)';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // 屋顶
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.05, cy - r * 0.1);
  ctx.lineTo(cx, cy - r * 1.05);
  ctx.lineTo(cx + r * 1.05, cy - r * 0.1);
  ctx.stroke();
  // 屋身
  ctx.strokeRect(cx - r * 0.72, cy - r * 0.1, r * 1.44, r * 1.0);
  // 门
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.24, cy + r * 0.9);
  ctx.lineTo(cx - r * 0.24, cy + r * 0.38);
  ctx.lineTo(cx + r * 0.24, cy + r * 0.38);
  ctx.lineTo(cx + r * 0.24, cy + r * 0.9);
  ctx.stroke();
  ctx.restore();
}

function drawSkinGlyph(ctx, cx, cy, r, g) {
  const sk = g.skin;
  ctx.save();
  // 中间的小光球，颜色跟着当前皮肤走
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.15);
  glow.addColorStop(0, `rgba(${sk.glow},0.55)`);
  glow.addColorStop(1, `rgba(${sk.glow},0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.44, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${sk.mid},0.95)`;
  ctx.fill();

  // 外圈三段弧，读起来像调色盘
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.92, k * 2.1 + 0.25, k * 2.1 + 1.35);
    ctx.strokeStyle = 'rgba(226,236,250,0.55)';
    ctx.stroke();
  }
  ctx.restore();
}

function drawArrowLeftGlyph(ctx, cx, cy, r) {
  ctx.save();
  ctx.strokeStyle = 'rgba(226,236,250,0.82)';
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + r, cy);
  ctx.lineTo(cx - r * 0.9, cy);
  ctx.moveTo(cx - r * 0.9, cy);
  ctx.lineTo(cx - r * 0.15, cy - r * 0.72);
  ctx.moveTo(cx - r * 0.9, cy);
  ctx.lineTo(cx - r * 0.15, cy + r * 0.72);
  ctx.stroke();
  ctx.restore();
}

/** 逆时针环形箭头：缺口在正上方，箭头落在右上端、朝逆时针方向 */
function drawRestartGlyph(ctx, cx, cy, r) {
  ctx.save();
  ctx.strokeStyle = 'rgba(226,236,250,0.82)';
  ctx.fillStyle = 'rgba(226,236,250,0.82)';
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  const startA = Math.PI * (240 / 180); // 240°
  const endA = Math.PI * (300 / 180); // 300°
  ctx.beginPath();
  ctx.arc(cx, cy, r, startA, endA, true); // true = 逆时针，缺口留在正上方
  ctx.stroke();

  // 箭头：在 endA 处沿逆时针切线
  const ex = cx + Math.cos(endA) * r;
  const ey = cy + Math.sin(endA) * r;
  const tx = Math.sin(endA);
  const ty = -Math.cos(endA);
  const nx = Math.cos(endA);
  const ny = Math.sin(endA);
  const s = r * 0.5;
  ctx.beginPath();
  ctx.moveTo(ex + tx * s, ey + ty * s);
  ctx.lineTo(ex + nx * s * 0.62, ey + ny * s * 0.62);
  ctx.lineTo(ex - nx * s * 0.62, ey - ny * s * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 灯泡轮廓：圆头 + 灯颈 + 底座两条线 */
function drawBulbGlyph(ctx, cx, cy, r) {
  ctx.save();
  ctx.strokeStyle = 'rgba(226,236,250,0.82)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.22, r * 0.62, Math.PI * 0.82, Math.PI * 0.18, false);
  ctx.stroke();
  // 灯颈
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.26, cy + r * 0.28);
  ctx.lineTo(cx - r * 0.2, cy + r * 0.62);
  ctx.lineTo(cx + r * 0.2, cy + r * 0.62);
  ctx.lineTo(cx + r * 0.26, cy + r * 0.28);
  ctx.stroke();
  // 灯丝
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.2, cy + r * 0.82);
  ctx.lineTo(cx + r * 0.2, cy + r * 0.82);
  ctx.stroke();
  ctx.restore();
}

const GLYPHS = {
  levels: drawArrowLeftGlyph,
  restart: drawRestartGlyph,
  hint: drawBulbGlyph,
  skin: drawSkinGlyph,
  home: drawHomeGlyph,
};

function iconButton(ctx, g, r, name, glyph) {
  const pressed = g.pressedBtn && g.pressedBtn.name === name && g.pressedBtn.until > g.t;
  const hover = g.hoverBtn === name;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rr = (r.w / 2) * (pressed ? 0.92 : 1);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, Math.PI * 2);
  ctx.fillStyle = pressed
    ? 'rgba(255,205,140,0.22)'
    : hover
      ? 'rgba(255,255,255,0.09)'
      : 'rgba(255,255,255,0.045)';
  ctx.fill();
  ctx.strokeStyle = pressed
    ? 'rgba(255,205,140,0.8)'
    : hover
      ? 'rgba(255,255,255,0.24)'
      : 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();
  glyph(ctx, cx, cy, rr * 0.5, g);
  ctx.restore();

  // 桌面端悬停提示（手机没有 hover，不依赖它）
  if (hover) {
    const label = r.label || name;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `400 17px ${FONT_UI}`;
    const w = ctx.measureText(label).width + 24;
    roundRect(ctx, cx - w / 2, r.y - 40, w, 30, 15);
    ctx.fillStyle = 'rgba(10,14,22,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(226,236,250,0.9)';
    ctx.fillText(label, cx, r.y - 24);
    ctx.restore();
  }
}

/**
 * 背景层：按 cover 缩放到整个 canvas，渐变/噪点/浮尘一直铺到屏幕边缘。
 * 玩法与 UI 仍然用 contain 坐标系，所以几何不会变形。
 */
function drawFullBleed(ctx, g, time) {
  const cw = (ctx.canvas && ctx.canvas.width) || VIEW.w;
  const ch = (ctx.canvas && ctx.canvas.height) || VIEW.h;
  const s = Math.max(cw / VIEW.w, ch / VIEW.h);
  const ox = (cw - VIEW.w * s) / 2;
  const oy = (ch - VIEW.h * s) / 2;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, ox, oy);
  drawBackground(ctx);
  drawAirlight(ctx, g);
  if (quality.tier.dust > 0) drawDust(ctx, g, time);
  if (quality.tier.vignette) drawVignette(ctx);
  drawNoise(ctx);
  ctx.restore();
}

/**
 * 第 5 次有效读秒失败后的轻量引导：指着真实的灯泡按钮，不复制假按钮。
 * 非模态、不冻结关卡、不抢手势（显示时机由 game 判定）。
 */
/**
 * 双光源身份标记：灯旁边一个 1/2 圆牌，目标水晶旁显示它需要哪几盏、已满足几盏。
 * 画在界面层（不旋转），所以文字始终是正的。
 */
function drawLightBadges(ctx, g, time) {
  if (!g.lights || g.lights.length < 2) return;
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.2);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  g.lights.forEach((L, i) => {
    const p = sceneToScreen(L.pos, g.sceneLayout, g.sceneDir || 'cw');
    const active = g.active === i;
    const r = 13;
    const cy = p.y - 30;
    ctx.beginPath();
    ctx.arc(p.x, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = active ? `rgba(255,214,160,${0.85})` : 'rgba(10,14,22,0.82)';
    ctx.fill();
    ctx.strokeStyle = active ? `rgba(255,236,206,${0.7 + 0.3 * pulse})` : 'rgba(200,214,236,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = active ? '#20160c' : 'rgba(226,234,246,0.9)';
    ctx.font = `600 15px ${FONT_UI}`;
    ctx.fillText(String(i + 1), p.x, cy + 1);
  });

  for (const c of g.crystals) {
    const need = c.def.lights || [];
    if (need.length < 2) continue;
    const p = sceneToScreen(c, g.sceneLayout, g.sceneDir || 'cw');
    const on = need.filter((li) => c.seenBy && c.seenBy[li]).length;
    const bx = p.x - 12;
    const by = p.y + 26;
    need.forEach((li, k) => {
      const ok = !!(c.seenBy && c.seenBy[li]);
      const x = bx + k * 22;
      ctx.beginPath();
      ctx.arc(x, by, 9, 0, Math.PI * 2);
      ctx.fillStyle = ok ? 'rgba(140,226,255,0.9)' : 'rgba(10,14,22,0.8)';
      ctx.fill();
      ctx.strokeStyle = ok ? 'rgba(190,244,255,0.95)' : 'rgba(200,214,236,0.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = ok ? '#06202a' : 'rgba(210,222,240,0.75)';
      ctx.font = `600 12px ${FONT_UI}`;
      ctx.fillText(String(li + 1), x, by + 1);
    });
    ctx.fillStyle = on === need.length ? 'rgba(150,232,255,0.95)' : 'rgba(210,222,240,0.75)';
    ctx.font = `600 13px ${FONT_UI}`;
    ctx.fillText(`${on}/${need.length}`, bx + (need.length * 22) / 2 + 18, by + 1);
  }
  ctx.restore();
}

function drawNudge(ctx, g, time) {
  const bar = g.bottomBar.find((b) => b.id === 'hint');
  if (!bar) return;
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.6);
  const tier = (g.level && g.level.tier) || 1;
  let text = '差一点就成功了，点灯泡看看提示吧。';
  if (!ads.available) text = '差一点就成功了，点灯泡看看免费提示。';

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

  // 呼吸圈：套在真实灯泡上
  ctx.strokeStyle = `rgba(255,214,160,${0.22 + 0.22 * pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bar.cx, bar.cy, 40 + pulse * 5, 0, Math.PI * 2);
  ctx.stroke();

  // 向下的小箭头，在灯泡正上方轻轻浮动
  const bob = Math.sin(time * 2.6) * 3;
  const ax = bar.cx;
  const ay = bar.cy - 64 + bob;
  ctx.fillStyle = `rgba(255,224,178,${0.55 + 0.3 * pulse})`;
  ctx.beginPath();
  ctx.moveTo(ax, ay + 12);
  ctx.lineTo(ax - 8, ay + 1);
  ctx.lineTo(ax + 8, ay + 1);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(ax - 1.5, ay - 10, 3, 12);

  // 文案：放在读秒条上方，避免遮挡进度与水晶
  ctx.font = `400 20px ${FONT_UI}`;
  const tw = ctx.measureText(text).width;
  const pad = 14;
  const bw = Math.min(VIEW.w - 80, tw + pad * 2);
  const bx = (VIEW.w - bw) / 2;
  const by = 1006;
  roundRect(ctx, bx, by, bw, 34, 17);
  ctx.fillStyle = 'rgba(12,16,26,0.82)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,214,160,0.28)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(246,238,226,0.9)';
  ctx.textAlign = 'center';
  ctx.fillText(text, VIEW.w / 2, by + 22);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawHoldMeter(ctx, g, time) {
  if (g.phase !== 'play') return;
  const w = 300;
  const x = (VIEW.w - w) / 2;
  const y = 1070;
  const k = Math.min(1, g.holdTime / HOLD_TIME);
  const allLit = g.allLit;

  ctx.save();
  roundRect(ctx, x, y, w, 8, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fill();
  if (k > 0.001) {
    roundRect(ctx, x, y, Math.max(8, w * k), 8, 4);
    const g2 = ctx.createLinearGradient(x, 0, x + w, 0);
    g2.addColorStop(0, `rgba(${WARM},0.85)`);
    g2.addColorStop(1, `rgba(${COOL},0.95)`);
    ctx.fillStyle = g2;
    ctx.fill();
  }
  // 3 秒刻度
  for (let i = 1; i < 3; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x + (w * i) / 3, y - 1, 1, 10);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (allLit) {
    ctx.fillStyle = `rgba(${COOL},${0.85 + 0.15 * Math.sin(time * 8)})`;
    ctx.font = `600 24px ${FONT_UI}`;
    ctx.fillText(`保持 ${g.holdTime.toFixed(1)} / ${HOLD_TIME.toFixed(0)} 秒`, VIEW.w / 2, y - 14);
  } else if (g.teachBasic) {
    // 基础规则只解释一次，后续关卡不再铺满这行字
    ctx.fillStyle = 'rgba(190,204,224,0.42)';
    ctx.font = `400 21px ${FONT_UI}`;
    ctx.fillText('全部点亮并连续保持 3 秒', VIEW.w / 2, y - 14);
  }
  ctx.restore();
}

function drawHud(ctx, g, time) {
  const lv = g.levelIndex;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = `rgba(${WARM},0.55)`;
  ctx.font = `500 20px ${FONT_UI}`;
  ctx.fillText(`第 ${String(lv + 1).padStart(2, '0')} 关 · 共 ${LEVELS.length}`, 52, 84);

  ctx.fillStyle = 'rgba(236,242,252,0.92)';
  ctx.font = `600 36px ${FONT_TITLE}`;
  ctx.fillText(g.level.name, 50, 128);

  const litN = g.crystals.filter((c) => c.lit).length;
  ctx.font = `500 19px ${FONT_UI}`;
  ctx.fillStyle = `rgba(${COOL},0.62)`;
  ctx.fillText(`水晶 ${litN} / ${g.crystals.length}`, 52, 162);
  if (g.level.distance) {
    ctx.fillStyle = `rgba(${WARM},0.5)`;
    ctx.fillText(`移动 ${g.distance.toFixed(0)}`, 176, 162);
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(200,212,230,0.42)';
  ctx.font = `400 20px ${FONT_UI}`;
  ctx.fillText(fmtT(g.levelTime), VIEW.w - 52, 84);
  if (g.lights.length > 1 && g.teachDual) {
    ctx.fillStyle = `rgba(${WARM},0.4)`;
    ctx.font = `400 17px ${FONT_UI}`;
    ctx.fillText(`双光源 · 拖动第 ${g.active + 1} 盏`, VIEW.w - 52, 112);
  }
  ctx.restore();

  if (g.phase === 'play' && !g.removeMode) {
    for (const b of g.bottomBar) iconButton(ctx, g, b, b.id, GLYPHS[b.id]);
  }

  if (!g.removeMode) drawHoldMeter(ctx, g, time);

  // 教学文案：只在该机制首次引入的关卡出现
  if (g.phase === 'play' && g.teach && g.levelTime < 11) {
    const a = Math.min(1, (11 - g.levelTime) / 1.6) * (g.levelTime > 0.4 ? 1 : 0.2);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 文字按可用宽度自动缩字号，窄屏不会被裁掉
    let fs = 22;
    ctx.font = `400 ${fs}px ${FONT_UI}`;
    const maxW = VIEW.w - 56;
    let tw = ctx.measureText(g.teach.text).width;
    while (tw > maxW && fs > 14) {
      fs -= 1;
      ctx.font = `400 ${fs}px ${FONT_UI}`;
      tw = ctx.measureText(g.teach.text).width;
    }
    // 给文字垫一层暗底，避免正好压在光源上读不清
    roundRect(ctx, VIEW.w / 2 - tw / 2 - 18, 1000, tw + 36, 36, 18);
    ctx.fillStyle = 'rgba(6,9,15,0.55)';
    ctx.fill();
    ctx.fillStyle = 'rgba(226,234,248,0.78)';
    ctx.fillText(g.teach.text, VIEW.w / 2, 1019);
    ctx.restore();
  }

  // 提示：方向 / 高亮挡板 / 位置脉冲
  if (g.hint) {
    if (g.hint.block) {
      ctx.save();
      ctx.globalCompositeOperation = addMode();
      polyPath(ctx, g.hint.block);
      ctx.strokeStyle = `rgba(${COOL},${0.5 + 0.3 * Math.sin(time * 5)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
    if (g.hint.point) {
      ctx.save();
      ctx.globalCompositeOperation = addMode();
      ctx.strokeStyle = `rgba(${COOL},0.45)`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const rr = 24 + i * 16 + Math.sin(time * 3 - i) * 4;
        ctx.beginPath();
        ctx.arc(g.hint.point.x, g.hint.point.y, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 提示条
  if (g.hint && g.phase === 'play') {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(${WARM},0.85)`;
    ctx.font = `500 21px ${FONT_UI}`;
    ctx.fillText(g.hint.text, VIEW.w / 2, 990);
    ctx.restore();
  }

}

function drawToast(ctx, g, time) {
  // 轻提示
  if (g.toastUntil > time) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(240,246,255,0.92)';
    roundRect(ctx, 180, 560, 360, 56, 28);
    ctx.fillStyle = 'rgba(12,16,24,0.92)';
    ctx.fill();
    ctx.strokeStyle = `rgba(${WARM},0.3)`;
    ctx.stroke();
    ctx.fillStyle = 'rgba(240,246,255,0.9)';
    ctx.font = `400 20px ${FONT_UI}`;
    ctx.fillText(g.toastMsg, VIEW.w / 2, 595);
    ctx.restore();
  }
}

function drawTitle(ctx, g, time) {
  ctx.save();
  const veil = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  veil.addColorStop(0, 'rgba(4,5,9,0.62)');
  veil.addColorStop(0.5, 'rgba(4,5,9,0.42)');
  veil.addColorStop(1, 'rgba(4,5,9,0.86)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const glow = ctx.createRadialGradient(VIEW.w / 2, 380, 0, VIEW.w / 2, 380, 320);
  glow.addColorStop(0, `rgba(${WARM},0.14)`);
  glow.addColorStop(1, `rgba(${WARM},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 140, VIEW.w, 520);

  // 标题：五个字，逐字排版（不依赖 canvas letterSpacing，微信端表现一致），
  // 按可用宽度自动缩字号，窄屏也不会溢出
  const TITLE = '就差一点光';
  const MAX_TITLE_W = 600;
  let fs = 104;
  let gap = 12;
  const titleWidth = () => {
    ctx.font = `500 ${fs}px ${FONT_TITLE}`;
    return [...TITLE].reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + gap * (TITLE.length - 1);
  };
  while (titleWidth() > MAX_TITLE_W && fs > 56) {
    fs -= 2;
    gap = Math.round(fs * 0.12);
  }
  ctx.fillStyle = 'rgba(248,244,236,0.96)';
  ctx.textAlign = 'left';
  let tx = VIEW.w / 2 - titleWidth() / 2;
  for (const ch of TITLE) {
    ctx.font = `500 ${fs}px ${FONT_TITLE}`;
    ctx.fillText(ch, tx, 380);
    tx += ctx.measureText(ch).width + gap;
  }
  ctx.textAlign = 'center';

  ctx.fillStyle = 'rgba(206,218,236,0.62)';
  ctx.font = `400 25px ${FONT_UI}`;
  ctx.fillText('拖动一点光，点亮所有水晶', VIEW.w / 2, 492);
  ctx.fillText('并且连续保持 3 秒', VIEW.w / 2, 530);

  const unlocked = Math.min(g.save.unlocked, LEVELS.length - 1);
  pill(ctx, g.ui.start, {
    active: true,
    label: unlocked > 0 ? '继续' : '开始',
    sub: unlocked > 0
      ? `第 ${unlocked + 1} 关 · ${LEVELS[unlocked].name}`
      : `${LEVELS.length} 关 · 从单光源到双侧水晶`,
  });
  pill(ctx, g.ui.levels, { label: '选关' });
  pill(ctx, g.ui.skins, { label: `光源皮肤 · ${g.skin.name}` });
  pill(ctx, g.ui.beam, { label: 'V2 光学试玩 · 5 个新机制' });

  const audio = (g.save && g.save.audio) || { bgm: true, sfx: true };
  audioToggle(ctx, g, g.ui.audioBgm, audio.bgm, '音乐');
  audioToggle(ctx, g, g.ui.audioSfx, audio.sfx, '音效');

  if (plat.kind !== 'wx') {
    // 微信端没有键盘，这行只在浏览器 Demo 里显示
    ctx.fillStyle = 'rgba(150,165,190,0.34)';
    ctx.font = `400 18px ${FONT_UI}`;
    ctx.fillText('电脑上可用方向键微调 · H 提示 · R 重来', VIEW.w / 2, 1180);
  }
  ctx.restore();
}

function audioToggle(ctx, g, r, on, label) {
  roundRect(ctx, r.x, r.y, r.w, r.h, 27);
  ctx.fillStyle = on ? 'rgba(255,214,160,0.10)' : 'rgba(255,255,255,0.03)';
  ctx.fill();
  ctx.strokeStyle = on ? 'rgba(255,214,160,0.35)' : 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 喇叭图标：开时带两道声波，关时带一道斜杠
  const cx = r.x + 34;
  const cy = r.y + r.h / 2;
  ctx.fillStyle = on ? 'rgba(255,214,160,0.85)' : 'rgba(160,175,198,0.55)';
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy - 4);
  ctx.lineTo(cx - 3, cy - 4);
  ctx.lineTo(cx + 3, cy - 9);
  ctx.lineTo(cx + 3, cy + 9);
  ctx.lineTo(cx - 3, cy + 4);
  ctx.lineTo(cx - 8, cy + 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = on ? 'rgba(255,214,160,0.7)' : 'rgba(160,175,198,0.5)';
  ctx.lineWidth = 1.6;
  if (on) {
    ctx.beginPath();
    ctx.arc(cx + 5, cy, 8, -0.7, 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 5, cy, 13, -0.7, 0.7);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx + 6, cy - 7);
    ctx.lineTo(cx + 16, cy + 7);
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = on ? 'rgba(240,230,214,0.92)' : 'rgba(170,184,206,0.66)';
  ctx.font = `400 22px ${FONT_UI}`;
  ctx.fillText(`${label} · ${on ? '开' : '关'}`, r.x + 66, cy + 1);
  ctx.textAlign = 'center';
}

function drawWin(ctx, g, time) {
  // 淡入进度用游戏时钟（winAt 记在 g.t 上），与装饰用的视觉时钟分开
  const k = Math.min(1, (g.t - g.winAt) / 0.45);
  const r = g.result;
  ctx.save();
  ctx.fillStyle = `rgba(4,5,9,${0.74 * k})`;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = 470 - (1 - k) * 24;

  ctx.fillStyle = 'rgba(248,244,236,0.96)';
  ctx.font = `500 70px ${FONT_TITLE}`;
  ctx.fillText('影子落位', VIEW.w / 2, y);

  ctx.fillStyle = `rgba(${COOL},0.7)`;
  ctx.font = `500 26px ${FONT_UI}`;
  ctx.fillText(`用时 ${fmtT(r.time)}${r.newRecord ? ' · 新纪录' : ''}`, VIEW.w / 2, y + 64);

  if (r.optimal !== null) {
    const dy = y + 130;
    ctx.font = `400 21px ${FONT_UI}`;
    const rows = [
      ['本局移动', `${r.distance.toFixed(0)} px`, r.newDistRecord],
      ['个人最短', `${r.personal.toFixed(0)} px`, false],
      ['参考距离', `${r.optimal.toFixed(0)} px`, false],
    ];
    rows.forEach(([label, val, hot], i) => {
      const yy = dy + i * 34;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(150,165,190,0.66)';
      ctx.fillText(label, 236, yy);
      ctx.textAlign = 'right';
      ctx.fillStyle = hot ? `rgba(${COOL},0.95)` : i === 2 ? `rgba(${COOL},0.8)` : 'rgba(226,236,250,0.85)';
      ctx.fillText(val, 484, yy);
    });
  }

  const last = g.levelIndex >= LEVELS.length - 1;
  pill(ctx, g.ui.next, { active: true, label: last ? '回到首页' : '下一关' });
  pill(ctx, g.ui.again, { label: '重玩本关' });
  pill(ctx, g.ui.share, { label: '生成分享卡片' });

  if (last) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200,212,230,0.5)';
    ctx.font = `400 18px ${FONT_UI}`;
    ctx.fillText(`全部 ${LEVELS.length} 关 · 累计 ${fmtT(g.totalTime)}`, VIEW.w / 2, 700);
  }
  ctx.restore();
}

/* ---------------- 弹窗 ---------------- */

function drawHintPanel(ctx, g, time) {
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,9,0.86)';
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(248,244,236,0.96)';
  ctx.font = `500 44px ${FONT_TITLE}`;
  ctx.fillText('提示', VIEW.w / 2, 372);
  ctx.fillStyle = 'rgba(160,175,198,0.6)';
  ctx.font = `400 19px ${FONT_UI}`;
  ctx.fillText('逐级给出：方向 → 关键物体 → 具体位置', VIEW.w / 2, 416);

  const titles = ['① 给个方向', '② 移除一个障碍', '③ 直接给位置'];
  for (let i = 0; i < 3; i++) {
    const row = g.hintRow(i);
    const tier = i + 1;
    const unlocked = tier === 2 ? g.removed.size > 0 : g.hintTier >= tier;
    const free = g.hintFree(tier);
    roundRect(ctx, row.x, row.y, row.w, row.h, 16);
    ctx.fillStyle = unlocked ? `rgba(${COOL},0.10)` : 'rgba(255,255,255,0.04)';
    ctx.fill();
    ctx.strokeStyle = unlocked ? `rgba(${COOL},0.45)` : 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = unlocked ? `rgba(${COOL},0.95)` : 'rgba(220,230,244,0.8)';
    ctx.font = `500 22px ${FONT_UI}`;
    ctx.fillText(titles[i], row.x + 24, row.y + row.h / 2);

    ctx.textAlign = 'right';
    ctx.font = `400 18px ${FONT_UI}`;
    if (unlocked) {
      ctx.fillStyle = `rgba(${COOL},0.6)`;
      ctx.fillText('已解锁', row.x + row.w - 24, row.y + row.h / 2);
    } else if (tier === 2) {
      ctx.fillStyle = 'rgba(200,212,230,0.5)';
      ctx.fillText(free ? '自带一次' : '看广告后移除', row.x + row.w - 24, row.y + row.h / 2);
    } else if (free) {
      ctx.fillStyle = 'rgba(200,212,230,0.5)';
      ctx.fillText('免费', row.x + row.w - 24, row.y + row.h / 2);
    } else {
      ctx.fillStyle = `rgba(${WARM},0.75)`;
      ctx.fillText('看广告解锁 ▶', row.x + row.w - 24, row.y + row.h / 2);
    }
  }
  pill(ctx, g.ui.close, { label: '关闭' });
  ctx.restore();
}

function drawAdModal(ctx, g, time) {
  ctx.save();
  ctx.fillStyle = 'rgba(2,3,6,0.94)';
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(220,230,244,0.8)';
  ctx.font = `500 26px ${FONT_UI}`;
  ctx.fillText('激励视频', VIEW.w / 2, 500);
  ctx.fillStyle = 'rgba(150,165,190,0.6)';
  ctx.font = `400 20px ${FONT_UI}`;
  ctx.fillText('模拟广告 · 接入微信后替换为真实广告位', VIEW.w / 2, 546);

  const w = 360;
  const x = (VIEW.w - w) / 2;
  roundRect(ctx, x, 600, w, 8, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();

  if (g.adProgress === null || g.adProgress === undefined) {
    // 真实广告拿不到播放进度，只显示不确定态，不伪造百分比
    const k = (Math.sin(time * 2.2) + 1) / 2;
    roundRect(ctx, x + (w - 120) * k, 600, 120, 8, 4);
    ctx.fillStyle = `rgba(${WARM},0.6)`;
    ctx.fill();
    ctx.fillStyle = 'rgba(200,212,230,0.5)';
    ctx.font = `400 18px ${FONT_UI}`;
    ctx.fillText('完整观看后发放奖励', VIEW.w / 2, 646);
  } else {
    roundRect(ctx, x, 600, Math.max(6, w * g.adProgress), 8, 4);
    ctx.fillStyle = `rgba(${WARM},0.85)`;
    ctx.fill();
    ctx.fillStyle = 'rgba(200,212,230,0.5)';
    ctx.font = `400 18px ${FONT_UI}`;
    ctx.fillText(`${Math.max(0, (adsDuration() * (1 - g.adProgress))).toFixed(1)} 秒后可获得提示`, VIEW.w / 2, 646);
  }
  ctx.restore();
}

function adsDuration() {
  return 4.5;
}

function drawShareModal(ctx, g, time) {
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,9,0.92)';
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  if (g.shareCanvas) {
    const w = 470;
    const h = (g.shareCanvas.height / g.shareCanvas.width) * w;
    const x = (VIEW.w - w) / 2;
    const y = 120;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = quality.tier.shadows ? 30 : 0;
    ctx.drawImage(g.shareCanvas, x, y, w, h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }
  pill(ctx, g.ui.saveImg, { active: true, label: '保存图片' });
  pill(ctx, g.ui.close, { label: '关闭' });
  ctx.restore();
}

/* ---------------- 移除障碍 ---------------- */

function drawRemoveUI(ctx, g, time) {
  ctx.save();
  ctx.setLineDash([7, 7]);
  const mark = (poly, selected) => {
    polyPath(ctx, poly);
    ctx.strokeStyle = selected ? `rgba(${COOL},0.95)` : `rgba(${WARM},0.34)`;
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.stroke();
  };
  g.level.blocks.forEach((poly, i) => {
    if (g.removed.has(`b${i}`)) return;
    mark(poly, g.removeSel && g.removeSel.kind === 'block' && g.removeSel.index === i);
  });
  g.movers.forEach((m, i) => {
    if (g.removed.has(`m${i}`)) return;
    mark(moverPoly(m, g.sceneT), g.removeSel && g.removeSel.kind === 'mover' && g.removeSel.index === i);
  });
  ctx.restore();

  // 选中高亮
  if (g.removeSel) {
    const poly = g.removeSel.kind === 'block'
      ? g.level.blocks[g.removeSel.index]
      : moverPoly(g.movers[g.removeSel.index], g.sceneT);
    ctx.save();
    ctx.globalCompositeOperation = addMode();
    polyPath(ctx, poly);
    ctx.strokeStyle = `rgba(${COOL},${0.5 + 0.3 * Math.sin(time * 6)})`;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  // 底部条
  ctx.save();
  roundRect(ctx, 40, 946, 640, 210, 22);
  ctx.fillStyle = 'rgba(8,11,18,0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(236,242,252,0.9)';
  ctx.font = `500 24px ${FONT_UI}`;
  ctx.fillText(g.removeSel ? '移除这一块障碍？' : '点一下要移除的障碍物', VIEW.w / 2, 986);
  ctx.fillStyle = 'rgba(160,175,198,0.6)';
  ctx.font = `400 17px ${FONT_UI}`;
  ctx.fillText('只对当前这一局有效，重开会恢复完整布局', VIEW.w / 2, 1020);
  ctx.restore();

  if (g.removeSel) {
    const needsAd = !g.hintFree(2);
    pill(ctx, g.ui.removeOk, { active: true, label: needsAd ? '看广告移除' : '移除' });
  }
  pill(ctx, g.ui.removeCancel, { label: g.removeSel ? '换个目标' : '取消' });
}

/* ---------------- 选关 ---------------- */

function lockIcon(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = 'rgba(150,165,190,0.45)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x, y - 3, 4.2, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = 'rgba(150,165,190,0.35)';
  ctx.fillRect(x - 5.5, y - 3, 11, 8);
  ctx.restore();
}

function drawLevels(ctx, g, time) {
  ctx.save();
  ctx.fillStyle = 'rgba(4,6,11,0.95)';
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  const cleared = LEVELS.filter((_, i) => g.levelCleared(i)).length;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(248,244,236,0.96)';
  ctx.font = `500 52px ${FONT_TITLE}`;
  ctx.fillText('选关', 52, 118);
  ctx.fillStyle = 'rgba(160,175,198,0.6)';
  ctx.font = `400 19px ${FONT_UI}`;
  ctx.fillText(`已通关 ${cleared} / ${LEVELS.length}　·　点亮的关卡可以随时重玩`, 52, 158);

  const currentIdx = Math.min(g.save.unlocked, LEVELS.length - 1);
  for (let i = 0; i < LEVELS.length; i++) {
    const c = g.levelCell(i);
    const isCleared = g.levelCleared(i);
    const unlocked = g.isUnlocked(i);
    const isCurrent = i === currentIdx && !isCleared;

    roundRect(ctx, c.x, c.y, c.w, c.h, 12);
    if (isCleared) {
      ctx.fillStyle = `rgba(${COOL},0.10)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${COOL},0.42)`;
    } else if (unlocked) {
      ctx.fillStyle = `rgba(${WARM},0.09)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${WARM},${isCurrent ? 0.55 + 0.35 * Math.sin(time * 4) : 0.28})`;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.028)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    }
    ctx.lineWidth = isCurrent ? 2 : 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${isCleared ? 26 : 24}px ${FONT_UI}`;
    ctx.fillStyle = isCleared
      ? 'rgba(220,250,255,0.95)'
      : unlocked
        ? 'rgba(255,232,196,0.9)'
        : 'rgba(140,152,172,0.35)';
    ctx.fillText(String(i + 1), c.x + c.w / 2, c.y + c.h / 2 - (isCleared ? 2 : 0));

    if (isCleared) {
      ctx.strokeStyle = `rgba(${COOL},0.8)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(c.x + c.w / 2 - 7, c.y + c.h - 14);
      ctx.lineTo(c.x + c.w / 2 - 2, c.y + c.h - 9);
      ctx.lineTo(c.x + c.w / 2 + 8, c.y + c.h - 21);
      ctx.stroke();
    } else if (!unlocked) {
      lockIcon(ctx, c.x + c.w - 20, c.y + c.h - 16);
    }
  }

  pill(ctx, g.ui.back, { label: g.levelsFrom === 'play' ? '继续游戏' : '返回' });
  pill(ctx, g.ui.skinBtn, { label: '光源皮肤' });
  ctx.restore();
}

/* ---------------- 皮肤面板 ---------------- */

function skinOrb(ctx, x, y, r, sk, time) {
  ctx.save();
  ctx.globalCompositeOperation = addMode();
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r);
  halo.addColorStop(0, `rgba(${sk.glow},0.5)`);
  halo.addColorStop(0.3, `rgba(${sk.glow},0.16)`);
  halo.addColorStop(1, `rgba(${sk.glow},0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  const core = ctx.createRadialGradient(x, y, 0, x, y, r * 0.34);
  core.addColorStop(0, `rgba(${sk.core},1)`);
  core.addColorStop(0.3, `rgba(${sk.mid},0.9)`);
  core.addColorStop(1, `rgba(${sk.glow},0)`);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 光柱粗细的直观示意
  ctx.save();
  ctx.globalCompositeOperation = addMode();
  const beam = ctx.createLinearGradient(x, y, x + r * 2.4, y - r * 0.6);
  beam.addColorStop(0, `rgba(${sk.beam},0.7)`);
  beam.addColorStop(1, `rgba(${sk.beam},0)`);
  ctx.strokeStyle = beam;
  ctx.lineWidth = 2 * sk.beamW;
  ctx.beginPath();
  ctx.moveTo(x + 6, y);
  ctx.lineTo(x + r * 1.9, y - r * 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawSkins(ctx, g, time) {
  ctx.save();
  ctx.fillStyle = 'rgba(4,6,11,0.975)';
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(248,244,236,0.96)';
  ctx.font = `500 44px ${FONT_TITLE}`;
  ctx.fillText('光源皮肤', VIEW.w / 2, 168);
  ctx.fillStyle = 'rgba(160,175,198,0.6)';
  ctx.font = `400 18px ${FONT_UI}`;
  ctx.fillText('换的只是样子：照明范围、遮挡和判定完全不变', VIEW.w / 2, 210);

  SKINS.forEach((sk, i) => {
    const r = g.skinRow(i);
    const equipped = g.skin.id === sk.id;
    const unlocked = g.skinUnlocked(sk.id);
    roundRect(ctx, r.x, r.y, r.w, r.h, 16);
    ctx.fillStyle = equipped ? `rgba(${COOL},0.10)` : 'rgba(255,255,255,0.035)';
    ctx.fill();
    ctx.strokeStyle = equipped ? `rgba(${COOL},0.55)` : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = equipped ? 2 : 1;
    ctx.stroke();

    skinOrb(ctx, r.x + 54, r.y + r.h / 2, 34, sk, time);

    ctx.textAlign = 'left';
    ctx.fillStyle = unlocked ? 'rgba(238,244,255,0.95)' : 'rgba(200,212,230,0.75)';
    ctx.font = `600 24px ${FONT_UI}`;
    ctx.fillText(sk.name, r.x + 106, r.y + r.h / 2 - 12);
    ctx.fillStyle = 'rgba(150,165,190,0.6)';
    ctx.font = `400 16px ${FONT_UI}`;
    ctx.fillText(sk.desc, r.x + 106, r.y + r.h / 2 + 16);

    ctx.textAlign = 'right';
    ctx.font = `500 19px ${FONT_UI}`;
    if (equipped) {
      ctx.fillStyle = `rgba(${COOL},0.9)`;
      ctx.fillText('使用中', r.x + r.w - 24, r.y + r.h / 2);
    } else if (unlocked) {
      ctx.fillStyle = 'rgba(214,224,238,0.7)';
      ctx.fillText('点击装备', r.x + r.w - 24, r.y + r.h / 2);
    } else {
      ctx.fillStyle = `rgba(${WARM},0.8)`;
      ctx.fillText('看广告解锁 ▶', r.x + r.w - 24, r.y + r.h / 2);
    }
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(150,165,190,0.45)';
  ctx.font = `400 16px ${FONT_UI}`;
  ctx.fillText('未解锁的皮肤也可以先预览效果', VIEW.w / 2, 790);
  pill(ctx, g.ui.skinClose, { label: '关闭' });
  ctx.restore();
}

/* ---------------- 主绘制 ---------------- */

export function draw(ctx, g, time) {
  if (g.mode === 'beam') {
    drawBeam(ctx, g, time);
    return;
  }

  // ---- 背景层：cover 铺满整个窗口（含信箱区），消除上下黑条 ----
  drawFullBleed(ctx, g, time);

  // ---- 玩法层：整体顺时针 90°，铺进上方玩法带 ----
  if (g.phase !== 'title' && g.phase !== 'levels') {
    const M = sceneMatrix(g.sceneLayout, g.sceneDir || 'cw');
    ctx.save();
    ctx.transform(M.a, M.b, M.c, M.d, M.e, M.f);
    if (g.wallR) drawWallPanel(ctx, g, g.wallR, g.bandsR, 'r');
    if (g.wallL) drawWallPanel(ctx, g, g.wallL, g.bandsL, 'l');
    if (quality.tier.beams) drawBeams(ctx, g, time);
    drawBlocks(ctx, g);
    drawMovers(ctx, g, time);
    drawLights(ctx, g, time);
    drawCrystals(ctx, g, time);
    ctx.restore();
  }

  if (g.phase === 'title') drawTitle(ctx, g, time);
  else if (g.phase === 'levels') drawLevels(ctx, g, time);
  else {
    drawHud(ctx, g, time);
    if (g.removeMode) drawRemoveUI(ctx, g, time);
    if (g.phase === 'win') drawWin(ctx, g, time);
  }

  if (g.phase === 'play') drawLightBadges(ctx, g, time);
  if (g.nudge && nudgeVisible(g.nudge, g.t) && g.phase === 'play') drawNudge(ctx, g, time);

  drawToast(ctx, g, time);
  if (g.modal === 'skins') drawSkins(ctx, g, time);
  if (g.modal === 'hint') drawHintPanel(ctx, g, time);
  if (g.modal === 'ad') drawAdModal(ctx, g, time);
  if (g.modal === 'share') drawShareModal(ctx, g, time);

  if (g.fade > 0.001) {
    ctx.save();
    ctx.fillStyle = `rgba(4,5,9,${g.fade})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.restore();
  }

  if (g.shake > 0.001) {
    ctx.save();
    ctx.globalCompositeOperation = addMode();
    ctx.fillStyle = `rgba(${COOL},${0.06 * g.shake})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.restore();
  }
}
