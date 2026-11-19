// Gate 0 的五个机制样板场景。
// 这些不是正式关卡，只用于沙盒手感验证与自动化冒烟测试；
// 正式关卡数据在 `src/levels.js`，两者互不影响。

import { COLOR } from './optics.js';

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const block = (id, x, y, w, h) => ({ id, poly: rect(x, y, w, h) });

const bounds = { x0: 0, y0: 0, x1: 720, y1: 1280 };

export const OPTICS_SCENES = {
  prism: {
    id: 'prism',
    name: '棱镜 · 一次偏折',
    hint: '拖动棱镜到光路上；45° 棱镜会把光折向上方。',
    bounds,
    lights: [{ id: 'l0', x: 120, y: 640, angle: 0, color: COLOR.WHITE }],
    blocks: [block('wall', 460, 620, 40, 200)],
    prisms: [{ id: 'p0', kind: 'deflect45L', x: 360, y: 640, angle: 0, r: 30, draggable: true }],
    filters: [],
    combiners: [],
    gates: [],
    crystals: [{ id: 'c0', x: 600, y: 400, r: 26, requiredColor: COLOR.WHITE, acceptAny: true }],
  },

  filter: {
    id: 'filter',
    name: '滤镜 · 同色才亮',
    hint: '两束白光各有一枚滤镜；把滤镜拖走，对应水晶就会熄灭。',
    bounds,
    lights: [
      { id: 'l0', x: 120, y: 640, angle: 0, color: COLOR.WHITE },
      { id: 'l1', x: 120, y: 400, angle: 0, color: COLOR.WHITE },
    ],
    blocks: [],
    prisms: [],
    filters: [
      { id: 'f0', color: COLOR.BLUE, x: 340, y: 640, r: 28, draggable: true },
      { id: 'f1', color: COLOR.RED, x: 340, y: 400, r: 28, draggable: true },
    ],
    combiners: [],
    gates: [],
    crystals: [
      { id: 'c0', x: 600, y: 640, r: 26, requiredColor: COLOR.BLUE },
      { id: 'c1', x: 600, y: 400, r: 26, requiredColor: COLOR.RED },
    ],
  },

  gate: {
    id: 'gate',
    name: '机关 · 先开门',
    hint: '分光镜一路照机关，一路被门挡住；等锁存机关充能后门会开。',
    bounds,
    lights: [{ id: 'l0', x: 120, y: 640, angle: 0, color: COLOR.WHITE }],
    blocks: [block('door', 500, 600, 36, 120)],
    prisms: [{ id: 'p0', kind: 'splitter', x: 340, y: 640, angle: 45, r: 30, draggable: true }],
    filters: [],
    combiners: [],
    gates: [
      {
        id: 'g0',
        kind: 'latch',
        x: 340,
        y: 880,
        r: 28,
        requiredColor: COLOR.WHITE,
        acceptAny: true,
        chargeTime: 0.8,
        actions: [{ type: 'openDoor', targetBlockId: 'door' }],
      },
    ],
    crystals: [{ id: 'c0', x: 640, y: 640, r: 28, requiredColor: COLOR.WHITE, acceptAny: true }],
  },

  tutorial: {
    id: 'tutorial',
    name: '教学 · 分光开门',
    hint: '按提示把分光镜拖进虚线框，等机关开门，再让光穿过门。',
    bounds,
    lights: [{ id: 'l0', x: 120, y: 640, angle: 0, color: COLOR.WHITE }],
    blocks: [block('door', 500, 600, 36, 120)],
    prisms: [{ id: 'p0', kind: 'splitter', x: 340, y: 780, angle: 45, r: 30, draggable: true }],
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
    tutorial: {
      steps: [
        {
          toast: '把分光镜拖进虚线框',
          dashedZones: [{ id: 'z0', x: 340, y: 640, r: 36, snapRadius: 18 }],
          gesture: { targetType: 'splitter', id: 'p0', to: { x: 340, y: 640 } },
          completeWhen: 'inZone:p0:z0',
        },
        {
          toast: '等锁存机关充能开门',
          gesture: { targetType: 'gate', id: 'g0', to: { x: 340, y: 900 } },
          completeWhen: 'gate:g0:opened',
        },
        {
          toast: '门开了，让光穿过门',
          gesture: { targetType: 'crystal', id: 'c0', to: { x: 640, y: 640 } },
          completeWhen: 'allLit',
        },
      ],
    },
  },

  joystick: {
    id: 'joystick',
    name: '摇杆 · 拨动发射角',
    hint: '按住灯座下方的手柄，沿弧线拨动；灯芯可单独拖动移位。',
    bounds,
    lights: [
      {
        id: 'l0',
        x: 360,
        y: 1040,
        angle: -90,
        color: COLOR.WHITE,
        joystick: true,
        angleRange: [-150, -30],
        snapAngles: [-90, -60, -120],
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
  },

  spectrum: {
    id: 'spectrum',
    name: '色散 · 白光分三色',
    hint: '把色散棱镜拖进白光；红、黄、蓝三束会分别飞向三颗水晶。',
    bounds,
    lights: [{ id: 'l0', x: 100, y: 640, angle: 0, color: COLOR.WHITE }],
    blocks: [],
    prisms: [{ id: 'p0', kind: 'dispersion', x: 340, y: 640, angle: 0, r: 32, draggable: true }],
    filters: [],
    combiners: [],
    gates: [],
    crystals: [
      { id: 'c0', x: 620, y: 510, r: 24, requiredColor: COLOR.RED },
      { id: 'c1', x: 620, y: 640, r: 24, requiredColor: COLOR.YELLOW },
      { id: 'c2', x: 620, y: 770, r: 24, requiredColor: COLOR.BLUE },
    ],
  },

  combiner: {
    id: 'combiner',
    name: '合光 · 红+蓝=紫',
    hint: '两束原色光同时进入合光晶格，才会合成紫光向上射出。',
    bounds,
    lights: [
      { id: 'l0', x: 120, y: 640, angle: 0, color: COLOR.RED },
      { id: 'l1', x: 360, y: 920, angle: -90, color: COLOR.BLUE },
    ],
    blocks: [],
    prisms: [],
    filters: [],
    combiners: [{ id: 'm0', x: 360, y: 640, r: 30, outAngle: -90, minInputs: 2 }],
    gates: [],
    crystals: [{ id: 'c0', x: 360, y: 300, r: 26, requiredColor: COLOR.PURPLE }],
  },
};

export const OPTICS_SCENE_LIST = [
  OPTICS_SCENES.tutorial,
  OPTICS_SCENES.prism,
  OPTICS_SCENES.filter,
  OPTICS_SCENES.gate,
  OPTICS_SCENES.joystick,
  OPTICS_SCENES.spectrum,
  OPTICS_SCENES.combiner,
];
