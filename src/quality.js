// 画质档位：只影响"怎么画"，绝不参与几何、遮挡、点亮与 3 秒判定。
//
// safe     —— 低端机 / 连续绘制失败后的兜底：低 DPR、关尘埃噪点拖尾
// standard —— 微信端默认：DPR 上限 2，保留主要光效
// high     —— 浏览器与实测达标机型：DPR 上限 3

export const TIERS = {
  safe: {
    name: 'safe',
    dprCap: 1.5,
    dust: 0,
    noise: false,
    vignette: true,
    trails: false,
    shadows: false,
    beams: true,
  },
  standard: {
    name: 'standard',
    dprCap: 2,
    dust: 60,
    noise: true,
    vignette: true,
    trails: true,
    shadows: true,
    beams: true,
  },
  high: {
    name: 'high',
    dprCap: 3,
    dust: 110,
    noise: true,
    vignette: true,
    trails: true,
    shadows: true,
    beams: true,
  },
};

export const quality = {
  tier: TIERS.high,
  /** 是否允许自动降级（连续绘制失败时由 frame runner 触发） */
  auto: true,
  onChange: null,

  set(name) {
    const t = TIERS[name];
    if (!t || t === this.tier) return false;
    this.tier = t;
    if (this.onChange) this.onChange(t);
    return true;
  },

  /** 只降不升：safe -> standard -> high 单向回退，避免抖动 */
  degrade() {
    if (!this.auto) return false;
    if (this.tier === TIERS.high) return this.set('standard');
    if (this.tier === TIERS.standard) return this.set('safe');
    return false;
  },

  get dprCap() {
    return this.tier.dprCap;
  },
};
