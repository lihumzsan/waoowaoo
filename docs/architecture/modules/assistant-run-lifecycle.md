<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Run 生命周期

## 设计理念

Assistant 是受服务端运行时约束的决策者，不是流程状态的权威来源。一次 run 的开始、等待、任务关联、恢复、结算和失败必须由服务端持久状态与锁协调；模型消息、UI 文案或工具输出不能自行宣告流程已完成。

## 不变量

- **AR-01 — 服务端权威。** thread/run 的 append、终态、锁和恢复由服务端管理；客户端和模型不得持有第二套 run 状态。
- **AR-02 — 每回合有结算语义。** 一个 turn 必须明确是完成、等待用户、等待 Task、继续 Agent 还是失败；零输出、伪完成和停滞必须显式报错或进入明确状态。
- **AR-02A — Choice 续跑不可静默完成。** 用户提交结构化选择后，服务端必须重新读取 Workflow；若存在已启用的权威 `nextAction`，本回合必须执行该 operation、进入 approval/choice/Task 等等待态或显式失败，不得只输出成功文案后把 run 标记为完成。
- **AR-02B — Choice Offer 单一权威。** Choice 工具必须先把完整且不可变的 Offer 持久化到 `ProjectAgentInterruption.payload`。Offer 同时包含 schema version、必填的 run/interruption/card/tool identity、完整卡片和受审资源 fingerprint。首屏 stream 与刷新后的 Session 只能投影这份持久 Offer；不得刷新时重查资源重建卡片，也不得接受客户端提交的 `choiceType` 作为控制事实。
- **AR-02C — Choice 原子提交。** Choice control 只提交 interruptionId、cardId、toolCallId 与原始回答。服务端必须在同一数据库事务中读取并严格解析 Offer、校验三个身份、重读当前受审资源 fingerprint、把回答规范化成穷尽的 ChoiceDecision，最后消费 interruption 并推进 Run。Event 只持久化规范化 Decision，客户端多余字段不得进入权威历史。身份或 fingerprint 不匹配必须 conflict，且 interruption 保持 pending。
- **AR-02D — Choice 不执行领域写入。** 所有 Choice 卡片统一使用 `submit_tool_output`，只记录用户决定。Workflow 把已消费的决定映射为唯一 `nextAction`，注册式 Operation 独占领域写入。视觉风格选择必须走 `confirm_edit_style_preview`；Choice renderer、Panel 与旧风格生成卡不得直接调用确认 API、不得以空 interruption/tool identity 续跑。
- **AR-02E — 最终消息与 Run 终态原子结算。** 普通 Run 的 assistant message 与 `completed/failed/cancelled` Event 必须由 `settleProjectAgentRunWithMessage` 在同一事务提交；消息写失败时终态不得前进。Thread append 必须锁定唯一 thread aggregate，禁止并发用户消息、普通 Run 和 continuation 通过 read-modify-write 相互覆盖。
- **AR-03 — Task 终态驱动继续。** Task 成功/失败后的唤醒只由持久任务终态触发，并以幂等方式关联到对应 run。
- **AR-03B — Continuation 单入口、at-most-once 模型围栏与两阶段交接。** Task 终态续跑只能由 Outbox worker 消费 `PROJECT_AGENT_CONTINUE_WAIT` 命令启动。命令 ID 同时作为 claim、Activity、模型 request 与消息幂等身份。调用模型前必须先把 `ProjectAgentContinuationCheckpoint.status=running` 持久化为不可重复执行围栏；重放看到未结算的 `running` 只能显式结算为 `outcome_unknown/failed`，不得再次调用模型或工具。模型正常完成后，在一个事务内追加 assistant message 并把 checkpoint CAS 为 `settled`，再由 settled checkpoint 驱动 Activity/Wait/Run 终态。route、客户端、轮询和 refetch 不得成为第二续跑入口。
- **AR-03A — 失败不授权改写。** 已确认剧本的制作规划任务失败只允许 Assistant 解释并等待用户决定；失败终态不得自动授权重写剧本或提交新输入。
- **AR-04 — 用户界面只呈现产品语义。** 运行卡片可展示本地化操作名和任务数量，不得展示 taskType、targetType、targetId、operationId、原始工具参数或原始工具结果；这些字段只用于诊断日志和持久协议。
- **AR-04 — 工具契约在 registry。** operation 的输入、confirmation、agentFlow、plan/commit 与输出 schema 必须在 registry 统一声明；不得以 operation id 特判或从文案反推控制流。
- **AR-05 — 并发与心跳可证明。** 锁、心跳、超时取消和恢复必须由同一运行时状态协调；旧 run 不得覆盖新 run 的结果。
- **AR-06 — Run 转换单调。** Run 只使用 `running`、`awaiting_approval`、`awaiting_choice`、`awaiting_task`、`completed`、`failed`、`cancelled` 七种状态。状态转换必须经事件 reducer 校验合法前驱并执行 CAS；三个终态不可重开。失去 DB heartbeat 或 Redis lock 所有权必须中止模型流并进入 `cancelled/run_lock_lost`，不得继续写入或伪装成业务失败。
- **AR-07 — Session/UI 只投影持久协议。** Panel 不得扫描历史 message、tool output 或 `task-submitted` part 推断 active Task、资源刷新、operation source 或 style generation；这些 identity 必须由 Session `currentActivity/activeTasks/pendingInteraction` 和正式 SSE resource envelope 提供。已有 server runId 时，本地 control state 无权覆盖。Session/Thread 收敛由请求完成边沿或持久 SSE 通知驱动，禁止 1.5 秒 polling、catch-up timer cascade 或持续 replay timer 承担正确性；客户端去重集合必须有界。

## 权威入口

- Project-agent runtime：`src/lib/project-agent/`。
- Task 终态续跑唯一执行入口：`src/lib/workers/outbox.worker.ts` → `runProjectAgentWaitContinuationCommand`。
- Continuation 三段交接：`beginProjectAgentWaitContinuationExecution` → `checkpointProjectAgentWaitFollowUp` → `finalizeProjectAgentWaitFollowUp`。
- Choice Offer 契约、fingerprint 与严格解析：`src/lib/project-agent/choice-offer.ts`。
- Choice 唯一创建/消费入口：`createProjectAgentChoiceInterruption` 与 `consumeProjectAgentChoiceInterruption`。
- Operation registry 验证：`src/lib/operations/registry.ts`。
- Operation 类型和 agentFlow：`src/lib/operations/types.ts`。

## 验证

- `tests/unit/project-agent/runtime-routing.test.ts` 验证运行时路由。
- `tests/unit/project-agent/server-follow-up.test.ts` 验证稳定 command identity、checkpoint-before-finalize 与 checkpoint replay 不重跑模型。
- `tests/unit/project-agent/waits-follow-up.test.ts` 验证 Wait claim/start fence 的原子推进与同命令重放。
- `tests/integration/task/project-agent-continuation-settlement.integration.test.ts` 在真实 MySQL 上验证并发 checkpoint、message/checkpoint 原子性、checkpoint 后崩溃重放与缺失 checkpoint 时终态事务整体回滚。
- `tests/unit/project-agent/run-state-machine.test.ts` 验证七状态转换、终态单调和 expected-status 门禁。
- `tests/unit/project-agent/run-heartbeat.test.ts` 验证 DB/Redis 续租失败和异常都会触发 ownership loss。
- `tests/unit/project-agent/interruption-consume.test.ts` 验证重复/并发消费由 pending 状态 CAS 拒绝，基础设施故障不会伪装成重复提交。
- `tests/contracts/assistant-choice-offer-conformance.test.ts` 穷尽验证每一种 Choice 都绑定一个显式受审资源种类，且卡片必须有完整持久身份。
- `tests/unit/project-agent/session-state.test.ts` 验证刷新只投影 interruption 中的持久 Offer，不调用卡片 builder。
- `tests/unit/project-agent/interruption-reopen.test.ts` 验证 interruption 按消费代次幂等重开且失败显式上报。
- `tests/unit/project-workflow/edit-first.test.ts` 验证失败状态不会开放剧本改写操作。
- `tests/unit/project-agent/tool-adapter-gates.test.ts` 验证工具确认与执行门禁。
- `tests/unit/operations/registry.test.ts` 验证 operation metadata、confirmation 和 agentFlow。
- `scripts/guards/no-client-agent-control.mjs` 阻止客户端成为 Agent 控制面。
- `scripts/guards/no-assistant-fixed-workflow-surface.mjs` 阻止将固定流程伪装成 Agent 自主运行。
- `scripts/guards/no-history-state-inference.mjs` 阻止从历史消息推断当前业务状态。
- 同一 guard 扫描实际 Panel/runtime/helper，阻止退役的 async-task/style-preview history scanner、timer polling 和 client-run-over-server precedence 回流。
- `scripts/guards/no-project-agent-direct-task-submit.mjs` 阻止 Assistant 控制层直接提交 Task 并绕过 operation/Wait。
- `scripts/guards/single-project-agent-continuation.mjs` 阻止旧 Wait 扫描/claim helpers 与第二续跑调用者复活，并强制 Outbox-only、message checkpoint-before-finalize 的两阶段顺序。
- `scripts/guards/no-plan-run-runtime.mjs` 阻止已退役的 PlanRun runtime、API 与 operation 入口重新形成第二套 Assistant 执行状态机。
- `tests/integration/api/specific/workflow-lab-service.integration.test.ts` 与 `workflow-lab-style-choice.integration.test.ts` 验证 Lab Choice 也经同一事件 reducer 投影并共用目标 runtime identity，Approval checkpoint 不伪造不可消费的运行态。
- `scripts/guards/project-agent-run-state-machine-guard.mjs` 扫描全 `src` 的 Run、Activity、Interruption 生命周期写入，阻止 reducer 外重新出现第二写入者，并阻止 session-state GET 恢复 stale cancellation 副作用。仅允许 `heartbeatAt` 与已消费 interruption `runState` 清理两个明确的非生命周期维护写入。
- `scripts/guards/assistant-choice-offer-authority-guard.mjs` 阻止 chat route 恢复无 interruption 的 Activity fallback、阻止客户端重新提供 `choiceType`、阻止 Session refresh 重建卡片，并强制 Choice 在同一事务内验证 Offer/fingerprint 后只持久化规范化 Decision。

## Choice 状态所有权

| 事实 | 唯一所有者 / 写入者 | 消费者 |
|---|---|---|
| 用户看到并回答的 Choice Offer | `ProjectAgentInterruption.payload` / `createProjectAgentChoiceInterruption` | 首屏 stream、Session refresh、Choice control |
| Offer 身份 | Offer 内必填的 `runId + interruptionId + cardId + toolCallId` | API control 与原子消费服务 |
| 受审资源代次 | Offer 的 `reviewedResource.kind + fingerprint` / Choice card builder | 原子消费服务在同事务内重读正式资源后比较 |
| 用户决定 | `interruption.resolved.response` 中的规范化 ChoiceDecision / `consumeProjectAgentChoiceInterruption` | Workflow 与下一回合 runtime |
| 选定视觉风格的领域写入 | `confirm_edit_style_preview` Operation / `confirmProjectEditStylePreview` 服务 | Workflow continuation、Edit Bible 与 UI 投影 |
| 卡片临时选中项、输入框文本 | 浏览器组件本地状态 | 仅用于组装一次 control 请求，不解释业务生命周期 |

写入者变化：Offer/卡片解释者由“stream card + Session 动态 builder + 客户端 choiceType + Activity fallback”四条路径收敛为一个持久 interruption Offer；ChoiceDecision 只由服务端 canonicalizer 写入 Event。视觉风格写入者由 Choice renderer、Panel、旧 generation card 以及 `/bible/style-preview` PATCH 四条路径收敛为 `confirm_edit_style_preview` Operation 一个；对应客户端 mutation hook 与专用 route 已删除。删除了 chat route 的 null-interruption Activity 完成路径、Session 的 choiceType 私有 parser/卡片重建 switch，以及 Workflow Lab 的 style-choice 无 interruption 特例。

## Task continuation 状态所有权

| 事实 | 唯一所有者 / 写入者 | 消费者 |
|---|---|---|
| Task 终态与 Wait 可唤醒事实 | `commitTaskTerminal` / `resolveProjectAgentWaitsForTaskTerminalInTransaction` | Outbox command 创建逻辑 |
| continuation 命令与重试责任 | `OutboxCommand` / Outbox worker | `runProjectAgentWaitContinuationCommand` |
| continuation claim 与 fence | `ProjectAgentWait` / Wait authority | server follow-up runtime |
| continuation 模型执行资格 | `ProjectAgentContinuationCheckpoint.status=running` / `beginProjectAgentWaitContinuationExecution` | 唯一 Outbox continuation runtime；存在该围栏的重放不得再调用模型 |
| continuation assistant message 与模型结算结果 | `ProjectAssistantThread + ProjectAgentContinuationCheckpoint.status=settled` / `checkpointProjectAgentWaitFollowUp` 同一事务 | replay 与终态交接 |
| Activity/Wait/Run 终态 | Event reducer / `finalizeProjectAgentWaitFollowUp` | Session/UI 投影 |
| loading、spinner、状态文案 | 上述持久事实的纯投影 | UI；不得反写生命周期 |

写入者变化：删除 scope 扫描、resolved Wait 列表/claim helpers 和客户端 follow-up 控制入口；续跑调用者收敛为 Outbox worker 一个。模型输出不再先于持久 checkpoint 直接宣告 Wait/Run 已结算；checkpoint 重放只完成第二阶段，不再次调用模型。

## 历史回归

- `227b2d288` 收敛 server-owned append、heartbeat 与 Redis lock；`41c5a13a` 随后仍修复 run settlement race，说明局部加锁不能替代完整 run 语义。
- `7f8e161be` 修复 stale bootstrap、heartbeat、tool leak、noop/stall 等多个症状，表明需要把这些症状收敛为同一生命周期契约。
- 制作规划 choice 曾通过局部副作用提交视觉风格 Task，导致模型文案、候选记录、run/Wait 三套状态分离；Choice 只负责落用户决定，异步执行必须回到 registry 与 runtime。

## 修改检查表

1. 此改动触及哪一种 run 结算结果？
2. 谁写入权威状态，谁只能读取或投影？
3. Task 终态如何幂等地唤醒正确 run？
4. 并发、重放、心跳超时和取消是否有测试？
5. 是否新增了按 operation id 或消息文本的控制流特判？若是，必须重做为 registry/状态机语义。
6. Choice 落库后若 Workflow 存在 `nextAction`，run 是否证明已执行、等待或显式失败？
7. 此转换是否带有可区分同状态代次的持久 `runVersion/eventSeq`？仅比较 status 不能阻止 ABA，未具备版本围栏时必须明确记录为未完成风险。
8. Choice 卡片是否来自持久 Offer，提交是否验证 card/tool/resource fingerprint，Event 是否只保存规范化 Decision？
