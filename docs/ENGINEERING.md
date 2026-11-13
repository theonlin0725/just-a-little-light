# 工程说明：一套逻辑，两个平台

> 这份文档写给想看实现的人。设计判断在 [设计手记](DESIGN.md)，迭代过程在 [迭代日志](ITERATION.md)。

## 1. 总览

```
                 ┌──────────────────────────────┐
                 │  src/levels.js （脚本生成）   │
                 └──────────────┬───────────────┘
                                │
   scripts/gen-levels.mjs ──────┘ 先定解、反推挡板、校验
                                │
                 ┌──────────────▼───────────────┐
                 │ src/levels-live.js            │
                 │ 镜像 1–24 / 收紧范围 / 命名   │
                 └──────────────┬───────────────┘
                                │
   ┌────────────────────────────┼────────────────────────────┐
   │                            │                            │
┌──▼──────────┐          ┌──────▼───────┐          ┌─────────▼────────┐
│ geometry.js │          │   game.js    │          │    render.js     │
│ 投影/遮挡    │◄────────►│ 状态机/判定   │─────────►│ Canvas 绘制      │
└─────────────┘          └──────┬───────┘          └──────────────────┘
                                │
                 ┌──────────────┼──────────────┐
                 │              │              │
          ┌──────▼─────┐ ┌──────▼─────┐ ┌─────▼──────┐
          │ platform.js│ │  clock.js  │ │  ads.js    │
          │ 浏览器/微信 │ │ 视觉时间    │ │ 激励视频    │
          └────────────┘ └────────────┘ └────────────┘
```

**核心原则**：游戏逻辑、几何、关卡、渲染、教学、存档语义全部共用；平台差异只在 `platform.js`、`main-wx.js`、`ads.js` 里。

## 2. 四套坐标，各管一件事

这是项目里最容易出 bug 的地方，所以单独拆开：

| 坐标 | 范围 | 用途 |
| --- | --- | --- |
| 世界坐标 | 720×1280 | 关卡、投影、遮挡、判定；墙是竖的 |
| 玩法带坐标 | 720×448（随内容变） | 世界旋转 90° 后投到屏幕上的区域 |
| CSS 坐标 | 视口宽高 | 触摸、按钮命中 |
| Canvas 物理像素 | CSS × DPR | 实际绘制 |

变换链：

```
世界 --(旋转/缩放/平移)--> 玩法带 --(viewport)--> CSS --(DPR)--> 物理像素
```

- `layout.js`：`sceneToScreen` / `screenToScene`，只负责旋转和玩法带。
- `viewport.js`：`computeLayout` / `toLogical` / `drawTransform`，只负责 CSS / backing store。
- 输入：先判断是否落在玩法带内，再逆变换回世界坐标；底部按钮仍用 CSS 坐标。

**测试**：`tests/layout.test.mjs` 覆盖坐标往返、带内命中、方向映射；`tests/viewport.test.mjs` 覆盖 DPR / 安全区 / 缩放。

## 3. 几何：影子不是按中心点算的

`geometry.js` 里几个关键函数：

| 函数 | 作用 |
| --- | --- |
| `projectToWall(L, P, wallX)` | 右墙投影（光源在墙左边） |
| `projectToWallL(L, P, wallX)` | 左墙投影（光源在墙右边） |
| `clipMaxX` / `clipMinX` | 按光源位置裁多边形，避免投影穿过光源 |
| `shadowIntervalOn(L, poly, wallX)` | 按墙的位置自动分派左右投影，返回影子区间 |
| `castRay` / `isVisible` / `rayEnd` | 点是否被挡板挡住、光束画到哪里 |
| `moverPoly` / `pathPoint` | 移动障碍在时刻 t 的形状与位置 |

**三个坑**（都写进了 README 和测试）：

1. **挡板必须够深。** 右侧关前沿 `x >= 330`，否则光源能溜到挡板和墙之间，所有水晶同时可见。双侧关把可拖拽区夹在 `x ∈ [150, 470]`，钻不进墙缝。
2. **影子不能按中心点算。** 一端来自近边上角、另一端来自远边下角，两侧放大倍率能差 20%，必须四角分别投影取极值。
3. **左侧投影是反的。** 左墙在光源左边，要按 `x <= L.x` 裁多边形、用左向投影；右墙反而返回 null。

## 4. 状态机：3 秒怎么算

`game.js` 的 `Game` 是唯一状态源。关键状态：

```
title → play → win → levels
         │
         ├─ hint / skins / ad / pause
         └─ remove 模式
```

**持续判定**

```
每帧：
  allLit = 所有水晶都满足（同时、指定灯、双灯同照）
  if allLit: holdTime += dt
  else:      holdTime = 0
  if holdTime >= 3: win()
```

要点：

- `holdTime` 只在 `allLit` 时增长；任一水晶熄灭立即归零，不累计。
- 面板、选关、广告、切后台时 `dt = 0`，不是「暂停后补算」。
- 通关只触发一次；结算后停止计时。
- 低帧率下用固定步长推进（`loop.js`），保证累计仿真时间等于真实时间。

**双光源**

- 每个水晶记录它需要的灯（`lights: [0]` 或 `[0,1]`）。
- 双灯同照的水晶要所有指定灯都可见；界面上用 1/2 标记和两个小点表达。
- 点哪盏拖哪盏；被选中的外圈会转。

**双侧**

- 水晶分 `side: 'l' / 'r'`，各自用对应的墙和投影。
- 判定不分别计时：必须同一个 3 秒窗口里全部满足。

## 5. 关卡流水线

### 5.1 生成

`scripts/gen-levels.mjs`：

1. 配方（RECIPES）给出水晶、解 `L*`、挡板候选、移动物参数；
2. 反推每块挡板的 y，让影子落进缝；
3. 移动障碍在「缩放 × 上下平移」里搜，保留 ≥4.2 秒干净窗口；
4. 起始位置必须开局凑不出 3 秒；
5. 写入 `src/levels.js`。

**不要手改 `levels.js`**：它是生成产物；改配方，再 `npm run gen`。

### 5.2 校验

`scripts/validate-levels.mjs` 逐关检查：

- 解区非空、起点可达；
- 开局不会自动通关；
- 解区面积在合理区间；
- 动态关的时间窗口；
- 距离挑战关的参考距离复算。

### 5.3 审查

`scripts/audit-levels.mjs` 输出 `docs/audit/LEVEL-AUDIT.md`：

- 机制标签；
- 可行解区（6px 网格 + 3 秒判定，最大连通区）；
- 可达距离（BFS）；
- 动作向量（起点 → 解区中心）；
- 保持窗口；
- 相邻相似度（余弦 + 中心距离）。

审查对象是**运行时关卡**，不是原始数据。镜像、压缩、收紧边界都会改变实际可玩空间。

### 5.4 测试

`tests/` 共 14 个文件，471 项断言：

| 文件 | 覆盖 |
| --- | --- |
| `hold.test.mjs` | 持续判定、距离、60 关可通关 |
| `features.test.mjs` | 双侧、移除、皮肤、广告回调、存档迁移、选关、底栏、教学 |
| `playthrough60.test.mjs` | 60 关真实指针通关（BFS 绕障） |
| `mirror.test.mjs` | 1–24 镜像等价、25–60 不变 |
| `layout.test.mjs` | 旋转坐标往返、玩法带、方向映射 |
| `viewport.test.mjs` | DPR、安全区、缩放 |
| `clock.test.mjs` | 毫秒→秒、30/60/120fps 相位一致 |
| `loop.test.mjs` | 固定步长、低帧率不拖慢 3 秒 |
| `timing.test.mjs` | 计时边界 |
| `nudge.test.mjs` | 灯泡引导状态机与频控 |
| `wx-ad.test.mjs` | 激励视频状态机（模拟 wx） |
| `input-wx.test.mjs` | 微信触摸状态机 |
| `stability.test.mjs` | 故障注入、音频隔离 |
| `compat.test.mjs` | 平台兼容 |

**关键断言**

- 0.5 秒、2.9 秒不通关；超过 3 秒通关。
- 中断后进度归零，重新满足不累计。
- 60 关在设计解位置都能通关；0 关开局自动通关。
- 四款皮肤下，同一操作的亮灭序列完全一致。
- 广告期间冻结计时；切关作废旧回调；取消/未看完不发奖。
- 旧存档（36 关）迁移到 60 关时，不会卡在第 37 关。

## 6. 微信小游戏

**入口**：`src/main-wx.js` → esbuild 打包成 `wechat/game.js`。

**平台差异**

| 能力 | 浏览器 | 微信 |
| --- | --- | --- |
| 画布 | DOM canvas | `wx.createCanvas()`（第一个为上屏画布） |
| 触摸 | PointerEvent | `wx.onTouchStart/Move/End/Cancel` |
| 前后台 | `visibilitychange` | `wx.onHide/onShow` |
| 存档 | `localStorage` | `wx.setStorageSync` |
| 音频 | `AudioContext` | `wx.createWebAudioContext()`，不支持则静音 |
| 广告 | 4.5 秒模拟播放器 | `wx.createRewardedVideoAd` |
| 分享图 | 下载 PNG | 存相册 |
| 视口 | `innerWidth/Height` + DPR | `getWindowInfo` + 安全区 + 胶囊 |

**构建**

```bash
npm install
npm run build:wechat   # → wechat/（release）+ wechat-dev/（QA）
npm run verify:wechat  # 静态校验：包结构、buildId、sha256、QA 入口、AppID
```

- `wechat/`：约 108 KB，QA 入口已剔除，导入开发者工具/上传用这个。
- `wechat-dev/`：约 190 KB，带跳关/解锁/模拟奖励，只用于自测，不要上传。
- 构建会写入 `build-info.json`（buildId、sha256、bytes、appid、channel）。
- 空 `adUnitId` 时不会创建广告实例，避免无谓报错。

**已知平台差异**

- iOS 用 PingFang SC，Android 用系统字体；标题的衬线字体在 Android 上可能回退。
- `shadowBlur` 在低端 Android 上可能很慢；掉帧时优先降级光晕，不动几何判定。
- 基础库 < 2.19 没有 `createWebAudioContext`，音效自动静音，玩法不受影响。

## 7. 性能与稳定性

- **固定步长**：`loop.js` 把一帧切成 ≤1/60 秒的步，追不上时用 ≤1/30 秒的粗步补齐；单帧最多认领 0.5 秒，防止长时间卡顿后一次补太多。
- **视觉时钟**：`clock.js` 只用秒，单帧限幅 50ms，后台/暂停冻结；避免毫秒当秒导致相位爆炸。
- **画质档位**：`quality.js` 的 `safe/standard/high` 控制阴影、拖尾、光束、尘埃；先保证 30fps。
- **错误边界**：`main-wx.js` 对 update/draw 分阶段保护；渲染失败时回退最小绘制，并保留错误码/重试入口。
- **主线程**：提示求解在难点关可能约 180ms；后续会分片/缓存。

## 8. 已知问题

| 问题 | 影响 | 计划 |
| --- | --- | --- |
| 提示求解同步扫描 | 第 59/60 关可能卡 180ms | 预计算候选 + 分片 |
| 双光源关相似度指标不足 | 25–36、38–53 只人工筛查 | 增加「双灯分工」指标 |
| 光源贴边光晕被裁 | 第 8 关最明显 | 加绘制边距 |
| 真实广告未联调 | 收入为 0 | 配置 adUnitId 后真机验证 |
| 无云存档/排行榜 | 换机丢进度 | v1.3 评估 |

## 9. 文件地图

```
index.html            画布容器（浏览器入口）
server.mjs            零依赖静态服务器
src/
  config.js           画面、墙、可拖拽区、3 秒判定
  levels.js           60 关数据（生成产物）
  levels-live.js      运行时：镜像 1–24、收紧边界
  geometry.js         投影、线段求交、影子区间、移动物
  game.js             状态机
  render.js           全部 Canvas 绘制
  layout.js           旋转与玩法带
  viewport.js         CSS / DPR / 安全区
  clock.js            视觉时钟
  loop.js             固定步长
  fit.js              按内容收紧范围
  mirror.js           镜像纯函数
  skins.js            皮肤数据
  ads.js              激励视频（simulated / wx）
  audio.js            WebAudio 合成
  share.js            分享卡绘制
  platform.js         平台差异
  main.js             浏览器入口
  main-wx.js          微信入口
scripts/
  gen-levels.mjs      关卡生成
  validate-levels.mjs 60 关体检
  audit-levels.mjs    解法相似度审查
  build-wechat.mjs    微信构建
  verify-wechat.mjs   微信包静态校验
  run-wx-harness.mjs  微信 API 替身自测
tests/                471 项断言
wechat/               微信正式构建产物
```
