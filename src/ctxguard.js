// 给 canvas 2d context 加 save/restore 深度跟踪。
// 渲染中途抛错时，restore 不会被执行，clip/alpha/composite 会泄漏到下一帧；
// 这里把深度记下来，出错后可以精确回退到干净状态。

export function createCtxGuard(ctx) {
  if (ctx.__guard) return ctx.__guard;
  let depth = 0;
  const rawSave = ctx.save ? ctx.save.bind(ctx) : null;
  const rawRestore = ctx.restore ? ctx.restore.bind(ctx) : null;

  if (rawSave) ctx.save = () => { depth++; return rawSave(); };
  if (rawRestore) ctx.restore = () => { depth = Math.max(0, depth - 1); return rawRestore(); };

  const guard = {
    get depth() {
      return depth;
    },
    /** 回到没有任何 save 的状态，并复位所有可能泄漏的绘制状态 */
    reset() {
      let n = 0;
      while (depth > 0 && rawRestore && n < 64) {
        depth--;
        try { rawRestore(); } catch { /* 已无对应 save，忽略 */ }
        n++;
      }
      try { ctx.globalAlpha = 1; } catch {}
      try { ctx.globalCompositeOperation = 'source-over'; } catch {}
      try { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; } catch {}
      try { if (ctx.setLineDash) ctx.setLineDash([]); } catch {}
      try { ctx.setTransform(1, 0, 0, 1, 0, 0); } catch {}
    },
  };
  ctx.__guard = guard;
  return guard;
}
