# Codex Routing Reference (codex-router-zcode)

> 本文件是 `codex-router` skill 的详细路由矩阵。设计工作流、写委托提示词、
> 或调路由边界时读它。这是路由逻辑的真正载体，`SKILL.md` 只是入口。

> **来源说明**：本矩阵移植自 `jlcbk/codex-router-skill`，后端表已改为
> codex-router-zcode 的**双模式**模型（direct 默认 + background 功能全）。

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

## Dual-Mode Selection (direct vs background)

codex-router-zcode 的 `/codex:rescue` 提供两种执行模式，互补使用：

### direct 模式（默认，可靠）

走 `codex exec` 直连，不经 app-server broker。由 `/codex:rescue` 命令体在主会话直接调
adapter 的 `task-direct` 子命令实现。

- **触发**：`/codex:rescue <任务描述>`
- **特点**：不受 broker 网络环境影响（如 TLS MITM 代理拦 chatgpt.com 时仍能工作，
  重试后常握手成功）；无 job 跟踪、无 resume、无后台
- **适合**：一次性硬任务、做完拉倒

### background 模式（功能全）

走 OpenAI codex-plugin-cc 的 codex-companion 运行时 + app-server broker：

- **触发**：`/codex:rescue --background <任务描述>`
- **支持**：后台任务、resume（`/codex:rescue --resume ...`）、`/codex:status`、
  `/codex:result`、`/codex:cancel`
- **特点**：常驻 broker（高效）、job 管理、结构化输出；但依赖 broker 长连接稳定
- **适合**：需要跟踪进度、续接、后台跑的长任务

### 独立的审查命令（不受 dual-mode 影响）

- `/codex:review`（当前未提交改动，或 `--base main` 分支对比；read-only）
- `/codex:adversarial-review <焦点文本>`（可质疑的对抗式审查）
- `/codex:setup` 检查就绪；`/codex:transfer` 摘要式会话交接

### 选型决策

| 任务特征 | 推荐 |
| --- | --- |
| 一次性硬任务、做完拉倒 | direct（默认） |
| broker 网络环境不稳/未知 | direct（默认） |
| 需要 resume（续接上次 Codex 工作） | background（`--background`） |
| 后台长任务、要跟踪进度 | background（`--background` + `/codex:status`） |
| 结构化 / 对抗式 review | `/codex:review` / `/codex:adversarial-review`（独立命令） |
| 不确定 | direct（默认）；失败了换 background 或反之 |

> **ZCode 子 agent 限制**：ZCode 当前版本不从磁盘加载自定义子 agent，所以 `/codex:rescue`
> 在主会话直接调 adapter（不经子 agent 边界）。background 模式的 job 隔离由 companion job
> store 提供。仓库里的 `agents/*.md` 供参考和未来 ZCode 支持。

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

调用方式按双模式选型（见上节）：默认 `/codex:rescue` 走 direct（`codex exec` 直连）；
要后台跟踪/resume 加 `--background`；read-only 审查走 `/codex:review` / `/codex:adversarial-review`。

## Anti-Patterns

- 任务还没框清楚、证据还没收集就让 Codex 上场。
- 让 Codex 读 GLM 本可以先压缩的大段代码区域。
- **把 Codex 当橡皮图章 reviewer**，而不是有独立判断的同侪。
- **默认任何任务都走 Codex**——违背省 Codex token 的核心目标。
- **升级后不记录**"漏了什么、Codex 该改什么"。
- 用这套多 agent 模式做简单 CRUD 或一次性编辑，编排开销比节省的多。
