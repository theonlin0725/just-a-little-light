# 新增关卡：改动点与流程

> 本轮只预留扩展点，**没有新增第 61 关，也没有改动已确认的 60 关布局**。

## 1. 已经预留好的东西

| 能力 | 位置 | 说明 |
|---|---|---|
| 稳定 ID | `levels.js` 每关 `id` | 追加时 ID 递增，已有关卡不重排 |
| 内容版本 | `src/content.js` `CONTENT_VERSION` | 与程序版本分开记录 |
| 关卡存取 | `content.js` `levelCount / levelAt / levelById / indexOfLevelId` | UI 不再依赖字面量 60 |
| 内容自检 | `content.js` `checkContent()` | ID 必须唯一且连续，错位会报出来 |
| 教学配置 | `src/tutorial.js` `MECHANICS` | 按"机制首次引入关"显示，新增机制只加一条 |
| 存档兼容 | `src/game.js` `normalize()` | 按序号存 `unlocked`，按 ID 存成绩 |

`npm run validate` 会跑 `checkContent()` 的等价检查（ID/序号一致性）。

## 2. 新增一关的步骤

1. **设计**：在 `scripts/gen-levels.mjs` 的 `RECIPES` 末尾追加一条配方
   （水晶位置/哪盏灯、解位置 `L`、挡板、移动物、`margin`）。
2. **教学**：如果引入了**新的操作或判定规则**，在 `src/tutorial.js` 里加一条
   `{ id, first: <新关号>, text }`；只是组合已有机制则不要加。
3. **生成**：`npm run gen`（= `node scripts/gen-levels.mjs --write`）。
4. **校验**：`npm run validate`，确认：
   - 新关有解、开局不自动通关、解区在 1.4k~62% 之间；
   - 旧 36/60 关的数据**没有变化**（用 `git diff src/levels.js` 看，应该只多出新条目）。
5. **回归**：`npm test`（含 60 关可通关、存档迁移）。
6. **版本**：把 `src/content.js` 的 `CONTENT_VERSION` 改成新值（例 `2026-11-20.66`）。
7. **构建**：`npm run build:wechat` → `npm run verify:wechat`。
8. **体验版**：上传 → 设体验版 → 你自测 → 提审。

### 确认旧关卡没变

```sh
git diff --stat src/levels.js     # 只应有新增行
npm run validate                  # 旧关卡的解区数字应与上次一致
```

## 3. 存档与解锁

- `unlocked` 是**序号**：通关第 60 关（index 59）后 `unlocked = 60`，追加第 61 关后
  `isUnlocked(60) === true`，老玩家直接可玩新关。
- 成绩存在 `best[<levelId>]`，按 ID 索引，追加关卡不影响旧成绩。
- 旧存档里可能 `unlocked` 落后于已通关记录，`normalize()` 会用"已通关最高 ID"兜底修正。

### 回归测试（必须补充）

```js
// tests/features.test.mjs 里已有类似断言，加关后补一条：
ok(LEVELS.length === 61, '关卡总数为 61');
// 老存档：通关 60 关的玩家能进第 61 关
store['projection.save.v3'] = JSON.stringify({ unlocked: 60, best: { 60: { time: 20 } } });
const g = new Game();
ok(g.isUnlocked(60), '第 61 关自动解锁');
```

## 4. 内容版本与线上定位

- 包内日志启动时打印 `v1.1.0 content=2026-10-25.60 levels=60 build=<buildId>`；
- `wechat/build-info.json` 记录同一份信息；
- 用户反馈"第 61 关有问题"时，先要 `buildId`，确认他跑的是哪个包。

## 5. 什么情况下才需要远程关卡

只有同时满足才考虑：

- 关卡数量/体积大到主包放不下（当前 86 KB，离 4 MB 很远）；
- 需要不发版就更新内容。

届时需要额外评估：小程序允许的下载域名、内容签名与 schema 校验、缓存与失败回退。
**本轮不引入远程内容平台**，也不通过远程脚本绕过审核。
