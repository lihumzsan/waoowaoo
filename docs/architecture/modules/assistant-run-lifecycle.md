<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Run 生命周期

## 设计理念

Assistant 是受服务端运行时约束的决策者，不是流程状态的权威来源。一次 run 的开始、等待、任务关联、恢复、结算和失败必须由服务端持久状态与锁协调；模型消息、UI 文案或工具输出不能自行宣告流程已完成。

## 不变量

- **AR-01 — 服务端权威。** thread/run 的 append、终态、锁和恢复由服务端管理；客户端和模型不得持有第二套 run 状态。
- **AR-02 — 每回合有结算语义。** 一个 turn 必须明确是完成、等待用户、等待 Task、继续 Agent 还是失败；零输出、伪完成和停滞必须显式报错或进入明确状态。
- **AR-02A — Choice 续跑不可静默完成。** 用户提交结构化选择后，服务端必须重新读取 Workflow；若存在已启用的权威 `nextAction`，本回合必须执行该 operation、进入 approval/choice/Task 等等待态或显式失败，不得只输出成功文案后把 run 标记为完成。
- **AR-02B — Choice Offer 单一权威。** Choice 工具必须先把完整且不可变的 Offer 持久化为不可见 `ProjectAgentExecutionHandoff(kind=choice)`；唯一 settlement 在同一事务中把它写入可见 `ProjectAgentInterruption.payload`、assistant message 与 Run 等待状态。可见 Offer 同时包含 schema version、必填的 run/interruption/card/tool identity、完整卡片和受审资源 fingerprint。首屏 stream 与刷新后的 Session 只能投影已提交的 Interruption Offer；不得刷新时重查资源重建卡片，也不得接受客户端提交的 `choiceType` 作为控制事实。
- **AR-02C — Choice 原子提交。** Choice control 只提交 interruptionId、cardId、toolCallId 与原始回答。服务端必须在同一数据库事务中读取并严格解析 Offer、校验三个身份、重读当前受审资源 fingerprint、把回答规范化成穷尽的 ChoiceDecision，最后消费 interruption 并推进 Run。Event 只持久化规范化 Decision，客户端多余字段不得进入权威历史。身份或 fingerprint 不匹配必须 conflict，且 interruption 保持 pending。
- **AR-02D — Choice 不执行领域写入。** 所有 Choice 卡片统一使用 `submit_tool_output`，只记录用户决定。Workflow 把已消费的决定映射为唯一 `nextAction`，注册式 Operation 独占领域写入。视觉风格选择必须走 `confirm_edit_style_preview`；Choice renderer、Panel 与旧风格生成卡不得直接调用确认 API、不得以空 interruption/tool identity 续跑。
- **AR-02E — 最终消息与 Run 终态原子结算。** 普通 Run 的 assistant message 与 `completed/failed/cancelled` Event 必须由 `settleProjectAgentRunWithMessage` 在同一事务提交；消息写失败时终态不得前进。Thread append 必须锁定唯一 thread aggregate，禁止并发用户消息、普通 Run 和 continuation 通过 read-modify-write 相互覆盖。
- **AR-02F — Choice 定义穷尽注册。** 每一种 Edit-first Choice 的 `choiceType`、tool identity、受审资源种类、Offer 构造能力、Decision parser/serializer 与 Workflow decision policy 必须由同一个穷尽 registry 定义。持久 Choice 卡片同时显式声明 `replyMode`、`submit.decision` 与每组 `presentation`；通用 renderer 只能消费这些策略，不得按 `choiceType` 或 group key 私自解释交互、决定或布局。通用卡片、Offer 校验、结果续跑和 Workflow 入口只按 registry 分派，不得各自维护 `if/switch`；新增 Choice 只能增加一种明确实现并注册，缺失任一能力必须编译或 contract 失败。
- **AR-02G — 决定不可重开，执行段可恢复。** Approval/Choice 一经 `consumed` 就是不可变事实。一个 Run 可包含 initial user turn、Decision resume、Task continuation 多个执行段；`run.execution_started` 必须绑定明确的 `executionSegmentId`（user Run、interruptionId 或 continuation commandId），不可再用 runId 代表所有执行。持久 execution-started identity 是 Redis lock 之外的数据库围栏；同一 segment 再次申请必须在模型压缩、模型调用和 Tool 执行前显式拒绝并按 outcome unknown 处理，不得把幂等 Event replay 当作新的执行许可。初始 user-turn 的水位不得阻止尚未开始的 Decision retry。
- **AR-03 — Task 终态驱动继续。** Task 成功/失败后的唤醒只由持久任务终态触发，并以幂等方式关联到对应 run。
- **AR-03C — Task batch 与 Wait 原子交接。** Assistant Task-producing Operation 必须复用 `prepareTaskSubmissionInput + persistSubmittedTaskBatchInTransaction`；全部 Task、billing freeze、Created Event、lifecycle/enqueue Outbox、前序 Operation Activity 终态、唯一 Run-level Wait 与 `awaiting_task` 必须同事务提交。单 Task 也是 batch size 1。一个模型 step 只允许一个 long-running Operation；多 Operation 必须显式失败，不得建立多个 Wait。runtime 只能确认事务内已绑定的 Task identity，禁止 Task commit 后补建 Wait。Wait 行是同批终态聚合的唯一事实：每个 Terminal transaction 在持有 Wait row lock 后只合并本次 `taskId + lifecycleType`，不得用 REPEATABLE READ 普通 Task 快照重新解释整批状态；dedupe 复用也必须锁定候选 Task 后才允许绑定。
- **AR-03B — Continuation 单入口、at-most-once 模型围栏与原子交接。** Task 终态续跑只能由 Outbox worker 消费 `PROJECT_AGENT_CONTINUE_WAIT` 命令启动。命令 ID 同时作为 claim、Activity、模型 request 与消息幂等身份。调用模型前必须先把 `ProjectAgentContinuationCheckpoint.status=running` 持久化为不可重复执行围栏；重放看到未结算的 `running` 必须先恢复已准备的 interaction handoff，否则显式结算为 `outcome_unknown/failed`，不得再次调用模型或工具。普通完成、失败、投递耗尽和新的 Choice/Approval/Task 等待都必须由 `execution-handoff` 在一次事务中写 message、checkpoint、Activity、Wait、Run 与事件；route、客户端、轮询和 refetch 不得成为第二续跑入口。
- **AR-03E — Execution Handoff 唯一写入者。** `ProjectAgentExecutionHandoff` 是执行段的不可见、可恢复交接 intent；Choice、Approval、Task 都必须先准备 intent，随后由同一 `execution-handoff` 模块提交 message、Interaction/Wait、Activity、Run、checkpoint 与 Event。普通 terminal continuation 也必须由该模块一次结算。adapter 只能结束自己的 Operation Activity，任何 adapter、Choice/Approval helper 或旧 finalizer 都不得结束 continuation Activity 或另行更新 checkpoint settled。
- **AR-03D — Continuation 投递耗尽必须先结算。** `PROJECT_AGENT_CONTINUE_WAIT` 达到持久 delivery 上限时，Outbox worker 必须先通过唯一 settlement 入口原子结算 checkpoint、Activity、Wait、Run、Thread message 与 Session Event，成功后才能把 Outbox 标为 dead。尚未开始执行的命令结算为 `delivery_exhausted`；已进入 `running` checkpoint 的未知结果结算为 `outcome_unknown`。settlement 失败必须保持 Outbox 可重试，禁止留下永久 `awaiting_task` Run/Wait。
- **AR-03A — 失败不授权改写。** 已确认剧本的制作规划任务失败只允许 Assistant 解释并等待用户决定；失败终态不得自动授权重写剧本或提交新输入。
- **AR-04 — 用户界面只呈现产品语义。** 运行卡片可展示本地化操作名和任务数量，不得展示 taskType、targetType、targetId、operationId、原始工具参数或原始工具结果；这些字段只用于诊断日志和持久协议。
- **AR-04 — 工具契约在 registry。** operation 的输入、confirmation、agentFlow、plan/commit 与输出 schema 必须在 registry 统一声明；不得以 operation id 特判或从文案反推控制流。
- **AR-04A — Operation 调用单入口。** API 与 Assistant Tool 只能把可信来源上下文交给 `invokeProjectAgentOperation`；该入口唯一负责 registry 查找、`channels.api/tool`、prerequisite、输入 schema、direct execute 或 billable Grant invoke、输出 schema 与资源变更投影。adapter 只翻译 API error 或 ToolResult，不得各自重建执行分流。tool-only operation 经 API、api-only operation 经 Tool 必须在解析或执行前显式拒绝。
- **AR-04B — Tool 写入 authority 必须穷尽。** 每个 Tool-visible 写 Operation 必须恰好属于 `billable plan commit`、`executeInTransaction` 或 `transactional_task_submission` 三种 commit authority 之一；未能证明 Run fence 内原子提交的能力必须保留 API-only。Operation domain 禁止通过 HTTP 调用本应用 route，也不得用 fire-and-forget 或吞错把记录创建与 Task 提交拼成第二执行入口。`create_character` 只事务性创建记录；参考图描述提取是独立文本 Task，参考图生图是独立 `billable_media plan/commit` Operation，两者不得再由 `extractOnly` 在同一 Task type 内切换计费和授权语义。
- **AR-05 — 并发与心跳可证明。** 锁、心跳、超时取消和恢复必须由同一运行时状态协调；旧 run 不得覆盖新 run 的结果。
- **AR-05A — Operation 副作用服从 Run execution fence。** Assistant Tool 调用必须把同一个 abort signal 与 `runId + runVersion + eventSeq` 交给 `invokeProjectAgentOperation`；continuation 还必须携带 `waitId + commandId + claimOwner`。统一入口在执行前拒绝已失效 Run；普通 Task 创建事务、批准计划事务与同步领域写入事务必须在 commit 前锁定 Run 行，并在 continuation 中同时锁定 Wait claim 行后再次校验 fence。心跳、Redis lock 或 continuation claim 失效后，即使 Operation 已经开始，未提交的领域写入也必须整体回滚；只在 execute 返回后检查状态不构成防线。
- **AR-05B — Execution eligibility 与等待 outcome 分离。** `effects.writes` 只描述领域数据写入，Run 的 `status` 只描述业务正在等待什么；二者都不得裁决一个 execution segment 是否仍能提交。fence 只校验 `runId + runVersion + eventSeq`、abort 与可选 Wait claim，并且只在执行前或写入事务内使用。暂停 settlement 在写自己的 Event 前必须通过 transaction barrier，在 Event 已推进本次 Run fence 后、提交前必须再次检查 abort signal；失锁时整笔交接回滚。`agentFlow.suspendsFor: choice` 只要求当前 invocation 登记完全匹配的不可见 `ChoiceHandoffReceipt`（run、execution segment、operation、toolCall）；最终可见 Interaction/Activity/card 必须由 execution-handoff 与 assistant message 一起提交。通用 invocation 绝不在提交后要求 Run 仍为 `running`、增加 awaiting 白名单或按 operation id 分支。Choice 是 Tool-only、非领域写、无媒体审批的 direct Operation；缺少 durable handoff 的调用必须失败。
- **AR-06 — Run 转换单调。** Run 只使用 `running`、`awaiting_approval`、`awaiting_choice`、`awaiting_task`、`completed`、`failed`、`cancelled` 七种状态。状态转换必须经事件 reducer 校验合法前驱并执行 CAS；三个终态不可重开。失去 DB heartbeat 或 Redis lock 所有权必须中止模型流并进入 `cancelled/run_lock_lost`，不得继续写入或伪装成业务失败。
- **AR-06A — Interaction 与 Activity 单调。** Approval 和 Choice 创建都必须通过同一个事务 authority，在持有目标 Run 行锁时一次性读取并 supersede 旧 pending interruption、结算其 Activity、完成前序 Activity 并 raise 新 interruption；任一 Event/reducer 写入失败必须整体回滚，禁止先 supersede 后 raise 的两阶段窗口。`activity.started` 只能 create，重复 identity 必须 conflict；`completed/failed/cancelled` 必须从 open 状态执行恰好一行的 CAS，零行或多行都原地失败，禁止终态重开或错误 activityId 静默前进。
- **AR-07 — Session/UI 只投影持久协议。** Panel 不得扫描历史 message、tool output 或 `task-submitted` part 推断 active Task、资源刷新、operation source 或 style generation；这些 identity 必须由 Session `currentActivity/activeTasks/pendingInteraction` 和正式 SSE resource envelope 提供。历史 `edit-style-preview-generation` part 只可作为隐藏协议记录，不得再启动 2.5 秒轮询、用 `data.items` 补候选或按 Task target 构造私有生命周期；风格候选交互只投影持久 Choice Offer。Session projector 必须用一次只读 scope 查询证明 active Run 至多一个，并只投影属于该 Run 的 open Activity、Interruption 与 Wait；多 active Run、缺失 runId、跨 Run 事实或终态 Run 仍有 open 事实都必须显式失败，禁止挑一条或拼成混合快照。已有 server runId 时，本地 control state 无权覆盖；本地 control pending 只覆盖实际 HTTP 请求窗口，错误或 Session 刷新失败均不得永久保持。成功提交后，已回答 interruption 的本地抑制必须保留到新的权威 Session 快照确认其消失，禁止旧快照重开已消费卡片。control 可见用户消息的 optimistic 与服务端持久副本必须复用 `runId + interruptionId + control type` 的同一个 canonical ID，使 Thread 收敛按身份替换而不是刷新后重复。每个 `ProjectAgentEvent` 必须在同一事务写入 `project_agent.session_broadcast` Outbox，Outbox worker 是 `assistant.session.changed` 的唯一发布者；SSE v2 cursor 以 `ProjectAgentEvent.id` 作为独立 Assistant 水位，并按 user/project/episode/assistant scope 提供最新 level-triggered bootstrap。服务端和客户端都必须在有界窗口内保存 `event identity → canonical fingerprint`；只有 identity 与 fingerprint 都相同才是 duplicate，同 identity 不同 fingerprint 必须 conflict 并触发 snapshot resync，不得静默吞掉。客户端收到通知后主动刷新 Session 与 Thread，Session 响应水位低于已见事件时必须拒绝。禁止 1.5 秒 polling、catch-up timer cascade 或持续 replay timer 承担正确性；客户端去重集合必须有界。
- **AR-07A — Thread clear 是带水位的 scope 事实。** 清空 Thread 必须在持有 project scope lock 的同一事务删除消息、追加唯一 `thread.cleared` scope Event 并写 Session broadcast Outbox。Session/Thread GET 必须返回持久水位；客户端只接受不低于已见水位的响应。权威空 Thread 必须 replace；清空后重建的非空 Thread 若持久 `thread.id` 与客户端最近接受的 identity 不同也必须 replace，只有同一 Thread identity 的快照才可与未持久 optimistic message 合并。

## 权威入口

- Project-agent runtime：`src/lib/project-agent/`。
- Task 终态续跑唯一执行入口：`src/lib/workers/outbox.worker.ts` → `runProjectAgentWaitContinuationCommand`。
- Continuation 唯一交接：`beginProjectAgentWaitContinuationExecution` 建立 running fence；`execution-handoff` 原子结算 terminal 或 `awaiting_*` outcome，并在重放时只调用其 finalize/recovery 入口。
- Choice Offer 契约、fingerprint 与严格解析：`src/lib/project-agent/choice-offer.ts`。
- Choice 身份、能力与 Workflow policy 的穷尽入口：`src/lib/project-agent/edit-first-choice-tools.ts` 的 `EDIT_FIRST_CHOICE_REGISTRY`。
- Interaction-backed waiting 唯一 settlement/消费入口：`prepare/settleProjectAgent*ExecutionHandoff` 与 `consumeProjectAgentChoiceInterruption` / `consumeProjectAgentApprovalInterruption`。
- 已消费 Decision 的恢复入口：`readRetryableConsumedProjectAgent*Interruption` 只重读同一持久决定；`createProjectAgentConsumedControlRetryRun` 是唯一新 attempt 创建者；`run.execution_started` 是禁止再次执行的持久水位。
- Approval/Choice 原子替换 authority：`appendProjectAgentInterruptionReplacementInTransaction`；Activity 单调终态 authority：`transitionProjectAgentActivity`。
- Operation registry 验证：`src/lib/operations/registry.ts`。
- Operation API/Tool 唯一执行入口：`src/lib/operations/invocation.ts` 的 `invokeProjectAgentOperation`。
- Operation Run fence 唯一裁判：`src/lib/project-agent/operation-execution-fence.ts`；Task 提交、批准计划与 transactional executor 只能复用该 commit barrier。
- Handoff/receipt authority：`src/lib/project-agent/execution-handoff.ts` 是 Choice、Approval、Task 与 terminal continuation 的唯一交接 owner；`recordProjectAgentSuspensionReceipt` 只在最终 Interaction 事务提交后登记，Choice invocation 只核验 `requireProjectAgentChoiceHandoffReceipt`。两者都不是第二份持久 UI 状态，也不读取 Run status。
- Tool 写 Operation 穷尽 authority：`src/lib/operations/write-authority.ts` 与实际 registry conformance；Thread clear 唯一入口：`src/lib/project-agent/thread-clear.ts`。
- Assistant Task batch 接线：`submitOperationTaskBatch` 只负责编排通用 Task persistence primitive；`ProjectAgentOperationTaskBatchBinding` 在同一 transaction 调用 `bindProjectAgentWaitToTasksInTransaction`，不得复制 Task/billing/Event/enqueue。
- Operation 类型和 agentFlow：`src/lib/operations/types.ts`。
- Assistant Session 变更 envelope、持久重放和唯一 publisher：`src/lib/project-agent/session-event.ts`；事件与 Outbox 原子创建：`src/lib/project-agent/event/append.ts`。

## 验证

- `tests/unit/project-agent/runtime-routing-*.test.ts` 按 bootstrap、choice、workflow、approval 与 settlement 验证运行时路由。
- `tests/unit/project-agent/server-follow-up.test.ts` 验证稳定 command identity、checkpoint-before-finalize 与 checkpoint replay 不重跑模型。
- `tests/unit/project-agent/waits-follow-up.test.ts` 验证 Wait claim/start fence 的原子推进与同命令重放。
- `tests/integration/task/project-agent-continuation-settlement.integration.test.ts` 在真实 MySQL 上验证并发 checkpoint、message/checkpoint 原子性、checkpoint 后崩溃重放与缺失 checkpoint 时终态事务整体回滚。
- `tests/integration/task/project-agent-continuation-dead-delivery.integration.test.ts` 验证投递耗尽与已开始执行的未知结果都先完成 Assistant settlement，重复结算不新增 Event/message，废弃 Wait 不被重开。
- `tests/unit/outbox/project-agent-continuation-dead-letter.test.ts` 验证 Outbox 只有在 Assistant settlement 成功后才能 dead-letter；settlement 异常必须保留命令重试资格。
- `tests/integration/task/project-agent-session-broadcast.integration.test.ts` 在真实 MySQL 上验证每个已提交 ProjectAgentEvent 都有且只有一个同事务广播责任，reducer 失败时 Event 与 Outbox 一起回滚。
- `tests/integration/task/project-agent-execution-segment.integration.test.ts` 验证同一 Run 的 initial user segment 与 Decision segment 使用不同水位；`project-agent-task-batch-wait.integration.test.ts` 与 approved batch integration 验证收费/非收费 Task batch 只产生一个同事务 Wait。
- `tests/integration/task/project-agent-thread-clear-race.integration.test.ts` 验证 Thread DELETE 与新 Run/消息创建共享 project scope lock，任何竞态结果都不会删除新消息。
- `tests/unit/components/workspace-assistant-session-watermark.test.ts` 与 Thread clear route/DB tests 验证持久 `thread.cleared`、旧 GET 拒绝和权威空快照 replace。
- `tests/system/assistant-reload.system.test.ts` 由 P0 journey registry 强制收集，验证 `awaiting_task` 与 `awaiting_choice` 刷新后仍从持久 Run/Activity/Wait/Interruption/Thread 恢复，并在真实 MySQL 中验证双 active Run 与跨 Run open Activity 都显式失败，而不是依赖当前标签页内存或单元 mock。
- `tests/unit/project-agent/run-state-machine.test.ts` 验证七状态转换、终态单调和 expected-status 门禁。
- `tests/unit/project-agent/run-heartbeat.test.ts` 验证 DB/Redis 续租失败和异常都会触发 ownership loss。
- `tests/integration/task/project-agent-choice-execution-fence.integration.test.ts` 用真实 MySQL 验证 Choice 的精确 durable Interaction、Run fence 与 `awaiting_choice` 是一次成功结果；`tests/unit/operations/invocation-execution-fence.test.ts` 证明合法 awaiting status 不会被误判失去执行权，且缺失/错协议 receipt 不能被接受。
- `tests/unit/operations/invocation.test.ts` 用未注册的未来 Choice identity 证明 invocation 只根据 `agentFlow.suspendsFor: choice` 核验通用 receipt；`assistant-choice-offer-authority` guard 禁止 invocation 恢复 operation-id 分支、旧 postcondition 或 Choice 专属 fence。新增第六种 Choice 只能扩展其 registry 声明与业务内容，不得修改 invocation、fence 或 stop controller。
- `tests/unit/project-agent/interruption-consume.test.ts` 验证重复/并发消费由 pending 状态 CAS 拒绝，基础设施故障不会伪装成重复提交。
- 同一测试同时验证 Approval 的 supersede + raise 只调用一个带 Run 锁的事务入口，投影故障不会落入第二写入路径；`tests/unit/project-agent/event-reducer.test.ts` 验证 Activity create-only、终态 identity 冲突以及三种零行终态 CAS 都显式失败。
- `tests/unit/project-agent/interruption-consume.test.ts` 验证 consumed Approval/Choice 只能重读完全相同的持久决定；`tests/unit/project-agent/runs.test.ts` 验证 bootstrap 失败可创建独立 retry Run，而 execution-started 后必须 outcome unknown；route contract 验证 retry 不复活旧 Run。
- `tests/contracts/assistant-choice-offer-conformance.test.ts` 穷尽验证每一种 Choice 都绑定一个显式受审资源种类，且卡片必须有完整持久身份。
- 同一 conformance test 逐项验证 registry 覆盖全部 Choice，并同时声明唯一 tool identity、Offer builder 模式、Decision parser、tool availability、Workflow policy 与当前资源 resolver；`assistant-choice-offer-authority-guard` 阻止卡片、Offer、结果、toolset 与 Workflow 恢复各自的 Choice type 分派器。
- `tests/unit/project-agent/session-state-*.test.ts` 验证刷新只投影 interruption 中的持久 Offer、不调用卡片 builder，并验证多 active Run、跨 Run Interruption/Wait/Activity 与不稳定事件水位都显式失败。
- `tests/unit/components/workspace-assistant-runtime-persistence.test.ts` 验证 control optimistic 与服务端持久消息共用 canonical ID，Thread 刷新只保留一份；`workspace-assistant-approval-dismissal.test.ts` 验证请求失败恢复卡片、成功后旧 Session 不重开卡片且 refresh 失败不会留下本地 pending。
- `tests/unit/components/workspace-assistant-renderers.test.ts` 验证 Choice renderer 只消费持久 `replyMode`、`submit.decision`、`group.presentation`；历史 style-generation part 保持隐藏且无轮询/Task target 私有生命周期。
- `tests/unit/project-agent/interruption-consume.test.ts` 与 `tests/unit/project-agent/runs.test.ts` 验证决定保持 consumed、相同决定只可建立新的 pre-execution Run attempt，且 execution-started 后必须拒绝重放。
- `tests/unit/project-workflow/edit-first-*.test.ts` 按剧本、规划、分镜视频与渲染音频验证失败状态不会开放错误操作。
- `tests/unit/project-agent/tool-adapter-gates.test.ts` 验证工具确认与执行门禁。
- `tests/unit/operations/registry.test.ts` 验证 operation metadata、confirmation 和 agentFlow。
- `tests/unit/operations/invocation.test.ts` 与 API/Tool adapter tests 验证双 channel 语义一致、channel 越权拒绝、prerequisite、Grant provenance 及输入/输出 schema 门禁。
- `tests/unit/operations/invocation-execution-fence.test.ts` 用 execute-started barrier 验证失锁 signal 会使 transactional domain write 回滚，并验证旧 `runVersion/eventSeq` 在执行器前失败。
- `tests/unit/operations/write-authority-registry.test.ts` 穷尽验证真实 Tool 写 Operation 只有一种 commit authority，并证明无法原子化的能力保持 API-only。
- `tests/integration/api/specific/project-character-style-forwarding.test.ts` 验证旧的 create+reference 组合输入在写记录前显式失败；`tests/unit/guards/single-operation-invocation.test.ts` 阻止 Operation domain 恢复内部 HTTP 自调用。
- `scripts/guards/no-client-agent-control.mjs` 阻止客户端成为 Agent 控制面。
- `scripts/guards/no-assistant-fixed-workflow-surface.mjs` 阻止将固定流程伪装成 Agent 自主运行。
- `scripts/guards/no-history-state-inference.mjs` 阻止从历史消息推断当前业务状态。
- 同一 guard 扫描实际 Panel/runtime/helper，阻止退役的 async-task/style-preview history scanner、timer polling 和 client-run-over-server precedence 回流。
- `scripts/guards/no-project-agent-direct-task-submit.mjs` 阻止 Assistant 控制层直接提交 Task 并绕过 operation/Wait。
- `scripts/guards/single-operation-invocation-guard.mjs` 与真实 registry conformance 阻止 API/Tool adapter 重新实现 schema、plan/Grant/execute、输出分流、未分类 Tool 写入或 Operation 内部 HTTP 自调用。
- 同一 guard 执行真实 Operation registry authority conformance，并禁止 Operation domain 通过 HTTP 自调用 route。
- 同一 guard 强制 Tool adapter 传递 Run execution fence，强制普通 Task 与批准计划的最终提交入口保留统一 transaction barrier 与事务内 Wait 绑定，并禁止 runtime 恢复 Task commit 后补建 Wait。
- `scripts/guards/single-project-agent-continuation.mjs` 阻止旧 Wait 扫描/claim helpers 与第二续跑调用者复活，并强制 Outbox-only、message checkpoint-before-finalize 的两阶段顺序。
- `scripts/guards/no-plan-run-runtime.mjs` 同时扫描 runtime/API/Operation 与 Prisma schema；`PlanRun/PlanStepRun/PlanRunEvent/PlanArtifact` 模型及表已由 `20260711173000_remove_plan_run_persistence` 退役，禁止恢复可写 delegate 或第二套 Assistant 状态机。
- `tests/integration/api/specific/workflow-lab-service.integration.test.ts` 与 `workflow-lab-style-choice.integration.test.ts` 验证 Lab Choice 也经同一事件 reducer 投影并共用目标 runtime identity，Approval checkpoint 不伪造不可消费的运行态。
- `scripts/guards/project-agent-run-state-machine-guard.mjs` 扫描全 `src` 的 Run、Activity、Interruption 生命周期写入，阻止 reducer 外重新出现第二写入者，并阻止 session-state GET 恢复 stale cancellation 副作用。仅允许 `heartbeatAt` 与已消费 interruption `runState` 清理两个明确的非生命周期维护写入。
- 同一 guard 禁止恢复 `interruption.reopened`，强制 `run.execution_started` 先于模型调用，并要求 consumed-control retry authority 锁定 interruption、检查 execution Event 后创建新 Run。
- `scripts/guards/assistant-choice-offer-authority-guard.mjs` 阻止 chat route 恢复无 interruption 的 Activity fallback、阻止客户端重新提供 `choiceType`、阻止 Session refresh 重建卡片，并强制 Choice 在同一事务内验证 Offer/fingerprint 后只持久化规范化 Decision。
- 同一 Choice guard 通过 TypeScript AST 追踪 `choiceType` 的直接访问、变量别名与解构别名，禁止 renderer 以 `if/switch/条件表达式` 恢复私有控制语义；它还按 registry 的 choice key 与 workflow stage 检测任意命名的私有 stage map。`assistant-architecture-guards.test.ts` 使用可绕过旧字符串匹配的恶意 fixture 反证。
- `tests/unit/sse/server-session.test.ts`、`tests/unit/optimistic/workspace-sse-event-sequence.test.ts` 与 `sse-task-terminal.test.ts` 验证 bootstrap/live 相同事实精确去重、同 identity 不同 fingerprint 显式 conflict、窗口溢出与客户端 snapshot resync。
- `scripts/guards/sse-durable-watermark-guard.mjs` 强制 Task/Mutation/Assistant 三域复合水位、subscribe-before-bootstrap、ProjectAgentEvent 同事务 Outbox、Outbox-only publisher、server/client 有界 identity→fingerprint 和客户端旧 Session 响应拒绝。

## Session 通知状态所有权

| 事实 | 唯一所有者 / 写入者 | 消费者 |
|---|---|---|
| Assistant 状态发生变化 | `ProjectAgentEvent` / `appendProjectAgentEventsInTransaction` | reducer、Session snapshot、SSE bootstrap |
| Assistant 通知交付责任 | 同事务 `project_agent.session_broadcast` Outbox | Outbox worker |
| Assistant SSE 水位 | `ProjectAgentEvent.id` / SSE v2 `agentEventId` | bootstrap、每个浏览器标签页的 event sequence |
| Session 一致快照 | 前后 `ProjectAgentEvent.id` 水位一致，且 active Run 唯一、所有 open Activity/Interruption/Wait 都属于该 Run 的 `getProjectAgentSessionSnapshot` | Session State route |
| SSE 事件事实身份 | `type + id → canonical fingerprint` / server session 与每个浏览器标签页的有界 event sequence | bootstrap/live 精确去重；identity conflict 只允许 snapshot resync |
| Session/Thread UI 收敛 | `assistant.session.changed` 触发的主动刷新 | Workspace Assistant runtime；不得轮询或从消息推断状态 |

写入者变化：新增的事件不是第二份 Session 状态，只是持久 ProjectAgentEvent 的 level-triggered 通知投影。后台 continuation、其他进程和其他标签页不再依赖当前请求结束或 timer 才看到 Session/Thread；旧 Session HTTP 响应也不能覆盖较新的事件水位。

## Choice 状态所有权

| 事实 | 唯一所有者 / 写入者 | 消费者 |
|---|---|---|
| 用户看到并回答的 Choice Offer | `ProjectAgentInterruption.payload` / prepared Choice handoff 的唯一 settlement | 首屏 stream、Session refresh、Choice control |
| 当前 execution 已准备的等待交接 | `ProjectAgentExecutionHandoff` / `execution-handoff` | recovery；不可直接投影到 UI |
| Offer 身份 | Offer 内必填的 `runId + interruptionId + cardId + toolCallId` | API control 与原子消费服务 |
| 受审资源代次 | Offer 的 `reviewedResource.kind + fingerprint` / Choice card builder | 原子消费服务在同事务内重读正式资源后比较 |
| 用户决定 | `interruption.resolved.response` 中的规范化 ChoiceDecision / `consumeProjectAgentChoiceInterruption` | Workflow 与下一回合 runtime |
| 已消费决定的执行资格 | `run.execution_started.executionSegmentId=decision:<interruptionId>`；只查询同一 Decision segment | control route、runtime；初始 user turn 或其他 continuation 的水位不参与该决定重试 |
| 选定视觉风格的领域写入 | `confirm_edit_style_preview` Operation / `confirmProjectEditStylePreview` 服务 | Workflow continuation、Edit Bible 与 UI 投影 |
| Choice 卡片交互/提交/布局策略 | 持久 Offer 中的 `replyMode + submit.decision + group.presentation` / Choice card builder | 通用 renderer；不得读取 `choiceType` 或 group key 推断策略 |
| 卡片临时选中项、输入框文本 | 浏览器组件本地状态 | 仅用于组装一次 control 请求，不解释业务生命周期 |

写入者变化：Offer/卡片解释者由“stream card + Session 动态 builder + 客户端 choiceType + Activity fallback”四条路径收敛为一个持久 interruption Offer；ChoiceDecision 只由服务端 canonicalizer 写入 Event。视觉风格写入者由 Choice renderer、Panel、旧 generation card 以及 `/bible/style-preview` PATCH 四条路径收敛为 `confirm_edit_style_preview` Operation 一个；对应客户端 mutation hook 与专用 route 已删除。删除了 chat route 的 null-interruption Activity 完成路径、Session 的 choiceType 私有 parser/卡片重建 switch，以及 Workflow Lab 的 style-choice 无 interruption 特例。

## Task continuation 状态所有权

| 事实 | 唯一所有者 / 写入者 | 消费者 |
|---|---|---|
| Task 终态与 Wait 可唤醒事实 | `commitTaskTerminal` / `resolveProjectAgentWaitsForTaskTerminalInTransaction` | Outbox command 创建逻辑 |
| continuation 命令与重试责任 | `OutboxCommand` / Outbox worker | `runProjectAgentWaitContinuationCommand` |
| continuation claim 与 fence | `ProjectAgentWait` / Wait authority | server follow-up runtime |
| continuation 模型执行资格 | `ProjectAgentContinuationCheckpoint.status=running` / `beginProjectAgentWaitContinuationExecution` | 唯一 Outbox continuation runtime；存在该围栏的重放不得再调用模型 |
| continuation assistant message、checkpoint 与模型结算结果 | `ProjectAssistantThread + ProjectAgentContinuationCheckpoint.status=settled` / `settleProjectAgentContinuationTerminalHandoff` 或 waiting handoff 同一事务 | replay 与终态交接 |
| Activity/Wait/Run 终态 | Event reducer / `execution-handoff` | Session/UI 投影 |
| Task batch → Wait 交接 | 通用 `persistSubmittedTaskBatchInTransaction` callback → `bindProjectAgentWaitToTasksInTransaction` | Operation adapter、runtime；runtime 不做事后补绑 |
| loading、spinner、状态文案 | 上述持久事实的纯投影 | UI；不得反写生命周期 |

`tests/integration/task/project-agent-continuation-settlement-concurrency.integration.test.ts` 以真实 MySQL 并发两个 claim owner，证明同一 resolved Wait 只授予一个执行者。合法删除 Run 时外键将 `Wait.runId` 置空，后续 claim 必须按 stale/permanent delivery 终止；不得为绕过外键的损坏数据增加运行时 fallback，损坏数据属于完整性告警与运维修复。

## Operation execution fence 状态所有权

| 事实 | 唯一所有者 / 写入者 | 消费者 |
|---|---|---|
| 当前 Assistant 执行资格 | `ProjectAgentRun.status + runVersion + eventSeq` / Event reducer | Operation execution fence |
| 当前进程已观察到的失锁事实 | Runtime `AbortController` / heartbeat、Redis lock 与 continuation claim 续租器 | 模型 stream、Operation invocation、commit barrier |
| Operation 最终提交资格 | `assertProjectAgentOperationExecutionFenceInTransaction` 对 Run 行及可选 continuation Wait claim 行加锁后的联合裁决 | Task 创建事务、批准计划事务、transactional direct executor |

写入者变化：Operation 过去只在 Activity Event 写入时使用 Run fence，领域 execute 已经开始后仍可绕过。现在 Tool adapter 不再丢弃 signal/fence；同步领域写入由 invocation-owned transaction 执行，Task 与批准计划在各自权威事务末尾调用同一个 barrier。API 调用不伪造 Assistant fence，仍按其自身鉴权与幂等契约执行。

写入者变化：删除 scope 扫描、resolved Wait 列表/claim helpers 和客户端 follow-up 控制入口；续跑调用者收敛为 Outbox worker 一个。模型输出不再先于持久 checkpoint 直接宣告 Wait/Run 已结算；checkpoint 重放只完成第二阶段，不再次调用模型。

## 历史回归

- `227b2d288` 收敛 server-owned append、heartbeat 与 Redis lock；`41c5a13a` 随后仍修复 run settlement race，说明局部加锁不能替代完整 run 语义。
- `7f8e161be` 修复 stale bootstrap、heartbeat、tool leak、noop/stall 等多个症状，表明需要把这些症状收敛为同一生命周期契约。
- 制作规划 choice 曾通过局部副作用提交视觉风格 Task，导致模型文案、候选记录、run/Wait 三套状态分离；Choice 只负责落用户决定，异步执行必须回到 registry 与 runtime。
- `BUG-AR-003` 证明“非领域写”等于“Run 保持 running”是错误推导；更深层地，fence 不得把业务 outcome 当作执行资格。Choice 成功提交其 suspension receipt 后合法进入 `awaiting_choice`；receipt 在 invocation 内被通用验证，Run status 不再参与提交后的重新裁决。详见 [Assistant Suspension 收敛设计](../assistant-suspension-convergence.md)。

## 修改检查表

1. 此改动触及哪一种 run 结算结果？
2. 谁写入权威状态，谁只能读取或投影？
3. Task 终态如何幂等地唤醒正确 run？
4. 并发、重放、心跳超时和取消是否有测试？
5. 是否新增了按 operation id 或消息文本的控制流特判？若是，必须重做为 registry/状态机语义。
6. Choice 落库后若 Workflow 存在 `nextAction`，run 是否证明已执行、等待或显式失败？
7. 此转换是否带有可区分同状态代次的持久 `runVersion/eventSeq`？仅比较 status 不能阻止 ABA，未具备版本围栏时必须明确记录为未完成风险。
8. Choice 卡片是否来自持久 Offer，提交是否验证 card/tool/resource fingerprint，Event 是否只保存规范化 Decision？
9. 若 Operation 声明了 Choice suspension，是否只验证本次已提交的通用 receipt，而没有在提交后读取 Run status、按 operation id 分支或要求继续 `running`？
