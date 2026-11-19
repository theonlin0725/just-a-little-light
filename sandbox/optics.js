// Gate 0 光学沙盒：拖动灯座 / 棱镜 / 滤镜，拨动摇杆，实时看光路与机关。
// 只用 Canvas 2D，不依赖任何图片资源；正式游戏接入前先在这里验手感。

import {
  COLOR,
  colorCss,
  colorGlyph,
  colorName,
  elementRadius,
  prismShape,
  toMask,
  traceScene,
} from '../src/optics.js';
import {
  applyGateEffects,
  createGateRuntime,
  gateChargeRatio,
  gateLabel,
  stepGates,
} from '../src/gates.js';
import {
  angleFromHandle,
  dragCore,
  handleArc,
  handlePoint,
  hitJoystick,
} from '../src/joystick.js';
import {
  createTutorialState,
  stepTutorial,
  tutorialView,
} from '../src/tutorial-flow.js';
import { OPTICS_SCENES, OPTICS_SCENE_LIST } from '../src/optics-scenes.js';

const W = 720;
const H = 1280;
const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
const FONT_MONO = '"SF Mono", "Menlo", "Consolas", monospace';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const tabs = document.getElementById('tabs');
const hint = document.getElementById('hint');
const stageWrap = document.getElementById('stageWrap');
const resetBtn = document.getElementById('reset');

const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const state = {
  id: 'prism',
  scene: null,
  runtime: null,
  active: null,
  result: null,
  drag: null,
  selected: null,
  tutorial: null,
  tutorialDoneAt: 0,
  last: 0,
};

/* ---------------- 初始化 ---------------- */

function loadScene(id) {
  const src = OPTICS_SCENES[id] || OPTICS_SCENES.prism;
  state.id = src.id;
  state.scene = clone(src);
  state.runtime = (state.scene.gates || []).length ? createGateRuntime(state.scene) : null;
  state.active = state.scene;
  state.result = null;
  state.drag = null;
  state.selected = null;
  state.tutorial = src.tutorial ? createTutorialState(src.tutorial) : null;
  state.tutorialDoneAt = 0;
  state.last = 0;
  for (const b of tabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.id === id);
  hint.innerHTML = `<b>${src.name}</b> · ${src.hint}`;
}

function buildTabs() {
  tabs.innerHTML = '';
  for (const scene of OPTICS_SCENE_LIST) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = scene.id;
    b.textContent = scene.name.split(' · ')[0];
    b.addEventListener('click', () => loadScene(scene.id));
    tabs.appendChild(b);
  }
}

function fitCanvas() {
  const ar = W / H;
  const maxH = Math.max(240, stageWrap.clientHeight - 6);
  const maxW = Math.max(160, stageWrap.clientWidth - 6);
  let h = maxH;
  let w = h * ar;
  if (w > maxW) {
    w = maxW;
    h = w / ar;
  }
  canvas.style.width = `${Math.round(w)}px`;
  canvas.style.height = `${Math.round(h)}px`;
}

/* ---------------- 绘制工具 ---------------- */

function roundRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function polyPath(poly) {
  if (!poly || !poly.length) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

function text(str, x, y, size = 16, color = 'rgba(244,239,228,.9)', align = 'center', weight = 500) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
  ctx.restore();
}

function dot(x, y, r, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function glowDot(x, y, r, color, blur = 18) {
  ctx.save();
  ctx.shadowBlur = blur;
  ctx.shadowColor = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/* ---------------- 场景绘制 ---------------- */

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#070b13');
  grad.addColorStop(0.55, '#060910');
  grad.addColorStop(1, '#04060b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 极淡的星点，纯 Canvas，不抢光路
  ctx.save();
  for (let i = 0; i < 70; i++) {
    const x = (i * 137.5) % W;
    const y = (i * 271.3) % H;
    const a = 0.035 + ((i * 7) % 9) * 0.006;
    ctx.fillStyle = `rgba(210,230,255,${a})`;
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  ctx.restore();

  // 玩法边界
  ctx.save();
  roundRect(18, 84, W - 36, 1080, 26);
  ctx.strokeStyle = 'rgba(155,205,255,.12)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 12]);
  ctx.stroke();
  ctx.restore();
}

function drawBlock(block) {
  const poly = block.poly || block;
  if (!poly || poly.length < 3) return;
  polyPath(poly);
  ctx.fillStyle = 'rgba(22,30,43,.96)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,160,205,.38)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 门/墙的斜纹
  ctx.save();
  polyPath(poly);
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
    text('门', c.x, c.y, 14, 'rgba(190,215,240,.6)');
  }
}

function drawPrism(p) {
  const poly = prismShape(p);
  polyPath(poly);
  ctx.fillStyle = 'rgba(118,220,255,.10)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,240,255,.72)';
  ctx.lineWidth = 1.8;
  ctx.shadowBlur = 12;
  ctx.shadowColor = 'rgba(120,220,255,.35)';
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 内部导光纹
  ctx.save();
  polyPath(poly);
  ctx.clip();
  ctx.strokeStyle = 'rgba(210,250,255,.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x - 30, p.y);
  ctx.lineTo(p.x + 30, p.y);
  ctx.stroke();
  if (p.kind === 'dispersion') {
    const cols = [COLOR.RED, COLOR.YELLOW, COLOR.BLUE];
    cols.forEach((m, i) => {
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
  text(label, p.x, p.y, 12, 'rgba(220,250,255,.9)', 'center', 700);
  if (p.draggable) dot(p.x + 17, p.y + 17, 2.5, 'rgba(255,225,165,.85)');
}

function drawFilter(f) {
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
  text(colorGlyph(color), f.x, f.y, 18, colorCss(color, 0.95), 'center', 700);
  text(colorName(color), f.x, f.y + elementRadius(f) + 14, 10, colorCss(color, 0.75));
}

function drawCrystal(c, hit, time) {
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

  text(colorGlyph(color), c.x, c.y + 1, 16, lit ? 'rgba(8,14,22,.9)' : colorCss(color, 0.75), 'center', 700);
  if (c.acceptAny) text('通', c.x, c.y + r + 14, 9, 'rgba(220,235,250,.45)');
}

function drawGate(g, gateState, scene, time) {
  const ratio = gateChargeRatio(g, gateState);
  const open = !!(gateState && gateState.open);
  const color = open ? 'rgba(140,255,200,.95)' : 'rgba(255,210,140,.9)';
  const r = elementRadius(g);

  // 机关到受控门的能量虚线
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

  // 充能环
  if (!open && ratio > 0) {
    ctx.beginPath();
    ctx.arc(g.x, g.y, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.strokeStyle = 'rgba(255,226,160,.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();

  text(open ? '开' : g.kind === 'hold' ? '常' : '锁', g.x, g.y, 13, color, 'center', 700);
  text(gateLabel(g, gateState), g.x, g.y + r + 15, 9, 'rgba(230,235,245,.55)');
}

function drawCombiner(m, hit, time) {
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
  text(color ? colorGlyph(color) : '合', m.x, m.y, 16, color ? colorCss(color, 0.95) : 'rgba(190,215,245,.7)', 'center', 700);
  text('合光', m.x, m.y + r + 14, 9, 'rgba(210,230,250,.5)');
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

function drawLight(light, time) {
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

  glowDot(light.x, light.y, 13 * pulse, 'rgba(255,248,225,.98)', 24);
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

    glowDot(hp.x, hp.y, 15, 'rgba(255,232,180,.95)', 18);
    ctx.save();
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, 19, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,240,205,.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    text('拨', hp.x, hp.y + 1, 11, 'rgba(20,28,38,.85)', 'center', 700);
    text('拖芯移位', light.x, light.y + 36, 9, 'rgba(240,230,205,.5)');
  }
}

function drawRay(seg) {
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
  ctx.globalCompositeOperation = 'lighter';
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

  if (!inside) {
    glowDot(seg.to.x, seg.to.y, 2.2, colorCss(color, 0.9), 10);
  }
}

function drawLegend() {
  const items = [
    [COLOR.RED, '红'],
    [COLOR.YELLOW, '黄'],
    [COLOR.BLUE, '蓝'],
    [COLOR.ORANGE, '橙'],
    [COLOR.GREEN, '绿'],
    [COLOR.PURPLE, '紫'],
    [COLOR.WHITE, '白'],
  ];
  const y = 1210;
  const gap = 92;
  const start = W / 2 - (gap * (items.length - 1)) / 2;
  ctx.save();
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < items.length; i++) {
    const [mask, name] = items[i];
    const x = start + i * gap;
    dot(x - 18, y, 5, colorCss(mask, 0.95));
    text(`${colorGlyph(mask)} ${name}`, x + 4, y, 11, 'rgba(210,225,240,.7)');
  }
  ctx.restore();
}

function drawHUD(scene, result) {
  text(scene.name, 30, 44, 18, 'rgba(248,235,205,.92)', 'left', 650);
  const total = result.crystals.length;
  const lit = result.lit || 0;
  const solved = result.allLit;
  text(
    solved ? '全部点亮 ✓' : `目标 ${lit}/${total}`,
    W - 30,
    44,
    13,
    solved ? 'rgba(140,255,200,.95)' : 'rgba(190,210,235,.65)',
    'right',
    600
  );
  drawLegend();
}

/* ---------------- 引导三件套 ---------------- */

function tutorialContext(active, result) {
  const positions = {};
  for (const l of active.lights || []) positions[l.id] = l;
  for (const p of active.prisms || []) positions[p.id] = p;
  for (const f of active.filters || []) positions[f.id] = f;
  for (const m of active.combiners || []) positions[m.id] = m;
  const angles = {};
  for (const l of active.lights || []) angles[l.id] = l.angle;
  const gates = {};
  if (state.runtime) {
    for (const [id, st] of state.runtime) gates[id] = st;
  }
  const crystals = {};
  for (const c of result.crystals || []) crystals[c.id] = c;
  return { positions, angles, gates, crystals, allLit: result.allLit, hold: 0 };
}

function findTutorialTarget(active, gesture) {
  if (!gesture || !gesture.id) return null;
  for (const list of [active.lights, active.prisms, active.filters, active.combiners, active.gates, active.crystals]) {
    const hit = (list || []).find((x) => x.id === gesture.id);
    if (hit) return { x: hit.x, y: hit.y, el: hit };
  }
  return null;
}

function drawDashedZone(zone, time) {
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
  text('放这里', zone.x, zone.y + r + 15, 10, 'rgba(150,255,220,.72)');
}

function drawGhostHand(gesture, active, time) {
  const from = findTutorialTarget(active, gesture);
  if (!from || !gesture.to) return;
  const to = gesture.to;
  const phase = (Math.sin(time * 1.7) + 1) / 2;
  const p = { x: from.x + (to.x - from.x) * phase, y: from.y + (to.y - from.y) * phase };
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const alpha = state.drag ? 0.12 : 0.55;

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
  roundRect(4, -4, 23, 8, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,246,220,.5)';
  ctx.beginPath();
  ctx.arc(-7, 8, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 目标元件的外圈提示
  ctx.save();
  ctx.globalAlpha = state.drag ? 0.15 : 0.5;
  ctx.beginPath();
  ctx.arc(from.x, from.y, 36 + Math.sin(time * 2.2) * 3, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,232,180,.5)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([2, 5]);
  ctx.stroke();
  ctx.restore();
}

function drawToast(str, time) {
  if (!str) return;
  ctx.save();
  ctx.font = `600 15px ${FONT}`;
  const tw = ctx.measureText(str).width;
  const w = Math.min(W - 70, tw + 44);
  const x = (W - w) / 2;
  const y = 88;
  roundRect(x, y, w, 38, 19);
  ctx.fillStyle = 'rgba(7,13,21,.86)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,228,170,.38)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  text(str, W / 2, y + 19, 15, 'rgba(255,240,210,.95)', 'center', 600);

  // 步骤小点
  const n = state.tutorial ? state.tutorial.steps.length : 0;
  if (n > 1 && state.tutorial && !state.tutorial.done) {
    const idx = state.tutorial.index;
    for (let i = 0; i < n; i++) {
      dot(W / 2 - (n - 1) * 6 + i * 12, y + 50, 2.4, i <= idx ? 'rgba(255,225,165,.85)' : 'rgba(180,200,220,.22)');
    }
  }
}

function drawTutorialOverlay(active, result, time) {
  if (!state.tutorial) return;
  const view = tutorialView(state.tutorial);
  if (view.done) {
    if (state.tutorialDoneAt && time - state.tutorialDoneAt < 2.4) drawToast('引导完成 ✓', time);
    return;
  }
  for (const zone of view.dashedZones) drawDashedZone(zone, time);
  if (view.gesture) drawGhostHand(view.gesture, active, time);
  drawToast(`${view.index + 1}/${view.total} · ${view.toast}`, time);
}

/* ---------------- 主循环 ---------------- */

function frame(now) {
  const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 0;
  state.last = now;
  const time = now / 1000;

  let active = state.scene;
  if (state.runtime) {
    active = applyGateEffects(state.scene, state.runtime).scene;
    const pre = traceScene(active);
    stepGates(active, state.runtime, pre.gates, dt);
    active = applyGateEffects(state.scene, state.runtime).scene;
  }
  const result = traceScene(active);
  state.active = active;
  state.result = result;

  ctx.clearRect(0, 0, W, H);
  drawBackground();

  for (const b of active.blocks || []) drawBlock(b);
  for (const seg of result.rays) drawRay(seg);

  for (const m of active.combiners || []) {
    drawCombiner(m, result.combiners.find((c) => c.id === m.id), time);
  }
  for (const f of active.filters || []) drawFilter(f);
  for (const p of active.prisms || []) drawPrism(p);

  for (const c of active.crystals || []) {
    drawCrystal(c, result.crystals.find((h) => h.id === c.id), time);
  }
  for (const g of active.gates || []) {
    drawGate(g, state.runtime ? state.runtime.get(g.id) : null, active, time);
  }
  for (const l of active.lights || []) drawLight(l, time);

  drawHUD(active, result);
  if (state.tutorial) {
    const wasDone = state.tutorial.done;
    stepTutorial(state.tutorial, tutorialContext(active, result));
    if (!wasDone && state.tutorial.done) state.tutorialDoneAt = time;
  }
  drawTutorialOverlay(active, result, time);
  requestAnimationFrame(frame);
}

/* ---------------- 交互 ---------------- */

function toScenePoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * W,
    y: ((e.clientY - rect.top) / rect.height) * H,
  };
}

function lightById(id) {
  return (state.scene.lights || []).find((l) => l.id === id) || null;
}

function capturePointer(e) {
  if (!canvas.setPointerCapture || !e || e.pointerId === undefined) return;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
}

function pickElement(p) {
  const scene = state.scene;
  // 灯优先：灯芯比元件更重要
  for (const l of scene.lights || []) {
    if (Math.hypot(p.x - l.x, p.y - l.y) <= 34) return { type: 'light', el: l };
  }
  for (const p0 of scene.prisms || []) {
    if (p0.draggable !== false && Math.hypot(p.x - p0.x, p.y - p0.y) <= elementRadius(p0) + 12) {
      return { type: 'prism', el: p0 };
    }
  }
  for (const f of scene.filters || []) {
    if (f.draggable !== false && Math.hypot(p.x - f.x, p.y - f.y) <= elementRadius(f) + 12) {
      return { type: 'filter', el: f };
    }
  }
  for (const m of scene.combiners || []) {
    if (m.draggable !== false && Math.hypot(p.x - m.x, p.y - m.y) <= elementRadius(m) + 12) {
      return { type: 'combiner', el: m };
    }
  }
  return null;
}

function onDown(e) {
  e.preventDefault();
  const p = toScenePoint(e);
  const jl = (state.scene.lights || []).find((l) => l.joystick);
  if (jl) {
    const zone = hitJoystick(jl, p);
    if (zone === 'handle') {
      state.drag = { type: 'handle', id: jl.id };
      jl.angle = angleFromHandle(jl, p);
      capturePointer(e);
      return;
    }
    if (zone === 'core') {
      state.drag = { type: 'core', id: jl.id, dx: jl.x - p.x, dy: jl.y - p.y };
      capturePointer(e);
      return;
    }
  }

  const picked = pickElement(p);
  if (!picked) return;
  state.selected = picked.el.id;
  if (picked.type === 'light') {
    state.drag = { type: 'light', id: picked.el.id, dx: picked.el.x - p.x, dy: picked.el.y - p.y };
  } else {
    state.drag = { type: picked.type, id: picked.el.id, dx: picked.el.x - p.x, dy: picked.el.y - p.y };
  }
  capturePointer(e);
}

function onMove(e) {
  if (!state.drag) return;
  e.preventDefault();
  const p = toScenePoint(e);
  if (state.drag.type === 'handle') {
    const l = lightById(state.drag.id);
    if (l) l.angle = angleFromHandle(l, p);
    return;
  }
  const B = state.scene.bounds || { x0: 0, y0: 0, x1: W, y1: H };
  if (state.drag.type === 'light' || state.drag.type === 'core') {
    const l = lightById(state.drag.id);
    if (l) {
      const moved = dragCore(l, { x: p.x + state.drag.dx, y: p.y + state.drag.dy }, B);
      l.x = moved.x;
      l.y = moved.y;
    }
    return;
  }
  const el =
    state.drag.type === 'prism'
      ? (state.scene.prisms || []).find((x) => x.id === state.drag.id)
      : state.drag.type === 'filter'
        ? (state.scene.filters || []).find((x) => x.id === state.drag.id)
        : (state.scene.combiners || []).find((x) => x.id === state.drag.id);
  if (!el) return;
  const r = elementRadius(el) + 8;
  el.x = clamp(p.x + state.drag.dx, B.x0 + r, B.x1 - r);
  el.y = clamp(p.y + state.drag.dy, B.y0 + r, B.y1 - r);

  // 引导虚线框的宽容吸附：进入 ±18px 就把元件吸到框中心
  if (state.tutorial && !state.tutorial.done) {
    const step = state.tutorial.steps[state.tutorial.index];
    const zone = step && step.dashedZones && step.dashedZones[0];
    const gesture = step && step.gesture;
    if (zone && gesture && gesture.id === el.id) {
      const d = Math.hypot(el.x - zone.x, el.y - zone.y);
      if (d <= (zone.snapRadius || 18)) {
        el.x = zone.x;
        el.y = zone.y;
      }
    }
  }
}

function onUp(e) {
  state.drag = null;
  if (canvas.releasePointerCapture && e && e.pointerId !== undefined) {
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }
}

canvas.addEventListener('pointerdown', onDown);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);
canvas.addEventListener('pointerleave', onUp);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
resetBtn.addEventListener('click', () => loadScene(state.id));
window.addEventListener('resize', fitCanvas);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitCanvas).observe(stageWrap);

buildTabs();
const initial = new URLSearchParams(location.search).get('scene') || location.hash.replace(/^#/, '') || 'tutorial';
loadScene(OPTICS_SCENES[initial] ? initial : 'tutorial');
fitCanvas();
requestAnimationFrame(frame);
