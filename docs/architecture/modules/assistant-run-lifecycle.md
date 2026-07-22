<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Run 生命周期

## 设计理念

Assistant 是受服务端运行时约束的决策者，不是流程状态的权威来源。一次 run 的开始、等待、任务关联、恢复、结算和失败必须由服务端持久状态与锁协调；模型消息、UI 文案或工具输出不能自行宣告流程已完成。

## 不变量

- **AR-01 — 服务端权威。** thread/run 的 append、终态、锁和恢复由服务端管理；客户端和模型不得持有第二套 run 状态。
- **AR-01A — 不存在 Workflow 或主链状态。** Assistant 的唯一能力表是完整 Operation registry；项目快照只提供持久事实和能力约束，不提供 `step/status/recommendedAction`。Primary Agent 每次依据用户目标、精确 Resource Revision、Task 终态、输入 prerequisite、owner/scope、provider capability、Approval/Choice 与 Run fence 自主组合 Operation。不得恢复 WorkflowView、阶段、固定下一步、持续时间分支、operation group、UI gating 或任何第二状态机。
- **AR-01D — Agent Plan 只是线程便签。** `update_plan` 是当前 Assistant Thread 计划快照的唯一写入口，每次调用完整替换，最多一个步骤为 `in_progress`，空列表清除。快照只进入后续模型输入与 Session 最终 View；不得驱动 Operation eligibility、Task/Wait/Approval/Choice、Workflow、Resource/Artifact、Canvas 节点或 Run 终态，也不得恢复 `PlanRun`、任务依赖或第二套执行状态机。模型自主判断步骤完成，UI 只展示快照，不从历史消息或 Tool output 重建，也不得用 spinner 把 `in_progress` 伪装成仍在运行的 Task/Run。
- **AR-01E — 设置不形成 Agent 模式。** Assistant 没有 Ask/Auto 执行模式，客户端不得向 chat/control 传递权限模式，Prompt 也不得据此改变工具可用性。破坏性 Operation 始终使用 SDK Approval，Choice 始终属于用户决定；`UserPreference.assistantBillingConfirmationRequired` 只决定新收费调用是否创建报价 Interruption。关闭时 runtime 仍为本次 Tool call 创建不可变 plan/quote 与精确 Grant，再复用唯一收费提交入口；既有 pending Approval 继续按原 Grant 恢复，不被设置变化自动消费。
- **AR-01F — Creative Subagent 只复用 Task，不形成第二 Agent Run。** 主 Agent 只能通过注册式 `delegate_creative_work` 委派专业创作推理；严格 `delegation.source=requests|chapters` 联合经统一 Task submitter 为每个逻辑请求创建一个 `creative_work` Task。`Task.id` 是唯一 Subagent identity，`Task.status` 是唯一生命周期事实；Worker 只在某个 Task attempt 内运行一次无状态模型循环，初始看到完整紧凑 Skill catalog，并且只能调用 `read_skill` 自主读取知识。Worker 模型只由服务端正式 `analysis` 角色配置解析并冻结到 Task，Primary Assistant 模型、Agent 输入、output kind 和 Worker 均不得重新选模；Primary、output kind 和服务端也均不指定必读专业 Skill。Worker 没有 ProjectAgent Run/Thread、Operation、Wait、Approval、Choice、Resource、Canvas 或领域数据库写权，结果也不裁决项目状态。多个 Subagent 只复用当前模型步骤既有 `OperationBatch + collecting Wait`，全部终态后只由既有 Outbox continuation 恢复主 Agent 一次。完整 strict 结果保存在 `Task.result`；Session 生命周期与 continuation 只能收到 TaskDefinition 的 reference projection，需要正文时主 Agent 通过正式 `get_task(taskId)` 读取。禁止恢复同步 Tool 内 Worker、Activity identity、`subagent.progressed` writer、独立 Subagent Run/Thread/Batch 或第二套恢复协议。真实执行仍由主 Agent 的完整 Operation registry 单入口完成；Operation、Canvas、Approval/Choice、计费与 Run fence 均保持既有权威入口。
- **AR-01C — Tool Schema 是模型调用的唯一参数契约。** 每个 tool-visible Operation 必须从同一个 strict runtime schema 生成完整 OpenAI strict Tool Schema，或声明与该 runtime command 等价的显式 schema；不得把必需参数藏在空 object、`unknown`、passthrough、根级 refinement 或 Prompt 文案中。可选字段为适配 strict 模式暴露为 nullable 时，enum/const 与运行时 null-to-absence normalizer 必须保持同一可接受集合。条件输入必须使用可穷尽 discriminated branch。Main Agent 只提交产品级创作参数，不得读取、选择或提交 `modelKey`、`*Model`、provider 原始字段或冻结执行选项；媒体与专业 Task 的实际模型只由服务端 `resolveSystemModelKey`/正式配置 owner 解析，再由 capability registry 校验。模型列表、用户偏好、provider 配置和 `get_project_config` 只能是 API channel。`update_project_config` 仍是同一项目配置 writer，但其 Agent tool projection 只能暴露 `videoRatio`，不得暴露任何模型、Provider、分辨率字段。输入错误必须返回 typed code、field、allowed values 与可修正语义，不能退化为通用失败文案。
- **AR-01G — 项目画幅是一个普通、可空的项目事实。** `Project.videoRatio` 不得有数据库、config service、project create 或媒体 Operation 的隐式默认；不存在专用 `confirmedAt/version` 状态。`update_project_config` 是唯一 writer，只接受模型显式提交的 ratio，不从用户文案 substring 猜确认。画幅缺失且当前媒体请求需要它时，Primary 可发起模型填写的通用 Choice，并将当前选择原子 commitment 到 Choice-eligible `update_project_config`；该 commitment 只写当前画幅，不授权或启动媒体。所有项目图片/视频 plan 冻结当前 `ratio + fingerprint`，重放时重新读取同一事实并比较内容；媒体请求中的显式 aspectRatio 必须与项目事实一致，禁止局部覆盖。global Asset Hub 不属于项目交付画幅，明确豁免。
- **AR-01B — HTTP Command 单入口。** 用户消息、Approval response 与 Choice response 必须先由各自 route 完成一次鉴权和输入解析，再统一调用 `executeProjectAgentCommand`。只有该 service 可以为 HTTP command 编排 thread read/merge、Run slot/identity、Redis lock/heartbeat、Run create/retry、Interruption consume、runtime invocation 与 pre-stream failure settlement；route 不得导入 runtime/Run/lock/Interruption owner，不得构造私有 `NextRequest`、header 或 body 再调用另一 route。service 只组合现有 owner，不直接实现模型、Operation、Billing、Task Terminal 或 execution handoff。Task terminal continuation 仍只属于 AR-03B 的 Outbox 入口，不得为追求形式统一改走 HTTP service。
- **AR-02 — 每回合有结算语义。** 一个前台 turn 必须明确是完成、等待用户、继续 Agent 还是失败；合法的空输出或未发起新 Tool 可以结算为 `completed` 且不产生领域事实，只有 completion、Tool、持久化、ownership 或协议本身失败才可结算为失败。Task 提交只产生 durable receipt 与独立后台 Run/Wait，不把当前前台 Run 改成等待 Task；模型文案不得伪造领域完成。
- **AR-02A — 只有一个通用 Choice。** `request_choice` 是唯一 Choice 发起入口。Primary Agent 必须为当前一个决定填写完整本地化卡片内容、交互模式、候选组、稳定 option value、可选精确 subject 和可选 commitment；服务端只补 run/interruption/card/tool identity。协议不存在 `choiceType`、领域卡片 registry、Workflow 触发器或服务器从文案猜测的卡片。Choice 不得承诺、命名或自动启动后续步骤。
- **AR-02B — Choice Offer 单一权威。** `request_choice` 先把完整不可变 Offer 持久化为 `ProjectAgentExecutionHandoff(kind=choice)`；唯一 settlement 在同一事务写入可见 `ProjectAgentInterruption.payload`、assistant message 与 Run 等待状态。Offer 同时包含身份、完整卡片、精确 subject fingerprint 和零个或多个当前决定 commitment。首屏与刷新只投影该 Offer；不得从当前 Resource、历史消息、DOM 或专用领域表重建卡片。
- **AR-02C — Choice 回答原子消费。** control 只提交 interruptionId、cardId、toolCallId 与原始回答。服务端同一事务严格解析持久 Offer、校验身份、重读 subject fingerprint、把回答规范化为 `confirm | select | text`、消费 interruption、记录 Event 并开始唯一 response execution segment。任一身份、fingerprint、回答或命令校验失败必须整体回滚，Choice 保持 pending。
- **AR-02D — 可选 commitment 只提交当前 Operation。** Offer 可以没有 commitment；此时回答只恢复 Primary Agent。只有模型在 Offer 中明确冻结、且目标 Operation 在 registry 声明 `choiceCommit.enabled=true` 的确定性、非收费、事务型写入，才可随匹配的 confirm/option 在 Choice 消费事务中复用唯一 Operation invocation 原子提交。自由文本永不执行 commitment；一次回答至多匹配一个 Operation；不得把当前决定扩展为后续链、媒体 Task、收费授权或第二 writer。
- **AR-02E — 最终消息与 Run 终态原子结算。** 普通 Run 的 assistant message 与 `completed/failed/cancelled` Event 必须由 `settleProjectAgentRunWithMessage` 在同一事务提交；消息写失败时终态不得前进。前台消费者取消流时，取消终态必须先于通用 settled cleanup 提交，然后才能停心跳并释放 Run lock；HTTP request 断开只是进入同一终态的另一个 signal。两者都不得取消已提交的后台 Task/Wait。Thread append 必须锁定唯一 thread aggregate，禁止并发用户消息、普通 Run 和 continuation 通过 read-modify-write 相互覆盖。
- **AR-02F — 通用卡片策略由 Offer 自描述。** 持久卡片显式声明 `mode`、`replyMode`、group `presentation`、是否允许组内自由文本以及所有用户可见文案。通用 renderer 只能消费这些字段，不得按 group key、候选内容、领域类型或历史消息私自解释交互和布局。新增选择场景只增加一次 `request_choice` 调用，不新增协议类型、renderer dispatcher、route 或写入入口。
- **AR-02G — 决定不可重开，执行段可恢复。** Approval/Choice 一经 `consumed` 就是不可变事实。一个 Run 可包含 initial user turn、Decision resume、Task continuation 多个执行段；`run.execution_started` 必须绑定明确的 `executionSegmentId`（user Run、interruptionId 或 continuation commandId），不可再用 runId 代表所有执行。持久 execution-started identity 是 Redis lock 之外的数据库围栏；同一 segment 再次申请必须在模型压缩、模型调用和 Tool 执行前显式拒绝并按 outcome unknown 处理，不得把幂等 Event replay 当作新的执行许可。初始 user-turn 的水位不得阻止尚未开始的 Decision retry。
- **AR-03 — Task 终态驱动继续。** Task 成功/失败后的唤醒只由持久任务终态触发，并以幂等方式关联到对应 run。
- **AR-03C — 一个模型步骤的 OperationBatch 与唯一后台 Wait 原子交接。** 一个模型 step 可以发出多个独立 Tool call，也可以多次调用同一个 Operation；成员身份是 opaque `toolCallId`，不得用 operationId 去重。所有实际提交 Task 的成员共享一个 `OperationBatch(batchId)`、一个独立 `backgroundRunId` 和一个 collecting Wait；每个成员仍通过自己的 Task/批准计划事务，把 Task、billing freeze、Created Event、lifecycle/enqueue Outbox 与该成员的 Wait membership 一次提交。SDK Tool commit callback 可以为数据库围栏串行执行，但已提交 Task 彼此并行，不能把 commit 串行误解为后台执行串行。模型步骤结束时 runtime 只 seal 一次完整 Task 集；Task 在 seal 前先终态时不触发 continuation，seal 必须锁定真实 Task 并折叠这些早到终态。seal 后 Wait 行是整批终态聚合的唯一事实；全部成员无论成功、失败或取消，最后一个终态都只创建一条 continuation command，不存在按 Operation 配置的静默完成分支。成员提交后只向前台模型返回 durable Task receipt；前台 Run 继续工具循环或正常回复，用户也可在后台 Run `awaiting_task` 时开启新前台 turn。不得每 Task 建 Wait、首个成员完成就恢复、以 operationId 禁止重复调用、提交后猜 membership，或把后台 Wait 当成全局对话锁。
- **AR-03F — 并行 Tool 失败是一轮纠错机会。** stop controller 以一次模型 step 为纠错计数单位；同一步中无论有多少并行成员失败，run-level error budget 只增加一次，同一 Operation 的 per-operation budget 也只增加一次。下一模型 step 再次失败才算新的尝试。`OPERATION_NOT_ALLOWED/NOT_FOUND/PLAN_CHANGED/OUTPUT_INVALID` 等 fatal code 仍可在首个失败 step 立即停止；错误事实和所有成员结果仍逐项保留，不能用聚合计数覆盖或伪造成功。
- **AR-03B — Continuation 单入口、at-most-once 模型围栏与原子交接。** Task 终态续跑只能由 Outbox worker 消费 `PROJECT_AGENT_CONTINUE_WAIT` 命令启动。命令 ID 同时作为 claim、execution segment、模型 request 与消息幂等身份；它不是 `ProjectAgentActivity`。开始续跑时必须先检查数据库 Run slot，再取得同 scope 的 Run lock；slot 检查只能排除 continuation 自己的后台 Run，必须清理其他 stale `running` Run，并在另一前台 Run 正在执行或等待 Approval/Choice 时保持投递可重试。此类占用是 typed defer，不是 delivery failure：Outbox 必须释放 lease、保留非 dead 命令并设置下一次 `availableAt`，本次 BullMQ job 正常结束后由既有 dispatcher 重新投递，禁止消耗有限失败次数。Redis lease 已释放不能覆盖仍 fresh 的数据库 `running` 事实，不得并发写同一 Thread。取得执行权后必须原子写 `run.execution_started` 并将后台 Run 推进 `running`，再把 `ProjectAgentContinuationCheckpoint.status=running` 持久化为不可重复执行围栏；重放看到未结算的 `running` 必须先恢复已准备的 interaction handoff，否则显式结算为 `outcome_unknown/failed`，不得再次调用模型或工具。普通完成、失败、投递耗尽和新的 Choice/Approval 等待都必须由 `execution-handoff` 在一次事务中写 message、checkpoint、Wait、Run 与事件；续跑中新提交的 Task 进入新的后台 OperationBatch，而不再次悬挂当前 Run。route、客户端、轮询和 refetch 不得成为第二续跑入口。
- **AR-03E — Execution Handoff 唯一写入者。** `ProjectAgentExecutionHandoff` 是不可见、可恢复的交接 intent。Choice/Approval 必须先准备 intent，再由同一模块把 message、Interaction、Run、checkpoint 与 Event 一次结算；OperationBatch 必须在第一个 Task 成员事务中准备 `task_batch` intent、随成员单调增长 Task 集，并在 collecting Wait seal 事务中结算。普通 terminal continuation 也必须由该模块一次结算。旧的前台 `task` suspension/handoff 已删除；adapter 只能结束自己的 Operation Activity，任何 adapter、Choice/Approval helper 或旧 finalizer 都不得结束 continuation Activity 或另行更新 checkpoint settled。
- **AR-03D — Continuation 投递耗尽必须先结算。** `PROJECT_AGENT_CONTINUE_WAIT` 达到持久 delivery 上限时，Outbox worker 必须先通过唯一 settlement 入口原子结算 checkpoint、Wait、Run、Thread message 与 Session Event，成功后才能把 Outbox 标为 dead。尚未开始执行的命令结算为 `delivery_exhausted`；已进入 `running` checkpoint 的未知结果结算为 `outcome_unknown`。settlement 失败必须保持 Outbox 可重试，禁止留下永久 `awaiting_task` Run/Wait。
- **AR-03A — 失败不自动授权改写，也不改写 Run 结论。** Task 失败事实只属于 Task/Wait/Activity；终态 continuation 必须把成功与失败的真实 Resource/Task refs交给 Assistant。模型可以据此形成一个新的显式重试决定，但必须重新调用正常 Operation；收费重试仍重新生成精确报价并按当前用户设置取得新的显式 Approval 或单次精确 Grant，不能继承失败 Task 的授权。系统不得在没有新 Tool 决定时自动重写、重新提交或写领域事实。若解释/规划回合本身没有协议错误，continuation 可结算为 `completed`，禁止把被解释的 Task 失败提升为 `run.failed`。
- **AR-04 — 用户界面只呈现产品语义。** 普通运行卡片必须从 Session `activeTasks` 投影同一 Wait 下全部本地化操作名和总任务数；不得假设只有一个 Operation，也不得展示 taskType、targetType、targetId、operationId、原始工具参数或原始工具结果。`creative_work` 是唯一显式例外：它从普通 `activeTasks` 排除，只由同一 Session View 的 `subagents` 投影为 Primary/Subagent 标签、公开推理摘要、Skill/工具轨迹与终态结果，避免一项 Task 同时显示成普通运行卡和 Subagent。产品只可显示 provider 明确公开的 reasoning text/summary；原始或加密 CoT、signature、Skill 正文、系统 Prompt、原始工具参数与内部 metadata 不得进入 UI。
- **AR-04G — Primary reasoning 只有一个流裁判和一个 Disclosure。** Agents extension 的既有 UI converter 继续唯一投影 message、step、text、tool 与 approval；repo-owned observer 只从同一 `RunStreamEvent` 读取公开 reasoning delta，并写入可唤醒 side channel。`createProjectAgentUiMessageStream` 是两者的唯一输出裁判：先发 converter 的 message `start`，再发 Run 数据与实时 reasoning；SDK 终态 reasoning aggregate 只做逐 block 一致性校验后抑制，缺少实时 delta 时才作为唯一兜底。分叉、缺块或身份冲突必须失败。UI 只由该 message 第一条 `agent-run` part 在正文之前聚合本轮全部 reasoning part，运行时展开同一个 Disclosure、终态自动折叠；reasoning part 自身不得再创建第二个披露，submitted 占位在 stream 开始后立即退出，禁止同时出现两个“思考中”。
- **AR-04E — Tool 展示身份必须精确。** Tool 卡继续使用 SDK 的一次调用/审批/结果协议；Task-producing Operation 只有在权威 Operation 返回 durable Task receipt 后才显示“已提交”，审批前不得伪造提交成功。`toolCallId` 是 opaque identity，不得从其文本猜测 operation。Tool adapter 在首次调用时登记当前 run 内精确的 `toolCallId → operationId` 关系，审批恢复时 runtime 从已持久化的 Approval member identity 重建同一关系；UI stream 只能用它补齐或校验 SDK 传输身份。关系缺失或冲突必须显式失败，通用 `call/tool` 不得降级成用户可见的“项目操作”。该关系不执行 Operation、不创建 Task、不参与审批，也不是第二份持久状态。
- **AR-04D — 媒体加载视觉单一。** Assistant 专用 presentation 仍由自己的最终 View 决定 loading、generating、completed 与 failed，不得读取 Canvas lifecycle 或建立状态适配层；图片区域的品牌 Logo、进度环、百分比和 neutral loading background 只能交给全局 `MediaGenerationLoadingView`，不得复制圆环、品牌动画或进度算法。已有输出遮罩、候选解释、Choice、失败原因和领域交互继续由专用 presentation 持有。
- **AR-04 — 工具契约在 registry。** operation 的输入、confirmation、agentFlow、plan/commit 与输出 schema 必须在 registry 统一声明；不得以 operation id 特判或从文案反推控制流。
- **AR-04F — 环境 scope 与 Tool 业务参数分离。** `projectId/userId/episodeId/runId/executionSegmentId` 等可信运行环境只通过 `ProjectAgentOperationContext` 进入 prerequisite 与 executor；送入 Operation input schema 的对象只能包含模型实际提交且 Tool schema 已声明的业务字段。runtime 不得把环境字段注入 strict payload，也不得要求模型重复传当前 scope。需要 episode 的 executor 从 context 读取；缺失时由 prerequisite typed-fail。
- **AR-04A — Operation 调用单入口。** API 与 Assistant Tool 只能把可信来源上下文交给 `invokeProjectAgentOperation`；该入口唯一负责 registry 查找、`channels.api/tool`、prerequisite、输入 schema、direct execute 或 billable Grant invoke、输出 schema 与资源变更提交。同步资源写 Operation 必须使用 invocation-owned transaction，把业务写、输出校验与 Resource Outbox 一次提交。带外部上传的同步写必须显式实现 `prepareTransaction → executeInTransaction → compensateTransactionFailure`：prepare 在事务外完成所有权预检、图片处理/上传与外部分析，只能产生本次唯一且尚未共享的临时 key；短事务必须以 target identity + prepare `updatedAt` 的单条 CAS 重新取得版本写权，再提交领域关系、输出与 Resource Outbox；任意事务、输出或 Outbox 失败都按 prepare identity 补偿，即使 executor 尚无 output。补偿遇到事务结果不明时，必须先按 owner、target identity 与本次 key 查询精确领域关系；关系已存在则不得删除，只有能证明该 key 尚未被本次目标采用时才可清理。任意已有 storageKey 不得由 Operation 充当媒体 GC。Task-producing Operation 的 registry 资源 impact 必须为 `none`；若它在 Task 提交事务内同时预留 pending CreativeResource，可以在该同一事务发布仅表示 pending 已持久化的 Resource Outbox，ready/failed/canceled 通知仍只由 Task Terminal Service 生成。adapter 只翻译 API error 或 ToolResult，不得各自重建执行分流。tool-only operation 经 API、api-only operation 经 Tool 必须在解析或执行前显式拒绝。
- **AR-04C — Operation outcome 穷尽。** `invokeProjectAgentOperation` 与其 Tool adapter 边界必须构造且只返回 `completed`、`noop`、`submitted_tasks`、`wait_choice`、`wait_approval` 或 `failed` 之一。`submitted_tasks` 携带已提交的 `batchId + backgroundRunId + waitId + taskIds` durable receipt，但不是 suspension outcome；`wait_choice` 携带 durable handoff。Tool adapter、stop controller 和 runtime 只能 switch 此 outcome。`effects.longRunning`、`agentFlow.suspendsFor`、Task binding 和 output 字段只能参与 outcome 的构造或契约验证，绝不可由调用方再次从输出形状猜测 lifecycle。旧 `runtime-signal` output parser 与前台 `awaiting_external_task` stop 不得恢复。
- **AR-04B — Tool 写入 authority 必须穷尽。** 每个 Tool-visible 写 Operation 必须恰好属于 `billable plan commit`、`executeInTransaction` 或 `transactional_task_submission` 三种 commit authority 之一；未能证明 Run fence 内原子提交的能力必须保留 API-only。Operation domain 禁止通过 HTTP 调用本应用 route，也不得用 fire-and-forget 或吞错把记录创建与 Task 提交拼成第二执行入口。`create_character` 只事务性创建记录；参考图描述提取是独立文本 Task，参考图生图是独立 `billable_media plan/commit` Operation，两者不得再由 `extractOnly` 在同一 Task type 内切换计费和授权语义。
- **AR-05 — 并发与心跳可证明。** 锁、心跳、超时取消和恢复必须由同一运行时状态协调；旧 run 不得覆盖新 run 的结果。
- **AR-05A — Operation 副作用服从 Run execution fence。** Assistant Tool 调用必须把同一个 abort signal 与 `runId + runVersion + eventSeq` 交给 `invokeProjectAgentOperation`；continuation 还必须携带 `waitId + commandId + claimOwner`。统一入口在执行前拒绝已失效 Run；普通 Task 创建事务、批准计划事务与同步领域写入事务必须在 commit 前锁定 Run 行，并在 continuation 中同时锁定 Wait claim 行后再次校验 fence。同一 execution segment 可以有多个 Tool 成员，但每次数据库提交必须在同一 segment identity 下串行锁定 Run、只接受水位单调前进并确认 Run 仍为 `running`；不能把许可扩展到其他 segment 或终态 Run。心跳、Redis lock 或 continuation claim 失效后，即使 Operation 已经开始，未提交的领域写入也必须整体回滚；只在 execute 返回后检查状态不构成防线。

- **AR-05C — 同一步骤收费调用聚合展示、逐成员冻结。** 一个模型 step 可包含多个收费 Tool call，包括同一个 Operation 的多个调用。runtime 必须把该步骤所有 approval item 作为一张聚合报价卡持久化并只请求用户批准一次，但每个成员仍以 `approvalId + toolCallId + operationId + planSnapshotId` 保存 exact input、不可变 plan 与 quote；operationId 不能充当成员 identity。批准事务为全部成员逐一签发精确 Grant，任一成员不匹配则整组失败；恢复时只允许相同 toolCallId 消费自己的 Grant。拒绝则任何成员都不创建 Task。不得引入 Run 预算、自动批准、跳过确认或由后续模型扩大已批准计划。
- **AR-05B — Execution eligibility 与等待 outcome 分离。** `effects.writes` 只描述领域数据写入，Run 的 `status` 只描述业务正在等待什么；二者都不得裁决一个 execution segment 是否仍能提交。Redis run lock 是当前 segment 的 lease，Run fence 只校验 `runId + runVersion + eventSeq`、abort 与可选 Wait claim，并且只在执行前或写入事务内使用；heartbeat 在持有该 lease 时不得因合法 `awaiting_*` status 撤销 ownership。暂停 settlement 在写自己的 Event 前必须通过 transaction barrier，在 Event 已推进本次 Run fence 后、提交前必须再次检查 abort signal；失锁时整笔交接回滚。`agentFlow.suspendsFor: choice` 只要求当前 invocation 登记完全匹配的不可见 `ChoiceHandoffReceipt`（run、execution segment、operation、toolCall）；最终可见 Interaction/Activity/card 必须由 execution-handoff 与 assistant message 一起提交。通用 invocation 绝不在提交后要求 Run 仍为 `running`、增加 awaiting 白名单或按 operation id 分支。Choice 是 Tool-only、非领域写、无媒体审批的 direct Operation；缺少 durable handoff 的调用必须失败。
- **AR-06 — Run 转换单调。** Run 只使用 `running`、`awaiting_approval`、`awaiting_choice`、`awaiting_task`、`completed`、`failed`、`cancelled` 七种状态。状态转换必须经事件 reducer 校验合法前驱并执行 CAS；三个终态不可重开。`run.failed` 只能从非终态写入 primary error；终态后到达的 `run.failed` 只作为已经持久化的 `ProjectAgentEvent` secondary diagnostic，绝不可覆盖 primary error 或重开 Activity/Wait。失去 Redis lease 所有权必须中止模型流并进入 `cancelled/run_lock_lost`，不得继续写入或伪装成业务失败。
- **AR-06A — Interaction 与 Activity 单调。** Approval 和 Choice 创建都必须通过同一个事务 authority，在持有目标 Run 行锁时一次性读取并 supersede 旧 pending interruption、结算其 Activity、完成前序 Activity 并 raise 新 interruption；任一 Event/reducer 写入失败必须整体回滚，禁止先 supersede 后 raise 的两阶段窗口。`activity.started` 只能 create，重复 identity 必须 conflict；`completed/failed/cancelled` 必须从 open 状态执行恰好一行的 CAS，零行或多行都原地失败，禁止终态重开或错误 activityId 静默前进。
- **AR-07 — Session/UI 只投影持久协议。** Panel 不得扫描历史 message、tool output 或 `task-submitted` part 推断 active Task、资源刷新、operation source 或当前决定；这些 identity 必须由 Session `currentActivity/activeTasks/pendingInteraction/subagents` 和正式 SSE Resource envelope 提供。Creative Subagent 只由同 scope 的 `creative_work` Task、Task.status/result 与有界 lifecycle projection 派生；通用 Choice 只由持久 Interruption Offer 投影，不存在风格、剧本、资产等专用 Choice renderer 或运行卡。Session projector 必须把当前前台 Run 与后台 Task Run 分开；后续水位、去重、刷新与断线规则继续由本模块的持久 Event/Outbox 契约裁决，timer、轮询、文案和 DOM 均无状态解释权。
- **AR-07A — Thread clear 是带水位的 scope 事实。** 清空 Thread 必须在持有 project scope lock 的同一事务删除消息、追加唯一 `thread.cleared` scope Event 并写 Session broadcast Outbox。Session/Thread GET 必须返回持久水位；客户端只接受不低于已见水位的响应。权威空 Thread 必须 replace；清空后重建的非空 Thread 若持久 `thread.id` 与客户端最近接受的 identity 不同也必须 replace，只有同一 Thread identity 的快照才可与未持久 optimistic message 合并。

- **AR-07B — Subagent reasoning 是 Task View 的瞬时输入，不是第二状态源。** 同一 Task attempt 的公开 reasoning delta 复用 Task stream `streamRunId + stepId + stepAttempt + lane + seq`，由一个 resolver 与 durable block snapshot 做前缀一致性合并；gap 时立即丢弃该瞬时段并重读 Session，分叉显式失败。Task lifecycle SSE 仍只触发最终 View 刷新，终态先读取 `Task.result.lifecycleProjection` 再清除 stream overlay。Task.status 是唯一终态，stream 不得完成、失败或重试 Subagent。

## 权威入口

- Project-agent runtime：`src/lib/project-agent/`。
- HTTP 用户/审批/选择命令唯一编排入口：`src/lib/project-agent/command-service.ts` 的 `executeProjectAgentCommand`。`/assistant/chat`、`/assistant/runs/:runId/approval`、`/assistant/runs/:runId/choice` 只做鉴权、输入适配与错误映射；`runtime.ts` 只允许由 Command Service 和 Task continuation owner 调用。
- Assistant 输入事实投影：`src/lib/project-projection/**` 与 `src/lib/project-context/**` 只构造项目事实；`src/app/api/assistant/text-attachments/**` 只解析受限附件。三者不得投影阶段、推荐动作或第二 Run/Workflow 状态机。
- Task 终态续跑唯一执行入口：`src/lib/workers/outbox.worker.ts` → `runProjectAgentWaitContinuationCommand`。
- Continuation 唯一交接：`beginProjectAgentWaitContinuationExecution` 建立 running fence；`execution-handoff` 原子结算 terminal 或 `awaiting_approval/awaiting_choice` outcome，并在重放时只调用其 finalize/recovery 入口。续跑中提交 Task 使用新的后台 OperationBatch，不悬挂当前 continuation Run。
- Choice Offer 契约、fingerprint 与严格解析：`src/lib/project-agent/choice-offer.ts`。
- 通用 Choice 的卡片、subject、fingerprint、commitment 与严格回答协议：`src/lib/project-agent/choice-offer.ts`、`choice-result.ts`；唯一发起 Operation：`src/lib/operations/domains/assistant/choice-ops.ts`。
- Interaction-backed waiting 唯一 settlement/消费入口：`prepare/settleProjectAgent*ExecutionHandoff` 与 `consumeProjectAgentChoiceInterruption` / `consumeProjectAgentApprovalInterruption`。
- 已消费 Decision 的恢复入口：`readRetryableConsumedProjectAgent*Interruption` 只重读同一持久决定；`createProjectAgentConsumedControlRetryRun` 是唯一新 attempt 创建者；`run.execution_started` 是禁止再次执行的持久水位。
- Approval/Choice 原子替换 authority：`appendProjectAgentInterruptionReplacementInTransaction`；Activity 单调终态 authority：`transitionProjectAgentActivity`。
- Operation registry 验证：`src/lib/operations/registry.ts`。
- Agent Plan 唯一事实与解析：`ProjectAssistantThread.planJson`、`src/lib/project-agent/plan.ts`；唯一写命令是 registry 中的 `update_plan`，Session projector 只读该快照，原始 Tool 卡不承担展示或状态解释。
- Creative Subagent 唯一委派与 Task 契约：`src/lib/operations/domains/assistant/creative-ops.ts`、`src/lib/creative-worker/task-contract.ts`；TaskDefinition 的 lifecycle/continuation reference projection 由 `src/lib/task/result-projection.ts` 统一执行。生产 UI 只消费 `session-state.ts` 从最近 `creative_work` Task 构造的运行中与终态 Subagent View，不读取 Activity 或历史响应增量。
- Operation API/Tool 唯一执行 authority：`src/lib/operations/invocation.ts` 的 `invokeProjectAgentOperation`；Choice commitment 只能使用该入口的 `atomic_choice_commit` 模式与 caller-owned transaction，并要求目标 Operation 显式声明 `choiceCommit.enabled=true`。
- Operation 资源影响唯一 resolver 与持久通知：`src/lib/workspace-resource/resource-impact.ts`、`src/lib/workspace-resource/resource-change-events.ts`；registry conformance 拒绝非事务资源写、Task-producing Operation 的重复 impact 与缺少补偿的外部上传。
- Operation Run fence 唯一裁判：`src/lib/project-agent/operation-execution-fence.ts`；Task 提交、批准计划与 transactional executor 只能复用该 commit barrier。
- Handoff/receipt authority：`src/lib/project-agent/execution-handoff.ts` 是 Choice、Approval、OperationBatch seal 与 terminal continuation 的唯一交接 owner；`recordProjectAgentSuspensionReceipt` 只登记最终提交的用户 Interaction，Task submission receipt 不属于 suspension。Choice invocation 只核验 `requireProjectAgentChoiceHandoffReceipt`；这些 receipt 都不是第二份持久 UI 状态。
- Tool 写 Operation 穷尽 authority：`src/lib/operations/write-authority.ts` 与实际 registry conformance；Thread clear 唯一入口：`src/lib/project-agent/thread-clear.ts`。
- Assistant Task batch 接线：`submitOperationTaskBatch` 只负责编排通用 Task persistence primitive；`ProjectAgentOperationTaskBatchBinding` 在同一 transaction 调用 `bindProjectAgentOperationBatchWaitMemberInTransaction`，`runtime.ts` 在同一模型步骤 Tool results 收齐后调用 `sealProjectAgentOperationBatchWait`。`operation-batch.ts` 是 `batch/backgroundRun/wait/member` identity 的唯一内存协调者；不得复制 Task/billing/Event/enqueue，也不得恢复前台 Task suspension。
- Operation 类型和 agentFlow：`src/lib/operations/types.ts`。
- Active Operation 运行外壳：`WorkspaceAssistantActiveRunCard.tsx` 统一消费 Session `activeTasks`；`WorkspaceAssistantRenderers.tsx` 只按持久 Choice Offer 的通用 `mode/replyMode/presentation` 渲染并组装一次回答。领域候选内容应作为 Resource/Task 的只读 View 单独展示，不得借专用卡片获得 Choice 写入或生命周期解释权。
- SDK Tool 展示身份入口：`createProjectAgentOperationTool` 登记首次调用的 exact identity；Approval interruption 持久化同一 `toolCallId + operationId`；`runtime.ts` 只为当前 response execution segment 构造一个临时 identity map；`agents-ui-stream.ts` 只校验或补齐 SDK chunk，不从 callId 文本、历史文案或 UI fallback 猜测身份。
- Assistant 设置 UI：`WorkspaceAssistantSettings.tsx` 只显示并更新现有用户偏好；Composer 不再拥有 Ask/Auto 状态。该设置不是 Session、Run、Plan 或 Tool eligibility 事实，后台 continuation 与前台 turn 都在各自 execution segment 开始时从同一服务端偏好读取。
- Assistant Session 变更 envelope、持久重放和唯一 publisher：`src/lib/project-agent/session-event.ts`；事件与 Outbox 原子创建：`src/lib/project-agent/event/append.ts`。

## 部署边界

本次把 `ProjectAgentExecutionHandoff(kind=task)` 与前台 `awaiting_external_task` 一次性切换为 `task_batch + collecting Wait + 独立后台 Run`，并把 Approval payload 切换为精确 member 列表；不提供双 parser 或兼容 writer。部署前必须排空旧版本仍处于 `running/awaiting_task/awaiting_approval/awaiting_choice` 的 Assistant Run、Wait 与 Interruption，再切换所有应用和 worker 实例。不得让旧 worker 消费新 `task.collection_*` Event，也不得让新 runtime 恢复旧单 Task handoff。

## 验证

- `tests/golden-journey/journeys/freeform-resources.spec.ts` 是自由组合跨浏览器、UI、Agent SDK、Operation、MySQL、Redis、worker、Outbox 与 SSE 的组合证据；空 Project 的媒体请求先由模型填写同一个通用 Choice，并以当前答案原子调用唯一 ratio writer，随后才独立规划原请求。Style Bible Choice 刷新后恢复同一持久 Offer；两个显式采用的 Chapter 由一次 `delegation.source=chapters` 编译为两个独立 Creative Task、一个 Wait 与一次续跑。并行 OperationBatch 场景从一个模型步骤发出三次同名 `create_image`，验证一张报价卡、三份精确 Grant、一个后台 Wait、三个 Resource/Canvas 节点与一次续跑。固定 mainline/stage oracle 必须删除或改成只观察真实事实。
- `tests/integration/task/project-agent-*.integration.test.ts` 中保留的场景使用真实 MySQL/Redis 验证 continuation settlement、dead delivery、execution segment、Interruption 原子性、Task batch Wait、并发 terminal、Thread clear race 与 session broadcast。
- `tests/unit/project-agent/{run-state-machine,event-reducer,event-reducer-transitions,execution-segment,suspension,waits,session-state-*}.test.ts` 只验证纯状态机、reducer、identity 和投影输入输出。
- `tests/contracts/assistant-choice-offer-conformance.test.ts` 从生产通用 Choice schema 与 Operation registry 验证 identity、subject fingerprint、Decision parser、commitment eligibility 与 suspension capability。
- `scripts/guards/{single-project-agent-continuation,no-plan-run-runtime,assistant-choice-offer-authority-guard,project-agent-run-state-machine-guard,single-operation-invocation-guard,sse-durable-watermark-guard}.mjs` 只提供结构旁路检查，不替代真实用户旅程。
## Session 通知状态所有权

| 事实 | 唯一所有者 / 写入者 | 消费者 |
|---|---|---|
| Assistant 状态发生变化 | `ProjectAgentEvent` / `appendProjectAgentEventsInTransaction` | reducer、Session snapshot、SSE bootstrap |
| Assistant 通知交付责任 | 同事务 `project_agent.session_broadcast` Outbox | Outbox worker |
| Assistant SSE 水位 | `ProjectAgentEvent.id` / SSE v3 `agentEventId` | bootstrap、每个浏览器标签页的 event sequence |
| Session 一致快照 | 前后 `ProjectAgentEvent.id` 水位一致；前台 active Run 唯一，后台 `awaiting_task` Runs/Waits 作为独立集合投影的 `getProjectAgentSessionSnapshot` | Session State route |
| SSE 事件事实身份 | `type + id → canonical fingerprint` / server session 与每个浏览器标签页的有界 event sequence | bootstrap/live 精确去重；identity conflict 只允许 snapshot resync |
| Session/Thread UI 收敛 | `assistant.session.changed` 触发的主动刷新 | Workspace Assistant runtime；不得轮询或从消息推断状态 |
| 当前 Agent Plan | `ProjectAssistantThread.planJson` / `update_plan` transactional Operation | 后续模型输入、Session View、Assistant 计划清单；其他运行或领域模块不得消费 |

写入者变化：新增的事件不是第二份 Session 状态，只是持久 ProjectAgentEvent 的 level-triggered 通知投影。后台 continuation、其他进程和其他标签页不再依赖当前请求结束或 timer 才看到 Session/Thread；旧 Session HTTP 响应也不能覆盖较新的事件水位。

## Choice 状态所有权

| 事实 | 唯一所有者 / 写入者 | 消费者 |
|---|---|---|
| 用户看到并回答的 Choice Offer | `ProjectAgentInterruption.payload` / prepared Choice handoff 的唯一 settlement | 首屏 stream、Session refresh、Choice control |
| 当前 execution 已准备的等待交接 | `ProjectAgentExecutionHandoff` / `execution-handoff` | recovery；不可直接投影到 UI |
| Offer 身份 | Offer 内必填的 `runId + interruptionId + cardId + toolCallId` | API control 与原子消费服务 |
| 当前 subject 代次 | Offer 的 `subject.kind + fingerprint` / `request_choice` | 原子消费服务在同事务内重读精确 Task result 或 Resource Revision 后比较 |
| 用户决定 | `interruption.resolved.response` 中的规范化 `confirm/select/text` / `consumeProjectAgentChoiceInterruption` | 可选当前 commitment 与下一回合 runtime |
| 已消费决定的执行资格 | `run.execution_started.executionSegmentId=decision:<interruptionId>`；只查询同一 Decision segment | control route、runtime；初始 user turn 或其他 continuation 的水位不参与该决定重试 |
| 可选当前 commitment | Offer 中冻结的 `when + operationId + input`，且目标 Operation 声明 `choiceCommit` | Choice 消费事务中的统一 Operation invocation；一次回答至多一个 |
| Choice 卡片交互/提交/布局策略 | 持久 Offer 中的 `mode + replyMode + group.presentation` | 唯一通用 renderer；不存在领域 dispatcher |
| 卡片临时选中项、输入框文本 | 浏览器组件本地状态 | 仅用于组装一次 control 请求，不解释业务生命周期 |

写入者变化：Offer/卡片解释者由固定 `choiceType` registry、专用 builder/renderer、Workflow 触发和客户端分支收敛为一个持久通用 Offer；ChoiceDecision 只由服务端 canonicalizer 写入 Event。Choice 本身没有领域写权，只有被 Offer 精确冻结且由 Operation registry 明示允许的单一当前 commitment 可复用原 writer。route 与 renderer 始终无领域写权。

## Task continuation 状态所有权

| 事实 | 唯一所有者 / 写入者 | 消费者 |
|---|---|---|
| Task 终态与 Wait 可唤醒事实 | `commitTaskTerminal` / `resolveProjectAgentWaitsForTaskTerminalInTransaction` | Outbox command 创建逻辑 |
| continuation 命令与重试责任 | `OutboxCommand` / Outbox worker | `runProjectAgentWaitContinuationCommand` |
| continuation claim 与 fence | `ProjectAgentWait` / Wait authority | server follow-up runtime |
| continuation 模型执行资格 | `ProjectAgentContinuationCheckpoint.status=running` / `beginProjectAgentWaitContinuationExecution` | 唯一 Outbox continuation runtime；存在该围栏的重放不得再调用模型 |
| continuation assistant message、checkpoint 与模型结算结果 | `ProjectAssistantThread + ProjectAgentContinuationCheckpoint.status=settled` / `settleProjectAgentContinuationTerminalHandoff` 或 waiting handoff 同一事务 | replay 与终态交接 |
| Activity/Wait/Run 终态 | Event reducer / `execution-handoff` | Session/UI 投影 |
| 模型步骤 Task members → 后台 Wait | Task transaction callback → `bindProjectAgentOperationBatchWaitMemberInTransaction`；runtime step boundary → `sealProjectAgentOperationBatchWait` | Operation adapter、runtime；成员事务原子绑定，runtime 只 seal 已提交精确集合 |
| Creative Subagent 身份、状态与完整结果 | `creative_work` Task 的 `id/status/result` / Task submitter、worker、Terminal Service | Session Subagent View、`get_task`；Activity/message/data part 无解释权 |
| Creative Subagent 批量恢复摘要 | TaskDefinition reference projection → OperationBatch collecting Wait | 唯一 Outbox continuation；不得把完整 Worker JSON 注入 Wait/模型上下文 |
| 前台/后台 Run 分离 | `createProjectAgentUserTurnRun` 只 supersede pending Decision Run；Session projector 排除后台 Run 作为 currentRun | 用户可继续对话；后台 Wait/Task 继续投影与终态续跑 |
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

- 自由视频生成上线后，Main Agent 同时拥有 `list_user_models`、项目/用户配置工具和 `create_video.modelKey`，系统 Prompt 又要求先查看并选择模型；真实模型因此读取配置并把另一个 provider 的 modelKey 复制到六个并行视频调用，服务端固定模型门禁逐项拒绝。OperationBatch 已把六个调用定义为同一模型 step，但 stop controller 仍按六条 Tool output 消耗六次错误预算，导致模型没有一次修正机会就 Run failed；同一 Creative Task 又同时投影成普通运行卡与 Subagent，Reasoning part 还直接显示内部英文思考。当前 Main Agent 的模型列表、用户偏好、Provider 和项目配置读取入口全部改为 API-only，`update_project_config` 仅投影画幅写入；所有 Agent 媒体 schema 删除 model 字段并只由服务端解析；同 step 并行失败只算一次纠错机会，fatal 仍立即停止；Session 把 `creative_work` 只投影到 `subagents`，产品 UI 隐藏 Reasoning。真实付费六段生成按用户要求留待手工复验。
- 上述模型职责收敛后，`create_project` 仍把用户偏好 9:16 复制到每个新 Project，config service 与 project policy 又各自用 9:16 fallback；首次纠正删除默认并允许 nullable，却新增 `videoRatioConfirmedAt/version`、用户文案 substring 匹配和专用 planning gate，形成通用 Choice 之外的第二确认协议。当前 `create_project` 保持 null，`Project.videoRatio` 是唯一事实，`update_project_config` 是唯一 writer 并可由通用 Choice 对当前选择原子调用；plan 只冻结 ratio 与内容 fingerprint，不再保存确认状态或猜测用户原文。migration 仍只由部署流程应用，不在运行时执行共享数据迁移。

- Creative Worker 初版在 `delegate_creative_work` 的同步 Tool Activity 内执行，并同时用 `ProjectAgentActivity.id`、`subagent.progressed` 事件和响应 data part 表示 Subagent；长推理无法后台存活，批量章节没有 Task/Wait 聚合，完整结构化结果还会直接占用主 Agent 上下文。当前一次性删除同步解释：每个逻辑 Subagent 是一个 `creative_work` Task，Task.id/status/result 分别独占身份、状态和完整结果；OperationBatch/collecting Wait 独占批量恢复，Session/continuation 只接收 reference projection。Activity 仍服务普通 Assistant Tool 展示，但不再解释 Subagent。

- Ask/Auto 最初由浏览器 localStorage 持有并随每次 chat/control 请求发送；两种模式对所有收费 Operation 行为完全相同，只对四个破坏性 Operation 有差异，因此它既不是 Agent loop，也不是可靠的服务端权限事实。继续在其上增加“跳过报价”会让前台与后台 continuation 得到不同决定，并诱导直接绕过现有 Grant。当前删除整条权限模式协议：破坏性确认固定保留，计费确认成为服务端 UserPreference；关闭后只省略 Approval Interruption，PlanSnapshot、Grant、重验证、余额、冻结、Task/Outbox 事务均保持同一入口。

- 2026-07-17 的 `get_resource/list_tasks/get_task` 等 strict Tool 读取操作明明只接受资源或任务 identity，统一 scope helper 却在校验前向每个 `episodeId=optional|required` 的业务 payload 注入当前 episodeId，导致模型参数完全正确仍被 Zod 以 unrecognized key 拒绝；连续诊断调用因此触发工具错误上限并结束 Run。旧实现先删除模型环境字段再重新注入，混淆了可信 context 与模型业务输入。当前 input schema 只接收模型声明字段，episode scope 由 Operation context/prerequisite 单独传递，相关 executor 显式读取 context；这不是放宽 schema。
- 主 Agent 曾把 `get_user_api_config/put_user_api_config` 与创作、项目和任务能力一并开放；Cloud 虽由 `platform-key` 拥有 Provider 配置，模型仍能看到并尝试调用这些部署管理工具。工具全开只适用于当前 deployment/channel 已授权的产品能力，不意味着把部署 owner 的设置交给创作 Agent。当前两项配置 Operation 保留为 Self-hosted 设置 API 的唯一执行入口，但 channel 改为 API-only，Agent 工具集不再包含它们。
- Tool 卡片曾只有部分 operationId 有本地化标题，`create_image/list_resources/get_resource` 等真实身份即使已正确登记仍回退成“项目操作”。当前全部 tool-visible Operation 均有 registry 对应的中英文标题；并行三次调用仍显示三张独立 Tool 回执，不合并调用身份。
- 2026-07-20 的 compact plan UI 重构把计划状态投影绑定到独立的蓝色/灰色边框，并在后续统一 UI 提交中移除了进行中图标的旋转；同时把 Step 胶囊放进 composer 前的普通布局流，长消息和可变面板宽度下会独占一行并截断内容。修正浮层布局后，`in_progress` 又被直接绑定为永久旋转，使 Run 已进入 Approval、Choice、Task wait 或终态时仍显示“正在运行”；根因是 Plan item 自行解释 Run 生命周期。当前 `WorkspaceAssistantPlanCard` 仍只读展示三种 plan status，但旋转必须同时满足 `item.status=in_progress` 与权威 `currentRun.status=running`，等待或停止时只显示静态环。Panel 只传最终 Run 投影，不从 pending、消息或 Task 推断。窄屏、超长步骤、屏幕阅读器焦点流与真实动画帧仍需 authenticated workspace 复验。
- Subagent 列表最初与 `ThreadPrimitive.Messages` 并列渲染在 viewport 末尾，因此所有 Subagent 无论何时结束都被追加到底部；旧实现只有 Session View 的全局列表，没有把它投影回对话时间线。当前防线删除该底部全局入口，消息 renderer 从持久 Assistant 消息的 `data-agent-run.runId` 与 Session Subagent 的 `runId` 建立显式锚定，把同一 run 的 Subagent 卡渲染在创建它的 Assistant 消息内部并持续更新；不使用 `finishedAt`、数组顺序或 scroll offset 猜测归属。旧线程/异常消息缺少该 run part 时不会静默伪造底部位置；真实多轮并行 Subagent、刷新后的视觉位置仍需 authenticated workspace 复验。

- 2026-07-17 的真实自由视频请求先让模型向 `create_video` 发明未注册的 `schemaId=short_film.video`，修正后又提交 Tool Schema 中实际不可表达的 `generationOptions.durationSeconds`；两次 Operation 都失败，Run 随后达到工具错误上限。根因不是模型缺少 loop，而是 Agent-facing schema 把 `schemaId` 暴露为任意字符串、把 `generationOptions` 转成空 object，并让产品参数、provider 参数和执行冻结参数并存。既有 17 条工具 schema 测试全部通过，因为只检查 strict/confirmation 表面，没有从生产 Resource registry 与 runtime parser 反证可调用性。当前通用媒体 schema 只暴露 registry 枚举、`request` 分支和模型无关产品字段，运行时按所选 model capability 映射并 typed-fail；生产 registry conformance 穷尽拒绝匿名 permissive schema、nullable enum 漂移和旧 provider-shaped 输入。真实外部模型能否在所有错误后继续规划仍属于 Run loop 的独立未验证盲区。

- 收费 BGM 与环境音曾在审批恢复后创建两个 Task，但 SDK Tool 卡名称被通用 `call` 覆盖，因而显示两条“已提交 · 项目操作”。名称 registry 并不缺失；真正丢失的是恢复流中的 Tool identity。`c47993138`/`aa23c77c9` 曾在缺少 input chunk 时从 callId 文本猜工具名，合成测试又使用包含 operationId 的 callId，因此没有覆盖真实 opaque identity；后续单独增加“已提交”View 则形成第二套 UI 消息协议。当前通用防线仍由 adapter 登记精确关系、审批恢复从持久化 identity 重建，stream 对 generic/missing input 只接受该关系且冲突原地失败；声音阶段只剩一个 BGM 审批成员，主 Golden 验证批准后恰好一个具体 BGM Tool 和一个进行中 Task。

- 同步 Operation 曾在执行后从 output/target 推断受影响资源并直接 publish Redis；异步 Task 又由客户端 terminal Effect 按 TaskType 重做一遍解释。业务事务成功但通知丢失、输出 schema 失败但写入已提交、或断线期间事件不可 replay 时，Assistant/Canvas 会看到不同事实。当前所有写 Operation 在 registry 显式声明 impact：同步写由 invocation 把业务写、输出校验和 Resource Outbox 同事务提交，Task-producing Operation 只由 Terminal Service 通知；v3 SSE 从持久 Outbox replay，旧 output interpreter 与客户端 terminal Effect 已删除。

- 付费 Operation Group 曾把多个 approval item 与同一 RunState 持久化，却只保存首成员 plan 并签发一个 Grant；旧 collecting Wait 又按 operationId 声明成员，因此无法表达同一 Operation 的三个独立调用。`680c406db` 选择删除 group 并硬性规定每个模型 step 只能有一个 Operation，但 `@openai/agents-extensions` 的 AI SDK adapter 没有把 `parallelToolCalls=false` 传给真实模型。2026-07-17 的真实请求让模型在同一步发出三次 `create_image`，三个 schema 与报价都有效，却在 `beforeFinish` 被 `PROJECT_AGENT_PARALLEL_APPROVAL_STEP_FORBIDDEN:3` 直接打成 Run 失败；该异常发生在 Tool outcome 之外，所以模型也没有机会修正。当前防线把模型步骤正式定义为 OperationBatch：报价只聚合 UI/用户决定，每个 `toolCallId` 保留自己的 plan/Grant；Task 成员在各自事务中原子加入同一个后台 collecting Wait，step boundary seal 精确 Task 集，前台 AI 不等待 Task。数据库 Tool commit 仍串行围栏，但外部 Tasks 并行运行。Critical 场景混合重复图片、音频和视频成员并覆盖终态早于 seal、新用户 turn 与并发 terminal；Golden 以三次同名 `create_image` 反证一张报价、三份 Grant/Task/Resource、一个 Wait 和一次续跑。
- OperationBatch 首次接入后，后台 Task 极快终态而前台模型流仍在运行时，continuation 只检查待 Approval/Choice 和 Redis lock；前台传输断开释放 lease 后，数据库里的 fresh `running` Run 仍未结算，continuation 却建立了第二个 `awaiting_choice` Run，Session 因两个前台 Run fail closed。首次补 Run-slot 后，浏览器刷新仍未把 HTTP request abort 传给 Agent signal，遗留 Run 又让 continuation 在有限 Outbox attempts 内反复失败并 dead-letter。当前前台 Request 断线显式把该 Run 结算为 `cancelled/stream_cancelled`，不取消已经提交的后台 Task/Wait；continuation 在 claim 后、取得 Redis lock 前复用数据库 Run-slot authority，排除且只排除自己的后台 Run，前台/Decision 占用转成不消耗失败额度的 typed defer。第二次真实主链 Golden 已运行至最终 durable render，但暴露并行镜头流被错误合并到单一节点的问题；修正后第三次复验按用户要求中止，因此最终全链仍需用户复验。Critical 场景已覆盖新前台 Run 存在时 continuation 释放 claim，Outbox typed defer 的真实 dispatcher 重投仍是未验证盲区。
- `33d0f9c62` 为流断开增加 `onCancel`，但旧模拟测试只断言 `onCancel/onSettled` 各调用一次，没有断言顺序或数据库终态。Web Streams 在 `reader.cancel()` 解除待定 read 时，`start.finally` 可先恢复并调用通用 `onSettled`，从而在 `onCancel` 设置 cancelled settlement 之前写入部分消息并释放锁，随后触发 `PROJECT_AGENT_RUN_MESSAGE_SETTLEMENT_ORDER_INVALID`。当前浏览器按钮还会同步 abort HTTP request，所以修改前的真实 Golden 主路已能通过；风险位于消费者取消先到的合法时序。当前 stream bridge 由 cancel 分支独占顺序：先执行 `onCancel` 原子结算，再执行唯一 `onSettled` cleanup。`GJ-ASSISTANT-STOP-REPLY` 点击真实方块按钮，以只读数据库 Oracle 断言首个 Run 为 `cancelled/stream_cancelled`、立即新回合完成且无 Task/Wait/Handoff。已提交 OperationBatch 后再点击停止的精确 UI 窗口仍未单独浏览器注入；其 Task/Wait 不取消语义继续由 OperationBatch Critical 场景承担。

- 收费 approval interruption 曾可长期显示，但其绑定的 Operation plan 仅有 15 分钟 TTL。用户点击旧卡片时，control transaction 已把 interruption 消费并开始 response execution segment，随后 Grant issuer 才抛 `OPERATION_PLAN_EXPIRED`，客户端最终只显示原始 Runtime Error。时间有效性现已从审批协议删除：卡片批准后仍恢复同一 frozen RunState，收费 Operation 的唯一 invoke 重新运行 registry planner；内容未变则执行，内容变化则撤销旧 Grant，并以 typed fatal Tool outcome 零副作用结束本次尝试，禁止同一 run 复用 stale Grant，用户可重新生成报价。

- `227b2d288` 收敛 server-owned append、heartbeat 与 Redis lock；`41c5a13a` 随后仍修复 run settlement race，说明局部加锁不能替代完整 run 语义。
- `7f8e161be` 修复 stale bootstrap、heartbeat、tool leak、noop/stall 等多个症状，表明需要把这些症状收敛为同一生命周期契约。
- 制作规划 choice 曾通过局部副作用提交视觉风格 Task，导致模型文案、候选记录、run/Wait 三套状态分离；Choice 只负责落用户决定，异步执行必须回到 registry 与 runtime。
- `PROJECT_AGENT_AI_TURN_PROTOCOL_REQUIRED` 曾把“Workflow 仍有可用 `nextAction`”解释为 Run 失败。真实复发证明 capability 不是 obligation；该 writer 已删除，Run 可以在仍有后续能力时合法 completed。
- 分镜图片批量生成曾在部分 Task 因 provider 提交结果未知而失败后，由 Assistant 正常解释并等待用户决定，但失败 follow-up policy 同时承担“禁止自动恢复”和“决定 Run 终态”两项职责，把已完成的解释回合结算成 `run.failed/PROJECT_AGENT_TOOL_ERROR`，UI 因而误报 AI 运行失败。旧单元断言只固化了 policy 映射，没有覆盖 Task/Wait、continuation、Run 与 UI 的真实组合。当前防线彻底删除该固定 follow-up policy：Task terminal 只报告真实成功、失败及 Resource refs，Agent 可重新规划且任何新收费调用仍重新进入报价 Approval；Run 只按本回合真实 runtime/tool outcome 结算。自由创作 Golden 让三个候选中两个永久失败，并证明 continuation 只重试失败项、成功项不重复生成。
- 删除硬失败后，真实制作规划确认与视觉风格确认仍分别停在新 `nextAction` 之前，证明结构化确认不是 AI 应再次决定的意图。确认命令现与 Choice 消费原子提交，AI 只从正式新状态继续。
- 视觉风格生成卡曾在删除客户端第二 writer 时被连同只读 presentation 一起删除，而 Golden 只观察 Task 终态与 Choice，未观察 processing UI；恢复只读 View 后仍由 Choice/Operation 独占写入。
- 恢复后的视觉风格生成卡虽然复用了 `useEstimatedTaskProgress`，仍复制了圆环、无进度动画、大图/缩略图 overlay 和深色背景；此前“全站唯一媒体加载入口”只存在于组件注释且该共享路径未映射到 architecture，因此 Canvas 收敛后 Assistant 仍保持第二套视觉。当前防线删除这些本地 helper 与专用 CSS，由最终候选 View 继续裁决可见性、全局 `MediaGenerationLoadingView` 独占品牌加载展示；按本次明确范围未新增专门浏览器断言，真实三候选 processing 组合仍作为验证盲区记录。
- 视觉风格方案 LLM 曾在媒体 approval preflight 中同步执行并写入 pending 候选，导致同类长文本生成只有它没有 Task/Wait，专用 presentation 又隐藏通用运行卡；图片 processing Golden 仍能通过，因此未覆盖审批前空窗。当前防线把方案生成迁入文本 Task，图片 plan 只读已完成候选，并要求真实 Journey 在批准前观察通用运行卡与持久文本 Task。
- 资产审核卡曾把每章重复 requirement 渲染为可选 option，但 Decision parser 从不消费该选择，且真实资产是本集共享的一组 canonical 角色/场景；这制造了没有业务语义的临时选中态。现 `asset_review` Offer 只有“资产满意，继续”与整组修改意见，章节 requirement 仅用于 ready 校验和 fingerprint。
- `BUG-AR-003` 证明“非领域写”等于“Run 保持 running”是错误推导；更深层地，fence 不得把业务 outcome 当作执行资格。Choice 成功提交其 suspension receipt 后合法进入 `awaiting_choice`；receipt 在 invocation 内被通用验证，Run status 不再参与提交后的重新裁决。
- 镜头执行计划完成后曾把确定性 Storyboard/Panel 投影暴露成 `nextAction`，迫使 continuation 调用第二 Task。删除媒体阶段后仍保留 recommendation，解释权没有真正消失。当前没有 `nextAction`；Primary 只依据真实 Resource 与目标显式调用任一视频 Operation。
- 最终渲染失败分支曾按最早缺失阶段推荐动作；新增前置能力必须不断改线性表。当前渲染是可独立调用的 Operation，由自身 planner 对本次显式输入 fail closed，项目快照不推荐它。
- Workflow 曾编码约 30 个位置/状态组合；首次修正只删除 allowlist 并保留只读 recommendation，固定 Choice、Prompt 配方和 Golden stage 仍继续消费它。当前 WorkflowView 与所有投影字段整体删除，toolset conformance 只从生产 Operation registry 穷尽能力。
- 规范化 WorkflowView 曾因机器状态与 reason 拼接导致视觉风格 Choice 重复生成。当前不再存在 workflow status；通用 Choice 由持久 Offer identity/fingerprint 防重复，Task/Resource 重放由各自 owner 裁决。
- 2026-07-14 的 Prompt 缩短曾遗漏 Choice/Task 规则；后续恢复时又写入 mainline、固定视觉风格卡和视频/BGM 配方。当前双语 Prompt 保留通用运行协议并明确无主链、单一通用 Choice、Style Bible 默认文字、`>180s` 仅为规划信号；semantic guard 拒绝旧 token 回流。
- Run-scoped Approval/Choice endpoint 最初为了把控制面移出消息 metadata，使用私有 `x-project-agent-run-control` header 和 `control` body 构造第二个 `NextRequest`，再把 chat route 当 service 调用；因此同一命令重复鉴权/解析，聊天 route 同时拥有 HTTP 与生命周期编排职责。后续锁、原子 Choice、retry 与 failure settlement 修正持续扩大该 route，却没有删除 route-to-route 入口。当前防线以穷尽 `ProjectAgentCommand` 和唯一 `executeProjectAgentCommand` 收敛三个 HTTP 命令；删除私有 header/body、route 回调与 runtime 公共 re-export，Task continuation 仍保持 Outbox-only。

- 2026-07 的自由 Operation registry 上线后，旧 Edit-first WorkflowView、固定 Choice 类型、确认剧本 Binding、视觉风格预览选择和 BGM 固定计划仍被保留为“专业主链”。同一创作目标因此同时由 Primary Agent 自主组合与代码阶段表解释，新增能力需要接两条入口，并在真实剧本完成后重新弹出“确认剧本，进入制作规划”。根因是上次只解除工具 allowlist，没有删除 recommendation 投影、专用卡片、旧 writer 与 Golden stage oracle。当前防线一次性删除 WorkflowView/mainline/choiceType/confirmed-screenplay/专用预览选择及固定声音规划入口；唯一能力来源是 Operation registry，唯一专业判断来源是 Skill + `creative_work` Task，唯一选择协议是模型填写的通用 Choice。`no-assistant-fixed-workflow-surface`、Choice authority guard 和 Prompt semantic guard 分别拒绝旧身份、固定 dispatcher 与时长配方回流；真实自由组合 Golden 已覆盖 ratio 与 Style Bible 两类 Choice 的当前提交、Choice 刷新恢复，以及采用多个 Chapter 后的一次并行 Creative Task batch。

- Primary reasoning 的第一次 UI 改动在运行卡和 pending placeholder 各写一个“思考中”，并只在 SDK 聚合结束后收到 reasoning part；第二次用 Run data part 补占位仍无法唤醒被 converter 阻塞的读取。当前 stream `start` 后只保留消息内单一 Disclosure，可唤醒 side channel 与 converter 共用一个输出裁判，终态聚合只校验不重复写；单元场景明确在正文 gate 未释放时要求 reasoning 已到达。

## 修改检查表

1. 此改动触及哪一种 run 结算结果？
2. 谁写入权威状态，谁只能读取或投影？
3. Task 终态如何幂等地唤醒正确 run？
4. 并发、重放、心跳超时和取消是否有测试？
5. 是否新增了按 operation id、领域类型、时长或消息文本的流程特判？若是，必须回到 Operation registry 的显式能力与 Primary Agent 判断。
6. Choice 是否只解决当前一个决定；可选 commitment 是否由模型完整冻结、目标 Operation 显式声明 eligibility，且自由文本不会执行命令？
7. 此转换是否带有可区分同状态代次的持久 `runVersion/eventSeq`？仅比较 status 不能阻止 ABA，未具备版本围栏时必须明确记录为未完成风险。
8. Choice 卡片是否来自持久 Offer，提交是否验证 card/tool/subject fingerprint，Event 是否只保存规范化 Decision？
9. 若 Operation 声明了 Choice suspension，是否只验证本次已提交的通用 receipt，而没有在提交后读取 Run status、按 operation id 分支或要求继续 `running`？
