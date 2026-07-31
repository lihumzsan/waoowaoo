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
  sourceKind 穷尽为 `user|choice_response|task_follow_up`。同 identity 同 payload 返回原 Turn；
  不同 payload fail closed。模型或 UI 不能创建 fallback identity。
- **AR-04 — HTTP 只提交可重放命令。** 用户消息、Approval、Choice、cancel 与 clear 的
  route只负责鉴权、参数解析、取得canonical threadId并调用typed Temporal client；全部命令
  使用包含完整payload的stable identity经Update-With-Start进入。HTTP/Workflow ACK丢失或
  旧Coordinator已完成时，仍须由MySQL业务owner exact replay同一receipt；确定性无效、scope
  分歧与payload冲突是non-retryable业务失败，client不得当作transport错误改写。route不运行
  模型、不写Turn、不抢锁、不续heartbeat、不读取UI Thread猜恢复输入。浏览器在同一
  Thread scope 内持久保存尚未被View确认的命令identity；HTTP结果不明、刷新或精确重试
  必须复用它，View出现对应消息后才可删除。
- **AR-05 — 模型 Activity 是一次性执行。** `maximumAttempts=1`，heartbeat 10 秒，
  timeout 45 秒。刷新、SSE 断线或 HTTP 断开不取消 Turn；Worker/Activity 丢失把 Turn
  结算为 interrupted，不自动重放原模型调用。
- **AR-06 — 完整 snapshot 才能进入模型历史。** token、reasoning delta 与未完成文本
  只进入 SSE overlay。只有 Agents SDK Session owner 产生的完整 snapshot 可在 settlement
  事务中晋升；interrupted Turn 的未完成模型输出不进入后续历史。Approval suspension已
  提交的snapshot例外地包含pending function call；该Turn随后cancel、failed、interrupted
  或Coordinator丢失时，唯一approval-history owner必须按冻结callId追加明确terminal result，
  原子推进Thread与Turn的history version，再清RunState，禁止留下orphan call。
- **AR-07 — 已发生 effect 不因 Turn 中断回滚。** 下一个 Turn 的模型输入必须包含从正式
  Turn source、ToolEffect、Task、Provider 与 Resource 事实构造的
  `interrupted_turn_continuation_v3`：`priorTurnIds`、逐Turn `sourceFacts`、
  `completedEffects`、`createdTaskIds`、`createdResourceIds`、`outcomeUnknownEffects`。
  同一未晋升history version上的连续 interrupted/failed/cancelled Turn必须全部聚合；普通
  Turn重建其canonical user/Choice/follow-up source，Approval checkpoint已把source写入
  history的Turn只投影effects，不重复source。该continuation是输入投影，不是第二状态机。
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
  “保险”制造RunState checkpoint。决定已写但HTTP/Workflow ACK丢失时，即使terminal已清
  RunState，新Coordinator仍从write-once response返回原receipt；只有首次决定与真正resume
  claim要求RunState存在。
- **AR-14 — Choice 只有一个通用协议，且回答是新Turn。** `request_choice` 创建immutable
  Offer，完整保存
  本地化 card、mode、stable option value、subject fingerprint 与可选 commitment。
  Decision write-once，规范化为 `confirm|select|text|cancelled`。Renderer 只消费 Offer，
  不按领域名字或历史消息重建卡片。Offer与当前Tool result提交后原Turn正常完成；用户回答
  的本地化可见文本必须由服务端根据冻结card、已解析Decision及Turn冻结locale规范生成；
  HTTP、UI与Temporal command只提交结构化response，协议不接受客户端文本字段。规范文本与
  Decision在同一事务
  写成正式用户消息，再以
  `sourceKind=choice_response + sourceId=offerId`创建新Turn；不恢复原模型Activity、
  不保存RunState。新的普通user Turn会原子supersede旧pending Offer。
- **AR-15 — Choice commitment 只提交当前决定。** 只有 registry 声明
  `choiceCommit.enabled=true` 的确定性、非收费、事务型 Operation 可被一个匹配回答原子
  执行；自由文本与 cancelled 不执行 commitment。Choice 不能授权媒体生成、未来链路或
  第二 writer。
- **AR-16 — Interaction 与 Turn 同生共死。** cancel、supersede 或 clear 在同一事务
  失效 pending Approval、Choice 与 RunState；resume 前再次校验 Turn 仍可运行。旧卡片
  点击不能复活 dead Turn。普通user消息supersede waiting Approval时，必须先在同一事务
  追加冻结call的rejection result、推进history、拒绝interaction并取消旧Turn，再创建具有
  新base version的前台Turn；它在内存队列和Coordinator恢复队列中都优先于旧后台follow-up。
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
  SSE part猜当前状态。Subagent `task.stream`只可覆盖View已确认属于当前Thread的taskId；未知
  task首包触发一次ownership refetch，确认期间按taskId有界缓存后续包，成功确认属于当前View
  才按attempt/seq消费。成功且同一View revision确认不属于当前Thread后必须缓存non-owned结论，
  避免每包refetch；transport失败不缓存结论，下一事件重试，scope或语义View revision变化必须
  失效该结论。seq gap立即丢弃overlay并刷新View，terminal只有fresh View确认后才交接。
  scope切换必须清除草稿、附件、乐观消息、错误与stream overlay。
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
- **AR-28 — 模型用量随 Turn segment 一次结算。** 每个 Turn attempt 的 Agents SDK
  usage 与该 segment 的 completed/waiting_approval/waiting_choice/failed settlement 在同一
  MySQL事务进入唯一 UsageCost writer；上下文压缩使用独立 phase，因为它可能使用不同
  utility model。Approval resume 增加 attempt 且以 replacement RunContext 从零累计本段
  usage，禁止把已记录的审批前累计量再次写入。Activity ACK丢失不得制造重复成本事实。
  用户取消或 Worker abort 也必须先把 SDK 已观测到的本段 usage 以同一 attempt identity
  exact-write 后再传播取消；取消不是免费执行，也不得因 settlement 未走 completed/failed
  分支而漏记真实模型成本。
- **AR-28A — 有损上下文压缩必须可见。** Tool result shedding可保持安静，但真正调用
  utility model压缩较早上下文时，当前Assistant消息必须持久化结构化
  `assistant-context-compacted` part并显示被替换条数；UI不得从消息长度猜测，marker也不得
  只存在于SSE而在刷新后消失。
- **AR-29 — Project 删除不得截断活跃执行。** `delete_project` 与 Agent Turn、Choice/
  Approval、Operation Task创建共用Project行锁。事务内只要仍存在`queued|running|
  waiting_approval` Turn、`pending` interaction、仍持有RunState待resume的已决定Approval或
  任何非终态Task，就必须以typed conflict失败；已经terminal且RunState已清的历史决定不阻断。
  不能依赖级联删除把仍可产生副作用的执行事实抹掉。全部执行终态后，删除
  事务先取消残余FollowUpBatch恢复权，再删除Project领域关系。

## 状态与写入者

| 事实 | 唯一 writer | 消费者 |
| --- | --- | --- |
| Thread/messages/model history | Thread persistence + SDK Session / approval-history owner | model input、UI |
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
→ terminal事务闭合所有已checkpoint但无result的call并清RunState
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
  heartbeat timeout、cancel/clear、foreground/background恢复顺序、未完成source连续投影、
  Approval checkpoint terminal closure、clear exact receipt、合法空Thread/version 0
  interaction与跨Project Episode拒绝。
- 真实 Agents SDK：callId、Approval RunState跨Worker恢复、schema/graph版本拒绝。
- 生产 registry conformance：Tool exposure/effect owner/outcome/choice commit/changed refs。
- 人工产品复验：刷新、SSE断线、多标签页、interrupted、Approval/Choice、Subagent、
  Resource links、i18n与Canvas同步。

模型自由规划质量、真实 Provider reasoning stream、长会话 RunState 大小和发布时旧
RunState 排空是环境盲区；未验证不得宣称架构完成。

## 历史回归

- B+ 首版把模型 Activity 与 Turn 终态收敛完成，却只保留日志级 context telemetry，
  没有调用账务模块已经声明的免费 usage writer；所有 Assistant token成本因此从项目统计
  消失。当前 runner 返回每段供应商 Usage，settlement 按 `turnId + attempt + phase` 与 Turn
  状态原子写入；普通失败段也携带已经观察到且进入 settlement 的 usage，重放只能读取同一
  事实。Provider 返回到首次本地 durable write 之间被强杀仍是明确的观测盲区，不为免费统计
  事实重建逐模型请求的 durable Agent Kernel。
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
- B+初版在Approval、Choice service和最终Turn settlement三处都追加同一assistant message；
  Choice commitment又被通用durable-write guard误拒绝。当前消息只由canonical Turn commit写，
  Choice决策与允许的原子commitment共用一个事务owner，避免重复消息、卡片已选但业务没变。
- 初版Activity只处理“running丢失→interrupted”，遗漏DB terminal已提交但Activity ACK丢失、
  queued尚未claim、deterministic admission错误与Coordinator重启后的durable queue。当前
  settlement返回任何已提交兼容终态，queued可明确interrupted，业务错误non-retryable，
  Coordinator启动从MySQL恢复queue/interaction且保持前台优先。
- 初版中断digest只看一个Turn且只保留effect，连续失败会丢前一Turn，首次模型调用前中断
  还会把已接受用户输入完全丢掉；Approval异常终止则留下无result call并重复source。当前
  v3聚合同一history version的全部source/effect，Approval source由已提交snapshot拥有，
  terminal owner闭合call并同步推进history，下一Turn既不失忆也不重复执行已发生effect。
- B+切换后canonical View虽已包含Subagent，客户端却没有接回`task.stream`；HTTP ACK不明时
  commandId也只活在一次React调用中。当前SSE只做有identity/seq的临时overlay，稳定command
  receipt按Thread scope保存到View确认，刷新与断线不再制造重复命令或“刷新才看到”。首版
  ownership确认又把refetch进行中的后续包当成非本会话事件，并对每个成功miss反复refetch；
  当前确认期间有界缓存，same-revision miss形成可失效non-owned结论，失败则由下一事件重试。
- Choice回答曾由浏览器同时提交结构化Decision和任意`visibleUserText`，服务端把后者直接写入
  正式消息与下一Turn输入；恶意或过期客户端可让用户看到的历史与实际选择分歧，等待期间切换
  locale还会让两端文案误冲突。当前HTTP、UI与Temporal command彻底删除该输入，服务端从冻结
  card、解析后的Decision和Turn locale构造唯一文本，存储及模型输入只使用该规范结果。
- Project级联删除曾只关闭FollowUpBatch，却没有拒绝仍在运行的Task、Turn或已经决定但尚待
  resume的Approval；数据库关系消失后，Temporal/Provider仍可能继续执行或结算。当前删除与
  所有执行创建共用Project行锁，并在事务内穷尽拒绝非终态Task、active Turn与active
  interaction，避免用数据级联冒充执行取消协议。
- Assistant媒体附件上传曾把底层`Error.message`直接展示，并以英文硬编码补缺；Provider、
  storage或内部协议文本因此可能泄漏到用户界面且绕过i18n。当前上传层只向Composer传递失败
  事实，最终文案统一取正式`assistantAgent.attachments.mediaUploadFailed`翻译。

## 修改检查表

1. 是否以threadId/turnId/callId作为canonical identity？
2. 是否让route、UI、SSE或消息文案重新拥有生命周期解释权？
3. 是否新增Agent retry/checkpoint/lease/reconciler而不是明确interrupted？
4. Tool、Approval、Choice、Task follow-up是否各走唯一owner？
5. clear/cancel/supersede是否同步失效所有旧恢复入口？
6. Operation schema、authority、outcome和changed refs是否仍由registry穷尽？
7. 是否实际删除被替代的Run/Wait/Handoff/Outbox入口？
