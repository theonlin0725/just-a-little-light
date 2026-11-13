// 极简 WebAudio 音效，全部用振荡器合成，不加载任何音频资源。
//
// 铁律：音效永远不能影响玩法。任何一步失败都只记数并静音，绝不向外抛。

import { plat } from './platform.js';

const MAX_VOICES = 8;

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.voices = 0;
    this.failures = 0;
    this.bgmOn = true;
    this.sfxOn = true;
    this.bgm = null; // { gain, filter, oscs, lfo }
    this.hold = null; // { src, filter, gain }
    this.holdBroken = false;
  }

  setBgm(on) {
    this.bgmOn = !!on;
    if (!this.bgmOn) this.stopBgm();
    else this.startBgm();
  }

  setSfx(on) {
    this.sfxOn = !!on;
    if (!this.sfxOn) {
      this.stopHold();
      this.mute?.();
    }
  }

  get ready() {
    return !!(this.enabled && this.ctx);
  }

  unlock() {
    if (this.ctx || !this.enabled) return;
    let ctx = null;
    let master = null;
    try {
      // 微信基础库没有 WebAudio 时返回 null，音效自动静音，不影响玩法
      ctx = plat.createAudioContext();
      if (!ctx) {
        this.enabled = false;
        return;
      }
      master = ctx.createGain ? ctx.createGain() : null;
      if (master) {
        master.gain.value = 1;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended' && ctx.resume) {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      // 只有全部成功才发布，避免半初始化的 ctx 被后续 tone 用到
      this.ctx = ctx;
      this.master = master;
      if (this.bgmOn) this.startBgm();
    } catch {
      this.enabled = false;
      this.ctx = null;
      this.master = null;
      try {
        if (master && master.disconnect) master.disconnect();
      } catch {}
    }
  }

  mute() {
    this.enabled = false;
    this.ctx = null;
    this.master = null;
    this.voices = 0;
  }

  suspend() {
    try {
      const p = this.ctx && this.ctx.state === 'running' && this.ctx.suspend && this.ctx.suspend();
      if (p && p.catch) p.catch(() => {});
    } catch {}
  }

  resume() {
    try {
      const p = this.ctx && this.ctx.state === 'suspended' && this.ctx.resume && this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch {}
  }

  /** 返回是否真的发声；任何异常都在内部消化 */
  tone(freq, dur, { type = 'sine', gain = 0.07, slide = 0, delay = 0 } = {}) {
    if (!this.enabled || !this.ctx || !this.sfxOn) return false;
    if (this.voices >= MAX_VOICES) return false; // 高频明灭时限制并发
    let osc = null;
    let g = null;
    try {
      const t0 = this.ctx.currentTime + delay;
      osc = this.ctx.createOscillator();
      g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      // 分开连：某些实现里 connect() 返回 undefined，不能链式调用
      osc.connect(g);
      if (this.master) g.connect(this.master);
      else g.connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
      this.voices++;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.voices = Math.max(0, this.voices - 1);
        try {
          osc.disconnect();
        } catch {}
        try {
          g.disconnect();
        } catch {}
      };
      osc.onended = release;
      // 部分实现不触发 onended，用定时器兜底
      setTimeout(release, (delay + dur + 0.12) * 1000);
      return true;
    } catch {
      this.failures++;
      try {
        if (osc) osc.disconnect();
      } catch {}
      try {
        if (g) g.disconnect();
      } catch {}
      if (this.failures >= 3) this.mute(); // 连续失败就彻底静音
      return false;
    }
  }

  /* ---------------- BGM：稀疏的琶音旋律，不是持续低音 ---------------- */
  //
  // 五个音一段乐句（C 大调五声音阶），每小节随机走音但受旋律轮廓约束，
  // 音符之间有呼吸；用轻三角波 + 两个泛音，加一条短延迟做空间感。
  // 不用低音持续音，避免长时间游玩的嗡鸣疲劳。

  _bgmNote(freq, at, dur, vel) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    const g2 = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2.004; // 轻微失谐的泛音，像钟琴
    g2.gain.value = 0.28;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vel, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    osc2.connect(g2);
    g2.connect(g);
    g.connect(this.bgm.mix);
    osc.start(at);
    osc2.start(at);
    osc.stop(at + dur + 0.05);
    osc2.stop(at + dur + 0.05);
  }

  startBgm() {
    if (!this.ready || !this.bgmOn || this.bgm) return false;
    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;

      const mix = ctx.createGain();
      mix.gain.value = 0.0001;
      // 一点点延时混响，让音与音之间"飘"起来
      let tail = null;
      if (ctx.createDelay) {
        tail = ctx.createDelay(1.0);
        tail.delayTime.value = 0.27;
        const fb = ctx.createGain();
        fb.gain.value = 0.22;
        const wet = ctx.createGain();
        wet.gain.value = 0.35;
        mix.connect(tail);
        tail.connect(fb);
        fb.connect(tail);
        tail.connect(wet);
        wet.connect(this.master || ctx.destination);
      }
      mix.connect(this.master || ctx.destination);

      this.bgm = { mix, tail, timer: null, nextAt: now + 0.4, step: 0 };

      // 五声音阶（C4 起），只用中高音区，避免低频轰鸣
      const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
      // 乐句轮廓：上行 - 停留 - 下行，每 8 个音循环一次，长度不等以打破机械感
      const SHAPE = [0, 2, 4, 5, 4, 2, 3, 1, 0, 3, 5, 6, 5, 3, 2, 0];
      const STEP = 0.62; // 音与音之间约 0.6 秒，留呼吸

      const tick = () => {
        if (!this.bgm) return;
        const horizon = ctx.currentTime + 1.6;
        while (this.bgm.nextAt < horizon) {
          const i = this.bgm.step % SHAPE.length;
          const idx = SHAPE[i];
          const octave = i % 8 >= 6 ? 12 : 0; // 乐句后段偶尔上一档
          const freq = SCALE[Math.min(SCALE.length - 1, idx)] * (octave ? 2 : 1);
          // 每 8 音留一个空拍，像呼吸
          if (i % 8 !== 7) this._bgmNote(freq, this.bgm.nextAt, 1.15, 0.05);
          if (i % 8 === 0) this._bgmNote(freq / 2, this.bgm.nextAt + 0.02, 1.6, 0.022); // 低八度轻托底，很轻
          this.bgm.nextAt += STEP * (i % 4 === 3 ? 1.35 : 1);
          this.bgm.step++;
        }
      };
      tick();
      this.bgm.timer = setInterval(tick, 500);
      mix.gain.setValueAtTime(0.0001, now);
      mix.gain.linearRampToValueAtTime(0.9, now + 2.5);
      return true;
    } catch {
      if (this.bgm && this.bgm.timer) clearInterval(this.bgm.timer);
      this.bgm = null;
      return false;
    }
  }

  stopBgm(fade = 0.6) {
    if (!this.bgm) return;
    const b = this.bgm;
    this.bgm = null;
    try {
      if (b.timer) clearInterval(b.timer);
      const now = this.ctx.currentTime;
      b.mix.gain.cancelScheduledValues?.(now);
      b.mix.gain.setTargetAtTime(0.0001, now, fade / 3);
      setTimeout(() => {
        try { b.mix.disconnect(); } catch {}
        try { b.tail && b.tail.disconnect(); } catch {}
      }, fade * 1000 + 200);
    } catch {}
  }

  /* ---------------- 读秒蓄力：一条常驻噪声，只调参数 ---------------- */
  startHold() {
    if (!this.ready || !this.sfxOn || this.hold || this.holdBroken) return false;
    try {
      const ctx = this.ctx;
      const len = Math.floor((ctx.sampleRate || 44100) * 0.8);
      if (!ctx.createBuffer || !ctx.createBufferSource) {
        this.holdBroken = true;
        return false;
      }
      const buf = ctx.createBuffer(1, len, ctx.sampleRate || 44100);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.35;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter ? ctx.createBiquadFilter() : null;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      if (filter) {
        filter.type = 'bandpass';
        filter.frequency.value = 780;
        filter.Q.value = 1.1;
        src.connect(filter);
        filter.connect(gain);
      } else {
        src.connect(gain);
      }
      gain.connect(this.master || ctx.destination);
      src.start();
      this.hold = { src, filter, gain };
      return true;
    } catch {
      this.holdBroken = true; // 只尝试一次，失败就彻底不用蓄力声
      this.hold = null;
      return false;
    }
  }

  /** @param {number} k 0..1 的保持进度 */
  setHold(k) {
    if (!this.hold) {
      if (k <= 0.001) return;
      if (!this.startHold()) return;
    }
    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const t = Math.max(0, Math.min(1, k));
      const level = 0.012 + 0.05 * t;
      this.hold.gain.gain.setTargetAtTime(level, now, 0.06);
      if (this.hold.filter) {
        this.hold.filter.frequency.setTargetAtTime(760 + 900 * t, now, 0.08);
      }
    } catch {
      this.stopHold();
    }
  }

  stopHold() {
    if (!this.hold) return;
    const h = this.hold;
    this.hold = null;
    try {
      const now = this.ctx.currentTime;
      h.gain.gain.cancelScheduledValues?.(now);
      h.gain.gain.setTargetAtTime(0.0001, now, 0.025); // 约 60ms 淡出
      setTimeout(() => {
        try { h.src.stop(); } catch {}
        try { h.src.disconnect(); } catch {}
        try { h.gain.disconnect(); } catch {}
      }, 220);
    } catch {}
  }

  chime(i) {
    const f = 523.25 * Math.pow(2, [0, 2, 4, 7, 9, 12][i % 6] / 12);
    this.tone(f, 0.5, { type: 'sine', gain: 0.06 });
    this.tone(f * 2, 0.35, { type: 'sine', gain: 0.02 });
  }

  holdBreak() {
    this.tone(196, 0.16, { type: 'sine', gain: 0.03, slide: -60 });
  }

  hint() {
    this.tone(392, 0.25, { type: 'sine', gain: 0.04 });
  }

  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this.tone(f, 0.7, { type: 'sine', gain: 0.055, delay: i * 0.1 })
    );
    this.tone(130.8, 0.9, { type: 'triangle', gain: 0.05 });
  }
}

export const sfx = new Sfx();
