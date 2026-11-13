// 微信小游戏的触摸状态机。
// 规则：
//   * 只有第一根按下的手指算"活动指"，其余手指一律忽略；
//   * 只有活动指的 move/end 才生效，别的指头松开不会中断拖动；
//   * touchcancel / 切后台会强制清空，避免"粘手"。
// 与具体坐标换算无关，方便单测。

function pickFirst(list) {
  if (!list || !list.length) return null;
  return list[0];
}

function findById(list, id) {
  if (!list || !list.length) return null;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const tid = t.identifier === undefined ? 0 : t.identifier;
    if (tid === id) return t;
  }
  return null;
}

/**
 * @param {{onStart:(x:number,y:number)=>void, onMove:(x:number,y:number)=>void, onEnd:()=>void}} handlers
 */
export function createTouchTracker(handlers) {
  let activeId = null;

  return {
    get activeId() {
      return activeId;
    },
    touchStart(e) {
      if (activeId !== null) return false; // 已有手指在操作，忽略后续手指
      const t = pickFirst((e && e.changedTouches) || (e && e.touches));
      if (!t) return false;
      activeId = t.identifier === undefined ? 0 : t.identifier;
      handlers.onStart(t.clientX, t.clientY);
      return true;
    },
    touchMove(e) {
      if (activeId === null) return false;
      const t = findById(e && e.touches, activeId);
      if (!t) return false;
      handlers.onMove(t.clientX, t.clientY);
      return true;
    },
    touchEnd(e) {
      if (activeId === null) return false;
      const t = findById(e && e.changedTouches, activeId);
      if (!t) return false; // 是别的手指松开了，忽略
      activeId = null;
      handlers.onEnd();
      return true;
    },
    touchCancel() {
      if (activeId === null) return false;
      activeId = null;
      handlers.onEnd();
      return true;
    },
    /** 切后台 / 系统中断：清状态并结束拖动，不触发点击 */
    reset() {
      if (activeId === null) return false;
      activeId = null;
      handlers.onEnd();
      return true;
    },
  };
}
