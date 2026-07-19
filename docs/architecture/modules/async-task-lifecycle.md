<!-- architecture-module: async-task-lifecycle -->

# 异步任务生命周期

## 设计理念

route、queue、worker、DB、Agent 和 Canvas 必须对同一个 Task 生命周期说同一种语言。Task 是长运行外部工作的权威事实；UI 只投影状态，Agent 只根据明确终态继续，不得由任一层猜测或补造状态。

## 不变量

- **TL-01 — 单一提交入口。** 创建并提交 Task 必须经由统一 submitter；Task、billing freeze、Created TaskEvent、lifecycle broadcast 与 `task.enqueue` Outbox 必须由共享事务 primitive 一次持久化。Operation Plan 在报价与快照持久化前、提交事务在写入任何 Task 前，都必须复用 TaskDefinition 的 `terminalResourceImpact` 验证必需 scope；提交事务还必须验证显式 `episodeId` 确实属于同一 project。缺失或跨 project 的 scope 必须原地失败。普通提交、Operation 批次与批准计划提交必须返回同一显式 `{ taskId, taskType }` 回执，UI 只能在收到该 canonical identity 后建立提交 overlay，不得预写或猜固定 TaskType。operation、route、worker 不得各自直连队列并重写生命周期语义。
- **TL-02 — 显式状态边。** 开始、等待用户、等待外部 provider、完成、失败、取消、重试必须有明确允许的状态转移和责任方。
- **TL-02A — 单个 attempt 只有一个执行者。** worker 开始必须由 DB 以 `status=queued` 原子 CAS 为 `status=processing, attempt=attempt+1`，并返回穷尽的 `claimed / already_processing / terminal / missing` 结果；`processing → processing` 不是合法领取边沿。同一 BullMQ job 的重复、stalled 重投或并发 delivery 只有一个执行者能进入 handler。`already_processing` delivery 必须以运输失败结束，禁止正常 return 后让 BullMQ 把未交接的业务 Task 记为 completed；只有 `terminal / missing` 可以幂等跳过。heartbeat、progress、retry、终态提交与 worker 日志均必须携带该 DB attempt，旧 worker 的晚到写入必须成为 no-op；BullMQ `attemptsMade` 是可丢失的运输事实，Redis 丢失后重建 job 也无权重置业务 attempt。
- **TL-02B — Worker/Redis 运行参数只有一个解析入口。** image/video/music/text/outbox concurrency、provider poll timeout/interval、Outbox lease 与最大持久投递次数必须由 `workers/runtime-config.ts` 的穷尽 registry 解析；Redis host/port/TLS/credentials 必须由 `redis-config.ts` 解析。变量未配置时使用权威入口声明的缺省值；变量一旦存在但格式非法、非正整数、越界或非法布尔值必须原地失败，禁止 worker/Redis client 用 `parseInt(...) || default` 静默改写配置。Outbox dead-letter 只使用 DB `deliveryCount`，BullMQ `attemptsMade` 无业务写权。
- **TL-02C — Worker attempt 上下文必须并发隔离。** Node worker 必须通过真正的 `AsyncLocalStorage` 传播 `taskId + taskAttempt`；ESM 启动时缺少该能力必须原地失败，禁止静默退化为进程全局变量。并发 Task 的日志、progress、LLM/vision 和 provider 回调必须始终读到各自 DB claim 分配的 attempt，不能因另一 Task 先完成或切换异步链而丢失 fence。
- **TL-02D — 本地媒体子进程必须有界且服从权威时间线。** Final/Chapter render 只能经 `video-compose/ffmpeg-command.ts` 启动 FFmpeg/FFprobe；FFmpeg 禁止读取交互 stdin，并必须由显式 stitched canonical duration 派生硬 deadline，超时按当前 Task attempt 失败，heartbeat 不得把静止子进程解释为仍在推进。参与最终混流的临时原声必须统一为 48kHz PCM WAV；原生音轨与 BGM 都必须在唯一混流入口按 canonical duration 执行 `pad → trim → reset PTS`，最终容器由显式 `-t` 裁决时长，不得依赖多路编码 EOF、`-shortest` 或事件到达顺序。
- **TL-03 — 范围与目标一致。** project、episode、chapter 和 target identity 必须从统一 payload/normalizer 派生；写入方与读取方不得使用不同 scope 语义。
- **TL-04 — 提交失败原子回滚。** Task 创建事务中的 target ownership、Wait、billing、event 或 Outbox 任一步失败必须整体回滚，不得留下 Task、冻结金额、孤儿记录或不可恢复 dedupe 状态。Redis 在事务提交后不可用时由持久 `task.enqueue` responsibility 恢复，不得把已正确提交的 Task 伪造为业务失败再补偿。
- **TL-04A — Dedupe 绑定服从当前锁定事实。** 普通读取只可发现 dedupe 候选；复用决定必须在同一事务以 `FOR UPDATE` 重读 Task。候选已经终态、identity/fingerprint 冲突或缺失完整 event/outbox bundle 时必须失败，不得把 REPEATABLE READ 旧快照中的 active Task 绑定给新 Wait。
- **TL-04B — 已提交 Task 只按 canonical identity 复用生命周期。** 同 target、同输入签名的 active Task 只能作为不可变 Operation Plan dependency 加入调用方的唯一 Wait，不得再次创建、入队或收费；同 target、不同输入签名在 active 期间必须拒绝新计划。completed target 由领域资源事实跳过，failed/cancelled target 才可形成新的 PlannedTask。dependency 在 snapshot 写入前必须验证 user/project/episode/type/target 与 active 状态，Wait 绑定继续使用既有锁定 Task 的原子 terminal fold，不得靠客户端状态、refetch 或 dedupe key 猜测。
- **TL-05 — 重试有唯一策略。** 错误分类决定是否进入更高 DB Task attempt；空输出、截断、JSON 解析、Schema 和业务计划校验统一属于 `OUTPUT_VALIDATION`，仅 LLM Task 可由队列重试，临时供应商错误同样可重试，鉴权、配置、余额、内容安全和 outcome unknown 等永久失败不得重试。队列、worker 与 Agent 不能叠加隐式重试或把永久失败吞掉。
- **TL-06 — 终态驱动下游。** Task 完成/失败是唤醒 Agent 和刷新 Canvas 的唯一业务边；不得用轮询、历史消息或局部 loading 推断替代。
- **TL-06A — 终态立即撤销瞬时运行态。** 结构化流和 optimistic runtime 在 Task completed/failed/canceled 终态到达时必须立即退出；历史 `task-submitted` 消息不得继续充当 active Task。Overlay 不得用 TTL 承担清理正确性。Structured stream 以 `streamRunId + stepAttempt + lane + seq` 拒绝旧、重复和乱序 chunk；共享 adapter registry 命中的流必须由 TaskEvent 唯一入口按同一 identity 更新绝对展示检查点，SSE bootstrap 将其投影为不推进 cursor 的 snapshot，刷新后不得依赖组件内存或等待下一 chunk 恢复。检查点不写 Task/资源状态；completed 只进入同 task 的 presentation handoff，failed/canceled 立即清除，旧 run 不得封锁新 retry。源剧本生成和制作规划生成即使复用同一 worker，也必须使用不同 Task type 与 target。
- **TL-06B — 目标失败只跟随最终终态。** 单次 worker attempt 不得把业务目标写成 `failed`，即使当前 `maxAttempts=1` 也不例外；只有 Task 确认进入最终失败终态后，统一目标失败 projector 才可落库。Chapter/Final render 等 `renderStatus` 字段同样受此约束，不能用字段别名绕过。
- **TL-06C — 资源变化只通知正式 Query 重新读取。** 每个 TaskDefinition 必须显式声明 `terminalResourceImpact`；影响 Canvas 的 worker 先持久化正式业务资源，Terminal Service 再在同一终态事务把解析后的 `affectedResources` 写入 completed/failed/canceled Event。同步写 Operation 必须在 registry 显式声明 `workspaceResourceImpact`，且业务写入、输出 schema 校验与 `workspace_resource.broadcast` Outbox 必须由 `invokeProjectAgentOperation` 在同一事务提交；Task-producing Operation 声明 `none`。异步 CreativeResource 可以在 Task 提交事务原子预留 pending Resource 并发布一次仅表示该 pending 事实的 broadcast，最终资源通知仍只归 Task 终态所有。客户端按显式集合用一次 `invalidateQueries(refetchType=active)` 重新读取，不得从 TaskType、target、operation output、历史消息或局部 loading 推断资源，也不得直接写业务 Query Cache。网络失败保留 Query stale/invalidated，交给正常 Query 重试或刷新，不改写 Task/Operation 终态。
- **TL-06D — Task 提交不悬挂前台 Agent。** Assistant 的 Task-producing Operation 在提交事务完成后只返回 durable submission receipt；当前前台 Run 不写 `awaiting_task`，stop controller 也不把 `submitted_tasks` 当作停止条件。一个模型步骤内的 Task members 由独立后台 Run 与 collecting Wait 持有；用户后续 turn 与不依赖未完成结果的 Agent 工具调用可以继续。只有后台 Run 使用 `awaiting_task`，全部成员终态后再由唯一 Outbox continuation 竞争同 scope Run lock。不得让 Task Wait 充当全局 conversation lock，也不得在另一前台 Run 正处于 Approval/Choice 时并发续写 Thread。
- **TL-07 — Queue 观察与恢复只有一个裁判。** BullMQ 只负责运输，Task DB 仍是业务生命周期权威。Queue 观察必须穷尽表达 `alive`、`terminal`、`absent`、`unavailable`；Redis 不可用不得解释成 job 丢失。active Task 在 grace 后观察到 `terminal / absent` 时，唯一 reconciler 必须以 `status + updatedAt` fence 原子恢复同一 Task 为 queued 并重建同 identity job；必须保留 attempt、external id、provider/handler checkpoint、billing freeze 与业务 target owner。heartbeat 过期只说明 worker lease 可能中断，不是 provider 或业务失败证据，禁止据此直接写 Task/target 最终失败。恢复、DB ↔ BullMQ 对账与非法 durable envelope 的显式终止必须由同一个 reconciler 执行，Next 启动逻辑、独立脚本和 worker handler 不得各自改写同一 Task 或业务目标终态。
- **TL-08 — 批准批次与业务投影一次提交、commit 后入队。** `billable_media` 的 operation-specific 业务写入、MutationBatch、Grant、OperationExecution、Task/freeze/Created event/`task.enqueue` Outbox responsibility 必须在唯一 MySQL 事务持久化，并复用普通 Task 相同的事务 primitive；enqueue command 无需未来时间暂存，因为事务 commit 前对 dispatcher 不可见。初次 Outbox 入队与 queued/absent reconciler 恢复必须复用同一 Execution completed 门禁。HTTP 响应、Redis 可用性、第二阶段 release 和逐 Task 补偿都不承担整批正确性。
- **TL-09 — SSE 单握手与复合持久水位。** 服务端必须先订阅 Redis channel，再读取 bootstrap，并按 snapshot → buffered live 精确去重交接；server/client 都必须在有界窗口保存 `event identity → canonical fingerprint`，相同 identity 的不同事实必须 conflict/resync，禁止当成 duplicate 静默跳过。v3 运输水位分别携带 TaskEvent 数字游标、MutationBatch `(createdAt,id)`、Assistant `ProjectAgentEvent.id` 与 Workspace Resource Outbox `(createdAt,id)`；资源 Redis 消息只是实时运输，断线恢复必须从持久 Outbox replay。结构化展示检查点使用 `snapshot:stream:<rowId>:<throughSeq>`，其 payload 明示 `fromSeq=1/throughSeq/checkpointedAt`；同逻辑 step/lane 只恢复最高 attempt 的最新 run，terminal snapshot 必须在检查点之后以相同 taskId 交接。任一事实域尚无水位时，bootstrap 必须发送对应的 level-triggered recovery 事实，禁止只补部分事实域；有界 Resource replay 达到上限时也必须追加全 workspace recovery checkpoint，不能静默截断遗漏的资源种类。客户端刷新后从持久水位重连，旧 v1/v2 cursor 不兼容并显式拒绝，禁止双轨 parser 或持续 replay polling承担正确性。服务端渲染没有浏览器 session storage 能力，必须以空 transport cursor 渲染；只有浏览器中的同一 cursor reader 可以恢复持久水位，禁止在 render 阶段直接读取 `window`。
- **TL-09A — Assistant continuation dead-letter 必须先完成业务结算。** `project_agent.continue_wait` 投递耗尽时，Outbox 不能先标 dead 再留下 `awaiting_task`。唯一顺序是：复用 Assistant continuation settlement 原子结算 checkpoint、Activity、Wait、Run、Thread message 与 Session Event，事务成功后再 dead-letter；结算失败保留 Outbox 可重试。未执行命令使用 `delivery_exhausted`，已有 running checkpoint 使用 `outcome_unknown`，不得重新调用模型。
- **TL-09B — Wait 终态聚合是事件合并，collecting seal 是唯一早到折叠边界。** 并发 Task Terminal transaction 必须串行锁定 `pending` Wait aggregate，并把本次终态事件合并进 `terminalTaskIds/failedTaskIds/canceledTaskIds`；最后一个事件创建唯一 continuation Outbox。模型步骤尚未结束时 Wait 为 `collecting`，Terminal Service 不得提前恢复；seal 事务必须锁定精确 Task membership，把状态一次切为 `pending`，并在同一事务按已锁定 Task 的真实终态折叠 seal 前早到事件。seal 之后禁止在锁等待后用普通 Task SELECT 判断整批终态，也禁止轮询补救丢失的唤醒。
- **TL-10 — 业务目标写入必须携带 Task 所有权 fence。** 会进入 `generating` 的持久资源必须在 Task 创建事务或 worker 的明确开始边沿记录 `generationTaskId`（或同等 execution identity）；Chapter/Final render 必须在 Task、billing、Created Event 与 Outbox 同一提交事务取得 `renderTaskId`，worker 只能以 `(target, renderTaskId, processing)` CAS 物化成功。视觉风格方案文本 Task 在持锁事务中创建整批 pending 候选并把自身 taskId 写为来源/重放 watermark；媒体批准事务再把每个候选切换为其唯一 direct image Task owner。成功、失败与取消 projector 只能以 `(resourceId, generationTaskId, activeStatus)`（或等价 render fence）CAS。成功后必须保留最后完成 Task 的 ownership watermark，并允许同一 Task 在“资源已提交、handler checkpoint 尚未提交”窗口中幂等返回正式资源。`ProjectEditBible`、`ProjectEditScript`、`ProjectEditShotExecutionPlan`、BgmDesign、MusicScore、StylePreview、ProjectVideoSegment 与 render target 均受同一规则约束。旧 Task 晚到只能成为 no-op，未知 target/type 组合必须显式失败。
- **TL-11 — Task 契约必须在一个 registry 穷尽。** 每个 TaskDefinition 必须声明 queue、worker handler、billing policy、retry、success handoff、submission target ownership、`terminalResourceImpact`、failure projector 与 cancel projector；不得用 helper 默认 `none` 掩盖缺失。四个 worker、Billing、submission ownership 与 Terminal Service 只按 registry 的 capability key 分派，不得各自按 TaskType 维护 switch。Terminal Service 在同一事务内按 registry 调用 projector并构造资源通知。取消只撤销当前 Task 的目标所有权并回到可重试的 pending，不得复用 failure projector 或写成 `failed`。
- **TL-12 — EditBible 成功事务持锁。** `persistGeneratedEditBibleBundle` 必须从事务第一步 `FOR UPDATE` 锁定 Bible，并校验 id、episode、sourceDocument、generationTaskId 与 generating。source read、bundle validation、chapter/style/Bible 全部写入在同一持锁事务，最终以完整 owner fence CAS；旧 Task 成功、失败或取消不得覆盖新 owner。
- **TL-13 — 单 attempt 外部执行至多一次。** Task 中每一个媒体、LLM 与 vision 生成单元必须在发出请求前以 `taskId + executionFingerprint + invocationKey + requestHash` 持久化唯一 invocation fence，并以 DB `Task.attempt` 作为提交资格版本。一个逻辑 invocation 在同一 attempt 只能提交一次；明确成功结果持久化为 `submitted` 并可重放，成功的同批 cue/候选/章节不会因兄弟单元失败而重复生成。只有三类明确事实可把该 invocation 原子切为 `retryable_rejected`：provider 以 typed HTTP 状态证明未受理、结构化模型结果已返回但未通过输出校验、已持久化 external id 的 provider job 以共享协议明确进入 `retryable` 失败终态。仅更高 DB attempt 可重新取得该 invocation 的一次新提交权，同 attempt 与旧 attempt 禁止重提；不传旧输出或 issues，也不创建 repair prompt。明确永久 HTTP/业务拒绝与 async `permanent` 终态关闭 Task；POST 断连、超时、无类型 `success:false` 或响应无法证明是否受理时进入 `outcome_unknown`，任何 attempt 都禁止再提交。已受理且仍 pending 的 external id 只能继续 poll；poll 传输失败保留 external id，明确 retryable 终态失败先重开对应 invocation 再清除 external id。本地下载、对象存储或 DB 持久化失败不得重开 invocation，下一 attempt 重放已有 provider 结果并复用 `taskId + artifact identity` 稳定产物 key。Task 最终成功只由 Terminal Service 向用户结算一次；最终失败退回用户额度，平台承担已发生的外部成本。
- **TL-14 — Durable command、checkpoint 与 resource row 只存有裁决力的事实。** Outbox command 由 `id + kind + payload identity` 裁决幂等与分派，provider checkpoint 由 `taskId + stepKey + invocation identity/hash/status` 裁决提交与重放；整集 BGM 规划由 `ProjectEditBgmDesign.taskId + designSignature + timelineSignature` 裁决，MusicScore 只以当前生成 `taskId + designSignature + timelineSignature` 裁决候选与 mix；ProjectVideoSegment 由 `(editScriptId, segmentId) + inputSignature + generationTaskId` 裁决。规划与媒体生成是独立 Task 时不得用同一可覆盖字段冒充两个 owner。不得在 DB 行和 JSON payload 中重复持久化永远固定、没有 writer/reader 分支的 `version/contractVersion`。真实并发 fence 必须保留；不兼容形状变更禁止双轨解析。
- **TL-15 — 创作 Resource 与领域成功同终态交接。** 需要向 Agent/Canvas 暴露创作产物的 TaskDefinition 必须声明唯一 terminal output materializer。`commitTaskTerminal` 在同一事务中先完成 owner-fenced 领域 success projector，再为通用预留候选或专业 `sourceType + sourceId` 追加不可变 CreativeResourceRevision、Lineage 与 provenance；真实 Resource refs 必须合并进 Task result/Event 后才能唤醒 Wait。任一步失败时 Task 不得进入 completed。终态重放只能返回同一 Revision，专业 Task 失败/取消不得破坏旧成功 head；Terminal Event 必须同时发布原领域 impact 与 `creativeResources` impact，客户端不得用 TaskType 猜第二次刷新。

## 状态所有权

| 事实                                              | 唯一所有者 / 写入入口                                                              | 消费者                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Task 状态、attempt、heartbeat 与错误诊断          | DB `Task` / `src/lib/task/service.ts` 的显式状态边                                 | worker、reconciler、UI、Agent                               |
| 是否允许下一次 attempt                            | `src/lib/task/retry-policy.ts`                                                     | worker 生命周期；BullMQ 只执行 attempts/backoff             |
| 当前 attempt 的执行资格                           | `Task.status + Task.attempt` / `tryClaimTaskAttempt` 的 queued CAS                 | 唯一 worker handler；retry 与 Terminal Service              |
| Worker 异步 attempt 上下文                       | Node `AsyncLocalStorage` / `src/lib/logging/context.ts`                            | progress、LLM/vision、provider 与 worker 日志                |
| BullMQ job 存在性与运输状态                       | BullMQ / `src/lib/task/queues.ts`                                                  | reconciler 只观察，不直接解释业务终态                       |
| DB Task → BullMQ payload                          | `src/lib/task/job-envelope.ts`                                                     | 初次提交与恢复入队                                          |
| Task/billing/Created event/enqueue responsibility | `src/lib/task/transactional-create.ts`                                             | 普通 submitter、批准计划、Outbox dispatcher                 |
| 批准计划的整批 Task/freeze/enqueue responsibility | `src/lib/task/approved-plan-submitter.ts`                                          | OperationExecution 与 Outbox worker                         |
| 批准 Task 的初次与恢复 BullMQ 入队门禁            | `task.enqueue` Outbox 与 reconciler / `src/lib/task/enqueue.ts`                    | BullMQ worker                                               |
| 丢失/终止 job 与中断 worker 的恢复对账            | `src/lib/task/reconcile.ts`                                                        | instrumentation 只启动唯一 reconciler                       |
| SSE Task/Mutation/Assistant/Resource 重放水位     | `src/lib/sse/protocol.ts` 的 v3 复合 cursor；服务端握手 `src/app/api/sse/route.ts` | `useSSE` 只投影并持久化 transport cursor                    |
| Structured stream 展示检查点                     | `TaskEvent(task.stream_checkpoint)` / `src/lib/task/publisher.ts` 的唯一 upsert；identity/选择协议在 `structured-stream-checkpoint.ts` | SSE bootstrap 与 Canvas presentation；不参与 Task/资源裁决 |
| 同步 Operation 资源变化事实与重放                 | 业务事务内的 `workspace_resource.broadcast` Outbox / `resource-change-events.ts` | Outbox worker 实时发布；SSE bootstrap 持久 replay           |
| ProjectEditBible 当前生成所有权                   | `ProjectEditBible.generationTaskId` / Task 创建事务 hook                           | 持锁 success projector 与 terminal failure/cancel projector |
| BgmDesign 规划与 MusicScore 生成所有权 | BgmDesign worker 写唯一 plan；生成 worker 只写 MusicScore 的 `taskId + designSignature` | Canvas 由 BgmDesign task 交接统一 stream；生成 projector 只围栏当前 MusicScore |
| Chapter/Final render 当前所有权                   | `renderTaskId` / `target-ownership.ts` 的 Task 创建事务 claim                     | owner-fenced worker success 与 terminal failure/cancel projector |
| Provider/LLM/Vision 提交资格与可重放结果          | `TaskExecutionCheckpoint` / `src/lib/task/provider-invocation.ts`                  | `ai-exec`、worker retry、Terminal Service                   |
| Task 对象存储产物身份                             | `src/lib/task/artifact-storage.ts` 的 `taskId + artifact`                          | worker upload、MediaObject upsert                           |
| Outbox 投递次数与 dead-letter                     | `OutboxCommand.deliveryCount` / Outbox worker                                      | dispatcher、告警与人工处理                                  |
| Assistant continuation 投递耗尽结算              | `settleProjectAgentWaitContinuationDeliveryExhausted`                              | Outbox worker 只在结算成功后写 dead                          |
| Assistant 模型步骤 Task 聚合身份与 seal           | `OperationBatch(batchId/backgroundRunId/waitId/toolCallId members)` / Task transaction member binding + runtime step seal | 前台 Agent receipt、后台 Wait、Task terminal continuation |
| Canvas 正式 Query 内容                            | Query service / React Query fetch                                                   | Canvas projection；Task Event 只触发 invalidate/refetch     |
| 异步创作 Revision、Lineage 与 Agent output refs   | `commitTaskTerminal` 内的 Creative Resource materializer                           | Resource Query、Canvas、Task continuation                   |
| Worker/Redis/Reconciler/Outbox 运行参数           | `workers/runtime-config.ts` 与 `redis-config.ts`                                   | worker constructors、provider async wait、dispatcher、reconciler、Redis clients  |

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
- Assistant OperationBatch identity、成员原子绑定与 seal：`src/lib/project-agent/operation-batch.ts`、`src/lib/project-agent/waits.ts` 的 `bindProjectAgentOperationBatchWaitMemberInTransaction` / `sealProjectAgentOperationBatchWait`；旧前台 Task suspension/handoff 不得恢复。
- Task 查询 route：`src/app/api/tasks/**` 与 `src/app/api/task-target-states/**` 只投影 Task service/operation 的权威状态，不得从 payload、历史消息或轮询次数重建生命周期。
- 批准计划到整批 Task 的唯一入口：`src/lib/task/approved-plan-submitter.ts`；初次 Outbox 投递与 queued/absent 恢复都复用 `src/lib/task/enqueue.ts` 的 execution-completed 门禁。
- Task/Operation 资源影响声明与唯一 resolver：`src/lib/workspace-resource/resource-impact.ts`；同步 Operation 持久事件：`src/lib/workspace-resource/resource-change-events.ts`；终态通知与 Query 重新读取：`src/lib/query/workspace-sse-event-sync.ts`、`src/lib/query/resource-change-sync.ts`。
- Task 终态创作产物物化：`src/lib/creative-resource/task-materializer.ts`；它只能由 Terminal Service 在终态事务内调用，Resource persistence/view 约束见 `creative-resource.md`。
- 重试判定：`src/lib/task/retry-policy.ts`；LLM Task registry：`src/lib/llm-observe/task-policy.ts`。
- Provider invocation fence：`src/lib/task/provider-invocation.ts`；媒体/LLM/vision 调用统一门禁：`src/lib/ai-exec/engine.ts`；稳定 Task 产物 key：`src/lib/task/artifact-storage.ts`。
- Final/Chapter render 的 FFmpeg 子进程门禁：`src/lib/video-compose/ffmpeg-command.ts`；临时 PCM 与 canonical duration 混流：`src/lib/video-compose/final-render-audio.ts`。
- 维护窗口只读排空门禁：`npm run db:async-migration-preflight` / `scripts/check-async-migration-preflight.ts`。
- Worker concurrency 与 external poll 配置：`src/lib/workers/runtime-config.ts`；Redis 配置：`src/lib/redis-config.ts`；共享正整数解析：`src/lib/runtime-config/positive-integer.ts`。

## 验证

- `tests/integration/task/create-task-dedupe.integration.test.ts`、`approved-operation-plan-batch*.integration.test.ts` 和 `outbox-delivery-lifecycle.integration.test.ts` 使用真实 MySQL/Redis 验证 Task/freeze/event/outbox 的原子创建、去重、active dependency 进入同一 Wait、回滚和恢复。
- `tests/integration/task/task-attempt-claim.integration.test.ts`、`task-reconcile-queue.integration.test.ts`、`task-target-terminal-{ownership,projectors}.integration.test.ts` 与 `bgm-design-owner-fence.integration.test.ts` 验证并发 attempt owner 的穷尽 claim、queue unavailable、真实 Redis terminal delivery 后保留 external id/target owner 的同 Task 恢复、late terminal、BGM 规划 owner 和唯一业务 projector。
- `tests/integration/task/project-agent-task-terminal-wait-concurrency.integration.test.ts` 验证同一步重复图片 Operation 与音频/视频 Operation members 共享后台 Wait、seal 前终态不丢失、后台任务不阻塞新用户 Run，并发终态收敛且 continuation command 唯一。
- `tests/integration/task/worker-log-context-concurrency.integration.test.ts` 在真实 tsx worker 启动方式下交错两个 Task，验证 `taskId + taskAttempt` 不会退化为共享进程变量。
- `tests/integration/task/{provider-invocation-at-most-once,async-migration-preflight,edit-script-ownership-migration}.integration.test.ts` 验证 provider POST fence 的同 attempt 单提交、成功兄弟重放、仅失败 invocation 由更高 attempt 重取、external terminal failed 重开、永久拒绝与结果未知零重提，以及维护窗口 fail-closed 与真实 schema 安装。
- `tests/integration/task/final-render-ffmpeg.integration.test.ts` 使用真实 FFmpeg 反证短原声与两条 M4A 音频的编码尾差会截断或挂起最终混流，并验证临时原声为 PCM、最终容器服从 stitched canonical duration 且同时包含音视频流。
- `tests/unit/task/{job-envelope,retry-policy,target-ownership,normalize-error,operation-result-normalizer}.test.ts` 与 `tests/unit/sse/{protocol,server-session}.test.ts` 只验证纯协议和 resolver 边界。
- `tests/contracts/task-definition-conformance.test.ts` 从生产 Task registry 穷尽验证 queue、handler、billing、retry、execution 和 terminal projector 声明。
- `tests/golden-journey/journeys/{mainline-complete,freeform-resources}.spec.ts` 通过真实 Task terminal、Outbox、SSE 和刷新验证专业/通用输出 Revision、Resource refs、精确失败重试与 Canvas 交接。
- Task 相关静态 guards 只阻止已知第二 writer/入口重新出现，不作为 route → worker → DB 行为证明。
## 本批 migration 发布门禁（必须人工执行，当前未应用）

`20260711020000` 至 `20260711070000` 以及 `20260712233000` 只能在维护窗口整体切换，禁止旧/新协议双轨运行：

1. 暂停新 Task/Operation/Assistant Run 提交并停止 worker 消费；等待 BullMQ 与 DB 中所有 active Task 排空。
2. 运行 `npm run db:async-migration-preflight`，用只读查询证明 active Task、`edit_style_previews_generate` 旧父任务、待交付 Outbox、非终态 Assistant Run/Wait 五类计数全部为 `0`。任一计数非零立即中止发布；禁止手工忽略结果。
3. 不得从已被 progress 合并污染的 `Task.payload` 回填 `executionFingerprint`，也不得猜测 `ProjectEditBible.generationTaskId`。本批对这些不可靠身份采用“排空后切换”；早期 `20260711010000` 的确定性 `runVersion/eventSeq` 历史回填是单独、显式的 migration 步骤，不得被描述为不存在。
4. 在应用 migration（或可重建环境使用 `npm run db:push`）、部署新代码、启动 dispatcher/worker 后，验证 guards、schema 与只读健康检查，最后恢复提交流量。
5. `20260711030000` 会删除 `operationConfirmed`；因此 migration 与新应用必须作为同一维护窗口切换，禁止旧应用实例继续写入。
6. `20260712233000` 会删除 Outbox、provider checkpoint、审批链和持久 JSON 中没有分流语义的固定标记；旧代码仍会写这些字段，新代码会 strict-reject 旧 JSON，因此必须在同一维护窗口先排空、迁移，再一次性切换全部应用与 worker。
7. `20260715160000_unify_audio_design` 新增统一 `ProjectEditAudioDesign`，并把 BGM 生成资源切换到 `designSignature`；它不再尝试改造即将删除、且历史物理表名不一致的环境音表。`20260715190000_remove_ambient_sound` 删除两种历史环境音表名和 sound-effect 配置列，把唯一规划表切换为 `project_edit_bgm_designs`，并将不兼容的旧设计失效为 `pending`，强制经唯一 BGM planner 重新规划。应用本次迁移前必须排空旧 BGM/环境音规划、两类生成 Task 与 final render；本仓只创建 migration，未授权也未执行任何共享数据迁移。
8. `20260717120000_add_creative_resource_spine` 只新增 Resource/Revision/Lineage/Binding 表与引用，不删除或改写既有专业领域表；本仓只创建并验证 migration 文件，没有授权执行任何共享或生产数据 migration。

## 历史回归

- Assistant 旧协议把 Task receipt 解释成当前 Run 的 suspension：一个 Operation 建一个 Wait、前台 Run 进入 `awaiting_task`，因此 Task 在跑时用户无法自然继续同一创作会话；为规避跨 Operation 聚合 race，后续又禁止模型同一步多调用，但真实模型仍会发出三次独立图片调用并让整个 Run 在批准前失败。当前每个模型步骤使用一个独立后台 OperationBatch Run/collecting Wait，成员 Task transaction 原子加入，step boundary seal，前台收到 receipt 后继续。Terminal Service 只处理 sealed `pending` Wait，seal 折叠早到终态，用户新 turn 不再取消后台 Run；continuation 遇到前台/Decision Run 时通过持久 Outbox `availableAt` 延期，不消耗 delivery failure 上限。已执行的真实 MySQL 场景反证重复图片与音频/视频混合成员、seal race、新前台 Run、并发 terminal 与单 continuation；typed defer 的 dispatcher 重投按用户要求留待后续验证。

- 最终成片在真实三路音频组合中曾长期停在估算 99%：Task DB 实际停于 `final_render_music`，FFmpeg 已写出不含 `moov` 的半成品后不再推进，但 worker heartbeat 仍持续刷新。根因是章节原声先逐段编码为 AAC/M4A、再拼接为 AAC/M4A，编码 priming 与帧取整让权威时间线出现三路尾差；最终滤镜又用 `amix duration=first + -shortest` 把终止裁决交给不同 EOF，且共享 FFmpeg 执行入口没有 deadline。当前 Final/Chapter render 的临时原声统一为 48kHz PCM WAV，原生音轨与 BGM 都按 stitched canonical duration 执行 `pad → trim → reset PTS`，最终输出使用显式 `-t`；唯一 `ffmpeg-command` 入口禁用 stdin 并按媒体时长设置硬 deadline。`final-render-ffmpeg.integration.test.ts` 使用真实 FFmpeg 验证短原声与较长 M4A BGM 仍生成完整时长且同时含音视频流；超长真实媒体在不同硬件上的最坏性能仍是未验证盲区。

- BGM 与环境音拆成“免费文本规划 → 收费媒体生成”后，第一次修正给两个资源各加 `planTaskId`，虽然避免生成 `taskId` 覆盖规划 stream owner，仍留下两个 plan writer；统一 AudioDesign 只删除了两个 plan writer，仍保留环境音生成链。当前只有一个 `ProjectEditBgmDesign`、一个 `BGM_DESIGN_PLAN` owner 和一个 MusicScore 生成资源；Golden 同时断言单规划 Task、单付费 BGM Task、签名一致、候选数量、连续 presentation 以及旧环境音入口为零。

- Task 资源影响改为 registry 明示后，完整 Critical 场景暴露出旧测试和底层 primitive 能创建缺少 `episodeId` 的 `IMAGE_PANEL` Task，批准计划也能报价并持久化缺少 scope 的 `EDIT_STYLE_PREVIEW_IMAGE`，两者都直到终态/提交才失败；原子提交防线只证明 Task/event/Outbox 同事务，没有证明 scope 可供下游解释。当前 Operation Plan 报价/快照和共享提交事务都复用同一 TaskDefinition impact resolver，提交还验证 project/episode 归属，终态继续 fail-closed；Critical 场景使用真实 episode，不再靠非法 fixture 绕过生产契约。

- 资源刷新最初由多个客户端 Effect 同时观察 Task target、TaskType、operation result 和本地 generation baseline，再用 timer/refetch 猜最终资源；`04aa9681d` 把猜测集中到 `affectedResources` helper，但仍从 target/output 推断且同步 Operation 只发不可重放 Redis 消息，断线或组合 target 仍会漏刷新。当前 Task 资源影响由穷尽 TaskDefinition 声明并只由 Terminal Service 写入终态 Event；同步 Operation 由 registry 声明 impact，业务写入、输出校验与资源 Outbox 同事务提交，SSE v3 从 Outbox replay；旧 target invalidator、batch baseline Effect、timer 和 output interpreter 已删除。现有 conformance 拒绝未声明 Task/Operation，结构 guard 拒绝恢复启发式；真实浏览器断线跨 Operation/Task 组合仍需主 Golden 环境验证。

- BGM 的 `music_score_plan` 曾同时在 music worker 内生成文本规划和付费音乐，后续虽拆为文本 Task 与媒体 Task，又与环境音各自形成规划状态机。现在唯一 BgmDesign 文本 Task 负责 `planning → planned`，唯一 MusicScore Task 负责 `generating → completed`；取消回到可重试 `pending`，失败/取消 projector 不修改冻结设计。该 TaskDefinition 与 schema 切换不兼容旧活动声音 Task，发布前必须排空并在同一维护窗口应用 migration。

- 多章节主 Journey 并发持久化核心剪辑 requirement 时曾触发 Prisma `P2034` write conflict/deadlock；共享错误规范化遗漏该官方可重试事务错误，worker 因而把一次瞬时冲突写成业务最终失败。当前 `src/lib/prisma-error.ts` 将 `P2034` 归入统一 retryable 数据库错误，仍由 Task attempt owner 和既有 max-attempt/backoff 协议负责重试，业务 service 不增加局部循环或第二 retry owner。

- `95254ae71` 尝试收敛 AI 与 Task 重试，但错误分类没有成为唯一来源时，重试仍会在多层复发。
- 共享错误裁判与 durable provider fence 曾补齐 provider 的数值 `status/code`，但 AI SDK `APICallError` 使用 `statusCode`，切换 SDK 后同一根因会换形复发：明确 429/5xx 可能被 fence 写成永久 `outcome_unknown`，403 欠费也可能丢失业务分类。现在 `normalizeAnyError` 与 `provider-invocation.ts` 的显式 HTTP 裁决都按同一 `status/statusCode/code` 顺序读取；明确未受理才写 `retryable_rejected` 并继续由 Task retry policy 唯一决定更高 attempt，provider adapter 不新增局部 retry 或错误表。
- `ba753a204` 去除隐式队列重试后，后续又需要显式任务生命周期与错误分类，说明“删重试”本身不能替代契约。
- 真实 `GJ-WORKER-RETRY-RECOVERY` 曾证明 durable provider fence 把明确 HTTP 503 统一写成永久 `rejected`，使 Task registry 的 retry 永远不可达；防线必须同时执行“同 attempt 零重提、ambiguous 零重提、明确临时未受理仅由更高 attempt 重取”，不能只断言调用次数。
- 核心剪辑表真实 Task 曾执行 3 个 DB attempts，却只有 attempt 1 的一个 `submitted` 模型 checkpoint；attempt 2/3 重放同一份 Schema-invalid 输出。旧测试分别证明“输出错误可排队重试”和“相同 invocation 只调用一次”，没有执行两者组合；现由结构化结果边界把失败的 invocation 显式重开，并由 provider checkpoint Critical scenario 证明更高 attempt 只重新提交该单元。
- Git 历史严格口径下已有 8 次直接 queue/retry/reconcile 修复；扩展到终态 SSE 与业务目标生命周期则为 10 次。反复出现的共同根因不是 BullMQ 本身，而是 retry、watchdog、worker handler 和启动恢复曾同时解释 Task/target 状态。
- Outbox 行与 payload、provider checkpoint、MusicScore/Soundscape resource row 曾各自写入固定为 `1` 的版本标记，但所有 reader 只有一个实现且从不按该值分流；这制造了重复字段和伪版本治理。本模块只保留真正参与并发、重放、修订或 CAS 裁决的版本事实。
- 视觉风格方案曾是唯一绕过 Task registry 的长文本生成：approval preflight 直接调用 provider 并写候选，Session 无 Task 可投影，失败/重试也跟随 Assistant 请求而非 worker attempt。现新增穷尽文本 TaskDefinition，候选批次只由该 worker 的 taskId 幂等物化。
- 镜头执行计划的长结构化输出曾把 provider 的逐 token delta 直接发布成独立 ephemeral SSE event；两个并行章节及 retry 在正常生成窗口内耗尽 2048 个 identity，客户端虽按契约 fail closed 并请求 snapshot resync，流式 presentation 仍会中断且日志误显为 parse error。首次防线只合并小 delta，降低了 identity 数量，却仍把内容仅留在 Redis 与组件 Map；真实主 Journey 在 processing 中刷新后，两个章节镜头计划和一个 BGM 计划失去 presentation，而 Task、正式资源与最终视频全部成功。当前唯一 worker stream 出口先按字符合并并分配 `streamRunId + stepAttempt + lane + seq`，再由共享 adapter registry 决定是否 upsert 一条绝对 TaskEvent 检查点；bootstrap 合成最新 run/attempt 快照，Canvas 以精确 task+target owner 交给正式 Query。发布时必须排空仍由旧 worker 运行的结构化 Task，禁止兼容无检查点的活动流；Golden 继续用刷新、1 字符 provider 碎片和 DOM observer 验证 processing preview、终态与 console clean。
- 分镜面板纯函数物化曾继续保留为 `edit_script_storyboard_camera_plan` Task，导致一次镜头计划产生第二个 Task/Wait/continuation，而该 Task 没有 provider invocation。首次删除该 Task 后仍保留 Storyboard/Panel 物化和分镜图媒体阶段，只是将旧解释权后移。当前防线已删除整个 Panel/分镜图资源与 Task 链，`edit_shot_execution_plan_generate` 只提交三项镜头执行决策，下一个媒体 Task 只能是 `video_segment`。
- 2026-07 的连续镜头视频曾在 provider 已完成后仍显示进行中：开发 watcher 中断轮询 worker 后，旧 claim 把 processing 冲突与 terminal/missing 混为 `null`，BullMQ 误记 delivery 完成，reconciler 又把 Task/VideoGroup 写成 `RECONCILE_ORPHAN`。当前四态 claim 与唯一 reconciler 保留 external id/checkpoint/target owner；新视频资源统一为 owner-fenced `ProjectVideoSegment`。`task-reconcile-queue.integration.test.ts` 用真实 MySQL/Redis terminal job 反证旧实现；付费 provider 的真实结果下载与对象存储仍是本地集成场景之外的盲区。

## 修改检查表

1. Task 的 scope、target、输入类型和输出类型的权威来源是什么？
2. 每个状态边由谁写入，失败与取消如何表现？
3. 任务提交失败时，哪些记录、队列项、冻结或锁需要补偿？
4. 错误如何分类，哪一层有权重试？
5. 是否覆盖 route → Task → worker → DB → stream 的真实组合路径？
6. Redis unavailable、queued/processing 与 absent/terminal 的组合恢复、external id 续接、stalled/late event 是否均有显式行为测试？
