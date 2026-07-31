<!-- architecture-module: durable-execution -->

# Temporal 持久执行边界

## 设计理念

Temporal 只解决两类基础设施问题：

1. 一个 Assistant Thread 当前是否允许开始、暂停、取消或结束一个 Turn；
2. 一个长时间 Task 应如何排队、重试、取消、恢复和最终通知。

Temporal 不决定导演产品下一步做什么，不保存创作阶段，不解释 Prompt、Operation、
Resource、计费或 Provider 结果。Agent 对话采用已经被 Codex/OpenCode 类产品验证的
`Thread → Turn → Item` 契约：历史是持久事实，运行中的 JavaScript/模型 stream 是临时
执行；服务器中断后保存已提交事实，把当前 Turn 明确结算为 `interrupted`，后续以新
Turn 继续。

长期媒体 Task 与对话不同：用户关闭页面或 Worker 重启后仍必须继续，因此 Task attempt
由 Temporal Workflow 持久拥有。资金、Resource、Provider 受理和 Tool effect 仍由
MySQL 中各自的唯一业务账本拥有。Redis/SSE 只传输即时增量，永不承担正确性。

## 权威分层

| 事实 | canonical identity | 唯一 owner |
| --- | --- | --- |
| Thread 与完整模型历史 | `threadId` | Thread persistence service |
| Turn 业务事实 | `turnId` | AgentTurn service |
| Thread 执行许可 | `agent-thread:v1:<hash(threadId)>` | AgentThreadCoordinatorWorkflow |
| Approval 等待事实 | `turnId + interactionId` | Turn interaction service |
| Choice Offer/decision | `offerId` | Choice service；decision成为新Turn输入 |
| 同 Turn Tool effect | `turnId + callId` | ToolEffect/Operation owner |
| Task 业务输入、结果与终态 | `taskId` | Task service/Terminal transaction |
| Task attempt 执行许可 | `task:v1:<hash(taskId)>` | TaskWorkflow |
| 用户 Task 容量 | `userId` | UserTaskSchedulerWorkflow |
| 多 Task 自动续跑 | `batchId` | FollowUpBatch service |
| Provider 外部受理 | logical invocation identity | Provider invocation ledger |
| Billing/Grant | plan/grant/execution identity | Billing owner |
| Resource/Lineage | `resourceId` | Resource owner/materializer |
| 流式增量 | `turnId + attempt + lane + seq` | SSE publisher；非持久权威 |

Temporal persistence/visibility schema 与 Prisma 业务 schema 必须物理隔离。二者可以共享
MySQL server，但不存在跨 schema 原子事务；跨边界只能依靠稳定 identity 和可重试
Activity。Prisma 业务模型只以 `prisma/schema.prisma` 的 MySQL schema 为唯一权威；旧的
SQLite 影子 schema 已删除，不允许再维护第二套模型或把它当作迁移、开发或测试裁判。

## 不变量

- **DE-01 — Temporal 只拥有执行许可。** Workflow 可以决定何时调度 Activity、等待
  Update、取消 attempt、释放容量或发送可靠通知；不得写创作阶段、Operation eligibility、
  Provider 成功、计费结果、Resource 内容或模型历史。
- **DE-02 — Thread Coordinator 以 threadId 唯一。** Workflow ID 只从 canonical
  `threadId` 构造。Project、Episode、user、assistant 或 UI scope 组合不能替代 Thread
  identity；Thread clear 后新建的 Thread 必须得到新的 Coordinator identity。
- **DE-03 — Coordinator 必须极薄。** 只允许 command admission、active Turn 互斥、
  waiting Approval、pending Choice Offer、pending follow-up FIFO、前台命令优先、cancel/clear
  与 model Activity 调度；同一优先级顺序必须可从MySQL恢复，不能只存在Workflow内存。
  Coordinator 内禁止业务 timer、poll、lease、heartbeat state、fence、reconciler、
  Prompt、导演步骤或完整模型历史。
- **DE-04 — Workflow 确定性，I/O 全部在 Activity。** 数据库、Redis、SSE、模型、
  Provider、对象存储、随机数和系统时间读取都不得直接发生在 Workflow。Workflow history
  只保存有界 identity、状态和 version，不保存 Prompt、RunState、模型历史、媒体或 token
  delta。
- **DE-05 — 命令以 Update-With-Start 进入。** Route先鉴权并get-or-create Thread，
  再按threadId提交typed Update-With-Start；Approval、Choice、cancel与clear同样不得
  退回只适用于存活execution的普通Update。首个Activity在一个业务事务中写入用户消息与
  AgentTurn；事务提交后Update才能返回accepted。Temporal接收Update本身不能代表产品已
  接受命令。
- **DE-06 — 跨 Workflow execution 去重属于 MySQL。** Turn source唯一键为
  `threadId + sourceKind + sourceId`，Approval/cancel等生命周期命令也由其MySQL owner保存
  write-once决定/终态receipt；所有命令另冻结包含reason等完整字段的canonical payload
  hash。相同identity与相同payload即使跨已完成Workflow execution也exact replay；相同
  identity与不同payload fail closed。Workflow validator/handler的确定性无效与冲突必须
  抛non-retryable failure，client不得重试为transport不确定。Temporal updateId只做传输层
  优化，不能成为业务唯一裁判。
- **DE-07 — Coordinator 只在安全空闲点完成。** return 或安全 rollover 前必须满足：
  无 active Turn、无 pending command、无 pending follow-up，且
  `allHandlersFinished()`。Client 遇到 Workflow 刚完成的 UWS 竞态，使用同一业务 identity
  重试。
- **DE-08 — Agent model Activity 不透明重跑。** heartbeat 每 10 秒，heartbeat timeout
  45 秒，`maximumAttempts=1`。Worker 丢失、timeout 或不可恢复的进程中断把当前 Turn
  结算为 `interrupted`；不得重新请求模型生成原 Turn，不恢复 token 位置或 JavaScript
  Promise。
- **DE-09 — 只提交完整模型历史。** UI 流式增量可丢；只有完整且通过 SDK Session owner
  提交的 model snapshot 才进入 Thread 历史。`interrupted` Turn 已经产生的 Tool、Task、
  Provider、Billing 和 Resource 事实不会回滚，也不得伪造为未发生。Approval snapshot已
  提交的pending call在cancel/fail/loss时必须由唯一history owner闭合并推进版本。
- **DE-10 — Activity 至少一次，副作用自行幂等。** Temporal retry 不能提供业务
  exactly-once。所有数据库写、Tool effect、Task 创建、Provider 提交、计费与终态必须
  使用所属 owner 的 canonical identity exact replay；同 identity 不同输入拒绝执行。
- **DE-11 — RunState 只服务冻结的真实 Approval。** 普通effectful、billable与external
  Tool在model Activity内联调用其唯一owner；只有Agents SDK明确返回`approval_required`
  时才外置序列化RunState。interaction必须同时冻结精确SDK包版本、RunState schema、agent
  graph、每个`approvalId + callId`、normalized input hash与tool contract revision；恢复时
  对当前registry和RunState内schema逐项复核。任一不兼容即失败关闭并按发布规则排空，不
  保留双parser。普通Choice持久化Offer/Tool result后结束当前Turn，用户decision作为新的
  幂等Turn输入；Choice不得建立第二套RunState恢复。
- **DE-12 — ToolEffect 只防同 Turn 技术重放。** canonical identity 为
  `turnId + SDK callId`，不得用数组位置、完成顺序、operationId 或 fallback UUID。
  它不保证新 Turn 中模型不会再次决定做语义相同的动作；跨 Turn 防线是正式
  `interrupted_turn_continuation_v3` 的canonical source/effect投影与
  Operation/Task/Provider 的业务幂等。Approval checkpoint已提交的source不得重复投影。
- **DE-13 — 长 Task 只有 Temporal 一条 transport。** 每个 Task 只对应一个
  TaskWorkflow；所有 task-producing Operation（Agent/API、收费/免费）先进入同一个
  OperationExecutionWorkflow，由其 persistence Activity 使用冻结的 Operation input
  在同一个 MySQL 事务中提交 Operation output、Task、Resource 与 Batch，再经
  UserTaskSchedulerWorkflow 调度。禁止先提交 Task、再单独记录 Operation 回执；也禁止一次性
  model/HTTP Activity 在 DB commit 后带外启动 TaskWorkflow，也禁止 BullMQ、Outbox、
  DB claim/lease/heartbeat/reconciler 或 Redis concurrency gate 作为 fallback。API入口
  必须提供显式Idempotency Key；缺失时失败关闭，不能生成随机execution identity。
- **DE-13a — 一次性 Operation 不建立命令状态机。** 每个
  `OperationExecutionWorkflow`只接受一个immutable envelope作为Workflow input并执行后
  完成；禁止为它建立空Workflow、Update-With-Start、Query或等待命令的第二生命周期。
  start ACK丢失后按稳定Workflow ID读取原result；相同execution identity携带不同payload
  必须由receipt hash与MySQL execution owner失败关闭。
- **DE-14 — Task 业务 attempt 与 Activity retry 分离。** 长 Activity 的相同 retry
  复用同一个 business attempt identity；只有 registry policy 判定一次业务 attempt
  已确定失败，Workflow 才能推进下一 attempt。仍可重试时不得提前写 Task、Resource 或
  Billing 最终失败。
- **DE-15 — Provider outcome unknown 不自动重提。** Provider ledger 已有 external id
  或能够证明未受理时才可安全恢复；网络超时、响应丢失或受理结果不明必须持久化
  `outcome_unknown` 并停止盲目提交。Temporal retry 不能覆盖这条裁决。
- **DE-16 — 容量释放与 Agent 通知解耦。** Task terminal 业务事务提交后，
  TaskWorkflow 先向 Scheduler 发送幂等 `capacityReleased`；Scheduler 立即释放对应槽位。
  follow-up通知在release ACK后优先可靠完成；canceled Task只在全部required follow-up ACK后
  由独立Activity从provider ledger执行可重试交接与best-effort外部cancel。补偿不得反向阻塞
  Agent接力；两者都不得继续占用Provider容量。
  Scheduler 只保存
  `capacityActive`，不得把通知 pending 解释为 Task 仍运行。
- **DE-17 — FollowUpBatch 是唯一多 Task 接力。** Batch 成员在 Task 创建事务中一次
  冻结；同一个 Tool call 创建多个 Task 必须全建或全滚。最后一个成员 terminal 后 Batch
  变 ready，Coordinator 以 `threadId + task_follow_up + batchId` 最多创建一个新 Turn。
  `followUpPolicy=none` 不创建空 Batch。
- **DE-18 — Clear 关闭旧 Thread 的全部恢复入口。** clear 通过 Coordinator 进入；
  同一事务归档 Thread、取消该 Thread 未完成 Batch、失效 Approval/Choice/RunState。
  晚到旧 Task 只能结算已经取消的 Batch，不能唤醒新 Thread。
- **DE-19 — SSE 与 View 分权。** MySQL View 是刷新后的产品事实；SSE 只传递已经提交
  的事实或即时 stream delta。消息文案、DOM、本地 timer、refetch 和事件到达顺序均不能
 决定生命周期。Task/Subagent overlay必须带attempt/seq并只覆盖View已确认identity；gap
  丢弃overlay并刷新，terminal等待fresh View。浏览器可保存未被View确认的stable command
  identity以处理HTTP ACK不确定，但不得把receipt本身解释为业务终态。
- **DE-20 — Temporal 不可用时失败关闭。** 新Turn、Task、批准执行或取消命令无法进入
  Temporal时返回stable typed infrastructure code；用户文案只由当前locale的i18n catalog
  解析，内部error message/cause不得成为HTTP copy。不得退回同步执行、BullMQ、Outbox、
  fire-and-forget或数据库扫描。
- **DE-21 — 协议升级不双读。** 正式环境必须使用不可变且非`local`的Worker build ID、
  以`repository@sha256:<digest>`锁定Worker镜像、启用Worker Deployment Versioning，并以
  `PINNED`作为默认versioning behavior；缺少任一条件启动即失败。自托管部署固定为
  blue/green两个独立Worker slot：首次安装只在
  Deployment尚无Current Version时自动激活blue；后续发布必须先让候选slot注册全部task
  queue，再显式`set-current-version`；rollout必须在任何候选`compose up`之前同时校验所选
  slot的运行中build和配置build均不是Current。旧slot保持运行到Temporal报告其drained，
  最后才允许退休。普通Compose重启不得隐式提升候选，`down/up`或滚动替换唯一Worker不是
  合法发布路径。Workflow变更遵守Deployment/patch纪律；不兼容的Workflow、SDK RunState、Task
  payload或schema发布必须先排空旧实例或明确阻止部署。禁止“先试新格式、失败再猜旧
  格式”。
- **DE-21a — Web配置不冒充Worker发布配置。** Temporal client只读取address、namespace、
  task queue与连接安全；build identity、Deployment Versioning与PINNED只由真实Worker
  入口解析。产品`DEPLOYMENT_EDITION`只决定产品能力，不得推断Temporal由官方托管还是
  自托管；连接方式只由显式address/TLS/API字段决定。开发脚本显式使用本机自托管
  `local/unversioned`，正式Worker slot显式注入不可变build和versioned，不能靠同一份
  `.env`默认值在运行时猜profile。API key只允许配合TLS连接。Compose中的Temporal数据库、
  schema和namespace初始化必须自包含，预构建安装不得依赖未下载的仓库脚本。
- **DE-21b — Cutover migration只前进不改写。** 已发布migration必须保持byte-for-byte
  不变；后续schema变化只能进入新的additive migration。`db:bplus-cutover-apply`是唯一
  切换入口：完整legacy阶段按固定顺序执行immutable base与additive，完整base阶段只允许
  重放幂等additive，最终阶段只验证并返回；部分base或未知schema必须fail closed并从备份
  恢复，禁止猜测、逐条补DDL或盲目重跑非事务base。
- **DE-22 — 控制面复杂度有硬预算。** 控制面目标 8,000–11,000 行，达到 12,000 行必须
  暂停架构审核。新增 timer、lease、claim、reconciler、execution receipt 或第二状态投影
  默认视为 Kernel 复发信号。`npm run architecture:durable-budget`必须穷尽分类全部
  `agent-turn`、`temporal`及durable Task/Operation边界，并同时报告Kernel、业务安全账本、
  产品adapter/projector与raw总量；不得通过移动文件或把Provider/Terminal安全账本删除来
  降低数字。

## 正常时序

### 用户 Turn

```text
HTTP route鉴权并取得canonical threadId
→ Update-With-Start submit_user_turn
→ Activity事务写user message + AgentTurn(queued)
→ Coordinator调度单次model Activity
→ SDK运行并通过唯一Tool/Operation owner执行调用
→ Activity提交完整model snapshot
→ settlement Activity写Turn terminal与正式View
→ SSE仅广播已提交事实
```

### Task

```text
Agent Tool/API以stable identity和immutable envelope启动OperationExecutionWorkflow
→ persistence Activity用同一事务提交Operation output、Task与可选FollowUpBatch成员
→ SchedulerWorkflow按user容量启动TaskWorkflow
→ TaskWorkflow建立business attempt
→ Activity运行handler并heartbeat
→ terminal Activity提交Task/Billing/Resource/Batch事实
→ capacityReleased
→ follow-up notify（需要时持续重试）
→ canceled时独立Activity校验终态并补偿Provider
→ TaskWorkflow完成
```

## 失败、取消与并发

| 场景 | 唯一结果 |
| --- | --- |
| Update接受后、消息事务前崩溃 | 同 Activity identity 重试；不返回accepted前不得丢消息 |
| Turn事务提交后HTTP ACK丢失 | 同source identity返回原Turn，不创建第二Turn |
| Agent Worker强杀 | heartbeat timeout后Turn=`interrupted`，保留已提交业务事实 |
| ToolEffect commit后Activity ACK丢失 | `turnId+callId` exact replay |
| Task terminal commit后Worker丢失 | terminal exact replay，再执行capacity release与notify |
| 重复/乱序Task terminal | Task terminal与Batch member均按identity幂等 |
| 前台Turn与follow-up并发 | follow-up FIFO排队，不抢占前台Turn |
| cancel与已提交完成竞争 | 已提交业务事实优先；cancel只阻止尚未发生的执行 |
| Task handler checkpoint提交后cancel/Workflow failure | terminal owner重读checkpoint并提交completed；不得改写cancel/failed |
| cancel/supersede与旧审批点击 | 同事务失效interaction；resume再次校验Turn仍可恢复 |
| clear与旧Task晚到 | Batch已cancelled，禁止创建ghost Turn |
| Provider响应丢失 | outcome_unknown，禁止Temporal自动重提 |
| Temporal服务不可用 | typed failure；无fallback transport |

## 权威入口

- Temporal client/config/worker：`src/lib/temporal/**`。
- Thread/Turn/interaction/View：`src/lib/agent-turn/**`。
- Agent routes：`src/app/api/projects/[projectId]/assistant/**`。
- Task registry与业务事实：`src/lib/task/definition.ts`、`service.ts`、
  `transactional-create.ts`、`terminal/**`。
- Task/Operation Workflow：`src/lib/temporal/workflows/**` 与对应 Activities。
- ToolEffect：`src/lib/agent-turn/tool-effect.ts`。
- Provider fence：`src/lib/task/provider-invocation.ts`。
- Billing/Approval、Resource/Lineage 继续使用各自既有架构模块的唯一入口。

## 被替代并必须删除的入口

- BullMQ queues、worker host、Bull Board
- Outbox command/repository/dispatcher/worker
- ProjectAgent Run/Activity/Event/Wait/ContinuationCheckpoint/ExecutionHandoff
- Redis run lock/heartbeat/fence 与 user concurrency gate
- Task reconciler、stalled takeover、shutdown attempt release
- server-follow-up 与伪造 HTTP request 的续跑
- UI 对 Run/Wait/Event/message 的生命周期拼装
- 完整 AgentSessionWorkflow、模型 step checkpoint/replay、Agent Session CAN
- generic TaskSubmissionWorkflow

`OperationExecutionWorkflow` 不是 generic Task submitter：它只接受生产 registry 中一个
精确 Operation identity、canonical normalized input与contract revision。收费执行必须
携带既有Plan/Grant，免费Task Operation明确声明无需Grant；两者复用相同的DB→Temporal
可靠交接。该Workflow直接以immutable envelope启动，不使用Update/Query命令状态机。
API入口使用Idempotency Key/request identity，Agent Tool入口使用
`turnId + SDK callId` 派生 stable execution identity；相同 identity 的 payload 或 registry
revision发生分歧时必须失败关闭。Operation业务事务成功后，Temporal ACK丢失只能读取
同一OperationExecution并补调度，不得再次执行domain写入。

不得保留 feature flag、兼容 reader、fallback worker 或“只用于保险”的旧 writer。

## 验证

只保留符合测试治理准入的证据：

- 真实 Temporal + MySQL 的 Turn/Task identity、事务重放、重复/乱序、Worker kill、
  heartbeat timeout、commit/ACK loss 与 capacity release；
- Provider invocation 的 external id 与 outcome_unknown；
- 从生产 Task/Operation/Tool registry 穷尽的 conformance；
- Approval 的真实 Agents SDK RunState 跨 Worker 恢复；
- 已完成Coordinator后的Approval/cancel UWS replay、payload分歧与non-retryable
  deterministic failure；
- 正式Temporal config拒绝可变build ID、关闭Versioning或非PINNED Worker；
- `docker compose config --quiet`证明预构建Compose不依赖宿主脚本；Worker进程入口与
  rollout守卫共同拒绝非完整sha256 digest，rollout还在启动候选前拒绝Current slot，并
  拒绝停止Current、未drained或期望副本数仍非0的Worker slot；
- 真实MySQL 8分别证明legacy→base→additive、完整base→additive、additive中断重放与部分
  base拒绝；最终验收必须同时覆盖新表、旧表删除、archive FK、两个archive新增列和废弃
  tool-selection表删除；
- typed Temporal unavailable；
- authenticated 产品人工复验刷新、断线、多标签页、Approval/Choice、interrupted 和
  Canvas changed refs。

真实 Provider 受理、长媒体生成、生产规模 history 写放大、Workflow deployment 排空和
cloud/self-hosted Temporal 运维仍属于发布环境盲区；未实际验证前不得宣称架构完成。

## 历史回归

- 旧控制面先后叠加 DB Run、Redis lock/heartbeat、Wait、Outbox、ExecutionHandoff、
  continuation claim/fence、Task reconciler 和 UI event reducer。每一层都修复一个崩溃
  窗口，却同时增加新的合法状态解释者，导致“修复后换形式复发”。当前防线是删除竞争
  owner：Temporal 只拥有执行许可，MySQL owner只拥有业务事实。
- Outbox 曾多次因为 transaction owner 忘记绑定 collector 而让 Task 已提交、UI仍需刷新。
  当前同步 Operation 直接返回统一 changed refs，异步 Task terminal 返回正式 Resource
  impact；SSE 不再决定事实是否生效。
- BullMQ redelivery、DB attempt heartbeat、shutdown release 与 reconciler 曾同时判断
  worker是否死亡，产生重复 attempt、假失败和长期卡住。当前 TaskWorkflow 是唯一 attempt
  owner；Activity heartbeat只报告执行存活。
- Creative Worker 的 Agents SDK模型调用曾绕过媒体Task已经使用的Provider invocation
  fence；Worker在请求已被模型接收后强杀会让Activity retry再次调用。现在Creative
  Worker也必须以stable invocation key先写`submitting`，只有明确拒绝才允许新business
  attempt重提；`submitting`崩溃或响应结果不明统一写/解释为`outcome_unknown`。
- 完整 Temporal Agent Kernel 原型证明任意模型位置透明恢复需要 model checkpoint、
  successor、execution-chain receipt、CAN dedupe 和完整 Session状态机，复杂度接近重新
  实现 Agent runtime。产品已接受“中断当前Turn、以新Turn继续”，因此这些保证和代码全部
  删除；保留 Temporal 的范围只限薄 Thread 协调与真正长期 Task。
- 旧Approval控制虽然补过持久target优先和重复decision幂等，AgentTurn初版仍把该保证缩在
  单个Coordinator execution：decision/cancel已写MySQL但ACK丢失后，普通Update无法跨已
  完成Workflow重放；同时RunState没有冻结SDK/graph/双identity/input/tool contract。这是
  同一恢复契约在新transport与新owner上的两次漏接。当前完整命令UWS只负责抵达，MySQL
  receipt负责跨execution exact replay，interaction payload负责冻结并校验实际可执行物。
- 旧Worker的stale takeover与shutdown release曾反复让进程信号覆盖业务结果；Temporal版
  仍出现handler checkpoint已提交、cancel先被Workflow观察的同形窗口。当前checkpoint是
  terminal裁判：cancel和Workflow failure都必须先恢复completed，不能退款或写失败。
- B+首次收敛后，Approval/Choice settlement仍以Turn→Project→Thread反向加锁，且Approval
  abnormal terminal只清RunState不闭合已提交的pending SDK call；Coordinator重启又按
  createdAt丢失前台优先级。当前所有入口统一Project→Thread→Turn，approval-history owner
  闭合call并同步Thread/Turn version，恢复队列显式foreground-first。
- 部署preflight曾因开发/生产profile边界错误阻止正常开发；新增Temporal后，`.env.example`
  又把开发所需`local/false`直接注入`NODE_ENV=production`的Web与Worker，同时README只启动
  MySQL/Redis导致本地Worker没有Temporal Server。预构建Compose还bind mount了用户并未
  下载的四个仓库脚本；即便补齐文件，单Worker`down/up`也会移除旧PINNED Workflow唯一可
  执行的代码。这是同一“profile必须显式、发布身份必须可恢复”不变量在新部署面的一组漏
  接。当前client/Worker配置分权，本地脚本显式local/unversioned，Compose bootstrap内联
  自包含，并以blue/green slot、只在Current为空时首次激活、显式promote和drained-gated
  retire收敛发布路径。真实目标集群的长Workflow排空耗时仍需发布复验。
- `dev:cloud`曾把产品`DEPLOYMENT_EDITION=cloud`直接解释为必须连接付费Temporal Cloud，
  开发preflight和runtime因此同时强制远程address、TLS、API key与正式Worker发布字段；而仓库
  Compose本来就在本机提供同一开源Temporal服务。当前产品edition与Temporal托管位置彻底
  分权：开发使用Compose自托管地址和local/unversioned Worker，正式发布约束仍由Worker入口
  独立失败关闭；不再为本地官方Cloud产品调试要求外部Temporal账户。
- 首版部署整改仍在已提交的cutover migration上追加archive字段和废表删除，导致已执行该
  migration的数据库永远不会得到新结构；blue/green脚本又先`compose up`所选slot、再判断
  它是否承载Current，且Worker镜像仍默认`latest`。这是同一“发布identity与状态变更必须先
  验证、已发布migration不可改写”不变量的同形漏接。当前旧migration恢复原文，所有新schema
  变化进入独立additive migration。首次修订又只新增了文件，原apply命令仍只执行旧migration，
  使演练、正式和恢复路径与最终验收断链；当前stage-aware唯一apply入口按schema阶段串联两份
  migration并拒绝部分base。Compose与Worker入口只接受sha256 digest，rollout在任何候选启动
  前比较配置build、运行build与Temporal Current。

## 修改检查表

1. 新状态属于执行许可还是业务事实，唯一 owner 是否明确？
2. 是否新增了第二 transport、timer、lease、claim、reconciler 或fallback？
3. Activity retry 是否复用业务 canonical identity，分歧是否fail closed？
4. Agent中断是否只结束当前Turn，没有重放模型或吞掉已提交effect？
5. Task容量是否在业务terminal后释放，且不等待Agent通知？
6. clear/cancel/supersede是否原子失效所有旧恢复入口？
7. Workflow history是否仍只包含有界控制数据？
8. 控制面是否低于12k行，旧入口/writer/reader是否实际删除？
