# Codex Routing Reference (codex-router-zcode)

> 本文件是 `codex-router` skill 的详细路由矩阵。设计工作流、写委托提示词、
> 或调路由边界时读它。这是路由逻辑的真正载体，`SKILL.md` 只是入口。

> **来源说明**：本矩阵移植自 `jlcbk/codex-router-skill`，后端表已改为
> codex-router-zcode 的**双后端并存**模型（高级后端 + fallback）。

## Contents

- Capability Profile
- Cost Model
- Token And Context Hygiene
- Routing Rules
- Upgrade Rules
- Downgrade Rules
- Dual-Backend Selection
- Subagent Patterns
- Anti-Patterns

## Capability Profile

| 模型 | Cost efficiency | Acceptance reliability | Taste | Throughput | 短标签 |
| --- | ---: | ---: | ---: | ---: | --- |
| GLM | 9 | 6 | 6 | 9 | 默认执行层 |
| Codex | 4 | 9 | 8 | 6 | 专家升级层 |

## Cost Model

委托 Codex 是有成本的。委托前先估算：

```text
expected_cost =
  uncached_input_tokens * input_rate
  + cache_write_tokens * cache_write_rate
  + cache_hit_tokens * cache_hit_rate
  + output_tokens * output_rate
  + expected_retry_cost
  + expected_subagent_cost
```

- **优化"可接受产出的总成本"，不是单次调用价格。**
- **委托前 pilot。** 先让 GLM 做一小片代表样本，再决定是否扩大。
- **Codex 不是"免费"的。** 后台 review gate、循环任务会很快耗光配额。

## Token And Context Hygiene

- 从一个简短的**设计包**开始：目标、约束、owned paths、验收标准、相关文件、
  验证命令、审批门。
- **给 Codex 设计包 + 精确 artifact，不是整个会话。**
- 让 explorer（GLM）返回：事实 + 路径 + 命令输出 + 矛盾点 + 未知项。
- 让 executor 返回：改了哪些文件、验收运行及结果、blocker、需要 review 的判断点。
- **独立验证放在 fresh context 里。**

## Routing Rules

- **用 GLM** 做代码探索、批量读取、grep 式调查、日志分诊、确定性变换、按 clear spec 的机械实现。
- **用 Codex** 做模糊架构决策、高风险 review、深度 pre-mortem、跨冲突证据综合、最终仲裁。
- **路由到能通过验收的最便宜模型。**
- 当不确定时**先用 GLM 做一版**。
- **只升级需要升级的那部分。** Codex 可以决定方案、仲裁冲突，然后把执行**降级**回去。

## Upgrade Rules

- **GLM → Codex**：执行大体正确但 taste、API 形态、措辞、可维护性不够好。
- **GLM → Codex**：失败是**核心推理**——模糊规划、无法 hold 住整个系统、多文件耦合分析。
- **升级时必须记录**：什么模型尝试了 / 漏了哪个验收标准 / 证据 / Codex 该做什么 / 预算上限。

## Downgrade Rules

硬决策做完后降级，把执行交回去：

- **Codex → GLM**：Codex 给出架构/方案/根因后，机械实现、测试生成、格式化交回 GLM。
- 只有当 Codex 的执行质量**也**明显优于 GLM、且差异值得 token 成本时，才让 Codex 一路执行到底。

降级不是降级模型能力，是**降级 token 消耗**。

## Dual-Backend Selection

codex-router-zcode 提供两个 Codex 执行后端，并存互补：

### 高级后端（默认推荐）

走 OpenAI codex-plugin-cc 的 codex-companion 运行时（经 ZCode 适配）：

- **实现 / rescue**：`/codex:rescue`（经 `codex-rescue` 子 agent 或主会话命令）
  - 支持后台任务：`/codex:rescue --background ...`
  - 支持 resume：`/codex:rescue --resume ...`（续接上次 Codex 会话）
- **review（read-only 第二意见）**：
  - `/codex:review`（当前未提交改动，或 `--base main` 分支对比）
  - `/codex:adversarial-review <焦点文本>`（可质疑的对抗式审查）
- **管理**：`/codex:status`、`/codex:result`、`/codex:cancel`、`/codex:setup`
- **会话交接**：`/codex:transfer`（ZCode 摘要式，非原生 resume thread）

特点：常驻 app-server broker（高效）、后台 job 管理、结构化 review 输出、resume。

### fallback 后端（可选，需单独安装 codex-router-skill）

走 `codex-engineer` 子 agent 直接 `codex exec`：

```bash
# 实现
codex exec --json --ephemeral -s workspace-write -C "$(pwd)" "$(cat /tmp/codex-task.md)"
# review
codex exec --json --ephemeral -s read-only -C "$(pwd)" "$(cat /tmp/codex-task.md)"
```

特点：每次起新进程、无状态、到处能跑、最轻。

### 选型决策

| 任务特征 | 推荐 |
| --- | --- |
| 需要 resume（续接上次 Codex 工作） | 高级后端 |
| 后台长任务 | 高级后端（`--background`） |
| 结构化 / 对抗式 review | 高级后端（`/codex:review` / `/codex:adversarial-review`） |
| 跨文件重构、rescue | 高级后端 |
| 一次性硬任务、做完拉倒 | 两者皆可；fallback 更轻 |
| 无网络、最简环境、`codex-engineer` 已装 | fallback |
| 不确定 | 默认高级后端 |

## Subagent Patterns

### GLM Explorer

```text
Use GLM for this subtask.
Goal: 为 [问题] 收集证据。
Scope: 只读 [路径]。不修改文件。
Output: 关键事实 + 文件路径 / 命令输出 + 未知项 + 适合 Codex review 的 token-light 证据包。
```

### GLM Executor

```text
Use GLM for this subtask.
Goal: 在 [owned paths] 内实现 [clear spec]。
Output: 改了哪些文件 + 验收运行及结果 + 需要 Codex review 的判断点 + 后续成本风险。
```

### Codex Peer Engineer

```text
Use Codex for this subtask.
Goal: 对 [问题 / 设计 / 改动] 给出独立 senior-engineering pass。
Input: 用和 GLM executor 同样的目标、约束、验收标准、压缩证据包。
Output: 推荐路径或 patch plan + 风险 + 与证据的一致/冲突点。
```

调用方式按双后端选型（见上节）：高级后端走 `/codex:rescue` 或 `/codex:review`；
fallback 走 `codex exec`。

## Anti-Patterns

- 任务还没框清楚、证据还没收集就让 Codex 上场。
- 让 Codex 读 GLM 本可以先压缩的大段代码区域。
- **把 Codex 当橡皮图章 reviewer**，而不是有独立判断的同侪。
- **默认任何任务都走 Codex**——违背省 Codex token 的核心目标。
- **升级后不记录**"漏了什么、Codex 该改什么"。
- 用这套多 agent 模式做简单 CRUD 或一次性编辑，编排开销比节省的多。
