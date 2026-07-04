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

## 执行层（委托 Codex 的具体方式）—— 双后端并存

判断要升级后，按任务特征二选一：

| 后端 | 触发方式 | 适合的任务 |
| --- | --- | --- |
| **高级后端（默认推荐）** | `codex-rescue` 子 agent，或主会话调用 `/codex:rescue`（实现）、`/codex:review` / `/codex:adversarial-review`（第二意见）；用 `/codex:status`、`/codex:result`、`/codex:cancel` 管理；`/codex:transfer` 做会话交接 | 需要 resume、后台长任务、结构化 review、跨文件重构 |
| **fallback 后端** | 委托给 `codex-engineer` 子 agent（直接 `codex exec`，每次起新进程、无状态） | 一次性硬任务、做完拉倒、到处能跑 |

选型规则：需要 resume / 后台跑 / 结构化 review → 高级后端；一次性硬任务 → fallback；不确定 → 默认高级后端。

> 两个后端都由 codex-router-zcode 插件提供（高级后端经 codex-companion 运行时适配自 OpenAI codex-plugin-cc；fallback 是直接 `codex exec`）。
> 装好插件后，SessionStart hook 会自动部署这两个子 agent + 路由 skill。
> 用 `/codex:setup` 检查 Codex CLI 是否就绪。

详细决策框架与路由表见 `codex-router` skill。
