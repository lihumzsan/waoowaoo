<!-- architecture-module: codex-runtime-rollout -->

# Codex Creative Runtime

## 设计理念

Codex app-server 是唯一 Agent Runtime；Wao 保留产品 View、WorkspaceResource、Capability Service、计费、审批、Task 和 Temporal。Runtime 可被替换，但 UI 和业务服务不直接依赖 Codex 进程细节，统一经 `RuntimeAdapter` 与 `AssistantRuntime`。

开发环境可显式使用本地进程，包括加载 Cloud 产品配置的 `dev:cloud`；Cloud 正式多租户部署必须在项目级隔离容器中运行。容器是租户和资源边界，Codex 内层 sandbox 是纵深防御，两者职责不同。

## 不变量

- **CRR-01 — 唯一 Runtime。** 每个活跃 `(userId, projectId)` 最多一个 Runtime session；同一 Project 同时最多一个活跃 Turn。旧 Agents SDK、Primary 模型循环和 Temporal Agent coordinator 不得执行 Turn。
- **CRR-02 — 适配器隔离协议。** UI、route 和业务 service 只能通过 `AssistantRuntime`；Codex JSON-RPC 方法、版本差异和进程生命周期收敛在 `RuntimeAdapter` / Session Manager。本地与容器 driver 都必须在 app-server 进程启动时启用并验证钉死 Codex 包随附的 `codex-code-mode-host`，不能只在 Thread overlay 声明后假定进程级 host 已存在。
- **CRR-03 — 双层隔离。** Cloud production driver 必须为 Docker，限制 CPU、内存、PID、磁盘/工作目录和网络；Codex 使用 `workspace-write`，只能写临时 Project workspace。development 可显式选择 local，即使产品 edition 为 Cloud 也不等同正式多租户部署；production 不能静默降级。
- **CRR-04 — WorkspaceResource 才是持久事实。** 启动时从 Catalog/对象存储 materialize 普通目录，Turn checkpoint 时以完整基线 CAS 原子 capture；Runtime 文件夹、inode 和临时 Codex home 都不是产品权威。
- **CRR-05 — 系统字段不可写。** Runtime 可自由组织用户工作区文件和目录，但不能修改 Resource status、Task、Artifact、Billing、media identity 或系统投影。媒体文件是受保护引用；改写、伪造或删除 pending 媒体必须失败。
- **CRR-06 — Codex 状态与产品 View 分权。** 不透明 Codex session state 只用于 resume；MySQL Assistant View 是聊天、审批、计费归因和刷新显示的产品事实。两者必须先持久化再绑定 runtimeThreadId。
- **CRR-06A — Session resume 必须匹配 Runtime revision。** 钉死 Codex 版本、process host 或工具拓扑发生不兼容变化时只提升一个共享 Runtime revision；对象存储 session key 与 `ProjectAssistantThread.runtimeRevision` 必须使用同一值。revision 不匹配时先完整停止旧 Runtime，再原子清空旧 `runtimeThreadId` 并绑定新 revision；新原生 Thread 由 MySQL Product View 的既有消息 seed。普通重启、空闲停止与同 revision 崩溃仍 resume 原 Thread，禁止每 Turn 重建或保留新旧双轨。
- **CRR-06A — 无 durable binding 时从 View 恢复语义。** Codex state 可 resume 时绝不重放产品消息；不可 resume 时，新 Runtime Thread 在开始 Turn 前恰好一次注入既有 Product View 文本历史与可重放附件内容。该 seed 只恢复上下文，不伪造旧工具终态或第二份聊天事实。
- **CRR-07 — MCP 是唯一系统能力桥。** Runtime 的真实媒体、导入、批量生产、预算与破坏性操作只经带当前 Turn token 的 Wao MCP；Capability Service 仍是业务实现，MCP 不复制逻辑。Runtime bearer 只证明项目能力调用权，绝不证明用户同意；计费与破坏性 writer 必须验证 Wao 登录态交互 route 已持久化的同 Turn 浏览器决定，MCP 客户端返回值不能自行签发授权。每次调用由同一 Session Manager 在执行前 flush Workspace、执行后 refresh，工具不得读取过期 Catalog；授权与 ownership 复验全部发生在副作用前，业务提交成功后的 refresh 失败可以阻断/恢复 Runtime，但绝不能把已成功副作用伪报为工具失败。Wao 的交互式生产工具在 Codex tool client 与 MCP elicitation server request 两层都显式使用有界 timeout，且内层短于短期 capability token；不得让任一 60 秒默认值截断业务审批。GPT-5.6 Sol/Terra 的官方模型元数据选择 `code_mode_only`，因此 Runtime 必须启用 Codex 随包提供的 process host；shell、patch 与 standalone Web Search 可由这个原生 host 调度，但 `wao` MCP 命名空间必须标记为 direct-only，不能进入嵌套执行器，父 Agent 与 Subagent 共用这一套拓扑。Streamable HTTP 内部发起的 elicitation 必须通过当前 `tools/call` handler 的 `sendRequest` 关联原请求，禁止脱离父请求写入无人持有的 standalone SSE stream。
- **CRR-07A — 用户取消是正常终态。** 浏览器拒绝 Wao 计费或破坏性审批时，MCP 返回结构化 `status=declined` 且不标记协议错误；UI 显示“已停止”，模型不得把用户取消解释为服务失败或建议重试。
- **CRR-07B — Runtime bearer 不是模型 API key。** Bearer nonce 同时是当前 Runtime placement 的 Redis ownership token；Responses、standalone search 与 MCP 必须先证明该 nonce 仍持有租约，再证明 Project 恰好一个活跃、未取消且 Thread 未 clear 的 Product Turn。停止/轮换/清空 placement 后旧 token 即使未过期且后来出现新 Turn 也不能重放。父 app-server 可访问内部网关，但 shell/patch 在 local 与 Docker 中均使用 `workspace-write + networkAccess=false`。
- **CRR-08 — 空闲可停。** 无活跃 Turn 时达到 idle timeout 才 capture、保存 session state 并停止容器；下一条消息按持久绑定重建。原生 Turn completion 必须同步登记 workspace capture/checkpoint，persistence queue 是 sticky failure barrier；下一 Turn、进程退出、ownership 丢失或 Manager 重启必须先排空持久化并确认 Product Turn settlement，再允许新 writer 或 placement。
- **CRR-09 — 版本钉死。** Codex binary/app-server 版本与协议 smoke 一起升级；未知关键 request/event 不得静默忽略。
- **CRR-09A — 原生实验事件显式协商。** 当前钉死版本把 `request_user_input`、Goal 等产品所需事件标为 experimental；Wao initialize 必须显式声明 `experimentalApi=true`，真实 schema smoke 同时校验这些方法仍存在。关闭该 capability 等同缺失必需能力，禁止静默降级。
- **CRR-09B — Provider 适配与重试只有一个 owner。** Codex app-server 是同一原生 Turn 内模型请求与流式连接重试的唯一 owner，重试次数必须有界；网关不得再建第二套 retry。Codex 生成的 Responses 输入只能在 `src/lib/codex-model-gateway` 这一唯一 Provider 适配边界规范化：所有 developer/system 指令提升到 top-level `instructions`，user/assistant/tool/reasoning 历史保持原顺序，无法无损规范化时原地失败。原生 `error` notification 只表示本次尝试，`willRetry=true` 不得提前写 Product Turn 失败；最终 `turn/completed.error` 才由 Product View writer 按钉死协议映射为稳定错误 identity。
- **CRR-10 — 不使用 Git。** 创作历史由 WorkspaceResourceVersion 拥有；Runtime 目录没有 Git、Commit Service、branch 或 CAS HEAD。并发安全来自 Project ownership、单 Turn 与 Catalog baseline CAS。
- **CRR-11 — 进程内 Manager 唯一。** 所有 Next route bundle 在同一进程必须复用一个进程级 AssistantRuntime/Session Manager；开发热更新不能遗留仍续租的模块级 Manager。跨进程唯一性继续由外部 ownership claim 裁决，不能用第二个本地 singleton 竞争。
- **CRR-12 — 当前控制面单进程。** app-server placement 与 Streamable HTTP MCP session 当前都是进程内对象，因此当前 Cloud Web 控制面只支持一个 Next Node 进程/replica；Temporal 媒体 Worker 可独立横向扩展。启用多个 Web replica 前必须先增加按 project owner 的请求路由与 MCP session affinity，禁止把 Redis ownership 误称为跨 replica 转发能力。

## 生命周期

1. Session Manager 获取 `(userId, projectId)` 独占 ownership。
2. 从 WorkspaceResource Catalog/对象存储 materialize 临时目录与持久 Codex state。
3. 启动 app-server，initialize，start/resume product thread。
4. 先持久化 Codex state，再写 product thread ↔ runtime thread binding。
5. Turn 期间按原生事件更新 MySQL View；MCP 调用先在 persistence queue capture 本 Turn Workspace，再进入 Capability Service，返回前刷新最新 Catalog 投影。
6. Turn 结束原子 capture 工作区；成功后 checkpoint runtime state。
7. 空闲、关闭或可恢复故障时保存后销毁临时目录；不保存成功则不得宣称 Turn 已持久。

## 失败与恢复

| 事件 | 唯一语义 |
| --- | --- |
| app-server 启动/initialize 失败 | 不建立 durable binding；清理 materialization；Turn 显式失败 |
| Runtime 进程意外退出 | live projector 结算 interrupted；Manager capture 后停止 placement，不并发写终态；下一 admission 再创建 placement |
| Provider 请求或流式连接失败 | Codex 在同一 Turn 内按有界次数重试；中间 `error` 只更新诊断事实。最终失败时 projector 持久化 typed code 与安全 message；用户若继续，创建新 Product Turn 并先核对 WorkspaceResource/Task/Plan，不重放原消息 |
| Session Manager 崩溃 | 外部 ownership 过期后新 Manager reconcile 废弃 Turn；禁止双 Runtime |
| workspace baseline 漂移 | 整个 checkpoint 原地拒绝，不部分覆盖 Catalog |
| MCP flush/Task 提交结果不明 | 依赖 operation/request idempotency 查询同一执行，不再次扣费 |
| 空闲停止 | 仅无活跃 Turn 时执行；checkpoint 失败则 session 进入 blocked，不销毁权威证据 |

## 权威入口

- Runtime 协议：`src/lib/codex-runtime/runtime-adapter.ts`、`app-server-client.ts`。
- placement/ownership/idle/recovery：`runtime-session-manager.ts`。
- local/Docker 隔离：`runtime-config.ts`、`*-runtime-container.ts`、`Dockerfile.codex-runtime`。
- materialize/capture：`src/lib/assistant-runtime/runtime-persistence.ts`、`src/lib/codex-workspace/**`。
- 产品 View：`src/lib/assistant-runtime/**`。
- 能力桥：`src/lib/wao-mcp/**`。

## 验证

真实 app-server smoke 覆盖 initialize、thread start/resume/read、turn、steer、interrupt、skills/list 与关键 event。Session Manager 需验证同 scope 互斥、进程退出、Manager 重启、binding 顺序、idle stop/restart；Workspace 需以真实数据库和对象存储边界验证目录 rename、内容版本、baseline divergence 和系统字段保护。配置复验必须同时证明 `dev:cloud + local` 可启动，以及 `cloud + production + local` 原地拒绝；云端容器资源限制与网络只能在目标部署复验。

## 历史回归

- Codex 0.146.0 为所有 server notification envelope 新增可选 `emittedAtMs`；RuntimeAdapter 的 fail-closed parser 仍只允许旧版 `method + params`，升级后在 `initialize` 紧随的 `remoteControl/status/changed` 上立即杀死进程，所有 Turn 都表现为 Runtime failed。当前钉死版本与生产 parser 同步：只额外接受并校验安全整数时间戳，产品事件顺序仍由 stdio 顺序和持久 View watermark 裁决，不把 provider 时间戳引入第二状态解释。

- Codex clean cutover 首版让 Cloud edition 无条件要求 Docker，但 `dev:cloud` 的开发 preflight 又明确要求 local driver，导致所有本地 Cloud 首条消息都在 Runtime materialize 前失败。根因是把产品 edition 误当成运行环境 profile；当前只有 Cloud production 强制 Docker，development 仍须显式选择 local，不存在自动降级。
- 首版协议 smoke 只安装一个 synthetic Skill，七个正式 Skill 缺少原生 frontmatter 时仍能通过；同时 MCP 与 Workspace round-trip 分开测试，遗漏同 Turn 新目录。当前 smoke 从生产 Registry 穷尽物化真实 Skill，真实组合验收覆盖 `mkdir → MCP → pending Resource → checkpoint`。
- 首次接通 Wao 业务审批时只延长了 Codex MCP 工具 timeout 与 MCP SDK elicitation timeout，却遗漏了两个真实协议边界：调用被 code-mode `exec` 包裹，以及 `Server.elicitInput` 脱离父 `tools/call` 后在 Streamable HTTP 中路由到 standalone SSE。两者都会让服务端已在等待用户而 app-server 收不到请求，报价卡只在超时后成为过期交互。当时通过整体关闭 code-mode 暂时消除嵌套，但 GPT-5.6 Sol/Terra 的正式模型选择器会因此失败关闭全部 code-mode 工具。当前防线改为启用随 Codex 版本锁定的 process host，同时把 `wao` MCP 整个命名空间 direct-only；业务审批不再进入嵌套执行器，`extra.sendRequest` 仍保持父请求关联，两层 timeout 只承担用户等待上限。
- 长片压力验收中，主 Agent 的两个原生 Subagent 使用同一工作区；旧 Codex 版本的一个子线程选择实验性 code-mode，把普通补丁包装成嵌套 `exec → apply_patch`，内层调用没有在 child-thread 协议中完成回传，另一个直接使用原生 patch 的子线程则正常完成。整体关闭 code-mode 虽规避旧症状，却让官方标记 `code_mode_only` 的 GPT-5.6 模型失去 shell 与 Web Search。当前钉死版本必须用真实父线程、子线程、standalone Web Search 与 direct-only Wao MCP 验收同一 host；任一链路无法闭环都视为 Runtime 版本不合格，不能再以关闭整个能力面作兼容。
- 中文项目的只读审计中，最终答复遵循 locale，但流式 reasoning summary 仍短暂显示英文；只约束“response”不足以覆盖 Codex 的可见推理与进度 surface。当前每 Turn locale context 显式覆盖 response、progress、plan explanation 与 reasoning summary，UI 不再假设最终正文语言可以替代全部可见输出的 i18n 契约。
- 模块级 Runtime singleton 在 Next 开发热更新后会失去引用但继续续租 Redis，新的 route bundle 随即创建第二个 Manager，表现为恢复消息永久 ownership busy。当前进程级 global 只保存一个 service；代码变更后的完整进程重启负责切换实现版本。
- Docker driver 首版把外层容器误当成唯一沙箱，向 Turn 声明 `danger-full-access`；同 UID 的 shell 因而可读取 app-server bearer 并直连内部模型网关。当前 local/Docker 都启用 Codex `workspace-write` 且关闭 shell 网络，模型/搜索网关再以唯一活跃 Product Turn fail closed；外层容器仍负责租户、CPU、内存、PID、挂载与网络边界。
- 模型网关首版只验证“项目里恰好有一个活跃 Turn”，未证明请求来自当前 Runtime；旧容器 bearer 在一小时内可等待新 Turn 后重放。当前 bearer nonce 与 Redis placement owner 完全相同，租约释放后 Responses/Search/MCP 都立即拒绝旧 generation。
- MCP 首版在业务事务或 Temporal 提交成功后再次执行 ownership 授权检查；用户恰在提交后取消会让后置检查抛错，把真实成功返回成失败并诱导重复执行。当前授权复验截止于副作用之前，后置 workspace refresh 失败只触发 Runtime 恢复与告警，不覆盖已经提交的业务结果。
- Local development driver 首版忽略 `stop('force')`，始终先等待 graceful shutdown；clear 已 claim 后本地 shell 仍可能继续数秒。当前 local app-server 使用独立进程组，force 直接终止整个组并等待 exit；graceful 仅用于已闭合 writer 的 checkpoint/idle 路径。
- Product View history seed 首版把旧 user/assistant 消息与当前 Turn 的 developer context 原样塞进同一 Responses `input`；OpenRouter 的 Anthropic-compatible 路由会把中段 developer 转成非法 system message，导致新 Turn 以 HTTP 400 在任何模型执行前失败。当前唯一模型网关把全部 instruction item 提升到 top-level `instructions`，只保留对话与工具历史的原顺序；不支持的指令结构显式拒绝，不按具体 Provider 名称增加分支。
- Codex 接入首版把 request/stream retry 都设为 0，长流的单次 socket 关闭直接终结整个 Product Turn；与此同时 projector 忽略原生 `error` 与 `turn.error`，持久层又固定写通用错误，真实网络失败和后续协议拒绝最终都显示成同一“服务器错误”。当前 Codex 是唯一有界 retry owner，网关不重试；projector 区分可重试 attempt 与最终 Turn，按钉死协议持久化 typed error。目标公网链路的实际稳定性仍是部署环境盲区。

## 修改检查表

- 是否出现第二 Runtime、第二 workspace writer 或第二 thread binding writer？
- cloud 是否仍 fail-closed 要求 Docker，local 是否只用于显式开发？
- checkpoint 是否先 capture WorkspaceResource，再保存/bind Codex state？
- 未知协议、崩溃和提交结果不明是否都有幂等、可恢复且不重复计费的语义？
