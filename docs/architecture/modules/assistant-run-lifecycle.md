<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Thread、Turn 与交互生命周期

## 设计理念

Assistant 使用 `Thread → Turn → Item` 产品契约。Thread 保存持久对话与完整 Agents SDK
模型历史；Turn 表示一次用户或系统发起的模型运行；消息、reasoning、Tool call、审批、
Choice、Task receipt 与 Resource link 是 Turn 中的 Item/View。

运行中的模型 stream 是临时过程，不是必须透明恢复的业务事实。Worker 中断时，当前 Turn
明确进入 `interrupted`，已经提交的 Tool、Task、Provider、Billing 与 Resource 事实继续
有效；后续用新 Turn 继续。Thread 的执行许可只由
`AgentThreadCoordinatorWorkflow(threadId)` 拥有，详细持久执行规则见
[Temporal 持久执行边界](durable-execution.md)。

Assistant 不拥有固定导演流程。完整 Operation registry 是唯一能力表，Primary 依据用户
目标、正式 Resource/Task/Project 事实、Provider capability 与 Approval/Choice 自主组合
Operation。

## 不变量

- **AR-01 — Thread 是持久会话权威。** `ProjectAssistantThread.id` 是 canonical
  `threadId`；完整 Agents SDK `AgentInputItem[]` 只保存在 Thread 的
  `modelHistoryJson`。UI `messagesJson` 是独立展示投影，绝不能反向重建模型历史。
- **AR-02 — Turn 是最小运行单元。** 一个 Turn 只允许
  `queued → running → waiting_approval|completed|failed|interrupted|cancelled`
  的单调转换；waiting_approval只可恢复到running或cancelled；终态不可重开。一个Thread
  同时最多一个 active Turn。
- **AR-03 — Turn source 唯一。** `threadId + sourceKind + sourceId` 唯一，其中
  sourceKind 至少包含 `user` 与 `task_follow_up`。同 identity 同 payload 返回原 Turn；
  不同 payload fail closed。模型或 UI 不能创建 fallback identity。
- **AR-04 — HTTP 只提交可重放命令。** 用户消息、Approval、Choice、cancel 与 clear 的
  route只负责鉴权、参数解析、取得canonical threadId并调用typed Temporal client；全部命令
  使用包含完整payload的stable identity经Update-With-Start进入。HTTP/Workflow ACK丢失或
  旧Coordinator已完成时，仍须由MySQL业务owner exact replay同一receipt；确定性无效、scope
  分歧与payload冲突是non-retryable业务失败，client不得当作transport错误改写。route不运行
  模型、不写Turn、不抢锁、不续heartbeat、不读取UI Thread猜恢复输入。
- **AR-05 — 模型 Activity 是一次性执行。** `maximumAttempts=1`，heartbeat 10 秒，
  timeout 45 秒。刷新、SSE 断线或 HTTP 断开不取消 Turn；Worker/Activity 丢失把 Turn
  结算为 interrupted，不自动重放原模型调用。
- **AR-06 — 完整 snapshot 才能进入模型历史。** token、reasoning delta 与未完成文本
  只进入 SSE overlay。只有 Agents SDK Session owner 产生的完整 snapshot 可在 settlement
  事务中晋升；interrupted Turn 的未完成模型输出不进入后续历史。
- **AR-07 — 已发生 effect 不因 Turn 中断回滚。** 下一个 Turn 的模型输入必须包含从正式
  ToolEffect、Task、Provider 与 Resource 事实构造的 `InterruptedTurnEffectDigest`：
  `priorTurnId`、`completedEffects`、`createdTaskIds`、`createdResourceIds`、
  `outcomeUnknownEffects`。该 digest 是输入投影，不是第二状态机。
- **AR-08 — Agent Plan 只是 Thread 便签。** `update_plan` 完整替换 `planJson`；
  空列表或全部 completed 清空便签。它不驱动 Operation、Task、Approval、Choice、
  Resource、Canvas 或 Turn 生命周期。
- **AR-09 — 不存在执行模式或业务主链。** Assistant 没有 Ask/Auto 模式、WorkflowView、
  stage、fixed next step、operation group 或 UI gating。破坏性 Operation 仍要求 Approval；
  收费确认设置只决定当前精确 plan 是否要求人工批准，不扩展授权。
- **AR-10 — Operation Schema 是唯一 Tool 参数契约。** Tool-visible Operation 必须从
  canonical strict runtime schema 生成模型 schema。`execute_operation` 只接收
  `operationId + argumentsJson`；scope、user、project、episode、turnId 与 callId 由可信
  runtime context 传入，模型不得重复声明。配置与 Provider capability 由 planner 解析并
  冻结，不形成第二 schema。
- **AR-11 — Tool 暴露来自 registry。** `toolExposure=direct|on_demand` 只改变传输；
  `load_tools` 不创建资格、ticket 或持久状态。未加载不能变成执行权限，调用仍由同一个
  Operation owner按registry校验。
- **AR-12 — Tool call identity 只使用 SDK callId。** effectful、billable 与 external
  Tool 经 `turnId + callId` 的 ToolEffect owner exact replay；并行顺序、tool数组位置、
  operationId 或输出 offset 都没有 identity 权力。同 identity 不同 normalized input、
  operation contract revision 或结果必须失败关闭。
- **AR-13 — Approval 只恢复冻结的真实调用。** Agents SDK返回`approval_required`时，
  Turn interaction owner外置完整序列化RunState，并冻结精确Agents SDK包版本、RunState
  schema、agent graph revision，以及每个member的`approvalId + callId + operationId +
  normalized input hash + tool contract revision`。approve/reject只恢复同一Turn的同一真实
  调用；恢复前同时校验RunState内schema、当前registry contract、两个SDK identity和原输入，
  任一不兼容即失败关闭并要求排空，禁止猜旧格式或只靠callId续跑。普通effectful Tool不为
  “保险”制造RunState checkpoint。
- **AR-14 — Choice 只有一个通用协议，且回答是新Turn。** `request_choice` 创建immutable
  Offer，完整保存
  本地化 card、mode、stable option value、subject fingerprint 与可选 commitment。
  Decision write-once，规范化为 `confirm|select|text|cancelled`。Renderer 只消费 Offer，
  不按领域名字或历史消息重建卡片。Offer与当前Tool result提交后原Turn正常完成；用户回答
  以`sourceKind=choice_response + sourceId=offerId`创建新Turn，不恢复原模型Activity、
  不保存RunState。新的普通user Turn会原子supersede旧pending Offer。
- **AR-15 — Choice commitment 只提交当前决定。** 只有 registry 声明
  `choiceCommit.enabled=true` 的确定性、非收费、事务型 Operation 可被一个匹配回答原子
  执行；自由文本与 cancelled 不执行 commitment。Choice 不能授权媒体生成、未来链路或
  第二 writer。
- **AR-16 — Interaction 与 Turn 同生共死。** cancel、supersede 或 clear 在同一事务
  失效 pending Approval、Choice 与 RunState；resume 前再次校验 Turn 仍可运行。旧卡片
  点击不能复活 dead Turn。
- **AR-17 — clear 以 Thread identity 关闭全部旧恢复。** clear 经 Coordinator 串行，
  同一事务归档 Thread、取消其 pending FollowUpBatch、失效 interaction 与 RunState。
  新会话创建新 threadId；旧 Task 晚到不能在新 Thread 创建 ghost follow-up。
- **AR-18 — Creative Subagent 仍是普通长期 Task。** `delegate_creative_work` 从生产
  output registry 创建一个或多个 `creative_work` Task；`Task.id/status/result` 是唯一
  Subagent identity/lifecycle/result。Worker 是一次 attempt 内的无状态专业模型循环，
  不拥有 Thread、Turn、Operation、Approval、Choice、Resource writer 或第二恢复协议。
- **AR-19 — Task 只返回 durable receipt。** Agent Tool 提交 Task 后，当前 Turn可继续
  或正常结束；Task terminal 由 FollowUpBatch 最多创建一个新的 system Turn。后台 Task
  失败不自动授权重试、改写或扣费；Primary 只有在用户明确要求且新 Operation 产生新报价/
  Grant/Task receipt 后才能声称重试。
- **AR-20 — 项目画幅是普通可空事实。** `Project.videoRatio` 只由
  `update_project_config` 写入。需要媒体且缺失时，Primary 可使用通用 Choice 提交当前
  决定；Choice 不启动媒体。Planner 冻结当前 ratio/fingerprint，模型或调用方不能局部
  覆盖。
- **AR-21 — Operation 调用与写入 authority 穷尽。** API/Tool 共享一个 invocation
  service；同步写只走业务 transaction；所有 task-producing Operation无论收费/免费都先
  进入OperationExecutionWorkflow，再由其persistence Activity执行唯一transactional Task
  submitter。Operation domain不得HTTP回调本应用route，也不得由model/HTTP Activity
  fire-and-forget拼接记录与Task。
- **AR-22 — Operation outcome 穷尽。** 只允许
  `completed|noop|submitted_tasks|wait_choice|wait_approval|failed`；调用方必须穷尽
  switch，不得从 output shape、文案或 TaskType 猜生命周期。
- **AR-23 — changed refs 是正式结果契约。** 同步 mutation 返回统一
  `OperationMutationReceipt.changedRefs`；异步结果由 Task terminal 返回正式 Resource
  impact。SSE 只广播这些已提交事实，广播失败不改变 mutation 成功或下一步执行。
- **AR-24 — 用户界面只消费最终 View。** Session View直接投影Thread、Turn、
  pendingInteraction、Task batches、Subagents与Resource links。命令admission前合法
  materialize的空Thread，以及新建pending interaction的`version=0`，都是正式初始事实，
  parser不得把“空”或零版本误判为缺失。UI不扫描历史消息、Tool output、DOM、timer或局部
  SSE part猜当前状态。
- **AR-25 — reasoning 与 Tool 展示保持原始身份。** Agents SDK UI converter 是
  message/step/text/tool/approval 的唯一基础投影；只展示 Provider 公开 reasoning。
  原始 CoT、signature、Skill正文、系统 Prompt和内部 metadata不得进入UI。同一step、
  同toolName可仅做展示聚合，但每个opaque callId、审批、结果与执行身份保持独立。
- **AR-26 — Resource 链接是结构化交付。** registry 声明的 Resource result 经唯一
  Link View projector 生成 `data-assistant-resource-links`；模型文案不拥有标题、文件名、
  href 或完成状态，Markdown 不扫描补链。
- **AR-27 — Project scope 与 Tool业务参数分离。** `projectId/userId/episodeId/threadId/
  turnId` 只在可信 context 中传递；需要 episode 的 Operation 从 context读取，缺失时
  typed failure。episode-scoped Thread首次materialize前必须在锁定的父Project下验证
  Episode真实存在且属于该Project，再构造scopeRef/写Thread；跨Project或已删除Episode
  原地失败，不能留下幽灵Thread。不得把环境字段注入strict model payload。

## 状态与写入者

| 事实 | 唯一 writer | 消费者 |
| --- | --- | --- |
| Thread/messages/model history | Thread persistence + SDK Session owner | model input、UI |
| Turn/source/status | AgentTurn service | Coordinator、View |
| pending Approval/RunState | Turn interaction service | Coordinator、UI |
| Choice Offer/decision | Choice service | UI、新Turn输入 |
| ToolEffect | Operation/ToolEffect owner | model continuation、digest |
| active execution permission | Thread Coordinator | command client |
| plan note | `update_plan` | model input、UI |
| Task follow-up source | FollowUpBatch service | Coordinator |
| stream delta | stream publisher | UI overlay |

## 权威入口

- Thread/Turn/interaction/View：`src/lib/agent-turn/**`。
- Coordinator client/workflow/activities：`src/lib/temporal/**`。
- Agent model、Session、Tool adapter：保留在 `src/lib/project-agent/**` 中的纯业务/
  SDK部分；锁、Run、Wait、handoff、recovery部分必须删除。
- Operation registry/invocation：`src/lib/operations/**`。
- ToolEffect：`src/lib/agent-turn/tool-effect.ts`。
- HTTP：`src/app/api/projects/[projectId]/assistant/**`。
- UI：`WorkspaceAssistantPanel` 与 `workspace-assistant/**`，只消费 canonical View。

## 正常与恢复时序

### 用户消息

```text
route鉴权 → get/create Thread → Coordinator UWS
→ command Activity写user message+Turn
→ model Activity运行
→ 完整snapshot+Turn terminal事务
→ View/SSE
```

### Approval

```text
model Activity返回approval_required + RunState reference
→ interaction事务写pending并把Turn设waiting_approval
→ 用户response update
→ 同事务write-once决定并校验Turn
→ 新model Activity使用同一RunState/call恢复
```

### interrupted

```text
Activity heartbeat timeout
→ settlement exact-once写Turn.interrupted
→ View显示明确中断与已发生effects
→ 用户/系统另建新Turn继续
```

## 被替代并必须删除

- ProjectAgentRun、Activity、Event reducer、Wait、ContinuationCheckpoint、
  ExecutionHandoff、旧Interruption
- Redis run lock/heartbeat/fence、server-follow-up、Run recovery
- UI `currentRunStatus`、Wait/Event/message混合推断
- 任意模型step透明恢复、successor checkpoint、AgentSession CAN

## 验证

- 真实 Temporal + MySQL：并发 user turn、UWS complete race、command commit/ACK loss、
  已完成Coordinator后的Approval/cancel replay、deterministic update failure、Worker kill、
  heartbeat timeout、cancel/clear、合法空Thread/version 0 interaction与跨Project Episode
  拒绝。
- 真实 Agents SDK：callId、Approval RunState跨Worker恢复、schema/graph版本拒绝。
- 生产 registry conformance：Tool exposure/effect owner/outcome/choice commit/changed refs。
- 人工产品复验：刷新、SSE断线、多标签页、interrupted、Approval/Choice、Subagent、
  Resource links、i18n与Canvas同步。

模型自由规划质量、真实 Provider reasoning stream、长会话 RunState 大小和发布时旧
RunState 排空是环境盲区；未验证不得宣称架构完成。

## 历史回归

- 旧架构用 DB Run、Redis lock/heartbeat、Event reducer、Interruption、Wait、
  ExecutionHandoff 与 Outbox共同解释一次 Agent 执行。修复任何窗口都会改变另一层水位，
  导致重复继续、永远等待、旧Run覆盖新Run或UI与服务端不一致。当前以
  Coordinator执行许可 + AgentTurn业务事实替代全部竞争解释。
- Task continuation 曾经历按单Task唤醒、collecting Wait、claim lease、Outbox命令、
  continuation checkpoint与模型执行fence的连续加层。当前成员在创建事务中冻结，
  FollowUpBatch只产生一个新Turn，不尝试恢复旧Run。
- 完整 Temporal Agent Kernel 原型试图透明恢复模型每个step，必须保存完整RunState、
  successor、execution chain、CAN与tool replay协议。产品接受Turn中断后，这些保证没有
  业务目标，继续保留只会重新自研Agent runtime，因此明确删除。
- UI曾从消息part、Run、Wait、Task和SSE分别判断“还在运行吗”，断线/乱序时出现spinner
  消失、卡片未更新或刷新才可见。当前生命周期只来自canonical View，SSE为临时overlay。
- 旧Approval控制曾因先抢Run slot/Redis lock再读取持久target而让重复点击与新Run冲突，
  后续又为Plan补了execution contract revision、为SDK Session补了完整历史；这些防线都
  绑定在已删除的Run/Plan/Session owner上。AgentTurn版初始interaction只保存RunState，
  没有冻结SDK/RunState schema/agent graph、双SDK identity、原输入和每个Tool contract，
  是同一“恢复必须绑定原执行契约”不变量换transport后的复发。当前由interaction payload
  一次冻结并在decision、claim和SDK resume三处共同校验，禁止局部版本判断。
- Approval/cancel初版只向仍存活的Coordinator执行Update；MySQL决定已提交但ACK丢失后，
  重试可能撞上已完成Workflow，旧内存又无法重建等待态。这是旧Approval幂等问题在Workflow
  execution边界的新形式。当前所有生命周期命令使用完整payload hash的UWS，业务owner返回
  可跨execution replay的receipt；确定性冲突以non-retryable failure结束，不进入client
  transport retry。
- B+初版producer合法创建空Thread和`version=0` interaction，View parser却只接受非空/
  正版本；Thread scopeRef也曾在校验Episode与Project关系前materialize。前者是同一契约
  producer/consumer漏接新初始实例，后者是scope ownership在新writer上的漏接。当前View
  显式接受两个初始事实，Thread writer在upsert前锁父Project并验证Episode归属。

## 修改检查表

1. 是否以threadId/turnId/callId作为canonical identity？
2. 是否让route、UI、SSE或消息文案重新拥有生命周期解释权？
3. 是否新增Agent retry/checkpoint/lease/reconciler而不是明确interrupted？
4. Tool、Approval、Choice、Task follow-up是否各走唯一owner？
5. clear/cancel/supersede是否同步失效所有旧恢复入口？
6. Operation schema、authority、outcome和changed refs是否仍由registry穷尽？
7. 是否实际删除被替代的Run/Wait/Handoff/Outbox入口？
