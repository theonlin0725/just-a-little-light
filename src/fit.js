// 每关的"内容框"与可操作范围归一化。
//
// 目的：光柱间距 = 内容框的垂直跨度 × 缩放，而缩放又受"沿墙方向的内容跨度"限制。
// 原先把可拖拽范围固定成整面墙（y 220..1060），等于给每关都塞了 840 的跨度，
// 缩放被压到 0.76，上下光柱只能靠得很近。这里按每关真实内容收紧范围，
// 让缩放真正用起来。

const CLAMP = (v, a, b) => Math.max(a, Math.min(b, v));

function push(p, box) {
  box.x0 = Math.min(box.x0, p.x);
  box.x1 = Math.max(box.x1, p.x);
  box.y0 = Math.min(box.y0, p.y);
  box.y1 = Math.max(box.y1, p.y);
}

/** 关卡里真正会被看见、会被碰到的东西的外接框 */
export function contentBox(level) {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const c of level.crystals || []) push({ x: c.x, y: c.y }, box);
  for (const poly of level.blocks || []) for (const p of poly) push(p, box);
  for (const m of level.movers || []) {
    for (const p of m.path || []) push(p, box);
    const r = Math.max(...(m.shape || []).map((p) => Math.hypot(p.x, p.y)), 0);
    for (const p of m.path || []) {
      push({ x: p.x - r, y: p.y - r }, box);
      push({ x: p.x + r, y: p.y + r }, box);
    }
  }
  for (const l of level.lights || []) {
    push(l.goal || l.start, box);
    push(l.start, box);
  }
  if (!Number.isFinite(box.x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return box;
}

/**
 * 收紧可拖拽范围并给出内容框。
 * @param {object} level
 * @param {object} base 原始 bounds
 */
export function fitLevel(level, base) {
  const box = contentBox(level);
  const padY = 96; // 内容上下留一点可调空间
  const edge = 24;
  const padX = 60;
  let y0 = CLAMP(box.y0 - padY, base.y0, base.y1);
  let y1 = CLAMP(box.y1 + padY, base.y0, base.y1);
  if (y1 - y0 < 320) {
    const mid = (y0 + y1) / 2;
    y0 = CLAMP(mid - 160, base.y0, base.y1);
    y1 = CLAMP(mid + 160, base.y0, base.y1);
  }
  const bounds = {
    x0: CLAMP(Math.min(base.x0, box.x0 + padX), base.x0, base.x1),
    x1: base.x1,
    y0,
    y1,
  };
  const lights = (level.lights || []).map((l) => {
    const s = {
      x: CLAMP(l.start.x, bounds.x0, bounds.x1),
      y: CLAMP(l.start.y, bounds.y0, bounds.y1),
    };
    return { ...l, start: s, start0: s };
  });
  return {
    bounds,
    lights,
    fitBox: {
      x0: Math.min(box.x0, bounds.x0) - 20,
      x1: Math.max(box.x1, bounds.x1) + 20,
      // 沿墙方向留边：内容不贴屏幕左右边缘
      y0: Math.max(120, Math.min(box.y0, bounds.y0) - edge),
      y1: Math.min(1160, Math.max(box.y1, bounds.y1) + edge),
    },
  };
}
