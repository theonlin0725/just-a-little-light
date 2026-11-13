// 通关分享卡片：用离屏 canvas 现画一张 750x1100 的竖图，不依赖任何图片资源。
// 数据全部来自本局结算，不编造排名。

const W = 750;
const H = 1100;

import { plat } from './platform.js';

const FONT_UI =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
const FONT_TITLE = '"Songti SC", "STSong", "Noto Serif SC", "SimSun", serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * @param {object} d
 * @param {string} d.levelName
 * @param {number} d.levelNo
 * @param {number} d.totalLevels
 * @param {number} d.time      本局用时（秒）
 * @param {number} [d.distance] 本局移动总距离
 * @param {number} [d.optimal]  该关最优距离（只有验证过多解的关卡才有）
 * @param {number} [d.personal] 个人最短距离
 * @param {boolean} [d.newRecord]
 */
export function buildCard(d) {
  const c = plat.createCanvas(W, H);
  const ctx = c.getContext('2d');

  // 背景
  const bg = ctx.createLinearGradient(0, 0, W * 0.5, H);
  bg.addColorStop(0, '#111a2a');
  bg.addColorStop(0.5, '#080b12');
  bg.addColorStop(1, '#040509');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* ---- 顶部：标题 / 关卡 / 用时 ---- */
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // 卡面标题：五个字，逐字排版，和首页保持同一套字距逻辑
  const CARD_TITLE = '就差一点光';
  ctx.fillStyle = 'rgba(248,244,236,0.96)';
  ctx.font = `500 52px ${FONT_TITLE}`;
  let cx = 64;
  for (const ch of CARD_TITLE) {
    ctx.fillText(ch, cx, 104);
    cx += ctx.measureText(ch).width + 7;
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,205,140,0.7)';
  ctx.font = `500 20px ${FONT_UI}`;
  ctx.fillText(`第 ${String(d.levelNo).padStart(2, '0')} 关 / 共 ${d.totalLevels}`, W - 64, 92);
  ctx.fillStyle = 'rgba(238,244,255,0.95)';
  ctx.font = `600 40px ${FONT_TITLE}`;
  ctx.fillText(d.levelName, W - 64, 140);

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(150,165,190,0.7)';
  ctx.font = `400 21px ${FONT_UI}`;
  ctx.fillText('通关用时', 64, 238);

  const tstr = d.time.toFixed(1);
  ctx.fillStyle = 'rgba(255,250,240,0.98)';
  ctx.font = `600 92px ${FONT_UI}`;
  ctx.fillText(tstr, 60, 322);
  const tw = ctx.measureText(tstr).width;
  ctx.fillStyle = 'rgba(255,205,140,0.8)';
  ctx.font = `400 38px ${FONT_UI}`;
  ctx.fillText('秒', 60 + tw + 8, 322);
  if (d.newRecord) {
    ctx.fillStyle = 'rgba(150,240,255,0.9)';
    ctx.font = `500 19px ${FONT_UI}`;
    ctx.fillText('个人最佳', 62, 358);
  }

  /* ---- 中部：场景缩略图（光源 → 三颗水晶） ---- */
  const artTop = 396;
  const artBot = 726;
  const wallX = W - 128;
  const wisps = [artTop + 46, artTop + 165, artTop + 284];

  const wallGrad = ctx.createLinearGradient(0, artTop, 0, artBot);
  wallGrad.addColorStop(0, 'rgba(255,236,200,0.14)');
  wallGrad.addColorStop(0.4, 'rgba(255,226,180,0.42)');
  wallGrad.addColorStop(1, 'rgba(255,196,140,0.12)');
  ctx.fillStyle = wallGrad;
  roundRect(ctx, wallX, artTop, 40, artBot - artTop, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,225,180,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const lx = 128;
  const ly = 620;
  for (const y of wisps) {
    const g = ctx.createLinearGradient(lx, ly, wallX, y);
    g.addColorStop(0, 'rgba(255,214,160,0.8)');
    g.addColorStop(1, 'rgba(255,236,200,0.3)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(wallX + 8, y);
    ctx.stroke();
  }
  for (const y of wisps) {
    const g = ctx.createRadialGradient(wallX + 20, y, 0, wallX + 20, y, 46);
    g.addColorStop(0, 'rgba(180,250,255,0.65)');
    g.addColorStop(1, 'rgba(120,230,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(wallX + 20, y, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(wallX + 20, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = 'rgba(238,255,255,0.95)';
    ctx.fillRect(-8, -8, 16, 16);
    ctx.restore();
  }
  const halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, 110);
  halo.addColorStop(0, 'rgba(255,246,225,0.95)');
  halo.addColorStop(0.22, 'rgba(255,205,140,0.4)');
  halo.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(lx, ly, 110, 0, Math.PI * 2);
  ctx.fill();

  /* ---- 下部：距离挑战（只有验证过多解的关卡才有） ---- */
  let footY = 800;
  if (d.distance !== undefined && d.optimal !== undefined) {
    const px = 56;
    const py = 760;
    const pw = W - 112;
    const ph = 186;
    roundRect(ctx, px, py, pw, ph, 18);
    ctx.fillStyle = 'rgba(9,13,21,0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const rows = [
      ['本局移动', `${d.distance.toFixed(0)} px`, 'rgba(226,236,250,0.9)'],
      ['个人最短', `${(d.personal ?? d.distance).toFixed(0)} px`, 'rgba(226,236,250,0.9)'],
      ['理论最优', `${d.optimal.toFixed(0)} px`, 'rgba(150,240,255,0.95)'],
    ];
    rows.forEach(([k, v, col], i) => {
      const yy = py + 54 + i * 44;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(150,165,190,0.7)';
      ctx.font = `400 21px ${FONT_UI}`;
      ctx.fillText(k, px + 34, yy);
      ctx.textAlign = 'right';
      ctx.fillStyle = col;
      ctx.font = `500 21px ${FONT_UI}`;
      ctx.fillText(v, px + pw - 34, yy);
    });
    footY = py + ph + 54;
  }

  /* ---- 页脚 ---- */
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(140,155,180,0.45)';
  ctx.font = `400 19px ${FONT_UI}`;
  ctx.fillText('拖动一点光，点亮所有水晶', 64, footY);
  ctx.fillStyle = 'rgba(255,205,140,0.5)';
  ctx.font = `500 19px ${FONT_UI}`;
  ctx.fillText('微信小游戏 · 就差一点光', 64, footY + 34);

  return c;
}

/** 保存成图片：浏览器下载 PNG，微信小游戏存相册（首次会弹授权） */
export async function saveCard(canvas, filename = 'projection.png') {
  const res = await plat.saveImage(canvas, filename);
  return !!res.ok;
}
