// 光源皮肤：纯视觉，不参与任何几何 / 遮挡 / 判定计算。
// 换皮肤只改颜色、光晕半径、光柱粗细、拖尾粒子和闪烁，不改照明范围。

export const SKINS = [
  {
    id: 'default',
    name: '初心',
    tag: '默认',
    desc: '最初的那盏灯',
    free: true,
    core: '255,252,242',
    mid: '255,226,168',
    glow: '255,205,140',
    beam: '255,236,200',
    beamW: 1,
    haloR: 250,
    trail: '255,220,170',
    trailN: 8,
    sparkle: 0,
  },
  {
    id: 'azure',
    name: '青焰',
    tag: '广告解锁',
    desc: '冷白的光柱，尾迹像水一样散开',
    free: false,
    core: '244,255,255',
    mid: '150,240,255',
    glow: '120,214,255',
    beam: '196,246,255',
    beamW: 0.78,
    haloR: 300,
    trail: '150,240,255',
    trailN: 14,
    sparkle: 0,
  },
  {
    id: 'ember',
    name: '赤潮',
    tag: '广告解锁',
    desc: '更粗的光柱，边缘烧得发红',
    free: false,
    core: '255,246,238',
    mid: '255,152,112',
    glow: '255,96,64',
    beam: '255,170,130',
    beamW: 1.5,
    haloR: 280,
    trail: '255,120,80',
    trailN: 18,
    sparkle: 0,
  },
  {
    id: 'gilded',
    name: '星砂',
    tag: '广告解锁',
    desc: '金色的光，走一路洒一路碎屑',
    free: false,
    core: '255,255,246',
    mid: '255,232,150',
    glow: '255,214,110',
    beam: '255,240,190',
    beamW: 1.15,
    haloR: 270,
    trail: '255,238,180',
    trailN: 12,
    sparkle: 1,
  },
];

export const DEFAULT_SKIN = SKINS[0];

export function skinById(id) {
  return SKINS.find((s) => s.id === id) || DEFAULT_SKIN;
}
