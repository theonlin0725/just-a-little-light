// 教学文案：按"玩法机制"配置，而不是按关卡散落 if。
//
// 规则：
//   - 某机制在 first 这一关第一次出现 → 显示它的简短说明；
//   - 后续关卡（哪怕机制重复出现、组合出现）→ 不再显示；
//   - 首次引入关的判断依据是关卡数据本身，与玩家是否看过、从哪个入口进来无关。
//
// 新增机制时只改这张表，不用碰渲染和状态机。

export const MECHANICS = [
  // 基础规则：拖动 + 全部点亮 + 连续保持 3 秒
  { id: 'basic', first: 1, text: '拖动光源，让墙上的水晶亮起来' },
  { id: 'multi', first: 3, text: '几颗水晶要同时亮着，影子会互相挤压' },
  { id: 'mover', first: 13, text: '挡板会移动，等它让开的间隙再保持' },
  { id: 'roamer', first: 19, text: '它会胀大：亮一圈前摇之后，等它缩回去' },
  { id: 'dualLight', first: 25, text: '两盏灯：点亮的那盏外圈会转，点它就能拖' },
  { id: 'bothLights', first: 27, text: '带两个点的水晶，要两盏灯同时照到' },
  { id: 'twoSides', first: 37, text: '上下两侧的水晶，要在同一段时间里同时亮' },
];

/** 这一关是否是某个机制的"首次引入关"；是就返回那条教学配置 */
export function mechanismForLevel(levelId) {
  return MECHANICS.find((m) => m.first === levelId) || null;
}

/** 基础通关规则只在基础教学关用文字解释一次 */
export function isBasicTutorial(levelId) {
  const m = mechanismForLevel(levelId);
  return !!m && m.id === 'basic';
}

/** 双光源的操作说明只在双光源首次引入关显示 */
export function teachesDualLight(levelId) {
  const m = mechanismForLevel(levelId);
  return !!m && m.id === 'dualLight';
}
