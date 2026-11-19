// 定向光束关卡的绘制。只在 Game.mode === 'beam' 时由 render.js 调用。
// 与沙盒共用同一套 optics / gates / joystick 结果，不重复算光路。

import { VIEW } from './levels-live.js';
import {
  COLOR,
  colorCss,
  colorGlyph,
  colorName,
  elementRadius,
  prismShape,
  toMask,
} from './optics.js';
import { gateChargeRatio, gateLabel } from './gates.js';
import { handleArc, handlePoint } from './joystick.js';
import { tutorialView } from './tutorial-flow.js';
import { plat } from './platform.js';

const W = VIEW.w;
const H = VIEW.h;
const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
const addMode = () => (plat.kind === 'wx' ? 'source-over' : 'lighter');

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

function polyPath(ctx, poly) {
  if (!poly || poly.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

function text(ctx, str, x, y, size, color, align = 'center', weight = 500) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
  ctx.restore();
}

function dot(ctx, x, y, r, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function glowDot(ctx, x, y, r, color, blur = 16) {
  ctx.save();
  ctx.shadowBlur = blur;
  ctx.shadowColor = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function fmt(t) {
  const v = Math.max(0, Number(t) || 0);
  if (v < 60) return `${v.toFixed(1)}s`;
  const m = Math.floor(v / 60);
  const s = v - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/* ---------------- 场景 ---------------- */

function drawBackground(ctx, s, time) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#070b13');
  grad.addColorStop(0.58, '#060910');
  grad.addColorStop(1, '#04060b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  for (let i = 0; i < 80; i++) {
    const x = (i * 137.5) % W;
    const y = (i * 271.3) % H;
    const a = 0.03 + ((i * 7) % 9) * 0.006;
    ctx.fillStyle = `rgba(210,230,255,${a})`;
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  ctx.restore();

  ctx.save();
  roundRect(ctx, 18, 128, W - 36, 1024, 26);
  ctx.strokeStyle = 'rgba(155,205,255,.12)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 12]);
  ctx.stroke();
  ctx.restore();
}

function drawBlock(ctx, block) {
  const poly = block.poly || block;
  if (!poly || poly.length < 3) return;
  polyPath(ctx, poly);
  ctx.fillStyle = 'rgba(22,30,43,.96)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,160,205,.38)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.save();
  polyPath(ctx, poly);
  ctx.clip();
  ctx.strokeStyle = 'rgba(150,190,235,.09)';
  ctx.lineWidth = 7;
  for (let x = 0; x < W; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 60, 60);
    ctx.stroke();
  }
  ctx.restore();

  if (block.id === 'door') {
    const c = poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), { x: 0, y: 0 });
    text(ctx, '门', c.x, c.y, 14, 'rgba(190,215,240,.6)');
  }
}

function drawRay(ctx, seg) {
  if (!seg) return;
  if (seg.kind === 'absorb') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(seg.from.x, seg.from.y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,140,120,.65)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const color = toMask(seg.color);
  if (!color) return;
  const inside = seg.kind === 'inside';
  ctx.save();
  ctx.globalCompositeOperation = addMode();
  ctx.strokeStyle = colorCss(color, inside ? 0.32 : 0.9);
  ctx.lineWidth = inside ? 6 : 2.8;
  ctx.lineCap = 'round';
  ctx.shadowBlur = inside ? 16 : 12;
  ctx.shadowColor = colorCss(color, 0.65);
  ctx.beginPath();
  ctx.moveTo(seg.from.x, seg.from.y);
  ctx.lineTo(seg.to.x, seg.to.y);
  ctx.stroke();
  ctx.restore();
  if (!inside) glowDot(ctx, seg.to.x, seg.to.y, 2.2, colorCss(color, 0.9), 10);
}

function drawPrism(ctx, p) {
  const poly = prismShape(p);
  polyPath(ctx, poly);
  ctx.fillStyle = 'rgba(118,220,255,.10)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,240,255,.72)';
  ctx.lineWidth = 1.8;
  ctx.shadowBlur = 12;
  ctx.shadowColor = 'rgba(120,220,255,.35)';
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.save();
  polyPath(ctx, poly);
  ctx.clip();
  ctx.strokeStyle = 'rgba(210,250,255,.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x - 30, p.y);
  ctx.lineTo(p.x + 30, p.y);
  ctx.stroke();
  if (p.kind === 'dispersion') {
    [COLOR.RED, COLOR.YELLOW, COLOR.BLUE].forEach((m, i) => {
      ctx.strokeStyle = colorCss(m, 0.55);
      ctx.beginPath();
      ctx.moveTo(p.x - 12, p.y);
      ctx.lineTo(p.x + 26, p.y + (i - 1) * 15);
      ctx.stroke();
    });
  }
  if (p.kind === 'splitter') {
    ctx.strokeStyle = 'rgba(230,250,255,.55)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 28);
    ctx.lineTo(p.x, p.y + 28);
    ctx.stroke();
  }
  ctx.restore();

  const label = p.kind === 'splitter' ? '分' : p.kind === 'dispersion' ? '散' : p.kind === 'reflect90' ? '90' : '45';
  text(ctx, label, p.x, p.y, 12, 'rgba(220,250,255,.9)', 'center', 700);
  if (p.draggable !== false) dot(ctx, p.x + 17, p.y + 17, 2.5, 'rgba(255,225,165,.85)');
}

function drawFilter(ctx, f) {
  const color = toMask(f.color);
  ctx.save();
  ctx.beginPath();
  ctx.arc(f.x, f.y, elementRadius(f), 0, Math.PI * 2);
  ctx.fillStyle = colorCss(color, 0.14);
  ctx.fill();
  ctx.strokeStyle = colorCss(color, 0.92);
  ctx.lineWidth = 2.2;
  ctx.shadowBlur = 14;
  ctx.shadowColor = colorCss(color, 0.4);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(f.x, f.y, elementRadius(f) - 6, 0, Math.PI * 2);
  ctx.strokeStyle = colorCss(color, 0.22);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  text(ctx, colorGlyph(color), f.x, f.y, 18, colorCss(color, 0.95), 'center', 700);
  text(ctx, colorName(color), f.x, f.y + elementRadius(f) + 14, 10, colorCss(color, 0.75));
}

function drawCrystal(ctx, c, hit, time) {
  const color = toMask(c.requiredColor, COLOR.WHITE);
  const lit = !!(hit && hit.ok);
  const wrong = !!(hit && hit.colors && hit.colors.length && !hit.ok);
  const r = elementRadius(c);
  const pulse = lit ? 1 + Math.sin(time * 4 + c.x) * 0.06 : 1;

  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(Math.PI / 4);
  ctx.beginPath();
  ctx.rect(-r * 0.72 * pulse, -r * 0.72 * pulse, r * 1.44 * pulse, r * 1.44 * pulse);
  if (lit) {
    ctx.fillStyle = colorCss(color, 0.92);
    ctx.shadowBlur = 30;
    ctx.shadowColor = colorCss(color, 0.9);
  } else {
    ctx.fillStyle = 'rgba(12,20,31,.9)';
    ctx.shadowBlur = 0;
  }
  ctx.fill();
  ctx.strokeStyle = lit ? colorCss(color, 1) : 'rgba(150,180,210,.4)';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.restore();

  if (lit) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, r + 7 + Math.sin(time * 4) * 2, 0, Math.PI * 2);
    ctx.strokeStyle = colorCss(color, 0.3);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  if (wrong) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,120,110,.5)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.restore();
  }

  text(ctx, colorGlyph(color), c.x, c.y + 1, 16, lit ? 'rgba(8,14,22,.9)' : colorCss(color, 0.75), 'center', 700);
  if (c.acceptAny) text(ctx, '通', c.x, c.y + r + 14, 9, 'rgba(220,235,250,.45)');
}

function drawGate(ctx, g, state, scene) {
  const ratio = gateChargeRatio(g, state);
  const open = !!(state && state.open);
  const color = open ? 'rgba(140,255,200,.95)' : 'rgba(255,210,140,.9)';
  const r = elementRadius(g);

  for (const action of g.actions || []) {
    if (!action.targetBlockId) continue;
    const target = (scene.blocks || []).find((b) => b.id === action.targetBlockId);
    if (!target) continue;
    const poly = target.poly || target;
    const cx = poly.reduce((a, p) => a + p.x / poly.length, 0);
    const cy = poly.reduce((a, p) => a + p.y / poly.length, 0);
    ctx.save();
    ctx.strokeStyle = open ? 'rgba(140,255,200,.5)' : 'rgba(255,200,130,.25)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
  ctx.fillStyle = open ? 'rgba(70,220,160,.18)' : 'rgba(255,190,100,.10)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  if (open) {
    ctx.shadowBlur = 22;
    ctx.shadowColor = 'rgba(120,255,190,.6)';
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (!open && ratio > 0) {
    ctx.beginPath();
    ctx.arc(g.x, g.y, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.strokeStyle = 'rgba(255,226,160,.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();

  text(ctx, open ? '开' : g.kind === 'hold' ? '常' : '锁', g.x, g.y, 13, color, 'center', 700);
  text(ctx, gateLabel(g, state), g.x, g.y + r + 15, 9, 'rgba(230,235,245,.55)');
}

function drawCombiner(ctx, m, hit, time) {
  const color = hit ? hit.color : 0;
  const r = elementRadius(m);
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    const x = m.x + Math.cos(a) * r;
    const y = m.y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color ? colorCss(color, 0.18) : 'rgba(160,200,255,.07)';
  ctx.fill();
  ctx.strokeStyle = color ? colorCss(color, 0.9) : 'rgba(160,200,255,.45)';
  ctx.lineWidth = 1.8;
  if (color) {
    ctx.shadowBlur = 24;
    ctx.shadowColor = colorCss(color, 0.55);
  }
  ctx.stroke();
  ctx.restore();
  text(ctx, color ? colorGlyph(color) : '合', m.x, m.y, 16, color ? colorCss(color, 0.95) : 'rgba(190,215,245,.7)', 'center', 700);
  text(ctx, '合光', m.x, m.y + r + 14, 9, 'rgba(210,230,250,.5)');
  if (color) {
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(time * 3) * 0.12;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r + 8, 0, Math.PI * 2);
    ctx.strokeStyle = colorCss(color, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

function drawLight(ctx, light, time) {
  const isJoy = !!light.joystick;
  const pulse = 1 + Math.sin(time * 2.2) * 0.04;
  const g = ctx.createRadialGradient(light.x, light.y, 2, light.x, light.y, 78);
  g.addColorStop(0, 'rgba(255,250,225,.95)');
  g.addColorStop(0.18, 'rgba(255,235,180,.45)');
  g.addColorStop(0.6, 'rgba(255,210,130,.08)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(light.x, light.y, 80, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  glowDot(ctx, light.x, light.y, 13 * pulse, 'rgba(255,248,225,.98)', 24);
  ctx.save();
  ctx.beginPath();
  ctx.arc(light.x, light.y, 19, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,230,175,.7)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  if (isJoy) {
    const arc = handleArc(light, {}, 28);
    const hp = handlePoint(light);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(arc[0].x, arc[0].y);
    for (const p of arc) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = 'rgba(150,210,255,.18)';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(180,225,255,.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = 'rgba(200,230,255,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(light.x, light.y);
    ctx.lineTo(hp.x, hp.y);
    ctx.stroke();
    ctx.restore();

    glowDot(ctx, hp.x, hp.y, 15, 'rgba(255,232,180,.95)', 18);
    ctx.save();
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, 19, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,240,205,.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    text(ctx, '拨', hp.x, hp.y + 1, 11, 'rgba(20,28,38,.85)', 'center', 700);
    text(ctx, '拖芯移位', light.x, light.y + 36, 9, 'rgba(240,230,205,.5)');
  }
}

/* ---------------- HUD ---------------- */

function drawHud(ctx, s, time) {
  const ui = s.ui;
  // 返回
  ctx.save();
  roundRect(ctx, ui.back.x, ui.back.y, ui.back.w, ui.back.h, 22);
  ctx.fillStyle = 'rgba(255,255,255,.04)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  text(ctx, '‹ 返回', ui.back.x + ui.back.w / 2, ui.back.y + ui.back.h / 2 + 1, 13, 'rgba(220,230,245,.75)');

  text(ctx, `第 ${s.index + 1}/${s.levels.length} 关 · ${s.level.name}`, 130, 46, 17, 'rgba(248,235,205,.92)', 'left', 650);

  const c = s.clock;
  if (c.limit > 0) {
    const frozen = s.frozen;
    text(
      ctx,
      frozen ? `冻结 ${fmt(c.left)}` : `剩余 ${fmt(c.left)}`,
      W - 28,
      46,
      16,
      frozen ? 'rgba(140,255,235,.95)' : c.left <= 5 ? 'rgba(255,170,120,.95)' : 'rgba(210,225,245,.75)',
      'right',
      650
    );
  } else {
    text(ctx, `用时 ${fmt(c.elapsed)}`, W - 28, 46, 15, 'rgba(190,210,235,.65)', 'right', 600);
  }

  if (s.hold > 0 || (s.result && s.result.allLit)) {
    const ratio = Math.max(0, Math.min(1, s.hold / s.holdTarget));
    const w = 240;
    const x = W / 2 - w / 2;
    const y = 116;
    ctx.save();
    roundRect(ctx, x, y, w, 12, 6);
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fill();
    roundRect(ctx, x, y, Math.max(2, w * ratio), 12, 6);
    ctx.fillStyle = s.frozen ? 'rgba(130,255,235,.8)' : 'rgba(255,220,150,.85)';
    ctx.fill();
    ctx.restore();
    text(ctx, `保持 ${s.hold.toFixed(1)} / ${s.holdTarget.toFixed(1)}s`, W / 2, y + 27, 10, 'rgba(220,235,250,.6)');
  }
}

function drawLegend(ctx) {
  const items = [
    [COLOR.RED, '红'],
    [COLOR.YELLOW, '黄'],
    [COLOR.BLUE, '蓝'],
    [COLOR.ORANGE, '橙'],
    [COLOR.GREEN, '绿'],
    [COLOR.PURPLE, '紫'],
    [COLOR.WHITE, '白'],
  ];
  const y = 1214;
  const gap = 92;
  const start = W / 2 - (gap * (items.length - 1)) / 2;
  ctx.save();
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < items.length; i++) {
    const [mask, name] = items[i];
    const x = start + i * gap;
    dot(ctx, x - 18, y, 5, colorCss(mask, 0.95));
    text(ctx, `${colorGlyph(mask)} ${name}`, x + 4, y, 11, 'rgba(210,225,240,.7)');
  }
  ctx.restore();
}

/* ---------------- 引导 ---------------- */

function findTarget(s, gesture) {
  if (!gesture || !gesture.id) return null;
  const scene = s.active || s.scene;
  for (const list of [scene.lights, scene.prisms, scene.filters, scene.combiners, scene.gates, scene.crystals]) {
    const hit = (list || []).find((x) => x.id === gesture.id);
    if (hit) {
      if (gesture.fromHandle && hit.joystick) return handlePoint(hit);
      return { x: hit.x, y: hit.y };
    }
  }
  return null;
}

function drawTutorial(ctx, s, time) {
  if (!s.tutorial || s.phase !== 'play') return;
  const view = tutorialView(s.tutorial);
  if (view.done) {
    if (s.tutorialDoneAt && s.t - s.tutorialDoneAt < 2.2) drawToast(ctx, s, '引导完成 ✓', time);
    return;
  }

  for (const zone of view.dashedZones) {
    const r = (zone.r || zone.snapRadius || 30) * (1 + Math.sin(time * 3) * 0.035);
    ctx.save();
    ctx.beginPath();
    ctx.arc(zone.x, zone.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(110,255,210,.045)';
    ctx.fill();
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(120,255,215,.62)';
    ctx.shadowBlur = 12;
    ctx.shadowColor = 'rgba(100,255,210,.35)';
    ctx.stroke();
    ctx.restore();
    text(ctx, '放这里', zone.x, zone.y + r + 15, 10, 'rgba(150,255,220,.72)');
  }

  if (view.gesture) {
    const from = findTarget(s, view.gesture);
    const to = view.gesture.to;
    if (from && to) {
      const phase = (Math.sin(time * 1.7) + 1) / 2;
      const p = { x: from.x + (to.x - from.x) * phase, y: from.y + (to.y - from.y) * phase };
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const alpha = s.drag ? 0.12 : 0.55;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.setLineDash([3, 7]);
      ctx.strokeStyle = 'rgba(255,232,180,.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(255,238,198,.55)';
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,246,220,.7)';
      roundRect(ctx, 4, -4, 23, 8, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,246,220,.5)';
      ctx.beginPath();
      ctx.arc(-7, 8, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = s.drag ? 0.15 : 0.5;
      ctx.beginPath();
      ctx.arc(from.x, from.y, 36 + Math.sin(time * 2.2) * 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,232,180,.5)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 5]);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawToast(ctx, s, `${view.index + 1}/${view.total} · ${view.toast}`, time);
}

function drawToast(ctx, s, str, time) {
  if (!str) return;
  ctx.save();
  ctx.font = `600 15px ${FONT}`;
  const tw = ctx.measureText(str).width;
  const w = Math.min(W - 70, tw + 44);
  const x = (W - w) / 2;
  const y = 154;
  roundRect(ctx, x, y, w, 38, 19);
  ctx.fillStyle = 'rgba(7,13,21,.86)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,228,170,.38)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  text(ctx, str, W / 2, y + 19, 15, 'rgba(255,240,210,.95)', 'center', 600);
}

/* ---------------- 结算 ---------------- */

function drawWin(ctx, s, time) {
  const k = Math.min(1, (s.t - s.winAt) / 0.35);
  ctx.save();
  ctx.fillStyle = `rgba(4,5,9,${0.74 * k})`;
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 96, 520, W - 192, 470, 28);
  ctx.fillStyle = 'rgba(9,14,23,.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  text(ctx, '通关', W / 2, 588, 38, 'rgba(255,240,210,.97)', 'center', 650);
  text(ctx, s.winInfo ? s.winInfo.level : s.level.name, W / 2, 634, 18, 'rgba(220,230,245,.68)');
  text(ctx, `用时 ${fmt(s.winInfo ? s.winInfo.time : s.elapsed)} · 保持 ${s.holdTarget.toFixed(1)}s`, W / 2, 682, 15, 'rgba(190,210,235,.62)');

  const ui = s.ui;
  if (s.hasNext) {
    roundRect(ctx, ui.next.x, ui.next.y, ui.next.w, ui.next.h, 38);
    ctx.fillStyle = 'rgba(255,210,145,.92)';
    ctx.fill();
    text(ctx, '下一关', W / 2, ui.next.y + ui.next.h / 2 + 1, 24, 'rgba(25,20,12,.95)', 'center', 700);
  } else {
    roundRect(ctx, ui.next.x, ui.next.y, ui.next.w, ui.next.h, 38);
    ctx.fillStyle = 'rgba(255,210,145,.92)';
    ctx.fill();
    text(ctx, '全部完成 · 返回首页', W / 2, ui.next.y + ui.next.h / 2 + 1, 20, 'rgba(25,20,12,.95)', 'center', 700);
  }
  text(ctx, '再玩一次', W / 2, ui.retry.y + ui.retry.h / 2, 17, 'rgba(220,230,245,.72)');
  text(ctx, '返回首页', W / 2, ui.home.y + ui.home.h / 2, 15, 'rgba(180,198,220,.55)');
}

function drawFail(ctx, s) {
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,9,.74)';
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 96, 520, W - 192, 360, 28);
  ctx.fillStyle = 'rgba(9,14,23,.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,180,140,.22)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  text(ctx, '时间到', W / 2, 592, 34, 'rgba(255,225,205,.96)', 'center', 650);
  text(ctx, `${s.level.name} · 再试一次`, W / 2, 638, 16, 'rgba(210,220,238,.62)');
  const ui = s.ui;
  roundRect(ctx, ui.retry.x, ui.retry.y, ui.retry.w, ui.retry.h, 28);
  ctx.fillStyle = 'rgba(255,210,145,.9)';
  ctx.fill();
  text(ctx, '重试', W / 2, ui.retry.y + ui.retry.h / 2 + 1, 22, 'rgba(25,20,12,.95)', 'center', 700);
  text(ctx, '返回首页', W / 2, ui.home.y + ui.home.h / 2, 15, 'rgba(180,198,220,.55)');
}

/* ---------------- 主绘制 ---------------- */

export function drawBeam(ctx, game, time) {
  const s = game.beam;
  if (!s) return;
  const scene = s.active || s.scene;
  const result = s.result || { rays: [], crystals: [], gates: [], combiners: [] };

  drawBackground(ctx, s, time);
  for (const b of scene.blocks || []) drawBlock(ctx, b);
  for (const seg of result.rays || []) drawRay(ctx, seg);

  for (const m of scene.combiners || []) {
    drawCombiner(ctx, m, (result.combiners || []).find((c) => c.id === m.id), time);
  }
  for (const f of scene.filters || []) drawFilter(ctx, f);
  for (const p of scene.prisms || []) drawPrism(ctx, p);
  for (const c of scene.crystals || []) {
    drawCrystal(ctx, c, s.crystalState(c.id), time);
  }
  for (const g of scene.gates || []) {
    drawGate(ctx, g, s.gateState(g.id), scene);
  }
  for (const l of scene.lights || []) drawLight(ctx, l, time);

  drawHud(ctx, s, time);
  drawTutorial(ctx, s, time);
  drawLegend(ctx);

  if (s.phase === 'win') drawWin(ctx, s, time);
  else if (s.phase === 'fail') drawFail(ctx, s);

  if (game.fade > 0.001) {
    ctx.save();
    ctx.fillStyle = `rgba(4,5,9,${game.fade})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}
