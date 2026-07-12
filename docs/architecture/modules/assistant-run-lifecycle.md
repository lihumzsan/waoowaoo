<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Run 生命周期

## 设计理念

Assistant 是受服务端运行时约束的决策者，不是流程状态的权威来源。一次 run 的开始、等待、任务关联、恢复、结算和失败必须由服务端持久状态与锁协调；模型消息、UI 文案或工具输出不能自行宣告流程已完成。

## 不变量

- **AR-01 — 服务端权威。** thread/run 的 append、终态、锁和恢复由服务端管理；客户端和模型不得持有第二套 run 状态。
- **AR-02 — 每回合有结算语义。** 一个 turn 必须明确是完成、等待用户、等待 Task、继续 Agent 还是失败；合法的空输出或未发起新 Tool 可以结算为 `completed` 且不产生领域事实，只有 completion、Tool、持久化、ownership 或协议本身失败才可结算为失败。模型文案不得伪造领域完成。
- **AR-02A — Choice 命令所有权显式。** 用户提交结构化 Choice 后，服务端必须在同一消费事务中锁定 current Run fence 与 pending interruption。registry 已声明且输入可由规范化 Decision 完整构造的确定性、非收费、事务型确认，是用户已经发起的命令：消费事务直接通过统一 Operation invocation 写入，不得再交给 AI 二次转发。其他创作/异步/收费 Decision 只恢复 AI 或正式 handoff，不得被服务端从 `nextAction` 猜测执行。事务提交后的 AI 只从刷新后的正式 Workflow 继续；后续 `nextAction` 仍是能力而非必须耗尽的义务。
- **AR-02B — Choice Offer 单一权威。** Choice 工具必须先把完整且不可变的 Offer 持久化为不可见 `ProjectAgentExecutionHandoff(kind=choice)`；唯一 settlement 在同一事务中把它写入可见 `ProjectAgentInterruption.payload`、assistant message 与 Run 等待状态。可见 Offer 同时包含必填的 run/interruption/card/tool identity、完整卡片和受审资源 fingerprint。当前协议只有一个严格解析的 Offer 形状，不持久化无分流语义的固定版本标记；不兼容变更必须排空 active Run/Wait、一次性迁移数据并切换唯一 parser。首屏 stream 与刷新后的 Session 只能投影已提交的 Interruption Offer；不得刷新时重查资源重建卡片，也不得接受客户端提交的 `choiceType` 作为控制事实。
- **AR-02C — Choice 原子提交。** Choice control 只提交 interruptionId、cardId、toolCallId 与原始回答。服务端必须在同一数据库事务中读取并严格解析 Offer、校验三个身份、重读当前受审资源 fingerprint、把回答规范化成穷尽的 ChoiceDecision，并消费 interruption、提交适用的 registry 确认 Operation、写 Activity 与开始唯一 response execution segment。Event 只持久化规范化 Decision，客户端多余字段不得进入权威历史。身份、fingerprint、命令契约或 Operation 任一步失败必须整体回滚，Choice 保持 pending。
- **AR-02D — Choice 不获得第二写权。** 所有 Choice 卡片统一使用 `submit_tool_output`；renderer、Panel 与 route 永远不直接修改领域数据。确定性确认只能由 `EDIT_FIRST_CHOICE_REGISTRY` 映射到既有注册式 Operation，并复用其 schema、channel、transaction 与 write authority；视觉风格选择仍只由 `confirm_edit_style_preview` 写入。确认提交后必须重新解析正式 Workflow，禁止继续把 `oldWorkflow + Decision` overlay 当作模型当前状态。
- **AR-02E — 最终消息与 Run 终态原子结算。** 普通 Run 的 assistant message 与 `completed/failed/cancelled` Event 必须由 `settleProjectAgentRunWithMessage` 在同一事务提交；消息写失败时终态不得前进。Thread append 必须锁定唯一 thread aggregate，禁止并发用户消息、普通 Run 和 continuation 通过 read-modify-write 相互覆盖。
- **AR-02F — Choice 定义穷尽注册。** 每一种 Edit-first Choice 的 `choiceType`、tool identity、受审资源种类、Offer 构造能力、Decision parser/serializer、Workflow decision policy 与原子确认命令 policy 必须由同一个穷尽 registry 定义。持久 Choice 卡片同时显式声明 `replyMode`、`submit.decision` 与每组 `presentation`；通用 renderer 只能消费这些策略，不得按 group key、候选内容或历史消息私自解释交互、决定或布局。已有专用只读资源卡需要承载同一 Choice 时，Panel 只可使用 Session 中持久 Offer 的 `choiceType` 选择该 renderer，并必须复用通用 Choice output 与 control 提交入口；不得新增协议字段、领域 mutation 或第二张同步卡片。Offer 校验、命令提交、结果续跑和 Workflow 入口只按 registry 分派，不得各自维护业务执行 `if/switch`；新增 Choice 只能增加一种明确实现并注册，缺失任一能力必须编译或 contract 失败。
- **AR-02G — 决定不可重开，执行段可恢复。** Approval/Choice 一经 `consumed` 就是不可变事实。一个 Run 可包含 initial user turn、Decision resume、Task continuation 多个执行段；`run.execution_started` 必须绑定明确的 `executionSegmentId`（user Run、interruptionId 或 continuation commandId），不可再用 runId 代表所有执行。持久 execution-started identity 是 Redis lock 之外的数据库围栏；同一 segment 再次申请必须在模型压缩、模型调用和 Tool 执行前显式拒绝并按 outcome unknown 处理，不得把幂等 Event replay 当作新的执行许可。初始 user-turn 的水位不得阻止尚未开始的 Decision retry。
- **AR-03 — Task 终态驱动继续。** Task 成功/失败后的唤醒只由持久任务终态触发，并以幂等方式关联到对应 run。
- **AR-03C — Task batch 与唯一 Wait 原子交接。** Assistant Task-producing Operation 必须复用 `prepareTaskSubmissionInput + persistSubmittedTaskBatchInTransaction`；全部 Task、billing freeze、Created Event、lifecycle/enqueue Outbox 与 Wait membership 必须同事务提交。单 Task 也是 batch size 1。同一个模型 step 可以执行声明式 Operation group，但各成员仍是独立 Operation；runtime 必须先建立同一 Run-level `collecting` Wait，各成员只在自己的 Task 提交事务追加 task identity，全部成员成功绑定后才一次 seal 并把 Run 推进 `awaiting_task`。禁止每个 Operation 建一个 Wait、在首个成员完成时提前恢复、或 Task commit 后根据输出补猜 membership。seal 必须在同一事务准备唯一 task execution handoff，并重读已经抢先终态的成员 Task；未 seal 的 Wait 不消费终态、不唤醒 Assistant，执行段失败/取消时随 Run 一起 abandoned。Wait 行是整组终态聚合的唯一事实：每个 Terminal transaction 在持有 Wait row lock 后只合并本次 `taskId + lifecycleType`，不得用普通 Task 快照重新解释整组状态；dedupe 复用也必须锁定候选 Task 后才允许绑定。
- **AR-03B — Continuation 单入口、at-most-once 模型围栏与原子交接。** Task 终态续跑只能由 Outbox worker 消费 `PROJECT_AGENT_CONTINUE_WAIT` 命令启动。命令 ID 同时作为 claim、execution segment、模型 request 与消息幂等身份；它不是 `ProjectAgentActivity`。开始续跑时必须原子写 `run.execution_started` 并将 Run 推进 `running`，再把 `ProjectAgentContinuationCheckpoint.status=running` 持久化为不可重复执行围栏；重放看到未结算的 `running` 必须先恢复已准备的 interaction handoff，否则显式结算为 `outcome_unknown/failed`，不得再次调用模型或工具。普通完成、失败、投递耗尽和新的 Choice/Approval/Task 等待都必须由 `execution-handoff` 在一次事务中写 message、checkpoint、Wait、Run 与事件；route、客户端、轮询和 refetch 不得成为第二续跑入口。
- **AR-03E — Execution Handoff 唯一写入者。** `ProjectAgentExecutionHandoff` 是执行段的不可见、可恢复交接 intent；Choice、Approval、Task 都必须先准备 intent，随后由同一 `execution-handoff` 模块提交 message、Interaction/Wait、Activity、Run、checkpoint 与 Event。普通 terminal continuation 也必须由该模块一次结算。adapter 只能结束自己的 Operation Activity，任何 adapter、Choice/Approval helper 或旧 finalizer 都不得结束 continuation Activity 或另行更新 checkpoint settled。
- **AR-03D — Continuation 投递耗尽必须先结算。** `PROJECT_AGENT_CONTINUE_WAIT` 达到持久 delivery 上限时，Outbox worker 必须先通过唯一 settlement 入口原子结算 checkpoint、Wait、Run、Thread message 与 Session Event，成功后才能把 Outbox 标为 dead。尚未开始执行的命令结算为 `delivery_exhausted`；已进入 `running` checkpoint 的未知结果结算为 `outcome_unknown`。settlement 失败必须保持 Outbox 可重试，禁止留下永久 `awaiting_task` Run/Wait。
- **AR-03A — 失败不授权改写。** 已确认剧本的制作规划任务失败只允许 Assistant 解释并等待用户决定；失败终态不得自动授权重写剧本或提交新输入。
- **AR-04 — 用户界面只呈现产品语义。** 运行卡片必须从 Session `activeTasks` 投影同一 Wait 下全部本地化操作名和总任务数；不得假设只有一个 Operation，也不得展示 taskType、targetType、targetId、operationId、原始工具参数或原始工具结果，这些字段只用于诊断日志和持久协议。
- **AR-04 — 工具契约在 registry。** operation 的输入、confirmation、agentFlow、plan/commit 与输出 schema 必须在 registry 统一声明；不得以 operation id 特判或从文案反推控制流。
- **AR-04A — Operation 调用单入口。** API 与 Assistant Tool 只能把可信来源上下文交给 `invokeProjectAgentOperation`；该入口唯一负责 registry 查找、`channels.api/tool`、prerequisite、输入 schema、direct execute 或 billable Grant invoke、输出 schema 与资源变更投影。adapter 只翻译 API error 或 ToolResult，不得各自重建执行分流。tool-only operation 经 API、api-only operation 经 Tool 必须在解析或执行前显式拒绝。
- **AR-04C — Operation outcome 穷尽。** `invokeProjectAgentOperation` 与其 Tool adapter 边界必须构造且只返回 `completed`、`noop`、`submitted_tasks`、`wait_choice`、`wait_approval` 或 `failed` 之一。`submitted_tasks` 携带已提交的 durable Wait/Task receipt，`wait_choice` 携带 durable handoff；Tool adapter、stop controller 和 runtime 只能 switch 此 outcome。`effects.longRunning`、`agentFlow.suspendsFor`、Task binding 和 output 字段只能参与 outcome 的构造或契约验证，绝不可由调用方再次从输出形状猜测 lifecycle。旧 `runtime-signal` output parser 不得恢复。
- **AR-04B — Tool 写入 authority 必须穷尽。** 每个 Tool-visible 写 Operation 必须恰好属于 `billable plan commit`、`executeInTransaction` 或 `transactional_task_submission` 三种 commit authority 之一；未能证明 Run fence 内原子提交的能力必须保留 API-only。Operation domain 禁止通过 HTTP 调用本应用 route，也不得用 fire-and-forget 或吞错把记录创建与 Task 提交拼成第二执行入口。`create_character` 只事务性创建记录；参考图描述提取是独立文本 Task，参考图生图是独立 `billable_media plan/commit` Operation，两者不得再由 `extractOnly` 在同一 Task type 内切换计费和授权语义。
- **AR-04C — Approval 计划身份可完整迁移。** Operation 在 plan 阶段预留、commit 阶段才物化且不等于 Task target 的 canonical identity，必须显式写入 `OperationPlan.reservedIdentityIds`；禁止把待创建父实体 identity 只藏在 operation-specific metadata。Workflow Lab 克隆 Approval 时以一个 replacement map 同时重写 project/episode、既有领域映射、reserved identity、Task target、plan、quote、payload 与 serialized runState，随后重新计算 hash 和 TTL。待 fork 的 Approval 必须有 pending durable interruption 与 runState；合法零 Task 计划仍是可恢复的 noop Approval，commit 必须保留 operation-specific plan writes 且不得伪造 Task。interruptionId 是主 identity，重复 toolCallId 不得猜测。克隆状态必须保留冻结计划 stale-value fence 所依赖的既有关联，禁止用目标 stage 的概括状态清空合法 association。
- **AR-05 — 并发与心跳可证明。** 锁、心跳、超时取消和恢复必须由同一运行时状态协调；旧 run 不得覆盖新 run 的结果。
- **AR-05A — Operation 副作用服从 Run execution fence。** Assistant Tool 调用必须把同一个 abort signal 与 `runId + runVersion + eventSeq` 交给 `invokeProjectAgentOperation`；continuation 还必须携带 `waitId + commandId + claimOwner`。统一入口在执行前拒绝已失效 Run；普通 Task 创建事务、批准计划事务与同步领域写入事务必须在 commit 前锁定 Run 行，并在 continuation 中同时锁定 Wait claim 行后再次校验 fence。同一声明式 Operation group 的成员额外携带相同 `executionSegmentId`，只允许该 segment 内 sibling Event 造成的单调水位前进；必须验证 execution-started identity、Run 仍为 `running` 与水位不回退，不能把这一许可扩展到其他 segment 或终态 Run。心跳、Redis lock 或 continuation claim 失效后，即使 Operation 已经开始，未提交的领域写入也必须整体回滚；只在 execute 返回后检查状态不构成防线。

- **AR-05C — 组审批只冻结一次模型决定。** Workflow 可声明 `operationGroup.operationIds` 与其中真正计费的 `approvalOperationIds`。SDK 必须把组内全部调用一起冻结；持久 Approval interruption 保存整组 approval item identity 与同一 serialized RunState，但 UI 只展示计费 Operation 的不可变 plan/quote。用户批准或拒绝时必须对该 RunState 中全部组成员一次性 approve/reject，不得再次调用模型、不得让非计费成员在批准前先执行，也不得把组包装成新的业务 Operation。
- **AR-05B — Execution eligibility 与等待 outcome 分离。** `effects.writes` 只描述领域数据写入，Run 的 `status` 只描述业务正在等待什么；二者都不得裁决一个 execution segment 是否仍能提交。Redis run lock 是当前 segment 的 lease，Run fence 只校验 `runId + runVersion + eventSeq`、abort 与可选 Wait claim，并且只在执行前或写入事务内使用；heartbeat 在持有该 lease 时不得因合法 `awaiting_*` status 撤销 ownership。暂停 settlement 在写自己的 Event 前必须通过 transaction barrier，在 Event 已推进本次 Run fence 后、提交前必须再次检查 abort signal；失锁时整笔交接回滚。`agentFlow.suspendsFor: choice` 只要求当前 invocation 登记完全匹配的不可见 `ChoiceHandoffReceipt`（run、execution segment、operation、toolCall）；最终可见 Interaction/Activity/card 必须由 execution-handoff 与 assistant message 一起提交。通用 invocation 绝不在提交后要求 Run 仍为 `running`、增加 awaiting 白名单或按 operation id 分支。Choice 是 Tool-only、非领域写、无媒体审批的 direct Operation；缺少 durable handoff 的调用必须失败。
- **AR-06 — Run 转换单调。** Run 只使用 `running`、`awaiting_approval`、`awaiting_choice`、`awaiting_task`、`completed`、`failed`、`cancelled` 七种状态。状态转换必须经事件 reducer 校验合法前驱并执行 CAS；三个终态不可重开。`run.failed` 只能从非终态写入 primary error；终态后到达的 `run.failed` 只作为已经持久化的 `ProjectAgentEvent` secondary diagnostic，绝不可覆盖 primary error 或重开 Activity/Wait。失去 Redis lease 所有权必须中止模型流并进入 `cancelled/run_lock_lost`，不得继续写入或伪装成业务失败。
- **AR-06A — Interaction 与 Activity 单调。** Approval 和 Choice 创建都必须通过同一个事务 authority，在持有目标 Run 行锁时一次性读取并 supersede 旧 pending interruption、结算其 Activity、完成前序 Activity 并 raise 新 interruption；任一 Event/reducer 写入失败必须整体回滚，禁止先 supersede 后 raise 的两阶段窗口。`activity.started` 只能 create，重复 identity 必须 conflict；`completed/failed/cancelled` 必须从 open 状态执行恰好一行的 CAS，零行或多行都原地失败，禁止终态重开或错误 activityId 静默前进。
- **AR-07 — Session/UI 只投影持久协议。** Panel 不得扫描历史 message、tool output 或 `task-submitted` part 推断 active Task、资源刷新、operation source 或 style generation；这些 identity 必须由 Session `currentActivity/activeTasks/pendingInteraction` 和正式 SSE resource envelope 提供。视觉风格生成面由 active-operation presentation registry 选择，内容只消费正式 Edit Bible Query 与 Task target runtime 组成的共享 View；历史 `edit-style-preview-generation` message part 已删除，renderer 不得查询、轮询或从 message snapshot 构造私有生命周期，风格选择仍只投影持久 Choice Offer。Session projector 必须用一次只读 scope 查询证明 active Run 至多一个，并只投影属于该 Run 的 open Activity、Interruption 与 Wait；多 active Run、缺失 runId、跨 Run 事实或终态 Run 仍有 open 事实都必须显式失败，禁止挑一条或拼成混合快照。已有 server runId 时，本地 control state 无权覆盖；本地 control pending 只覆盖实际 HTTP 请求窗口，错误或 Session 刷新失败均不得永久保持。成功提交后，已回答 interruption 的本地抑制必须保留到新的权威 Session 快照确认其消失，禁止旧快照重开已消费卡片。control 可见用户消息的 optimistic 与服务端持久副本必须复用 `runId + interruptionId + control type` 的同一个 canonical ID，使 Thread 收敛按身份替换而不是刷新后重复。每个 `ProjectAgentEvent` 必须在同一事务写入 `project_agent.session_broadcast` Outbox，Outbox worker 是 `assistant.session.changed` 的唯一发布者；SSE v2 cursor 以 `ProjectAgentEvent.id` 作为独立 Assistant 水位，并按 user/project/episode/assistant scope 提供最新 level-triggered bootstrap。服务端和客户端都必须在有界窗口内保存 `event identity → canonical fingerprint`；只有 identity 与 fingerprint 都相同才是 duplicate，同 identity 不同 fingerprint 必须 conflict 并触发 snapshot resync，不得静默吞掉。客户端收到通知后主动刷新 Session 与 Thread，Session 响应水位低于已见事件时必须拒绝。禁止 1.5 秒 polling、catch-up timer cascade 或持续 replay timer 承担正确性；客户端去重集合必须有界。
- **AR-07A — Thread clear 是带水位的 scope 事实。** 清空 Thread 必须在持有 project scope lock 的同一事务删除消息、追加唯一 `thread.cleared` scope Event 并写 Session broadcast Outbox。Session/Thread GET 必须返回持久水位；客户端只接受不低于已见水位的响应。权威空 Thread 必须 replace；清空后重建的非空 Thread 若持久 `thread.id` 与客户端最近接受的 identity 不同也必须 replace，只有同一 Thread identity 的快照才可与未持久 optimistic message 合并。

## 权威入口

- Project-agent runtime：`src/lib/project-agent/`。
- Project phase 与 Assistant 输入投影：`src/lib/project-projection/**` 只从正式领域资源构造 project View；`src/app/api/assistant/text-attachments/**` 只解析受限附件并交给 project-agent 输入协议，二者都不得成为第二 Run/Workflow 状态机。
- Task 终态续跑唯一执行入口：`src/lib/workers/outbox.worker.ts` → `runProjectAgentWaitContinuationCommand`。
- Continuation 唯一交接：`beginProjectAgentWaitContinuationExecution` 建立 running fence；`execution-handoff` 原子结算 terminal 或 `awaiting_*` outcome，并在重放时只调用其 finalize/recovery 入口。
- Choice Offer 契约、fingerprint 与严格解析：`src/lib/project-agent/choice-offer.ts`。
- Choice 身份、能力、确认命令与 Workflow policy 的穷尽入口：`src/lib/project-agent/edit-first-choice-tools.ts` 的 `EDIT_FIRST_CHOICE_REGISTRY`。
- Interaction-backed waiting 唯一 settlement/消费入口：`prepare/settleProjectAgent*ExecutionHandoff` 与 `consumeProjectAgentChoiceInterruption` / `consumeProjectAgentApprovalInterruption`。
- 已消费 Decision 的恢复入口：`readRetryableConsumedProjectAgent*Interruption` 只重读同一持久决定；`createProjectAgentConsumedControlRetryRun` 是唯一新 attempt 创建者；`run.execution_started` 是禁止再次执行的持久水位。
- Approval/Choice 原子替换 authority：`appendProjectAgentInterruptionReplacementInTransaction`；Activity 单调终态 authority：`transitionProjectAgentActivity`。
- Operation registry 验证：`src/lib/operations/registry.ts`。
- Operation API/Tool 唯一执行 authority：`src/lib/operations/invocation.ts` 的 `invokeProjectAgentOperation`；Choice 消费事务只能使用该入口的 `atomic_choice_confirmation` 模式与 caller-owned transaction，该模式拒绝非事务、收费、长任务、外部副作用与 suspension Operation。
- Operation Run fence 唯一裁判：`src/lib/project-agent/operation-execution-fence.ts`；Task 提交、批准计划与 transactional executor 只能复用该 commit barrier。
- Handoff/receipt authority：`src/lib/project-agent/execution-handoff.ts` 是 Choice、Approval、Task 与 terminal continuation 的唯一交接 owner；`recordProjectAgentSuspensionReceipt` 只在最终 Interaction 事务提交后登记，Choice invocation 只核验 `requireProjectAgentChoiceHandoffReceipt`。两者都不是第二份持久 UI 状态，也不读取 Run status。
- Tool 写 Operation 穷尽 authority：`src/lib/operations/write-authority.ts` 与实际 registry conformance；Thread clear 唯一入口：`src/lib/project-agent/thread-clear.ts`。
- Assistant Task batch 接线：`submitOperationTaskBatch` 只负责编排通用 Task persistence primitive；`ProjectAgentOperationTaskBatchBinding` 在同一 transaction 调用 `bindProjectAgentWaitToTasksInTransaction`，不得复制 Task/billing/Event/enqueue。
- Operation 类型和 agentFlow：`src/lib/operations/types.ts`。
- Active Operation 专用展示选择：`workspace-assistant-panel-state.ts` 的穷尽 presentation registry；视觉风格内容由 `style-preview-set-view.ts` 构造后交给独立 `EditStylePreviewGenerationDataCard.tsx`。该卡在 processing 阶段只读，在 Session 投影持久 `choiceType=style` 时复用通用 Choice output builder 提交选择；它不直接写领域数据，renderer 无权读取 Query、Task 或消息快照。
- Assistant Session 变更 envelope、持久重放和唯一 publisher：`src/lib/project-agent/session-event.ts`；事件与 Outbox 原子创建：`src/lib/project-agent/event/append.ts`。

## 验证

- `tests/golden-journey/**` 是 Assistant 跨浏览器、UI、Agent SDK、Operation、MySQL、Redis、worker、Outbox、SSE 与刷新恢复的最高组合证据；主线、阶段探针、断流、重复提交、provider failure 和 worker retry 使用同一生产链。
- `tests/integration/task/project-agent-*.integration.test.ts` 中保留的场景使用真实 MySQL/Redis 验证 continuation settlement、dead delivery、execution segment、Interruption 原子性、Task batch Wait、并发 terminal、Thread clear race 与 session broadcast。
- `tests/golden-journey/journeys/stage-probes.spec.ts` 验证 Workflow Lab 的 11 个稳定 checkpoint 经过生产 list/fork、真实 Session/UI 动作和持久 oracle 后能到达下一边界；Approval 还必须可重复 fork 后消费。目标 stage 是领域克隆的唯一时间边界：Bible lock、Asset requirement outcome、Storyboard image/video 等未来事实必须按该边界清空；冻结 Approval 所需的 target association 必须保留，禁止仅改概括 status 后留下会让 resolver 越级的完成事实。`tests/unit/workflow-lab/checkpoints.test.ts` 只反证 interruption identity、runState admission、reserved identity 与 stage normalization 的纯逻辑边界。
- `tests/unit/project-agent/{run-state-machine,event-reducer,event-reducer-transitions,execution-segment,suspension,waits,session-state-*}.test.ts` 只验证纯状态机、reducer、identity 和投影输入输出。
- `tests/contracts/assistant-choice-offer-conformance.test.ts` 从生产 Choice registry 穷尽验证 identity、resource fingerprint、Decision parser 与 suspension capability。
- `scripts/guards/{single-project-agent-continuation,no-plan-run-runtime,assistant-choice-offer-authority-guard,project-agent-run-state-machine-guard,single-operation-invocation-guard,sse-durable-watermark-guard}.mjs` 只提供结构旁路检查，不替代真实用户旅程。
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
| 用户决定 | `interruption.resolved.response` 中的规范化 ChoiceDecision / `consumeProjectAgentChoiceInterruption` | registry 确认命令、Workflow 与下一回合 runtime |
| 已消费决定的执行资格 | `run.execution_started.executionSegmentId=decision:<interruptionId>`；只查询同一 Decision segment | control route、runtime；初始 user turn 或其他 continuation 的水位不参与该决定重试 |
| 确定性确认命令 | `EDIT_FIRST_CHOICE_REGISTRY.resolveAtomicConfirmationCommand` | Choice 消费事务中的统一 Operation invocation；AI 不再转发 |
| 选定视觉风格的领域写入 | `confirm_edit_style_preview` Operation / `confirmProjectEditStylePreview` 服务 | 刷新后的 Workflow、Edit Bible 与 UI 投影 |
| Choice 卡片交互/提交/布局策略 | 持久 Offer 中的 `choiceType + replyMode + submit.decision + group.presentation` / Choice card builder | Panel/renderer；专用 renderer 只按持久 `choiceType` 选择，提交语义仍由通用策略构造 |
| 卡片临时选中项、输入框文本 | 浏览器组件本地状态 | 仅用于组装一次 control 请求，不解释业务生命周期 |

写入者变化：Offer/卡片解释者由“stream card + Session 动态 builder + 客户端 choiceType + Activity fallback”四条路径收敛为一个持久 interruption Offer；ChoiceDecision 只由服务端 canonicalizer 写入 Event。视觉风格写入者始终只有 `confirm_edit_style_preview` Operation；本次只是把发起者从 AI 转发改为已验证的用户 Choice 命令。对应客户端 mutation hook 与专用 route保持删除，route/renderer 仍无领域写权。确认后状态解释者从“旧 Workflow overlay + 新数据库 resolver”两个收敛为后者一个。

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
- `PROJECT_AGENT_AI_TURN_PROTOCOL_REQUIRED` 曾把“Workflow 仍有可用 `nextAction`”解释为 Run 失败。真实复发证明 capability 不是 obligation；该 writer 已删除，Run 可以在仍有后续能力时合法 completed。
- 删除硬失败后，真实制作规划确认与视觉风格确认仍分别停在新 `nextAction` 之前，证明结构化确认不是 AI 应再次决定的意图。确认命令现与 Choice 消费原子提交，AI 只从正式新状态继续。
- 视觉风格生成卡曾在删除客户端第二 writer 时被连同只读 presentation 一起删除，而 Golden 只观察 Task 终态与 Choice，未观察 processing UI；恢复只读 View 后仍由 Choice/Operation 独占写入。
- `BUG-AR-003` 证明“非领域写”等于“Run 保持 running”是错误推导；更深层地，fence 不得把业务 outcome 当作执行资格。Choice 成功提交其 suspension receipt 后合法进入 `awaiting_choice`；receipt 在 invocation 内被通用验证，Run status 不再参与提交后的重新裁决。

## 修改检查表

1. 此改动触及哪一种 run 结算结果？
2. 谁写入权威状态，谁只能读取或投影？
3. Task 终态如何幂等地唤醒正确 run？
4. 并发、重放、心跳超时和取消是否有测试？
5. 是否新增了按 operation id 或消息文本的控制流特判？若是，必须重做为 registry/状态机语义。
6. Choice Decision 是否由 registry 明确区分“用户已发起的原子确认命令”和“仍需 AI/Task/Approval handoff 的创作请求”？确认提交后是否从正式数据库重新解析 Workflow，而没有服务器猜测或强制耗尽后续 `nextAction`？
7. 此转换是否带有可区分同状态代次的持久 `runVersion/eventSeq`？仅比较 status 不能阻止 ABA，未具备版本围栏时必须明确记录为未完成风险。
8. Choice 卡片是否来自持久 Offer，提交是否验证 card/tool/resource fingerprint，Event 是否只保存规范化 Decision？
9. 若 Operation 声明了 Choice suspension，是否只验证本次已提交的通用 receipt，而没有在提交后读取 Run status、按 operation id 分支或要求继续 `running`？
