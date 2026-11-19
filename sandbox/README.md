# 光学沙盒（Gate 0）

用于验证 V2 的定向光束、棱镜、滤镜、机关、摇杆和色散/合光手感。**不接入正式 60 关**，也不改现有存档。

## 运行

```bash
# 在仓库根目录
npm run dev
# 如果 5183 已被占用：
PORT=5184 npm run dev
```

打开：

```text
http://127.0.0.1:5183/sandbox/optics.html
```

正式游戏首页也已加入 **V2 光学试玩** 入口；直接访问 `/?beam=0` 可进入第 1 个光学演示关，`?beam=1..4` 进入后续关。游戏内是独立的 `BeamSession`，不会改动经典 60 关的进度。

可用 `?scene=tutorial|prism|filter|gate|joystick|spectrum|combiner` 直接进入某个样板。

- `tutorial`：完整演示「虚线框 + 幽灵手 + 分步 Toast + 机关开门」。
- 其余六个：分别验证棱镜、滤镜、机关、摇杆、色散、合光。

## 操作

- **灯座**：拖动发光圆点移动位置；摇杆关里按住内芯拖动。
- **摇杆**：按住灯座下方的手柄，沿弧线拨动；松手即锁定发射角。
- **棱镜 / 滤镜 / 合光晶格**：按住拖动；可拖元件角上有小黄点。
- **重置**：回到当前样板初始状态。

## 当前代码

| 文件 | 作用 |
| --- | --- |
| `src/optics.js` | 射线求交、45°/90°/分光/色散、3-bit RYB 滤镜与合光、软磁吸工具 |
| `src/gates.js` | 锁存型 / 保活型机关状态机，开门、护罩、副闸、滑台效果 |
| `src/joystick.js` | 内芯 / 外延手柄命中、扇区夹紧、角度换算与 ±3° 软磁吸 |
| `src/tutorial-flow.js` | 分步引导状态机，支持虚线框、机关/水晶条件和自动推进 |
| `src/optics-scenes.js` | 七个 Gate 0 样板场景（含完整引导样板） |
| `sandbox/optics.js` | Canvas 沙盒渲染、单指交互、引导三件套 |
| `tests/optics.test.mjs` | 光学与样板场景的回归 |
| `tests/gates.test.mjs` | 机关时序与门效果 |
| `tests/joystick.test.mjs` | 摇杆热区、角度与软磁吸 |
| `tests/tutorial-flow.test.mjs` | 分步引导推进、跳过与重置 |
| `tests/beam-game.test.mjs` | 游戏内 5 关、3 秒保持、倒计时冻结、超时与返回 |

## 验证

```bash
npm run test:optics
npm test
```

## 还没做

- 正式关卡数据接入、3 秒保持与计时冻结；
- 幽灵手势 / 虚线框 / 分步 Toast 三件套；
- 关卡求解器与 60 关批量校验；
- 微信端渲染与真机触摸验证。

这些按 `docs/V2-PLAN.md` 的 Gate 0 → Gate 1 顺序继续。
