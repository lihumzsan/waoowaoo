<!-- architecture-module: durable-execution -->

# Temporal 持久执行边界

## 设计理念

Temporal 只处理真正跨秒、跨分钟且必须在 Web/Agent 退出后继续的媒体与生产 Task。交互式
Codex Thread/Turn、模型 stream、command/file approval、Workspace 与 app-server placement
不进入 Temporal。

业务事实仍由 MySQL 的 Operation、Task、Provider、Billing、Resource 与 FollowUpBatch owner
写入；Temporal 只拥有执行许可、retry/cancel 顺序和容量调度。Workflow history 不是第二份产品
数据库。

## 权威分层

| 层 | 拥有 | 不拥有 |
| --- | --- | --- |
| AssistantRuntime | Codex Turn、交互 View、Task follow-up 新 Turn | 长媒体 attempt |
| Operation invocation | 输入规范化、Plan/Grant、业务幂等、Task 创建 | Provider 长执行调度 |
| Temporal TaskWorkflow | attempt 时序、heartbeat、retry/cancel、capacity release | Task/Billing/Resource 终态解释 |
| MySQL owners | Operation/Task/Provider/Billing/Resource/Batch 事实 | 模型 stream/rollout |
| Runtime Session Manager | app-server placement/ownership/checkpoint | Task workflow |

## 不变量

- **DE-01 — Temporal 不执行交互式 Agent Turn。** Assistant route、approval、choice、steer、
  interrupt、clear 与 Codex rollout 不得调用 Temporal AgentThread workflow。Task 完成只通过一个
  内部 authenticated follow-up Activity 唤醒 AssistantRuntime。
- **DE-02 — Workflow 只拥有执行许可。** Workflow 可以调度 Activity、等待 heartbeat、推进
  business attempt 和释放容量；Task/Resource/Billing/Provider/Operation 的持久状态只由所属
  MySQL service 写。
- **DE-03 — Workflow 必须确定性。** 数据库、Redis、HTTP、S3、Provider、随机数与系统时间读取
  均在 Activity。History 只保存有界 identity、policy/version 与必要结果，不保存 Prompt、模型
  history、媒体、token delta 或 app-server event。
- **DE-04 — Activity 至少一次，副作用自行幂等。** Temporal retry 不提供业务 exactly-once。
  数据库写、Provider submit、计费与 Resource materialization 使用所属 owner 的 canonical identity；
  相同 identity 不同 payload 拒绝。
- **DE-05 — Task-producing Operation 只有一条 transport。** 所有 Agent MCP/API/UI 调用先进入
  同一个 `OperationExecutionWorkflow`，由 persistence Activity 在一个事务中提交 Operation
  output、Task、Resource 与 FollowUpBatch，再进入 Scheduler/TaskWorkflow。禁止 DB commit 后
  fire-and-forget 启动 Task，也禁止 BullMQ、Outbox、扫描器或同步 Provider fallback。
- **DE-06 — OperationExecution 是 immutable envelope。** Workflow 一次输入后完成，不建立
  Update/Query 命令状态机。HTTP 使用稳定 Idempotency Key；MCP 使用 `turnId+callId`。start ACK
  丢失按相同 workflow/execution identity 读取结果，不重做 domain 写入。
- **DE-07 — 计费授权先于 Task。** billable Operation 必须携带冻结 Plan snapshot 与精确 Grant；
  Activity 在同一事务校验 input/plan/quote/revision 后才创建 Task。MCP elicitation 只是用户交互，
  不能替代 Grant owner。
- **DE-08 — business attempt 与 Activity retry 分离。** 同一 Activity retry 复用同一个 Provider
  invocation/attempt identity。只有 registry policy 判定该 attempt 确定失败后，Workflow 才推进
  下一 business attempt；可重试期间不能提前写最终 failed。
- **DE-09 — Provider outcome unknown 不自动重提。** 已有 external id 或能证明未受理才可安全
  恢复；超时、断线、ACK 丢失且受理结果不明写 `outcome_unknown` 并停止盲目提交。
- **DE-10 — Task terminal 交接顺序可恢复。** terminal Activity 先原子提交 Task、Billing、
  Resource、Batch member；随后 Scheduler `capacityReleased`，再执行 follow-up notify。通知 pending
  不得继续占用 Provider 容量。
- **DE-11 — FollowUpBatch 是唯一多 Task 接力。** 成员在 Task 创建事务中一次冻结；最后成员
  terminal 后 status 变 ready。Temporal 以 batchId 调内部 route，AssistantRuntime 最多创建一个
  `task_follow_up` Turn，并写 `notifiedTurnId/notifiedAt`。一个 Task 不创建一条私有等待链。
- **DE-12 — follow-up busy 使用 Temporal typed retry。** 项目正有前台 Turn 时，内部 route 返回
  明确 retryable code；Activity retry 同一 batchId。没有 timer、DB poller、伪造浏览器 request 或
  第二通知队列。Batch canceled/notified 是 non-retryable replay。
- **DE-13 — Clear 关闭旧 Batch。** clear 事务取消旧 Thread 未完成 Batch；晚到 Task 只能结算
  member，不能唤醒新 Thread。follow-up 必须从 Batch 读取 user/project/thread/episode/context，
  不信任 Temporal caller 提供 scope。
- **DE-14 — Cancel 不覆盖已提交完成。** checkpoint/terminal 已提交时业务事实优先；cancel 只
  阻止尚未发生的执行。Provider cancel 在读取正式 ledger 后独立重试，不能反向阻塞 terminal、
  capacity release 或 follow-up。
- **DE-15 — SSE 只传播正式事实。** Task terminal/Resource impact 由提交事务产生；SSE 丢失只
  影响即时体验，刷新从 MySQL View 恢复。浏览器不得从进度文案、倒计时或事件顺序推断终态。
- **DE-16 — Temporal 不可用时长任务失败关闭。** 新 OperationExecution、Task cancel 或
  follow-up 无法进入 Temporal 时返回 stable typed infrastructure code；不能退回同步执行、
  BullMQ、Outbox 或 fire-and-forget。
- **DE-17 — 正式 Worker 使用不可变发布身份。** production build ID 非 `local`，Worker
  Deployment Versioning 开启且默认 `PINNED`，镜像为 repository@sha256。自托管 blue/green 先
  注册候选、显式 promote、等待旧版本 drained 后 retire；普通 Compose 重启不隐式提升候选。
- **DE-18 — Web 与 Worker 配置分权。** Web 只读取 Temporal address/namespace/task queue/
  connection security；build/versioning/slot 只由 Worker 入口解析。产品 edition 不推断 Temporal
  托管方式，API key 只能配 TLS。
- **DE-19 — Migration 只前进。** 已发布 migration byte-for-byte 不变；不兼容 schema/
  Workflow payload 发布前排空相应实例。部分 schema 或未知 source fail closed，不靠逐条 DDL
  猜测修补。
- **DE-20 — Durable 控制面有复杂度预算。** 新增 timer、lease、claim、reconciler、execution
  receipt 或第二状态 projector 默认是复发信号。预算脚本必须把 Codex runtime placement 与长
  Task kernel 分开报告，不能靠移动文件隐藏代码。

## 正常时序

### Task-producing Operation

```text
MCP/API/UI provides stable operation identity
→ normalize input and freeze Plan/Grant when billable
→ start immutable OperationExecutionWorkflow
→ persistence Activity transaction creates execution output + Task(s) + Batch
→ Scheduler grants capacity
→ TaskWorkflow runs one business attempt through heartbeat Activity
→ terminal Activity commits Task/Billing/Resource/Batch facts
→ capacityReleased
→ notify ready FollowUpBatch through internal AssistantRuntime route
```

### Task follow-up

```text
ready batchId
→ Activity POST internal runtime follow-up using deployment secret
→ route validates caller and batchId only
→ AssistantRuntime loads canonical Batch and exact-replays source
→ success writes notifiedTurnId/notifiedAt
→ project busy retries same Activity/batchId
→ canceled/notified batch completes without a second Turn
```

## 失败、取消与并发

| 场景 | 唯一结果 |
| --- | --- |
| Operation start ACK 丢失 | 同 execution identity 读取原 result |
| persistence commit 后 Activity 丢失 | exact replay，不创建第二 Task/Batch |
| Worker 强杀 | heartbeat timeout；同 business attempt identity 恢复或按 policy 失败 |
| Provider submit ACK 不明 | outcome_unknown；不自动重提 |
| terminal commit 后 Worker 丢失 | terminal replay，再 release capacity/notify |
| 重复/乱序 terminal | Task 与 Batch member 均按 identity 幂等 |
| cancel 与 completed 竞争 | 已提交 terminal 优先 |
| follow-up 与前台 Turn 竞争 | Batch 保持 ready，typed retry；不抢占前台 |
| clear 与旧 Task 晚到 | canceled Batch 禁止 ghost Turn |
| internal follow-up ACK 丢失 | 同 batchId/source exact replay |
| Temporal unavailable | typed failure；无第二 transport |

## 权威入口

- Temporal config/client/worker：`src/lib/temporal/**`。
- Operation durable dispatch：`src/lib/operations/durable-dispatch.ts`、
  `src/lib/operations/durable-execution.ts`。
- Task registry/submit/terminal：`src/lib/task/**`。
- Scheduler/Task/Operation workflows 与 activities：`src/lib/temporal/workflows/**`、
  `src/lib/temporal/activities/**`。
- Follow-up publisher：Task terminal Activity → `src/lib/temporal/assistant-runtime-follow-up/**` →
  internal Codex Runtime route。
- AssistantRuntime 不属于 Temporal：`src/lib/assistant-runtime/**`。

## 已删除且不得恢复

- `AgentThreadCoordinatorWorkflow`、agent-thread Activity/client/Update-With-Start 命令。
- Agent model Activity、SDK RunState resume、Temporal model history/checkpoint。
- BullMQ、Outbox、DB claim/lease/heartbeat/reconciler 与 generic TaskSubmissionWorkflow。
- 伪造 HTTP request 的 server follow-up、DB polling/timer 唤醒、每 Task 独立等待状态机。
- app-server 或 MCP 失败后改走旧 Agent/同步 Provider 的 fallback。

## 发布与验证

- 真实 Temporal+MySQL：Operation exact replay、Task attempt、Worker kill、heartbeat timeout、
  terminal/ACK loss、cancel race、capacity release、Batch ready/notify/cancel/late terminal。
- Provider ledger：external id、outcome_unknown 与 cancel compensation。
- Registry conformance：全部 task-producing/billable Operation 都走统一 durable dispatch。
- Worker deployment：digest/build/versioning/PINNED、blue/green promote/drain/retire 守卫。
- Compose：预构建镜像无需宿主源码脚本，Web 与 Worker 是不同进程/失败域。
- 真实 Provider 长媒体、生产规模 history 与正式部署排空仍必须在发布环境复验。

## 历史回归

旧系统曾同时使用 BullMQ redelivery、DB attempt heartbeat、shutdown release、reconciler、Outbox
与 Temporal 判断同一 Task 是否仍运行，产生重复 attempt、假失败和长期卡住。随后又把交互式
Agent Turn 塞进 Temporal，为 model history、RunState、快速用户消息和 approval ACK 建立了巨大
Coordinator。当前边界删掉两个根因：Task 只由 TaskWorkflow 调度，交互式 Agent 只由 Codex
Runtime 执行；二者唯一交点是稳定 batchId 的完成通知。
