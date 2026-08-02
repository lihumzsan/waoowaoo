<!-- architecture-module: codex-runtime-rollout -->

# Codex Creative Runtime

## 当前状态与目标

Codex app-server 是生产 Assistant 的唯一通用 Agent Runtime。Wao 不再实现模型循环、
上下文压缩、Tool 调度、Subagent 调度或 Turn Coordinator；它只保留自己的产品事实、
Creative Skills、真实生产能力和浏览器 View。

普通项目文件组成 Creative Workspace；Canvas 是该目录与正式 Resource/Task 事实的投影。
图片、视频、音频、计费、审批、Task 和 Resource 仍由 Wao 服务拥有，不伪装为 Agent 可写
的文件状态。Temporal 只处理真正的长媒体 Task。

## 不变量

- **CRR-01 — RuntimeAdapter 是唯一 Codex 协议边界。** 产品层不得自行拼接 app-server
  JSON-RPC。Codex CLI 版本固定在 Runtime 镜像中；升级必须先通过真实协议 smoke，差异只在
  adapter 内消化。
- **CRR-02 — app-server 只拥有模型执行状态。** Codex rollout 只用于 thread resume；
  MySQL View 是用户消息、Turn、交互、Task/Resource link 与审计的产品事实。浏览器不读取
  Codex 本地 session 文件。
- **CRR-03 — 一个活跃 user/project 只有一个 Runtime。** Runtime Session Manager 以
  `userId+projectId` 取得 Redis 排他 ownership，一个容器可承载该项目的多个产品 Thread，
  但同项目一次只有一个 active Turn。Route、Temporal 和 UI 都不得另起 Runtime。
- **CRR-04 — Runtime 按需启动。** 第一条消息 materialize 并启动；空闲且没有 active
  Turn、pending server request 或 checkpoint 时停止。它不是每用户常驻服务。
- **CRR-05 — 生产外层容器是权威 Sandbox。** Linux namespace sandbox 不能在受限 Docker
  中再次嵌套，除非危险地授予 `SYS_ADMIN`。因此生产 Codex 的 `danger-full-access` 只表示它
  可在已经隔离的容器内执行命令；真正边界是非 root 用户、只读 rootfs/system mount、仅
  authoring 可写、capabilities 全删除、PID/CPU/内存上限与 internal-only 网络。Runtime 只能
  连接 Wao 网关，不能直接访问数据库、对象存储、Provider 或公网。本地 `local` driver 仍用
  Codex `workspace-write` 内层 sandbox。
- **CRR-06 — 只有 authoring 可写。** 生产容器将 Workspace 根目录只读挂载，只把
  `authoring/` 叠加为可写；`system/project.json`、`system/resources.json`、正式文本 Resource
  与版本锁定 Skill 均为只读投影。capture 再次拒绝 system 变化、symlink、隐藏路径、二进制、
  越界路径和超限内容。
- **CRR-07 — Workspace 的唯一持久 writer 是 S3 bundle service。** canonical identity
  为 `userId+projectId` 的固定对象 key。运行目录只是临时 materialization；没有 Git、branch、
  CAS、逐文件对象或本地卷产品事实。若未来允许第二 writer，必须先建立唯一并发裁判。
- **CRR-08 — 媒体只保留指针。** Workspace 不下载或保存图片、视频、音频；文本只包含正式
  Resource identity、类型、提示词、意图与 lineage 指针。Task/Artifact status、URL 与计费事实
  始终由 Canvas/View 在读取时 join 正式 owner，不回写文件。
- **CRR-09 — MCP 是 Operation Registry 的协议投影。** `channels.mcp=true` 是唯一曝光声明；
  MCP 不维护第二张能力表，不直接写数据库，也不绕过 invocation、计划、Grant、Task、Billing、
  Provider 与 Resource owner。
- **CRR-10 — MCP 调用有可信执行 fence。** runtime bearer 只声明 user/project/assistant；
  服务端从唯一 running Turn 解析 thread、runtimeTurn、executionOwner 与 project context。模型
  参数不能指定 scope。同步 effect 以 `turnId+callId` exact replay；相同 identity 不同输入失败。
- **CRR-11 — 两类审批分权但同一 UI。** Codex command/file patch/requestUserInput 由
  app-server server request → MySQL interaction → write-once response 裁决；Wao billable/
  destructive Operation 由 MCP elicitation + 冻结 Plan/Grant 裁决。两者都显示为本地化聊天卡，
  但不能互相代替。
- **CRR-12 — 模型只来自 Wao OpenRouter 网关。** 第一阶段只接受当前部署凭证模式唯一解析的
  `assistantModel` 与 OpenRouter API Key：user-key 使用用户配置，platform-key 使用平台配置，
  两者均不需要 Codex 账号或登录。Runtime 收到短期 Wao bearer，不收到 Provider key；
  Codex Responses 请求由内部网关校验精确 model 后透传 OpenRouter `/responses`。不支持的
  provider/model 原地失败，不回退其他模型或 Chat Completions，也不得绕过部署凭证裁判。
- **CRR-13 — 进程失败结束当前 Turn。** app-server/container/ownership 丢失时，pending
  request 失败、Turn 记为 `interrupted`，已经提交的 Wao Operation/Task/Billing/Resource 保留。
  下次从已 checkpoint 的 rollout 和 Workspace 新开 Turn；不透明重放进程中模型请求。
- **CRR-14 — 切换无双轨。** Assistant route 只进入 AssistantRuntime service；旧 Agents SDK
  主 runner、Temporal AgentThreadCoordinator、RunState、MySQL model history 与 UI 猜测全部
  删除。app-server 失败不能回退旧 Agent。

## 事实与唯一 owner

| 事实 | canonical identity | 唯一 owner/writer | 消费者 |
| --- | --- | --- | --- |
| Runtime placement | hash(userId, projectId) | Runtime Session Manager + Redis ownership | AssistantRuntime |
| Codex rollout | runtimeThreadId | app-server；Wao opaque checkpoint service | RuntimeAdapter |
| 产品 Thread/Turn/View | Wao threadId/turnId | AssistantRuntime persistence/projector | API/UI |
| pending server request | turnId+runtimeRequestId | interaction persistence | UI/RuntimeAdapter |
| Workspace bundle | hash(userId, projectId) | codex-workspace bundle service | Runtime/Canvas |
| MCP effect | turnId+callId | Operation invocation/ToolEffect | Codex/View |
| Task/Billing/Resource | 既有正式 ID | 既有 owner | Canvas/Chat/Task follow-up |

## 正常生命周期

```text
authenticated Assistant request
→ admit Wao message/Turn by stable sourceId
→ obtain project Runtime ownership
→ S3 materialize Workspace + opaque Codex home
→ start restricted container and start/resume Codex thread
→ start Turn and bind runtimeTurnId/executionOwnerId
→ stream notifications + persist product View/server requests
→ MCP calls existing Wao Operation owners when needed
→ terminal event settles usage/View
→ capture authoring bundle + checkpoint rollout
→ idle stop destroys container and temporary directory
```

Task terminal 后，Temporal 只向内部 authenticated follow-up endpoint 提交稳定 `batchId`；
AssistantRuntime 从正式 Batch 读取 scope/context 并新建一次 `task_follow_up` Turn。Temporal 不
持有 app-server、Thread 或模型 history。

## 失败、取消与恢复

| 场景 | 唯一结果 |
| --- | --- |
| 重复用户 sourceId | 相同 payload 返回原 Turn；不同 payload fail closed |
| 同项目第二 active Turn | 明确 busy；steer/interrupt 只能作用于已绑定 runtimeTurnId |
| server request 重复决定 | write-once replay；不同 response 拒绝 |
| MCP session/request 越 scope | 401/403；不调用 Operation |
| billable plan/Grant 分歧 | 不执行、不扣费、不创建 Task |
| Workspace capture 失败 | 旧 S3 bundle 保持权威；Turn 不宣称 authoring 已保存 |
| app-server/container 退出 | 当前 Turn interrupted；下次从最后完整 checkpoint 恢复 |
| Manager 退出 | Redis claim 失效后新 owner reconcile；旧 runtime 不能继续写 |
| clear 与晚到 Task | archive/cancel Batch 后，旧 Task 禁止唤醒新 Thread |
| OpenRouter Responses 不支持 | typed failure；无 Chat Completions/其他 provider fallback |

## 权威入口

- Codex 协议与容器：`src/lib/codex-runtime/**`、`Dockerfile.codex-runtime`。
- 产品执行与 View：`src/lib/assistant-runtime/**`。
- Workspace：`src/lib/codex-workspace/**`。
- MCP：`src/lib/wao-mcp/**`，能力身份来自 `src/lib/operations/registry.ts`。
- 模型网关：`src/lib/codex-model-gateway/**` 与 internal Responses route。
- 浏览器入口：`src/app/api/projects/[projectId]/assistant/**`。
- Task 唤醒：Temporal terminal publisher → internal follow-up route → AssistantRuntime。

## 验证与发布边界

- 真实 app-server：initialize、thread start/resume/read、Turn stream、steer、interrupt、server
  request、进程 kill 后恢复。
- 真实 MCP HTTP：initialize/session/list/call/elicitation，未知 operation、越 scope 和重复 call
  fail closed；收费能力必须经真实 Plan/Grant/Task owner。
- 容器：只读 system/rootfs、authoring 可写、内部网络、CPU/memory/PID、空闲停止与重建。
- 持久层：MySQL source/decision race、S3 materialize/capture/checkpoint、Task late follow-up。
- 产品：刷新、断线、审批卡、locale、Task/Resource Canvas 投影。
- 发布必须使用不可变 Codex Runtime image digest，并在应用 migration 前排空旧 active Turn、
  pending interaction 与旧 follow-up。migration 代码存在不等于已获准操作生产数据。

## 历史回归

旧系统先后用 DB Run、Redis lock、Outbox、Temporal Thread Coordinator、SDK model history、
RunState 与 UI overlay 共同解释一个 Agent Turn。每次补一个崩溃窗口都会增加新的合法 owner，
最终大量工作用于维护 runtime 而非创作能力。当前防线不是再加恢复分支，而是把模型执行整体
交给 Codex：Wao 只保留产品事实、能力和投影，并对每类事实维持一个 writer。
