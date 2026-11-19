// Gate 1 的光学演示关：五个新机制各一关，先跑通「引导 → 操作 → 3 秒保持 → 结算」。
//
// 这些关卡使用定向光束，不接现有 60 关的点光源数据；
// 正式 21–60 关会按 docs/V2-PLAN.md 的逐关表继续生产。

import { COLOR } from './optics.js';

const W = 720;
const H = 1280;
const bounds = { x0: 0, y0: 0, x1: W, y1: H };

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const block = (id, x, y, w, h) => ({ id, poly: rect(x, y, w, h) });

const tutorial = (steps) => ({ steps });

export const BEAM_LEVELS = [
  {
    id: 'beam-prism',
    name: '初折',
    chapter: 'prism',
    hold: 3,
    timeLimit: 0,
    parTime: 20,
    hint: '拖动棱镜到光路上，让光折向上方的水晶。',
    bounds,
    lights: [{ id: 'l0', x: 120, y: 640, angle: 0, color: COLOR.WHITE }],
    blocks: [block('wall', 460, 620, 40, 200)],
    prisms: [{ id: 'p0', kind: 'deflect45L', x: 360, y: 800, angle: 0, r: 30, draggable: true }],
    filters: [],
    combiners: [],
    gates: [],
    crystals: [{ id: 'c0', x: 600, y: 400, r: 26, requiredColor: COLOR.WHITE, acceptAny: true }],
    tutorial: tutorial([
      {
        toast: '拖动棱镜到光路上',
        dashedZones: [{ id: 'z0', x: 360, y: 640, r: 36, snapRadius: 18 }],
        gesture: { id: 'p0', to: { x: 360, y: 640 } },
        completeWhen: 'inZone:p0:z0',
      },
      { toast: '水晶亮了，保持 3 秒', completeWhen: 'allLit' },
    ]),
  },

  {
    id: 'beam-filter',
    name: '初染',
    chapter: 'filter',
    hold: 3,
    timeLimit: 0,
    parTime: 20,
    hint: '白光点不亮蓝水晶；把蓝滤镜拖进光路。',
    bounds,
    lights: [{ id: 'l0', x: 120, y: 640, angle: 0, color: COLOR.WHITE }],
    blocks: [],
    prisms: [],
    filters: [{ id: 'f0', color: COLOR.BLUE, x: 340, y: 800, r: 28, draggable: true }],
    combiners: [],
    gates: [],
    crystals: [{ id: 'c0', x: 600, y: 640, r: 26, requiredColor: COLOR.BLUE }],
    tutorial: tutorial([
      {
        toast: '把蓝滤镜拖进光路',
        dashedZones: [{ id: 'z0', x: 340, y: 640, r: 36, snapRadius: 18 }],
        gesture: { id: 'f0', to: { x: 340, y: 640 } },
        completeWhen: 'inZone:f0:z0',
      },
      { toast: '蓝光才对得上蓝水晶', completeWhen: 'allLit' },
    ]),
  },

  {
    id: 'beam-gate',
    name: '叩门',
    chapter: 'gate',
    hold: 3,
    timeLimit: 0,
    parTime: 25,
    hint: '分光镜一路照机关，一路被门挡住；等机关开门。',
    bounds,
    lights: [{ id: 'l0', x: 120, y: 640, angle: 0, color: COLOR.WHITE }],
    blocks: [block('door', 500, 600, 36, 120)],
    prisms: [{ id: 'p0', kind: 'splitter', x: 340, y: 800, angle: 45, r: 30, draggable: true }],
    filters: [],
    combiners: [],
    gates: [
      {
        id: 'g0',
        kind: 'latch',
        x: 340,
        y: 900,
        r: 28,
        requiredColor: COLOR.WHITE,
        acceptAny: true,
        chargeTime: 0.8,
        actions: [{ type: 'openDoor', targetBlockId: 'door' }],
      },
    ],
    crystals: [{ id: 'c0', x: 640, y: 640, r: 28, requiredColor: COLOR.WHITE, acceptAny: true }],
    tutorial: tutorial([
      {
        toast: '把分光镜拖进光路',
        dashedZones: [{ id: 'z0', x: 340, y: 640, r: 36, snapRadius: 18 }],
        gesture: { id: 'p0', to: { x: 340, y: 640 } },
        completeWhen: 'inZone:p0:z0',
      },
      { toast: '等锁存机关充能开门', gesture: { id: 'g0', to: { x: 340, y: 900 } }, completeWhen: 'gate:g0:opened' },
      { toast: '门开了，让光穿过门', gesture: { id: 'c0', to: { x: 640, y: 640 } }, completeWhen: 'allLit' },
    ]),
  },

  {
    id: 'beam-joystick',
    name: '寻向',
    chapter: 'aim',
    hold: 3,
    timeLimit: 0,
    parTime: 25,
    hint: '按住灯座下方的手柄，把发射角拨到正上方。',
    bounds,
    lights: [
      {
        id: 'l0',
        x: 360,
        y: 1040,
        angle: -120,
        color: COLOR.WHITE,
        joystick: true,
        angleRange: [-150, -30],
        snapAngles: [-90, -60, -120],
        bounds: { x0: 160, y0: 940, x1: 560, y1: 1100 },
      },
    ],
    blocks: [],
    prisms: [
      { id: 'p0', kind: 'deflect45R', x: 360, y: 760, angle: 0, r: 30, draggable: false },
      { id: 'p1', kind: 'deflect45L', x: 600, y: 520, angle: 0, r: 30, draggable: false },
    ],
    filters: [],
    combiners: [],
    gates: [],
    crystals: [{ id: 'c0', x: 600, y: 280, r: 28, requiredColor: COLOR.WHITE, acceptAny: true }],
    tutorial: tutorial([
      {
        toast: '拨动摇杆，让光朝上',
        gesture: { id: 'l0', fromHandle: true, to: { x: 360, y: 1096 } },
        completeWhen: 'angleNear:l0:-90:4',
      },
      { toast: '光折两次后点亮水晶', completeWhen: 'allLit' },
    ]),
  },

  {
    id: 'beam-spectrum',
    name: '虹现',
    chapter: 'spectrum',
    hold: 3,
    timeLimit: 0,
    parTime: 30,
    hint: '把色散棱镜拖进白光，红、黄、蓝三束会分别飞向三颗水晶。',
    bounds,
    lights: [{ id: 'l0', x: 100, y: 640, angle: 0, color: COLOR.WHITE }],
    blocks: [],
    prisms: [{ id: 'p0', kind: 'dispersion', x: 340, y: 800, angle: 0, r: 32, draggable: true }],
    filters: [],
    combiners: [],
    gates: [],
    crystals: [
      { id: 'c0', x: 620, y: 510, r: 24, requiredColor: COLOR.RED },
      { id: 'c1', x: 620, y: 640, r: 24, requiredColor: COLOR.YELLOW },
      { id: 'c2', x: 620, y: 770, r: 24, requiredColor: COLOR.BLUE },
    ],
    tutorial: tutorial([
      {
        toast: '把色散棱镜拖进白光',
        dashedZones: [{ id: 'z0', x: 340, y: 640, r: 38, snapRadius: 18 }],
        gesture: { id: 'p0', to: { x: 340, y: 640 } },
        completeWhen: 'inZone:p0:z0',
      },
      { toast: '三色同时亮起，保持 3 秒', completeWhen: 'allLit' },
    ]),
  },

  {
    id: 'beam-prism-time',
    name: '限时 · 初折',
    chapter: 'prism',
    hold: 3,
    timeLimit: 15,
    parTime: 10,
    hint: '15 秒内把棱镜拖进光路；全亮后倒计时会冻结，只需守住 3 秒。',
    bounds,
    lights: [{ id: 'l0', x: 120, y: 640, angle: 0, color: COLOR.WHITE }],
    blocks: [block('wall', 460, 620, 40, 200)],
    prisms: [{ id: 'p0', kind: 'deflect45L', x: 360, y: 800, angle: 0, r: 30, draggable: true }],
    filters: [],
    combiners: [],
    gates: [],
    crystals: [{ id: 'c0', x: 600, y: 400, r: 26, requiredColor: COLOR.WHITE, acceptAny: true }],
    tutorial: null,
  },
];

export const BEAM_LEVEL_COUNT = BEAM_LEVELS.length;
