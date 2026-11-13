// 平台层：把浏览器和微信小游戏的差异收在一处。
// 游戏逻辑、渲染、存档、音频都只调这里的接口，不再直接摸 window/document/localStorage。

import { quality } from './quality.js';

function webCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export const plat = {
  kind: 'web',
  wx: null,
  canvas: null,
  /** 窗口 CSS 尺寸 */
  screenW: 0,
  screenH: 0,
  dpr: 1,
  /** 安全区（微信刘海/胶囊），单位 CSS px */
  safeTop: 0,
  safeBottom: 0,
  capsuleHeight: 0,
  /** 微信环境快照，见 readWxWindow */
  env: null,

  createCanvas: webCanvas,

  getStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 隐私模式 / 配额满 */
    }
  },

  saveImage(canvas, filename) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) return resolve({ ok: false, reason: 'toBlob 失败' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve({ ok: true });
      }, 'image/png');
    });
  },

  createAudioContext() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try {
      return new AC();
    } catch {
      return null;
    }
  },

  shareAppMessage() {
    return { ok: false, reason: '当前环境不支持小程序分享' };
  },
};

/**
 * 读取窗口 / 安全区 / 胶囊信息。
 * 优先 wx.getWindowInfo()（新基础库），拿不到再退回 getSystemInfoSync()。
 */
export function readWxWindow(wxApi) {
  let info = null;
  try {
    info = wxApi.getWindowInfo ? wxApi.getWindowInfo() : null;
  } catch {
    info = null;
  }
  if (!info) {
    try {
      info = wxApi.getSystemInfoSync();
    } catch {
      info = {};
    }
  }

  const winW = info.windowWidth || info.screenWidth || 375;
  const winH = info.windowHeight || info.screenHeight || 667;
  const screenH = info.screenHeight || winH;
  const safe = info.safeArea || null;

  let capsuleBottom = 0;
  try {
    const cap = wxApi.getMenuButtonBoundingClientRect ? wxApi.getMenuButtonBoundingClientRect() : null;
    if (cap && cap.bottom) capsuleBottom = cap.bottom;
  } catch {
    capsuleBottom = 0;
  }

  return {
    winW,
    winH,
    dpr: Math.min(info.pixelRatio || 1, quality.dprCap),
    safeTop: safe && typeof safe.top === 'number' ? safe.top : info.statusBarHeight || 0,
    safeBottom: safe && typeof safe.bottom === 'number' ? Math.max(0, screenH - safe.bottom) : 0,
    capsuleBottom,
  };
}

/**
 * 刷新环境，并把上屏画布的 backing store 对齐到 窗口 × dpr。
 * 可重复调用（resize 时复用同一块画布，不重复创建）。
 */
export function refreshWxEnvironment(wxApi) {
  const env = readWxWindow(wxApi || plat.wx);
  plat.env = env;
  plat.screenW = env.winW;
  plat.screenH = env.winH;
  plat.dpr = env.dpr;
  plat.safeTop = env.safeTop;
  plat.safeBottom = env.safeBottom;
  plat.capsuleHeight = env.capsuleBottom;

  if (plat.canvas) {
    const bw = Math.round(env.winW * env.dpr);
    const bh = Math.round(env.winH * env.dpr);
    if (plat.canvas.width !== bw) plat.canvas.width = bw;
    if (plat.canvas.height !== bh) plat.canvas.height = bh;
  }
  return env;
}

/** 初始化微信小游戏平台。必须在任何离屏 canvas 之前调用。 */
export function initWxPlatform(wxApi) {
  plat.kind = 'wx';
  plat.wx = wxApi;
  // 小游戏里第一次 createCanvas() 才是上屏画布
  plat.canvas = wxApi.createCanvas();
  refreshWxEnvironment(wxApi);

  plat.createCanvas = (w, h) => {
    const c = wxApi.createCanvas();
    c.width = w;
    c.height = h;
    return c;
  };

  plat.getStorage = (key) => {
    try {
      const v = wxApi.getStorageSync(key);
      return v === '' || v === undefined ? null : v;
    } catch {
      return null;
    }
  };
  plat.setStorage = (key, value) => {
    try {
      wxApi.setStorageSync(key, value);
    } catch {
      /* 存储失败不阻断游戏 */
    }
  };

  plat.createAudioContext = () => {
    if (!wxApi.createWebAudioContext) return null;
    try {
      return wxApi.createWebAudioContext();
    } catch {
      return null;
    }
  };

  // 分享图存相册：canvas → 临时文件 → 相册（授权被拒只影响保存）
  plat.saveImage = (canvas, filename) =>
    new Promise((resolve) => {
      try {
        wxApi.canvasToTempFilePath({
          canvas,
          success: (res) => {
            wxApi.saveImageToPhotosAlbum({
              filePath: res.tempFilePath,
              success: () => resolve({ ok: true }),
              fail: (e) => resolve({ ok: false, reason: (e && e.errMsg) || '保存失败' }),
            });
          },
          fail: (e) => resolve({ ok: false, reason: (e && e.errMsg) || '导出图片失败' }),
        });
      } catch (e) {
        resolve({ ok: false, reason: String(e && e.message ? e.message : e) });
      }
    });

  plat.shareAppMessage = (opts) => {
    try {
      wxApi.shareAppMessage(opts);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  };

  return plat;
}
