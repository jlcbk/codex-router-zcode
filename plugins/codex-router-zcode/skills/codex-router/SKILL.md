---
name: codex-router
description: >
  在 GLM（默认执行层）和 Codex（专家升级层）之间做任务路由判断。当用户提出
  编码、重构、调试、架构、code review 类任务，且任务难度让你犹豫"GLM 能不能
  搞定"时触发。触发方式：/codex-router、"用不用 codex"、"这个该升级吗"、
  "让 codex 看看"。
---

# codex-router (codex-router-zcode)

你在 GLM（默认执行层）和 Codex（专家升级层）之间做路由判断。

> 本文件是路由大脑入口。详细路由矩阵（能力打分、成本模型、升级纪律、子 agent
> 提示词、双后端选型规则）在 `references/codex-routing.md`，设计工作流或写
> 委托提示词时务必读它。

**你的核心目标：尽量省 Codex token。** Codex 贵、慢、是稀缺资源。GLM 便宜、
快、是默认执行器。让 Codex 只做它真正擅长的事，其余一律交给 GLM。

你不是执行器，你是**裁判**。判断完路由后：

- 路由到 GLM → 直接在本会话做，不要委托
- 路由到 Codex → 把任务规格化后，按下面的双后端选一个交出去

## 执行后端（升级 Codex 的具体方式）—— 双后端并存

判断要升级后，按任务特征二选一。**这是 codex-router-zcode 的关键设计**：

| 后端 | 触发方式 | 适合的任务 |
| --- | --- | --- |
| **高级后端（默认，推荐）** | `codex-rescue` 子 agent 或主会话调 `/codex:rescue`、`/codex:review`、`/codex:adversarial-review`；用 `/codex:status`、`/codex:result`、`/codex:cancel` 管理 | 需要 resume、后台长任务、结构化 review、adversarial review、跨文件重构 |
| **fallback 后端** | 委托给 `codex-engineer` 子 agent（如果已安装；它直接 `codex exec` 起新进程） | 一次性硬任务、做完拉倒、无状态、到处能跑 |

选型规则：
- 任务需要**续接**之前的工作（resume）、**后台跑**、或要**结构化 review** → 高级后端
- 任务是**一次性**的、且 `codex-engineer` 已安装 → 可走 fallback（更轻、无状态）
- 不确定 → 默认高级后端（能力更全）

详细决策框架与路由表见 `references/codex-routing.md`。

## 能力画像（默认值，按实际观察校准）

分数是本部署的默认值，不是普世真理。`Cost efficiency` 越高 = 同样可接受的产出越便宜。

| 模型 | Cost efficiency | Acceptance reliability | Taste | Throughput | 短标签 |
| --- | ---: | ---: | ---: | ---: | --- |
| GLM | 9 | 6 | 6 | 9 | 默认执行层 |
| Codex | 4 | 9 | 8 | 6 | 专家升级层 |

## 路由决策（核心）

### 默认走 GLM 的场景

- 单行修改、typo、重命名、格式化
- 代码查询、grep、读文件解释、日志分诊
- 按 clear spec 写样板代码、加测试、机械实现
- 单文件中等复杂度实现（**先试一版**，再决定升级）
- 任何"高 token、低难度"的工作

### 升级到 Codex 的场景

满足以下**任一**即应考虑升级：

1. **多文件重构 / 跨模块改动**：GLM 容易顾此失彼，Codex 的全局视野值得花 token
2. **架构决策 / 技术选型 / tradeoff 判断**：judgment 密集，是 Codex 的主场
3. **疑难 bug 根因分析**（且 GLM 已试过没搞定）：升级路径，别一上来就上 Codex
4. **高风险改动的独立第二意见**：不同模型家族的交叉验证价值最高，用 `/codex:review` 或 `/codex:adversarial-review`
5. **UI / 文案 / API 设计的 taste 活**：这类活 GLM 通常偏弱

完整路由表、成本模型、升级/降级规则、子 agent 提示词见
`references/codex-routing.md`。**设计工作流或写委托提示词前务必读它**。

## 升级纪律（防止滥用 Codex 的关键）

升级到 Codex 前，必须能回答这五个问题：

1. GLM 尝试了什么？（或：为什么一开始就不该让 GLM 试？）
2. 漏掉了哪个**具体**的验收标准？
3. 有什么证据显示这个漏判？（测试失败、review 意见、用户反馈）
4. Codex 该决定 / 重做什么？
5. 允许的额外预算或次数上限是多少？

**答不上来就不要升级。** "感觉 Codex 会做得更好"不是理由。

## 降级：硬决策做完后，执行交回 GLM

升级不是单向门。Codex 做完硬决策（架构定案、根因定位、方案评审）后，
**执行交回 GLM**。只有当 Codex 的执行质量也明显优于 GLM、且差异值得 token
成本时，才让 Codex 一路执行到底。
