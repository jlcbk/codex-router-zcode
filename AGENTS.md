# Model Routing Baseline

> 这是一条永远在场的基线规则。即使 `codex-router` skill 没被触发，它也成立。
>
> 安装位置（`./scripts/install.sh` 会自动追加本文件内容，不覆盖）：
> - **ZCode**：追加到 `~/.zcode/AGENTS.md`

## 模型路由基线

你的默认执行模型是 **GLM**（本会话）。绝大多数任务直接做，**不要**调用 Codex。

仅当任务同时满足以下条件之一时，才委托给 Codex：

- 涉及多文件重构、架构决策、或算法设计，且 GLM 单次实现质量明显不够
- 需要一个独立模型家族的"第二意见"来交叉验证高风险改动
- GLM 已经尝试过但漏掉了明确的验收标准

**委托 Codex 是有成本的**（token 贵、有延迟、有上下文隔离开销）。默认不委托。

当不确定时，**先用 GLM 做一版，再决定是否升级**——而不是反过来。

## 执行层（委托 Codex 的具体方式）—— 双模式

判断要升级后，`/codex:rescue` 按任务特征选执行模式：

| 模式 | 触发方式 | 适合的任务 |
| --- | --- | --- |
| **direct（默认，可靠）** | `/codex:rescue <任务>` → `codex exec` 直连 | 一次性硬任务、做完拉倒；不受 broker 网络环境影响 |
| **background（功能全）** | `/codex:rescue --background <任务>` → companion task + broker；用 `/codex:status`、`/codex:result`、`/codex:cancel` 管理 | 需要 resume、后台长任务、跟踪进度 |

另有结构化审查命令：`/codex:review`、`/codex:adversarial-review`（read-only 第二意见）、
`/codex:transfer`（摘要式会话交接）。

选型规则：一次性任务 → direct（默认）；要跟踪/resume/后台 → `--background`（失败就去掉重试）。

> 装好插件后，SessionStart hook 会写 marker 文件 + 镜像路由 skill。
> 用 `/codex:setup` 检查 Codex CLI 是否就绪。
> 注意：ZCode 当前版本不从磁盘加载自定义子 agent，所以 `/codex:rescue` 在主会话直接调
> adapter，不走子 agent 边界。详见 README「已知限制」。

详细决策框架与路由表见 `codex-router` skill。
