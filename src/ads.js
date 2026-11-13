// 激励视频统一入口。
//
// 两种 provider：
//   'simulated' —— 浏览器 Demo 用，4.5 秒假播放器；
//   'wx'        —— 微信小游戏真实广告，走 wx.createRewardedVideoAd。
//
// 约定（真实广告）：
//   * 只有 onClose 里 res.isEnded === true 才算"完整观看"，其余一律不发奖；
//   * 不用猜测的广告时长伪造进度，微信下进度为 null（UI 显示不确定态）；
//   * 一次请求最多发一次奖，并发展示直接拒绝；
//   * 加载/展示失败、无填充、超时都要有明确结果，且不阻断免费游玩；
//   * 配置成 wx 后绝不回退到模拟播放器。

const SIM_DURATION = 4.5;
const LOAD_TIMEOUT = 12000; // show() 成功之前的等待上限
const WATCHDOG = 180000; // 广告已经展示后的兜底（正常广告不会超过这个时长）

export const ERROR_TEXT = {
  nofill: '暂时没有合适的广告，稍后再试',
  unavailable: '广告暂不可用',
  error: '广告加载失败，稍后再试',
  timeout: '广告响应超时，稍后再试',
  busy: '广告正在播放',
};

function mapWxError(err) {
  const code = err && (err.errCode || err.errno);
  if (code === 1004) return 'nofill';
  if (code === 1002 || code === 1005 || code === 1006 || code === 1007 || code === 1008) return 'unavailable';
  return 'error';
}

const state = {
  provider: 'simulated',
  adUnitId: '',
  /** 微信广告实例与监听只建一次 */
  ad: null,
  wired: false,
  /** 当前进行中的请求；并发 show 会被拒绝 */
  current: null,
  seq: 0,
};

/** 每次展示创建独立实例：SDK 的 onClose 不带请求 id，只能靠实例隔离迟到回调 */
function createWxAd() {
  if (!state.adUnitId) return null;
  if (typeof wx === 'undefined' || !wx.createRewardedVideoAd) return null;
  try {
    return wx.createRewardedVideoAd({ adUnitId: state.adUnitId });
  } catch (e) {
    warn(`createRewardedVideoAd 抛错：${(e && e.message) || e}`);
    return null;
  }
}

function destroyAd(ad) {
  if (!ad || typeof ad.destroy !== 'function') return;
  try {
    ad.destroy();
  } catch {
    /* 某些基础库没有 destroy 或不支持重复销毁 */
  }
}

function settle(status, detail) {
  const req = state.current;
  if (!req || req.settled) return;
  req.settled = true;
  state.current = null;
  clearTimeout(req.timer);
  clearTimeout(req.watchdog);
  destroyAd(req.ad);
  req.resolve({ status, detail, requestId: req.id });
}

function warn(msg) {
  try {
    if (typeof console !== 'undefined') console.warn('[ads]', msg);
  } catch {
    /* 忽略 */
  }
}

function showWx() {
  if (state.current) return Promise.resolve({ status: 'busy' });
  if (!state.adUnitId) return Promise.resolve({ status: 'unavailable' });
  const ad = createWxAd();
  if (!ad) return Promise.resolve({ status: 'unavailable' });

  return new Promise((resolve) => {
    const req = { id: ++state.seq, settled: false, resolve, ad, timer: null, watchdog: null };
    state.current = req;

    // 监听绑定在本次实例上；即使旧实例迟到回调，req.settled 也已为 true
    const onClose = (res) => {
      if (req.settled) return;
      const ended = !!(res && res.isEnded === true);
      settle(ended ? 'completed' : 'cancelled');
    };
    const onError = (err) => {
      if (req.settled) return;
      settle(mapWxError(err), err);
    };
    try {
      ad.onClose(onClose);
      ad.onError(onError);
    } catch (e) {
      settle('unavailable', e);
      return;
    }

    // 广告还没真正展示出来的等待上限，避免"点了一直转圈"
    req.timer = setTimeout(() => {
      if (!req.settled) settle('timeout');
    }, LOAD_TIMEOUT);

    const started = () => {
      if (req.settled) return;
      clearTimeout(req.timer);
      req.watchdog = setTimeout(() => settle('timeout'), WATCHDOG);
    };

    try {
      ad.show()
        .then(started)
        .catch(() => {
          if (req.settled) return;
          // show 失败时先 load 再 show，只重试一次；每步都检查请求是否还有效
          return Promise.resolve(ad.load())
            .then(() => (req.settled ? null : ad.show()))
            .then((r) => {
              if (r !== null) started();
            })
            .catch((e) => settle(mapWxError(e), e));
        })
        .catch((e) => settle(mapWxError(e), e));
    } catch (e) {
      settle('unavailable', e);
    }
  });
}

function showSimulated(onProgress) {
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16);
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const k = Math.min(1, (Date.now() - start) / (SIM_DURATION * 1000));
      onProgress?.(k);
      if (k >= 1) resolve({ status: 'completed' });
      else raf(tick);
    };
    raf(tick);
  });
}

export const ads = {
  get provider() {
    return state.provider;
  },

  get adUnitId() {
    return state.adUnitId;
  },

  /** 由入口（main-wx / main）注入配置。provider='wx' 时绝不回退模拟 */
  configure({ provider, adUnitId }) {
    if (provider) state.provider = provider;
    if (typeof adUnitId === 'string') state.adUnitId = adUnitId;
    // 配置变化后旧实例作废，避免串到别的广告位
    state.ad = null;
    state.wired = false;
  },

  /**
   * 展示激励视频。
   * @returns {Promise<{status:'completed'|'cancelled'|'unavailable'|'nofill'|'error'|'timeout'|'busy', detail?:any}>}
   */
  showRewarded(onProgress) {
    if (state.provider === 'wx') {
      if (state.current) return Promise.resolve({ status: 'busy' });
      return showWx();
    }
    if (state.current) return Promise.resolve({ status: 'busy' });
    const req = { id: ++state.seq, settled: false, resolve: null, timer: null, watchdog: null };
    state.current = req;
    return showSimulated(onProgress).then((res) => {
      settle(res.status);
      return res;
    });
  },

  /** 是否配置了可用广告位（引导文案要用它决定措辞） */
  get available() {
    return !!state.adUnitId;
  },

  /** 测试/诊断用：当前是否有请求在进行 */
  isBusy() {
    return !!state.current;
  },

  /** 仅测试用：重置内部状态 */
  _reset() {
    state.ad = null;
    state.wired = false;
    state.current = null;
    state.provider = 'simulated';
    state.adUnitId = '';
    state.seq = 0;
  },

  _warn: warn,
};
