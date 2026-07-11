<!-- architecture-module: async-task-lifecycle -->

# 异步任务生命周期

## 设计理念

route、queue、worker、DB、Agent 和 Canvas 必须对同一个 Task 生命周期说同一种语言。Task 是长运行外部工作的权威事实；UI 只投影状态，Agent 只根据明确终态继续，不得由任一层猜测或补造状态。

## 不变量

- **TL-01 — 单一提交入口。** 创建并提交 Task 必须经由统一 submitter；Task、billing freeze、Created TaskEvent、lifecycle broadcast 与 `task.enqueue` Outbox 必须由共享事务 primitive 一次持久化。operation、route、worker 不得各自直连队列并重写生命周期语义。
- **TL-02 — 显式状态边。** 开始、等待用户、等待外部 provider、完成、失败、取消、重试必须有明确允许的状态转移和责任方。
- **TL-02A — 单个 attempt 只有一个执行者。** worker 开始必须由 DB 以 `status=queued` 原子 CAS 为 `status=processing, attempt=attempt+1`，并返回 DB 分配的 attempt；`processing → processing` 不是合法领取边沿。同一 BullMQ job 的重复、stalled 重投或并发 delivery 只有一个执行者能进入 handler。heartbeat、progress、retry、终态提交与 worker 日志均必须携带该 DB attempt，旧 worker 的晚到写入必须成为 no-op；BullMQ `attemptsMade` 是可丢失的运输事实，Redis 丢失后重建 job 也无权重置业务 attempt。
- **TL-02B — Worker/Redis 运行参数只有一个解析入口。** image/video/music/text/outbox concurrency、provider poll timeout/interval、Outbox lease 与最大持久投递次数必须由 `workers/runtime-config.ts` 的穷尽 registry 解析；Redis host/port/TLS/credentials 必须由 `redis-config.ts` 解析。变量未配置时使用权威入口声明的缺省值；变量一旦存在但格式非法、非正整数、越界或非法布尔值必须原地失败，禁止 worker/Redis client 用 `parseInt(...) || default` 静默改写配置。Outbox dead-letter 只使用 DB `deliveryCount`，BullMQ `attemptsMade` 无业务写权。
- **TL-03 — 范围与目标一致。** project、episode、chapter 和 target identity 必须从统一 payload/normalizer 派生；写入方与读取方不得使用不同 scope 语义。
- **TL-04 — 提交失败原子回滚。** Task 创建事务中的 target ownership、Wait、billing、event 或 Outbox 任一步失败必须整体回滚，不得留下 Task、冻结金额、孤儿记录或不可恢复 dedupe 状态。Redis 在事务提交后不可用时由持久 `task.enqueue` responsibility 恢复，不得把已正确提交的 Task 伪造为业务失败再补偿。
- **TL-04A — Dedupe 绑定服从当前锁定事实。** 普通读取只可发现 dedupe 候选；复用决定必须在同一事务以 `FOR UPDATE` 重读 Task。候选已经终态、identity/fingerprint 冲突或缺失完整 event/outbox bundle 时必须失败，不得把 REPEATABLE READ 旧快照中的 active Task 绑定给新 Wait。
- **TL-05 — 重试有唯一策略。** 错误分类决定是否重试；LLM 任务的模型输出校验失败可由队列重试，临时供应商错误同样可重试，鉴权、配置、余额和内容安全等永久失败不得重试。队列、worker 与 Agent 不能叠加隐式重试或把永久失败吞掉。
- **TL-06 — 终态驱动下游。** Task 完成/失败是唤醒 Agent 和刷新 Canvas 的唯一业务边；不得用轮询、历史消息或局部 loading 推断替代。
- **TL-06A — 终态立即撤销瞬时运行态。** 结构化流和 optimistic runtime 在 Task completed/failed/canceled 终态到达时必须立即退出；历史 `task-submitted` 消息不得继续充当 active Task。Overlay 不得用 TTL 承担清理正确性。Structured stream 以 `streamRunId + stepAttempt + seq` 拒绝旧、重复和乱序 chunk，旧 attempt 的终态不得封锁新 retry。源剧本生成和制作规划生成即使复用同一 worker，也必须使用不同 Task type 与 target。
- **TL-06B — 目标失败只跟随最终终态。** 单次 worker attempt 不得把业务目标写成 `failed`，即使当前 `maxAttempts=1` 也不例外；只有 Task 确认进入最终失败终态后，统一目标失败 projector 才可落库。Chapter/Final render 等 `renderStatus` 字段同样受此约束，不能用字段别名绕过。
- **TL-06C — 终态只通知资源重新读取。** 影响 Canvas 的 worker 必须先持久化正式业务资源；Terminal Service 随 completed/failed/canceled Event 携带显式 `affectedResources`。客户端按该集合 invalidate 并 refetch active Query，Task payload 不携带 Query DTO，也无权直接写业务 Cache。缺少资源声明时不得按 TaskType 推断；网络失败保留 Query stale/invalidated，交给正常 Query 重试或刷新，不改写 Task 终态。
- **TL-07 — Queue 观察与恢复只有一个裁判。** BullMQ 只负责运输，Task DB 仍是业务生命周期权威。Queue 观察必须穷尽表达 `alive`、`terminal`、`absent`、`unavailable`；Redis 不可用不得解释成 job 丢失。恢复、超时终止和 DB ↔ BullMQ 对账必须由同一个 reconciler 执行，Next 启动逻辑、独立脚本和 worker handler 不得各自改写同一 Task 或业务目标终态。
- **TL-08 — 批准批次与业务投影一次提交、commit 后入队。** `billable_media` 的 operation-specific 业务写入、MutationBatch、Grant、OperationExecution、Task/freeze/Created event/`task.enqueue` Outbox responsibility 必须在唯一 MySQL 事务持久化，并复用普通 Task 相同的事务 primitive；enqueue command 无需未来时间暂存，因为事务 commit 前对 dispatcher 不可见。初次 Outbox 入队与 queued/absent reconciler 恢复必须复用同一 Execution completed 门禁。HTTP 响应、Redis 可用性、第二阶段 release 和逐 Task 补偿都不承担整批正确性。
- **TL-09 — SSE 单握手与复合持久水位。** 服务端必须先订阅 Redis channel，再读取 bootstrap，并按 snapshot → buffered live 精确去重交接；server/client 都必须在有界窗口保存 `event identity → canonical fingerprint`，相同 identity 的不同事实必须 conflict/resync，禁止当成 duplicate 静默跳过。运输水位必须分别携带 TaskEvent 数字游标、MutationBatch `(createdAt,id)` 游标与 Assistant `ProjectAgentEvent.id` 游标；当客户端尚无 Mutation 或 Assistant 水位时，bootstrap 必须发送对应的 level-triggered recovery 事实，禁止只补一个事实域导致其他域永久脱漏。客户端刷新后从持久水位重连，持续 replay polling 不得承担正确性。
- **TL-09A — Assistant continuation dead-letter 必须先完成业务结算。** `project_agent.continue_wait` 投递耗尽时，Outbox 不能先标 dead 再留下 `awaiting_task`。唯一顺序是：复用 Assistant continuation settlement 原子结算 checkpoint、Activity、Wait、Run、Thread message 与 Session Event，事务成功后再 dead-letter；结算失败保留 Outbox 可重试。未执行命令使用 `delivery_exhausted`，已有 running checkpoint 使用 `outcome_unknown`，不得重新调用模型。
- **TL-09B — Wait 终态聚合是事件合并，不是 Task 快照推断。** 并发 Task Terminal transaction 必须串行锁定 Wait aggregate，并把本次终态事件合并进 `terminalTaskIds/failedTaskIds/canceledTaskIds`；最后一个事件创建唯一 continuation Outbox。禁止在锁等待后用普通 Task SELECT 判断整批终态，也禁止轮询补救丢失的唤醒。
- **TL-10 — 业务目标写入必须携带 Task 所有权 fence。** 会进入 `generating` 的持久资源必须在 Task 创建事务或 worker 的明确开始边沿记录 `generationTaskId`（或同等 execution identity）；Chapter/Final render 必须在 Task、billing、Created Event 与 Outbox 同一提交事务取得 `renderTaskId`，worker 只能以 `(target, renderTaskId, processing)` CAS 物化成功。成功、失败与取消 projector 只能以 `(resourceId, generationTaskId, activeStatus)`（或等价 render fence）CAS。成功后必须保留最后完成 Task 的 ownership watermark，并允许同一 Task 在“资源已提交、handler checkpoint 尚未提交”的崩溃窗中读取正式资源幂等返回；不得清空 owner 后把重放解释成 stale failure。若 failure/cancel 与同一 Task 的正式资源成功提交竞争，projector 必须返回 `success_materialized`，Terminal Service 不得回滚账务或写失败/取消；BullMQ 已终止时由唯一 reconciler 把同一 Task 重新入队完成 checkpoint 与成功终态。`ProjectEditBible`、`ProjectEditScript`、`ProjectEditShotExecutionPlan`、MusicScore、Soundscape、StylePreview、VideoGroup 与 render target 均受同一规则约束。旧 Task 晚到只能成为 no-op，未知 target/type 组合必须显式失败。
- **TL-11 — Task 契约必须在一个 registry 穷尽。** 每个 TaskDefinition 必须声明 queue、worker handler、billing policy、retry、success handoff、submission target ownership、failure projector 与 cancel projector；不得用 helper 默认 `none` 掩盖缺失。四个 worker、Billing、submission ownership 与 Terminal Service 只按 registry 的 capability key 分派，不得各自按 TaskType 维护 switch。Terminal Service 在同一事务内按 registry 调用 projector。取消只撤销当前 Task 的目标所有权并回到可重试的 pending，不得复用 failure projector 或写成 `failed`。
- **TL-12 — EditBible 成功事务持锁。** `persistGeneratedEditBibleBundle` 必须从事务第一步 `FOR UPDATE` 锁定 Bible，并校验 id、episode、sourceDocument、generationTaskId 与 generating。source read、bundle validation、chapter/style/Bible 全部写入在同一持锁事务，最终以完整 owner fence CAS；旧 Task 成功、失败或取消不得覆盖新 owner。
- **TL-13 — 外部执行至多一次。** Task 中每一个媒体、LLM 与 vision provider 调用必须在发出请求前以 `taskId + executionFingerprint + invocationKey + requestHash` 持久化 invocation fence。provider POST 内部不得自动重试。明确成功结果必须持久化并可重放；明确 HTTP/业务拒绝持久化为 rejected；断连、超时或 provider 成功后本地持久化失败一律进入 `outcome_unknown`，禁止再提交。Task 最终失败并由 Terminal Service 退回用户额度，平台承担外部可能已产生的成本。poll/download 可以重试，但不得重建 provider job。provider 结果之后的对象存储产物必须由 `taskId + artifact identity` 生成稳定 key，使 worker crash/retry 复用同一对象与 MediaObject，而不是制造随机孤儿。

## 状态所有权

| 事实                                              | 唯一所有者 / 写入入口                                                              | 消费者                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Task 状态、attempt、heartbeat 与错误诊断          | DB `Task` / `src/lib/task/service.ts` 的显式状态边                                 | worker、reconciler、UI、Agent                               |
| 是否允许下一次 attempt                            | `src/lib/task/retry-policy.ts`                                                     | worker 生命周期；BullMQ 只执行 attempts/backoff             |
| 当前 attempt 的执行资格                           | `Task.status + Task.attempt` / `tryClaimTaskAttempt` 的 queued CAS                 | 唯一 worker handler；retry 与 Terminal Service              |
| BullMQ job 存在性与运输状态                       | BullMQ / `src/lib/task/queues.ts`                                                  | reconciler 只观察，不直接解释业务终态                       |
| DB Task → BullMQ payload                          | `src/lib/task/job-envelope.ts`                                                     | 初次提交与恢复入队                                          |
| Task/billing/Created event/enqueue responsibility | `src/lib/task/transactional-create.ts`                                             | 普通 submitter、批准计划、Outbox dispatcher                 |
| 批准计划的整批 Task/freeze/enqueue responsibility | `src/lib/task/approved-plan-submitter.ts`                                          | OperationExecution 与 Outbox worker                         |
| 批准 Task 的初次与恢复 BullMQ 入队门禁            | `task.enqueue` Outbox 与 reconciler / `src/lib/task/enqueue.ts`                    | BullMQ worker                                               |
| 丢失 job 恢复、stale timeout 与终态对账           | `src/lib/task/reconcile.ts`                                                        | instrumentation 只启动唯一 reconciler                       |
| SSE Task/Mutation/Assistant 重放水位              | `src/lib/sse/protocol.ts` 的 v2 复合 cursor；服务端握手 `src/app/api/sse/route.ts` | `useSSE` 只投影并持久化 transport cursor                    |
| ProjectEditBible 当前生成所有权                   | `ProjectEditBible.generationTaskId` / Task 创建事务 hook                           | 持锁 success projector 与 terminal failure/cancel projector |
| Chapter/Final render 当前所有权                   | `renderTaskId` / `target-ownership.ts` 的 Task 创建事务 claim                     | owner-fenced worker success 与 terminal failure/cancel projector |
| Provider/LLM/Vision 提交资格与可重放结果          | `TaskExecutionCheckpoint` / `src/lib/task/provider-invocation.ts`                  | `ai-exec`、worker retry、Terminal Service                   |
| Task 对象存储产物身份                             | `src/lib/task/artifact-storage.ts` 的 `taskId + artifact`                          | worker upload、MediaObject upsert                           |
| Outbox 投递次数与 dead-letter                     | `OutboxCommand.deliveryCount` / Outbox worker                                      | dispatcher、告警与人工处理                                  |
| Assistant continuation 投递耗尽结算              | `settleProjectAgentWaitContinuationDeliveryExhausted`                              | Outbox worker 只在结算成功后写 dead                          |
| Canvas 正式 Query 内容                            | Query service / React Query fetch                                                   | Canvas projection；Task Event 只触发 invalidate/refetch     |
| Worker/Redis/Reconciler/Outbox 运行参数           | `workers/runtime-config.ts` 与 `redis-config.ts`                                   | worker constructors、dispatcher、reconciler、Redis clients  |

## 权威入口

- Task 类型与状态：`src/lib/task/types.ts`。
- Task 静态契约（queue、worker handler、billing、retry、execution protocol、success/failure/cancel handoff）：`src/lib/task/definition.ts`；新增 TaskType 必须通过穷尽 `satisfies` 与 conformance。
- 提交、队列与计费边界：`src/lib/task/submitter.ts`。
- Task attempt/progress 服务：`src/lib/task/service.ts`；唯一终态事务：`src/lib/task/terminal/service.ts`。
- Task 创建原子提交：`src/lib/task/transactional-create.ts`；普通与批准 Task 均复用，Redis 只由 `task.enqueue` Outbox consumer 接触。
- Task submission target ownership：`src/lib/task/target-ownership.ts`；render target 的 active owner 在 Task 创建事务中取得，worker 无权无条件改写。
- Task → BullMQ 完整 envelope：`src/lib/task/job-envelope.ts`；Task type → queue 的穷尽映射：`src/lib/task/queues.ts`。
- Queue 四态观察与唯一恢复 cycle：`src/lib/task/reconcile.ts`；`src/instrumentation.ts` 只负责启动，不写 Task。
- Operation 到 Task 的提交适配：`src/lib/operations/submit-operation-task.ts`。
- 批准计划到整批 Task 的唯一入口：`src/lib/task/approved-plan-submitter.ts`；初次 Outbox 投递与 queued/absent 恢复都复用 `src/lib/task/enqueue.ts` 的 execution-completed 门禁。
- Canvas 资源影响声明：`src/lib/workspace-resource/resource-impact.ts`；终态通知与 Query 重新读取：`src/lib/query/workspace-sse-event-sync.ts`、`src/lib/query/resource-change-sync.ts`。
- 重试判定：`src/lib/task/retry-policy.ts`；LLM Task registry：`src/lib/llm-observe/task-policy.ts`。
- Provider invocation fence：`src/lib/task/provider-invocation.ts`；媒体/LLM/vision 调用统一门禁：`src/lib/ai-exec/engine.ts`；稳定 Task 产物 key：`src/lib/task/artifact-storage.ts`。
- 维护窗口只读排空门禁：`npm run db:async-migration-preflight` / `scripts/check-async-migration-preflight.ts`。
- Worker concurrency 与 external poll 配置：`src/lib/workers/runtime-config.ts`；Redis 配置：`src/lib/redis-config.ts`；共享正整数解析：`src/lib/runtime-config/positive-integer.ts`。

## 验证

- `tests/integration/task/create-task-dedupe.integration.test.ts` 验证去重与重复提交。
- `tests/integration/task/create-task-dedupe.integration.test.ts`、`tests/regression/task-submission-durable-outbox.test.ts` 与 `tests/system/task-submission-durable-outbox.system.test.ts` 验证 batch 严格复用/冲突/整体回滚，以及 Redis 不可用时 Task/freeze/event/enqueue responsibility 仍原子提交且 submitter 零直写队列。
- `tests/unit/task/service-operation-metadata.test.ts` 验证 operation metadata 语义。
- `tests/unit/task/job-envelope.test.ts` 验证恢复入队不会丢失 billing、operation、scope、priority 与 trace。
- `tests/unit/task/execution-checkpoint.test.ts` 验证 handler result 直接进入 terminal-ready checkpoint，旧 materialization-only `executed` 状态原地失败。
- `tests/unit/task/reconcile-target-sync.test.ts` 与 `reconcile-queue-lifecycle.test.ts` 验证 queue unavailable 零写入、批准 Task 恢复仍经过 Execution completed 门禁，以及最终失败投影。
- `tests/integration/task/task-reconcile-queue.integration.test.ts` 验证真实 DB + Redis 下 queued/absent 的完整恢复时序。
- `tests/integration/task/approved-operation-plan-batch.integration.test.ts` 验证真实 DB 下批准批次的 Task/freeze/outbox 原子性。
- `tests/contracts/task-definition-conformance.test.ts` 验证每个 TaskType 的 queue/handler/billing/retry/execution/success/failure/cancel 声明被必跑 guard suite 收集，并阻止 worker、Billing 恢复 TaskType 私有 switch。
- `tests/unit/sse/server-session.test.ts`、`tests/unit/operations/sse-ops.test.ts` 与 `tests/integration/api/contract/task-run-routes.test.ts` 验证 subscribe-before-bootstrap、复合游标、缺失 Mutation 水位的 recovery checkpoint、buffer 去重和 abort cleanup。
- `tests/unit/query/workspace-sse-event-sync.test.ts` 验证 completed/failed/canceled 只按显式 `affectedResources` 请求正式 Query refetch，且不直接写业务 Cache。
- `scripts/guards/task-submit-compensation-guard.mjs` 检查 route 的 create + submit 补偿标记。
- `scripts/guards/no-operation-direct-submit-task.mjs` 阻止 operation 绕过统一提交边界。
- `scripts/guards/no-project-agent-direct-task-submit.mjs` 阻止 Assistant choice/runtime 绕过 operation registry 直接提交 Task。
- `scripts/guards/task-target-states-no-polling-guard.mjs` 阻止以 polling 伪造目标状态。
- `scripts/guards/single-task-reconciler-guard.mjs` 阻止第二 watchdog、instrumentation 直接写 Task，以及四态观察/完整 envelope 被绕过。
- `scripts/guards/no-worker-attempt-target-terminal-write.mjs` 阻止单次 worker attempt 提前写业务目标终态。
- `scripts/guards/terminal-resource-refetch-guard.mjs` 阻止 terminal payload 直接写 Cache、资源版本/trigger 协议和 materialization-only checkpoint 阶段回流。
- `scripts/guards/sse-durable-watermark-guard.mjs` 阻止恢复 5 秒 replay polling、丢失复合水位或颠倒 subscribe/bootstrap 顺序。
- `scripts/guards/edit-bible-task-ownership-guard.mjs` 阻止 ProjectEditBible 回退为无 Task fence 的成功/失败写入。
- `tests/unit/task/provider-invocation.test.ts` 验证 submitted 结果重放、结果未知零重提和明确拒绝；`scripts/guards/provider-submission-at-most-once-guard.mjs` 阻止 provider POST 恢复自动重试或 Task 媒体调用缺失 invocation key。
- `tests/integration/task/provider-invocation-at-most-once.integration.test.ts` 在真实 MySQL 上验证 invocation 首次 claim 的并发互斥、成功重放和 `outcome_unknown` 永不重提；`tests/integration/billing/worker-lifecycle.integration.test.ts` 验证未知提交结果即使 BullMQ 配置了剩余 attempts 也会立即失败、回滚冻结额度且保持用户余额不扣减。
- `tests/integration/task/task-attempt-claim.integration.test.ts` 在真实 MySQL 上以并发 claim 验证每个精确 attempt 只有一个 owner；`scripts/guards/single-task-attempt-owner-guard.mjs` 阻止 `processing → processing` 旧入口、无 attempt retry 或 terminal fence 回流。
- `tests/unit/worker/runtime-config.test.ts` 与 `tests/unit/helpers/redis-config.test.ts` 验证缺省值与非法显式配置的 fail-closed 行为；`scripts/guards/worker-runtime-config-guard.mjs` 阻止 worker 或 Redis client 恢复分散 parse/fallback。
- `tests/integration/task/outbox-delivery-lifecycle.integration.test.ts` 在真实 MySQL+Redis 下验证 add-before-mark、固定 job identity、丢 job 重置、lease reclaim/stale owner 与 poison command 首次 dead-letter；`tests/unit/outbox/queue-observation.test.ts` 验证 Redis unavailable 不得解释为 absent。
- `tests/integration/task/project-agent-continuation-dead-delivery.integration.test.ts` 与 `tests/unit/outbox/project-agent-continuation-dead-letter.test.ts` 验证 Assistant continuation 投递耗尽先结算、后 dead，且 settlement 失败不丢失重试责任。
- `tests/integration/task/task-target-terminal-projectors.integration.test.ts` 验证 MusicScore、Soundscape、EditScript 与 ShotExecutionPlan 的 failure/cancel/late owner CAS；`tests/integration/task/task-target-terminal-ownership.integration.test.ts` 验证正式资源成功先提交时 cancel 不得覆盖成功，且已终态重放必须具有精确 terminal Event/broadcast bundle；`scripts/guards/task-target-ownership-guard.mjs` 与 `no-worker-attempt-target-terminal-write.mjs` 阻止 attempt 恢复第二终态写入者。
- `tests/unit/task/target-ownership.test.ts` 验证 Chapter/Final render 在 Task 创建事务中取得目标 owner；worker success 必须带该 owner CAS，不能自行 claim 或覆盖后来的 target。
- `tests/integration/task/edit-script-ownership-migration.integration.test.ts` 在隔离的真实 MySQL schema 中执行 `20260711070000`，验证两个 owner column 与 index 实际可安装。
- `tests/unit/task/artifact-storage.test.ts` 与 `scripts/guards/task-artifact-idempotency-guard.mjs` 验证 Task 产物 key 稳定且所有 worker 上传都携带显式身份。
- `tests/integration/task/async-migration-preflight.integration.test.ts` 验证维护窗口对 active Task、旧父任务、Outbox、Run 与 Wait 任一非零均 fail-closed。
- `scripts/guards/single-task-billing-owner-guard.mjs` 禁止恢复非事务 `prepare/settle/rollbackTaskBilling`，并强制 Terminal Service 使用 transaction API。
- `scripts/guards/task-submission-atomicity-guard.mjs` 禁止 generic submitter 恢复 Task 创建后的直接 billing/event/BullMQ 副作用，并强制普通与批准 Task 复用同一事务 primitive 和 Outbox consumer。

## 本批 migration 发布门禁（必须人工执行，当前未应用）

`20260711020000` 至 `20260711070000` 只能在维护窗口整体切换，禁止旧/新协议双轨运行：

1. 暂停新 Task/Operation/Assistant Run 提交并停止 worker 消费；等待 BullMQ 与 DB 中所有 active Task 排空。
2. 运行 `npm run db:async-migration-preflight`，用只读查询证明 active Task、`edit_style_previews_generate` 旧父任务、待交付 Outbox、非终态 Assistant Run/Wait 五类计数全部为 `0`。任一计数非零立即中止发布；禁止手工忽略结果。
3. 不得从已被 progress 合并污染的 `Task.payload` 回填 `executionFingerprint`，也不得猜测 `ProjectEditBible.generationTaskId`。本批对这些不可靠身份采用“排空后切换”；早期 `20260711010000` 的确定性 `runVersion/eventSeq` 历史回填是单独、显式的 migration 步骤，不得被描述为不存在。
4. 在应用 migration（或可重建环境使用 `npm run db:push`）、部署新代码、启动 dispatcher/worker 后，验证 guards、schema 与只读健康检查，最后恢复提交流量。
5. `20260711030000` 会删除 `operationConfirmed`；因此 migration 与新应用必须作为同一维护窗口切换，禁止旧应用实例继续写入。

## 历史回归

- `95254ae71` 尝试收敛 AI 与 Task 重试，但错误分类没有成为唯一来源时，重试仍会在多层复发。
- `ba753a204` 去除隐式队列重试后，后续又需要显式任务生命周期与错误分类，说明“删重试”本身不能替代契约。
- Git 历史严格口径下已有 8 次直接 queue/retry/reconcile 修复；扩展到终态 SSE 与业务目标生命周期则为 10 次。反复出现的共同根因不是 BullMQ 本身，而是 retry、watchdog、worker handler 和启动恢复曾同时解释 Task/target 状态。

## 修改检查表

1. Task 的 scope、target、输入类型和输出类型的权威来源是什么？
2. 每个状态边由谁写入，失败与取消如何表现？
3. 任务提交失败时，哪些记录、队列项、冻结或锁需要补偿？
4. 错误如何分类，哪一层有权重试？
5. 是否覆盖 route → Task → worker → DB → stream 的真实组合路径？
6. Redis unavailable、queued+absent 恢复、terminal failed reason、stalled/late event 是否均有显式行为测试？
