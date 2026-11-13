// 内部 QA 工具。只有 QA 构建会把这段装进包；正式构建时打包器会把它替换成空模块。
// 这里的任何能力（跳关 / 解锁 / 模拟）都不得出现在提审包与正式包里。

import { contentStamp } from './content.js';

export function installQa({ game, buildId, adUnitId, layout, ads, extra }) {
  globalThis.__qa = {
    game,
    stamp: contentStamp(),
    build: buildId,
    ads,
    ...(extra || {}),
    layout: () => (layout ? layout() : null),
    unlockAll() {
      game.save.unlocked = 999;
      console.log('[qa] unlocked all');
    },
    jumpTo(i) {
      game.startLevel(i);
    },
    grantSkin(id) {
      if (!game.save.skins.unlocked.includes(id)) game.save.skins.unlocked.push(id);
      game.equipSkin(id);
    },
  };
  if (typeof wx !== 'undefined' && wx.onShow) {
    wx.onShow((res) => {
      if (res && res.query && res.query.qa === '1') globalThis.__qa.unlockAll();
    });
  }
  console.log(`[qa] ${contentStamp()} build=${buildId} adUnit=${adUnitId ? 'set' : 'empty'}`);
}
