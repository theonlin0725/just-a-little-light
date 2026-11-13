# 关卡审查与验证记录

| 文件 | 内容 |
| --- | --- |
| [LEVEL-AUDIT.md](LEVEL-AUDIT.md) | 60 关逐关的机制、可行解区、可达距离、动作向量、保持窗口、相邻相似度 |
| [PLAYTHROUGH-60.md](PLAYTHROUGH-60.md) | 60 关逻辑层 / 交互层 / 真机栏的逐关记录 |
| [LEVEL-EXTENSION.md](LEVEL-EXTENSION.md) | 新增第 61 关的流程、存档兼容与回归清单 |

## 怎么看

- **LEVEL-AUDIT** 由 `node scripts/audit-levels.mjs` 生成，对象是运行时关卡（镜像、压缩、收紧边界之后）。
- **PLAYTHROUGH-60** 里「真机」一栏当时明确写「未测」，不是通过；自动化不能替代真机。
- 审查只能筛出「相似」，不能证明「好玩」；最终仍要人玩。

## 自己跑

```bash
node scripts/audit-levels.mjs      # 重新生成审查表
node scripts/validate-levels.mjs   # 60 关体检（较慢，动态关逐点扫时间窗口）
node tests/playthrough60.test.mjs  # 真实指针事件跑 60 关
```
