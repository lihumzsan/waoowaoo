<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Thread、Turn 与交互生命周期

## 设计理念

Assistant 使用 `Thread → Turn → Item` 产品契约，但模型执行完全由 Codex app-server
负责。Wao 的 MySQL View 用于聊天刷新、审计、计费归因与正式 Resource/Task link；Codex
rollout 是不透明恢复状态。两者用途不同，不能互相替代。

Runtime Session Manager 只管理 project Runtime placement、Thread resume、Turn 准入、
checkpoint 和进程恢复；它不是第二个 Agent 状态机。Temporal 不参与交互式 Turn，只保留长
媒体 Task。

## 不变量

- **ARL-01 — AssistantRuntime service 是唯一 Turn 入口。** submit、steer、interrupt、
  server-request response、clear 与 task follow-up 均由该 service 执行。Route 只鉴权、解析
  规范化 command 并调用 service；不得直连 RuntimeAdapter、数据库或 Temporal。
- **ARL-02 — Thread identity 不从 UI 推断。** canonical Wao thread 由
  `projectId+userId+assistantId+scopeRef` 唯一；`runtimeThreadId` 只有在完整 rollout 已 checkpoint
  后才绑定。空的 Codex Thread 不得伪装成可恢复事实。
- **ARL-03 — source identity 决定用户命令重放。** 用户 Turn 使用
  `threadId+sourceKind+sourceId`；canonical payload hash 与 requestId 一并冻结。相同 identity/
  payload 返回原 Turn，不同 payload fail closed。JSON-RPC request id 不是业务幂等键。
- **ARL-04 — 同项目一次只有一个 active Turn。** Runtime 以 user/project 共享，多个产品
  Thread 可以 resume，但不能并行运行。追加上下文用 `turn/steer`；替换先 interrupt 当前 Turn
  再提交新 source。禁止 route、timer 或 UI 启动第二 Turn。
- **ARL-05 — runtime identity 在启动后原子绑定。** `runtimeTurnId` 与
  `executionOwnerId=runtimeTurnId` 在同一事务把 Wao Turn 从 queued 置为 running；MCP 和
  ToolEffect 只接受该 running fence。旧 runtime 或晚到 event 不能覆盖新 owner。
- **ARL-06 — app-server event projector 是 View 唯一写入解释者。** delta 是临时流；完整
  item/turn notification 才持久化 Message/Item/terminal。SSE 只广播已提交事实或即时 overlay，
  浏览器文案、DOM、timer 和到达顺序不能决定生命周期。
- **ARL-07 — terminal 只由明确 Runtime 事件或显式中断写入。** `completed`、`failed`、
  `interrupted`、`canceled` 互斥且单调。进程/ownership 丢失写 interrupted；不重放原模型请求，
  已提交 Operation/Task/Billing/Resource 不回滚。
- **ARL-08 — server request 先持久化再展示。** command execution、file change、MCP
  elicitation、requestUserInput 等均以 `turnId+runtimeRequestId` 冻结 kind 与 payload。UI decision
  write-once；响应前再次校验 project/thread/turn/runtime generation。未知 method fail closed，
  不能根据文案猜审批类型。
- **ARL-09 — Codex 与 Wao 审批不混权。** Codex command/file approval 只允许或拒绝
  Runtime 行为；Wao billable/destructive elicitation 只授权精确 Operation Plan/Grant。两种卡片
  可共享 UI 组件，但 response protocol 和事实 owner 必须分开。
- **ARL-10 — requestUserInput 是结构化 Choice。** app-server 请求中的 question/option identity
  原样冻结；只接受当前 pending request 声明的答案。自由文本只在协议允许时接受，任何未知
  question/option 或重复分歧都拒绝。
- **ARL-11 — locale 是每 Turn 显式上下文。** 系统 developer instructions 和 Turn context
  都注入当前 locale；API 错误只返回 stable code，由 i18n catalog 生成用户文案。不能依赖模型
  或 Codex 默认语言。
- **ARL-12 — 原生 Subagent 属于 Codex Item。** Codex collaboration/subagent item 由同一
  event projector 投影为普通 message/tool part；UI 不维护第二条 subagent stream。
  `delegate_creative_work` 仍可作为 MCP 暴露的专业后台 Task，但它只按普通 Task/Resource 与
  FollowUpBatch 投影，不冒充 Codex 原生 Subagent 或 Assistant Session 子生命周期。
- **ARL-13 — Tool 输出只相信正式 Operation 结果。** MCP 同步 effect 的结果由 ToolEffect
  exact replay；Task-producing Operation 返回 Task/Resource identity，完成状态由正式 View
  join。模型说“已完成”不改变任何事实。
- **ARL-14 — task follow-up 只创建新 Turn。** FollowUpBatch 最后成员 terminal 后，Temporal
  以稳定 batchId 调用内部 authenticated endpoint；AssistantRuntime 读取 Batch 并最多创建一个
  `task_follow_up` Turn。busy 时由 Temporal typed retry，不能轮询文件或伪造用户 request。
- **ARL-15 — clear 关闭全部旧入口。** clear 先 interrupt 当前 Runtime Turn，再在事务中归档
  View、失效 pending interaction、取消未完成 FollowUpBatch，并停止项目 Runtime。新会话使用新
  Wao thread；晚到旧 Task/interaction 不能进入它。
- **ARL-16 — 没有旧协议 fallback。** MySQL SDK model history、Agents SDK RunState、Temporal
  command/update、旧 approval/choice resume 和前端 modelHistoryVersion 均不存在。Codex 或内部
  网关不可用时返回 typed failure。

## 状态与 writer

| 状态/事实 | 唯一 writer | 说明 |
| --- | --- | --- |
| Wao Thread messages/View | AssistantRuntime persistence/projector | 刷新与审计事实 |
| runtimeThreadId binding | runtime checkpoint persistence | 先保存 rollout，后绑定 |
| Turn queued/running/terminal | AssistantRuntime persistence/projector | source admission + Runtime event |
| active Runtime/Turn | Runtime Session Manager | Redis project ownership + in-process entry |
| pending interaction/decision | interaction persistence | request 先写、decision write-once |
| Codex rollout | app-server | opaque checkpoint，仅供 resume |
| streaming delta | SSE overlay | 可丢，不是终态 |
| Task/Resource/Billing | 既有 owner | Assistant 只投影 identity |

## 正常时序

### 用户消息

```text
browser POST stable sourceId + UIMessage
→ route auth/parse
→ AssistantRuntime transactional admission
→ resolve selected OpenRouter assistantModel
→ ensure project Runtime + Wao Thread
→ app-server turn/start
→ bind runtimeTurnId/executionOwnerId
→ projector persists items and publishes SSE
→ turn terminal settles usage/View
→ workspace + rollout checkpoint
```

### server request

```text
app-server request(method,id,params)
→ classify exact supported method
→ persist pending interaction
→ View/SSE renders localized card
→ authenticated decision route writes once
→ service verifies current runtime fence
→ JSON-RPC response sent exactly once
```

### Task follow-up

```text
Task terminal transaction settles FollowUpBatch member
→ final member makes Batch ready
→ Temporal calls internal follow-up endpoint with batchId
→ AssistantRuntime exact-replays or admits task_follow_up Turn
→ Codex reads formal Task/Resource projection and continues
→ Batch stores notifiedTurnId/notifiedAt
```

## 失败、取消与并发

| 场景 | 唯一结果 |
| --- | --- |
| POST ACK 丢失 | 同 sourceId 读取原 Turn/View |
| turn/start ACK 不确定 | 未确认 runtimeTurnId 时失败启动；不得盲目再发同模型请求 |
| 连续用户消息 | 明确 steer 或 interrupt+new；禁止两个 running Turn |
| stop 与 MCP effect 竞争 | 已提交业务事实优先；旧 executionOwner 写入被拒绝 |
| interaction 重复点击 | 相同 decision replay；不同 decision conflict |
| Runtime 进程退出 | pending interaction 失败，Turn interrupted，checkpoint 前内容不声称持久 |
| workspace save 失败 | View 可结算模型结果，但 authoring 明确保存失败，旧 bundle 仍权威 |
| follow-up 遇 project busy | typed retry；Batch 保持 ready，不创建 ghost Turn |
| clear 后晚到 event | generation/thread/turn fence 拒绝 |
| OpenRouter/model 不支持 Responses | typed unavailable；无旧 SDK/其他模型 fallback |

## 权威入口

- Service、persistence、event projector、View：`src/lib/assistant-runtime/**`。
- Runtime placement 与协议：`src/lib/codex-runtime/**`。
- Assistant HTTP：`src/app/api/projects/[projectId]/assistant/**`。
- 内部 Task wake-up：`src/app/api/internal/codex-runtime/follow-up/route.ts`。
- SSE transport：`src/lib/agent-turn/stream-publisher.ts` 与既有 SSE server；它不是状态 owner。
- Operation effect fence：`src/lib/agent-turn/tool-effect.ts`；该模块仅保留业务重放语义，不是
  Agent runner。

## 删除的旧入口

- Agents SDK primary runner、model session、tool adapter、RunState 与自研上下文压缩。
- Temporal AgentThreadCoordinator workflow/activity/client/worker registration。
- MySQL `modelHistoryJson/modelHistoryVersion/modelHistoryBaseVersion` 与 interaction `runState`。
- Route 的 Temporal update/command 与 UI 的 modelHistoryVersion/subagent Task stream 判断。
- 任何 app-server 失败后回旧 Agent 的 feature flag、reader 或 fallback。

## 验证

- 真实 app-server thread/turn/steer/interrupt/server-request/kill-resume。
- 真实 MySQL source replay、active Turn race、decision race、clear/late event。
- 真实 Redis ownership 丢失与 Manager 重启。
- 真实 MCP effect exact replay、Plan/Grant 与 Task follow-up。
- 刷新、断线、多标签页、locale、command/file approval、requestUserInput、原生 Subagent Item。
- 静态验证必须确认旧 Coordinator/SDK primary imports 与 schema 字段为零。

## 历史回归

旧实现把模型历史、RunState、Temporal command、MySQL Turn、Redis 执行租约和 UI overlay 同时
用于恢复一个交互 Turn，导致 ACK 丢失、快速新消息、审批晚到和 Worker kill 都需要跨多个 owner
协调。当前防线是明确放弃进程中模型透明恢复：Codex 拥有模型上下文，Wao 拥有产品 View，
进程失败把当前 Turn 结束为 interrupted，再用新 Turn 继续。
