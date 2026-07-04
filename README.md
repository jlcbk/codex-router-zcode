# codex-router-zcode

> 在 **GLM（ZCode 默认执行层）** 和 **Codex（OpenAI 专家升级层）** 之间自动路由任务，
> 并提供从 ZCode 直接调用 Codex 的完整命令集——装一个拿全部。
>
> 目标：**尽量省 Codex token**——让贵的 Codex 只做硬活，便宜快速的 GLM 承担绝大多数任务；
> 真要上 Codex 时，又能用到后台任务、resume、结构化 review 这些高级能力。

---

## 这是什么

一个 **ZCode 专用** 的自包含路由器 + Codex 执行后端。它把两样东西合进一个插件：

1. **路由大脑**（移植自 [`jlcbk/codex-router-skill`](https://github.com/jlcbk/codex-router-skill)）
   — 路由表、能力打分、成本模型、升级/降级纪律、**可调比例 profile**。决定"这个任务
   该用 GLM 还是 Codex"。

2. **执行管道**（适配自 [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) v1.0.5）
   — `/codex:rescue`、`/codex:review` 等命令 + 后台 job + resume + app-server broker。
   解决"怎么从 ZCode 把 Codex 跑起来"。

### 两模型世界

- **GLM** 是默认执行层——便宜、快速，承担绝大多数任务。
- **Codex** 是专家升级层——贵、慢、稀缺，只在硬任务上按需调用。

原则一句话：**用能稳定通过验收的最便宜模型，只在便宜模型漏掉具体标准时才升级。**

## 平台支持

- ✅ **macOS**（实测）
- ✅ **Linux**（代码层可移植：纯 `node`、所有路径用 `path.join(os.homedir(), ...)`、
  sqlite 用 Node 22+ 内置 `node:sqlite`，无原生模块依赖）
- ❌ **Windows** 不支持（codex-plugin-cc 上游有 sandbox runner bug：
  [openai/codex#30839](https://github.com/openai/codex/issues/30839)）

需要 **Node.js 18.18+**（`/codex:transfer` 的摘要式交接需要 22+ 的 `node:sqlite`）。

## 前置依赖

- **ZCode**
- **Codex CLI**，并已完成登录：
  ```bash
  codex --version          # 确认已安装
  codex login              # 或在 ~/.codex/config.toml 配 API key
  ```

## 安装

### 1. 克隆（含 submodule）

```bash
git clone --recurse-submodules https://github.com/jlcbk/codex-router-zcode.git
cd codex-router-zcode
```

> 若已扁平克隆，补 submodule：`git submodule update --init --recursive`

### 2. 安装插件（提供 /codex:* 命令 + 子 agent + 路由 skill）

ZCode → **Settings → Plugin Management → Discover → `+`** → 选本地目录 → 指向本仓库根
（含 `marketplace.json` 的目录）→ Install `codex-router-zcode`。

### 3. 安装路由策略（写入 ~/.zcode/AGENTS.md 的永远在场的基线 + profile）

```bash
./scripts/install.sh                          # 默认 savings profile
./scripts/install.sh --profile balanced       # 换一档
```

### 4. 重启 ZCode 会话

SessionStart hook 会自动：写插件根路径 marker、部署 `codex-rescue` +
`codex-engineer` 子 agent、镜像 `codex-router` skill。

### 5. 验证

新开会话，跑：

```
/codex:setup
```

应报告 Codex CLI 就绪、登录有效。

## 路由 profile（可调比例机制）

`install.sh --profile <档>` 把一段"软比例目标 + Codex 门禁 + 升级规则"写进
`~/.zcode/AGENTS.md`，用 marker 块隔离，可幂等更新：

| Profile | 软比例 (GLM/Codex) | 适合场景 |
| --- | --- | --- |
| `glm-only` | 100% / 0% | 几乎不用 Codex，除非用户明确要求 |
| `savings`（默认） | 90-95% / 5-10% | Codex 只做已验证的硬/高风险活 |
| `balanced` | 75-85% / 15-25% | 复杂任务更早请 Codex 做 plan/review |
| `quality` | 60-70% / 30-40% | taste/risk 密集项目，多花 token 换质量 |
| `codex-heavy` | 40-60% / 40-60% | 短期冲刺，质量/独立性优先于成本 |

**比例是审计目标，不是硬性随机比例。** 永远不要为了凑比例把简单任务交给 Codex。
当前任务里的用户明确指令优先于 profile。

## 双后端并存

路由判断"要升级 Codex"后，按任务特征二选一：

| 后端 | 触发方式 | 适合的任务 |
| --- | --- | --- |
| **高级后端（默认推荐）** | `/codex:rescue`、`/codex:review`、`/codex:adversarial-review`；`/codex:status`、`/codex:result`、`/codex:cancel` 管理；`/codex:transfer` 交接 | 需要 resume、后台长任务、结构化 review、跨文件重构 |
| **fallback 后端** | `codex-engineer` 子 agent（直接 `codex exec`，每次起新进程、无状态） | 一次性硬任务、做完拉倒、到处能跑 |

选型：需要 resume / 后台跑 / 结构化 review → 高级后端；一次性硬任务 → fallback；
不确定 → 默认高级后端。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `/codex:setup` | 检查 Codex CLI 是否就绪 |
| `/codex:review [--base <ref>] [--background]` | 对当前改动跑结构化代码审查（read-only） |
| `/codex:adversarial-review [焦点文本]` | 可质疑的对抗式审查（挑战设计决策） |
| `/codex:rescue [任务描述]` | 把任务交给 Codex（`--background`、`--resume`、`--model`、`--effort`） |
| `/codex:status [job-id]` | 查看 Codex 任务状态 |
| `/codex:result [job-id]` | 取回已完成任务的完整输出 |
| `/codex:cancel [job-id]` | 取消后台任务 |
| `/codex:transfer` | 把当前 ZCode 会话作为摘要喂给一个**新** Codex 会话（见下） |

也可通过 `/codex-router` skill 触发路由判断，或直接说"用不用 codex"、"让 codex 看看"。

## 路由表速览

| 任务特征 | 路由到 |
| --- | --- |
| 单行修改、查询、解释、格式化、grep | GLM |
| 按 clear spec 写样板代码、加测试 | GLM |
| 单文件中等复杂度实现 | GLM（先试，按验收决定升级）|
| 多文件重构、跨模块改动 | **Codex** |
| 架构决策、技术选型、tradeoff 判断 | **Codex** |
| GLM 已试过但漏验收标准的疑难 bug | **Codex** |
| 高风险改动的独立第二意见 | **Codex（read-only review）** |

完整路由矩阵（能力打分、成本模型、升级/降级纪律、子 agent 提示词）见
[`plugins/codex-router-zcode/skills/codex-router/references/codex-routing.md`](plugins/codex-router-zcode/skills/codex-router/references/codex-routing.md)。

## 仓库结构

```
codex-router-zcode/
├── marketplace.json                    # 本地 marketplace（仓库根）
├── AGENTS.md                           # 路由 baseline 源（install.sh 写入 ~/.zcode/AGENTS.md）
├── scripts/install.sh                  # 装 baseline + profile（幂等 marker splice）
└── plugins/codex-router-zcode/         # ZCode 插件包
    ├── .zcode-plugin/plugin.json
    ├── hooks/hooks.json                # SessionStart → bootstrap
    ├── commands/codex/*.md             # 8 个命令（/codex:*）
    ├── agents/{codex-rescue,codex-engineer}.md  # 双后端子 agent
    ├── skills/codex-router/            # 路由大脑（SKILL.md + references/）
    └── scripts/
        ├── bootstrap-session.mjs       # SessionStart：marker + agent/skill 部署
        ├── zcode-adapter.mjs           # 命令体 → codex-companion 桥
        ├── transfer-zcode.mjs          # 摘要式会话交接
        └── vendor/codex-plugin-cc/     # git submodule → openai/codex-plugin-cc v1.0.5
```

## 已知限制

### `/codex:transfer` 是摘要式交接，非可 resume 的 thread

Claude Code 的 `/codex:transfer` 把 live transcript 导入一个可 resume 的 Codex thread。
ZCode 做不到忠实移植，因为：

- ZCode 不向会话暴露 transcript path（不像 Claude 的 `transcript_path`）
- 主交互会话没有 JSONL transcript（内容在 `~/.zcode/cli/db/db.sqlite` 的关系表里）
- `codex resume` 不接受外部文件

本仓库的实现改为：从 sqlite 读当前会话 → 渲染压缩摘要 → 喂给 `codex exec` 起一个**新**
Codex 会话。结果是 **fresh-context seed**，不是可 `codex resume` 回去的 thread。
等 ZCode 暴露 session path 或 Codex 支持 `--source` 后可升级。详见
[`docs/transfer-design.md`](docs/transfer-design.md)。

### stop-gate hook 默认关闭

codex-plugin-cc 原版有个 Stop hook（响应完自动跑 review gate）。ZCode 的 `async` 无效，
该 hook 会阻塞会话最多 15 分钟。本仓库**默认不装** Stop hook，只保留 SessionStart。
`/codex:setup --enable-review-gate` 的开关被记录但不生效（保留作前向兼容）。

### 命令体靠"模型读 marker 再调 Bash"

ZCode 命令体不展开 `${...}` 模板变量、拒绝内联 `` !`cmd` ``。因此每个 `/codex:*` 命令
都先指示模型读 `~/.zcode/codex-router-zcode-root` 拿到插件根路径，再调 Bash 跑 adapter——
比 Claude 的内联 shell 多一次模型往返。这是 ZCode 命令机制的通用约束，非本仓库特有。

### 与 codex-router-skill 的关系

本仓库的路由 brain 与 [`jlcbk/codex-router-skill`](https://github.com/jlcbk/codex-router-skill)
同源（同一个 author）。**两边都装会重名冲突**（skill 都叫 `codex-router`）。
推荐二选一：在 ZCode 上用本仓库（自包含、含执行管道）；在 Claude Code 上用 codex-router-skill。

## 升级 codex-plugin-cc submodule

```bash
cd plugins/codex-router-zcode/scripts/vendor/codex-plugin-cc
git fetch --tags
git checkout v1.0.6    # 或新版
cd -                   # 回仓库根
git add plugins/codex-router-zcode/scripts/vendor/codex-plugin-cc
git commit -m "bump codex-plugin-cc to v1.0.6"
```

适配层（`zcode-adapter.mjs`）在 submodule 外面，升级通常零成本。

## 致谢

- 路由结构（路由表 + 能力打分 + 升级纪律 + profile）源自
  [`jlcbk/codex-router-skill`](https://github.com/jlcbk/codex-router-skill)（MIT）。
- 执行运行时（codex-companion + app-server broker）源自
  [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)（Apache-2.0），
  以 git submodule 形式 vendored，**源码零改动**。详见 [`NOTICE`](NOTICE)。

## License

MIT。第三方组件保留其原始许可证（见 NOTICE）。
