<!-- architecture-module: async-task-lifecycle -->

# Temporal 异步 Task 生命周期

## 设计理念

Task 是长运行执行的唯一业务事实；Temporal `TaskWorkflow` 是 attempt、retry、timeout、
cancel 与恢复的唯一执行许可 owner。Operation 负责校验、计费批准和原子创建 Task；
Task registry 穷尽声明能力；Activity 只执行一个稳定 business attempt；Terminal Service
统一提交 Task、Billing、Resource、Lineage 与 FollowUpBatch 终态。

不再使用 BullMQ、Outbox、DB claim/lease/heartbeat、reconciler 或 Redis user concurrency
gate。Temporal transport 不拥有业务结果，MySQL Task/Resource/Billing/Provider事实也不
反向决定 Workflow 是否有执行许可。共享边界见
[Temporal 持久执行边界](durable-execution.md)。

## 不变量

- **TL-01 — Task 创建只有事务入口。** Agent Tool/API route先以stable execution identity
  启动OperationExecutionWorkflow；只有它的persistence Activity可调用共享Task
  submitter/transaction primitive，原子创建Task、billing freeze、Created Event、
  pending Resource与可选FollowUpBatch成员。route、model Activity、Worker与调用方不得
  直接拼装Task row或在commit后带外启动Workflow。API直接发起task-producing Operation
  必须提供显式`Idempotency-Key`作为stable source identity；缺失即拒绝，不能回退随机
  requestId、进程UUID或普通trace identity。
- **TL-02 — Task registry 穷尽。** 每个 TaskType 必须声明 handler、scheduler class、
  business retry、execution deadline、billing、scope、terminal modelKey requirement、
  result projection、Resource impact、materializer 与 `followUpPolicy`。新增实例主要增加
  registry声明；多处switch表示契约未穷尽。
- **TL-03 — 只有七类生产 Task。** 当前长期能力为 `creative_work`、image、
  web-reference、audio、voice、video、video-merge。固定创作阶段、风格预览、EditScript、
  BGM plan、final render等专用Task不得恢复。
- **TL-04 — 所有 Task 只经 Scheduler。** Task创建事务提交后，唯一Temporal client以
  `taskId` 向 `UserTaskSchedulerWorkflow(userId)` 提交。Scheduler按registry class与服务端
  用户并发配置排队；caller不能传并发上限，Activity不能绕过Scheduler直接启动顶层
  TaskWorkflow。
- **TL-05 — TaskWorkflow 是 attempt唯一owner。** Workflow创建稳定 attemptId，短
  Activity把该business attempt原子投影到Task，再运行长Activity。Worker进程、DB status、
  Redis lease、heartbeat freshness或队列job均无权另行claim attempt。
- **TL-06 — Activity retry 不消耗business attempt。** infrastructure retry始终复用同一
  attemptId。只有handler返回确定且已规范化的failure，并经registry retry policy裁决，
  Workflow才推进下一business attempt。仍可重试时不得写Task/Resource/Billing最终失败。
- **TL-07 — heartbeat只报告Activity存活。** 长Activity每10秒heartbeat并携带有界
  checkpoint；heartbeat timeout、Worker丢失或shutdown由Temporal恢复同一attempt。它不
  解释Provider成功、Task终态或UI进度。
- **TL-08 — provider调用有独立幂等fence。** Provider invocation ledger冻结logical
  identity、input fingerprint、route、external id与result。明确未受理或Provider支持同一
  idempotency identity才可重试；受理结果不明写`outcome_unknown`并停止自动提交。收费
  媒体handler必须在成功交接前从该ledger读取实际accepted route，并以它的`modelKey +
  provider`写terminal result与Resource provenance；请求中的primary model不是成功来源
  事实，即使当前route set只有一个成员也不得建立旁路。
- **TL-09 — Task terminal writer唯一。** 长Activity不直接写completed/failed/canceled。
  Terminal Service在一个事务中校验attempt、提交Task terminal、结算Billing、物化
  Resource/Lineage、写Task Event、更新FollowUpBatch member并构造正式Resource impact。
  exact replay返回相同terminal receipt。
- **TL-10 — committed result优先于并发cancel。** handler result checkpoint一旦提交，
  即使Activity completion尚未被Temporal确认、cancellation随后到达或Workflow进入失败
  settlement，terminal owner也必须从该checkpoint完成Task；不得改写为cancel/failed/
  refund。Workflow接受cancel后提交canceled terminal前必须重读canonical checkpoint，
  commit返回completed时以业务结果为准。cancel只中止尚未发生的执行，Task terminal不可
  重开。
- **TL-11 — Scheduler容量与通知分离。** terminal事务提交后，TaskWorkflow发送幂等
  `capacityReleased(taskId, terminalIdentity)`；Scheduler立即从`capacityActive`删除。
  Agent follow-up通知失败可持续重试，但不能占槽。Scheduler不得保存第二份Task业务状态。
- **TL-12 — FollowUpBatch成员创建时冻结。** 一个Tool call创建多个Task必须同事务全建
  或全滚，并在该事务中冻结完整member set。Batch不存在collecting/seal阶段；早到、重复、
  乱序terminal都由member identity幂等收口。最后一个member使Batch ready。
- **TL-13 — followUpPolicy来自registry。** `after_all_terminal`创建Batch并在全部成员
  terminal后通知Thread Coordinator；`none`不创建Batch。调用方不得根据Operation名字、
  TaskType或结果内容决定是否续跑。
- **TL-14 — 一个Batch最多一个新Turn。** Coordinator以
  `threadId + sourceKind=task_follow_up + sourceId=batchId`创建Turn。前台Turn活跃时按FIFO
  排队，不抢占；Thread已clear或Batch已cancelled时通知只返回稳定no-op。
- **TL-15 — generic TaskSubmissionWorkflow不存在。** 生产Task创建只允许
  OperationExecutionWorkflow persistence Activity进入共享事务submitter。该Workflow只
  接受registry中的精确Operation与冻结normalized input；收费执行校验Plan/Grant，免费
  Task Operation明确声明无需Grant。未来producer必须注册Operation channel，不能恢复
  “任意调用方提交任意Task payload”的第二编排层。
- **TL-15a — Operation execution是一条一次性链路。**
  `OperationExecutionWorkflow`直接以stable immutable envelope作为input，执行Activity后
  完成；不使用Update-With-Start、Query、Trigger或等待命令状态。Workflow start ACK丢失
  只能读取同一Workflow result，不能重复执行domain写入。
- **TL-16 — Resource是媒体目标。** 通用媒体Task target为CreativeResource，提交前校验
  canonical Resource ID、owner、scope与真实输入；成功时唯一materializer写内容与Lineage。
  Task result是交接输入，不是第二领域数据库。
- **TL-17 — Creative Work结果只物化一次。** `creative_work` strict outputKind由统一
  materializer转换为Resource/Lineage；相同Task/结果replay必须幂等。Worker没有领域writer。
- **TL-18 — 进度不是协议。** Task progress、Provider phase和estimated percentage只服务
  View/SSE。`Task.payload`运行字段只能由`progress-payload.ts`的唯一envelope投影写入；
  handler或领域parser不能各维护字段白名单。
- **TL-19 — UI不解释Task生命周期。** Query/View只读取Task与Resource正式事实，SSE只
  通知刷新或叠加瞬时进度。timer、poll、refetch、Canvas节点、消息文案与本地overlay均
  不能完成/失败/retry Task。
- **TL-20 — Resource changed refs是正式terminal输出。** Terminal事务返回registry声明的
  affected Resource refs；SSE广播失败不回滚terminal，也不阻止capacity release或
  follow-up。消费者只按refs invalidate正式Query。
- **TL-21 — 本地媒体进程有界。** 视频合并只经
  `video-compose/ffmpeg-command.ts`、`video-merge-ffmpeg.ts`与
  `video-merge-audio.ts`。FFmpeg禁止交互stdin，deadline从明确媒体时长派生，音轨按
  canonical duration pad/trim/reset PTS，不能用多路EOF或`-shortest`裁决正确性。
- **TL-22 — Temporal不可用时提交失败关闭。** OperationExecutionWorkflow必须在Task业务
  事务之前成为持久重试owner；它用stable execution identity exact replay persistence
  Activity，并在commit后可靠调度Task。无法确认Temporal接受时route/model Activity不得
  宣称Task已提交，禁止fire-and-forget、BullMQ、Outbox或周期扫描兜底。

## 状态与写入者

| 事实 | 唯一 owner/writer | 主要消费者 |
| --- | --- | --- |
| Task identity/input/status/result | Task service/Terminal Service | Workflow、UI、Agent |
| business attempt number | TaskWorkflow；短Activity投影 | handler、diagnostic |
| Activity retry/timeout/cancel | TaskWorkflow | Temporal Worker |
| 用户容量/FIFO | UserTaskSchedulerWorkflow | Task producer/debug View |
| Provider受理/checkpoint | provider invocation ledger | handler |
| Resource/Lineage | terminal materializer | Agent、Canvas、后续Operation |
| Billing settlement | Billing owner + Terminal事务 | profile、approval |
| FollowUpBatch/member | Task创建/terminal事务 | Coordinator |
| progress envelope | Task service | Task View |
| SSE delta | stream publisher | UI overlay |

## 权威入口

- Task定义：`src/lib/task/definition.ts`。
- 原子创建：`src/lib/task/submitter.ts`、`transactional-create.ts`、
  `approved-plan-submitter.ts`与Operation Task submitter。
- Temporal调度：`src/lib/temporal/task-client.ts`、
  `workflows/user-task-scheduler.ts`、`workflows/task.ts`。
- Task Activities：`src/lib/temporal/activities/task.ts`与共享handler registry。
- Provider fence：`src/lib/task/provider-invocation.ts`、`src/lib/ai-exec/engine.ts`。
- 终态：`src/lib/task/terminal/**`。
- 结果物化：`src/lib/creative-resource/task-materializer.ts`与
  `creative-work-materialization.ts`。
- Agent接力：`src/lib/agent-turn/follow-up-batch.ts`与Thread Coordinator client。
- 资源影响：`src/lib/workspace-resource/resource-impact.ts`与正式changed refs投影。
- SSE route只负责transport admission与已提交事件/stream的传输。

## 正常、失败与恢复时序

### 创建与执行

```text
Operation/Tool校验并冻结normalized input
→ OperationExecutionWorkflow
→ persistence Activity校验适用Plan/Grant并在MySQL事务创建Task、freeze、pending Resource、可选Batch成员
→ commit
→ Workflow向Scheduler Update-With-Start（稳定taskId）
→ Scheduler启动TaskWorkflow
→ beginAttempt Activity
→ handler Activity + heartbeat/provider ledger
→ terminal Activity
```

### 终态与接力

```text
Task/Billing/Resource/Batch terminal事务
→ exact terminal receipt
→ capacityReleased
→ Scheduler释放slot
→ 若Batch ready则可靠通知Thread Coordinator
→ TaskWorkflow完成
```

| 崩溃窗口 | 恢复 |
| --- | --- |
| Task事务commit、Scheduler ACK前 | 同taskId重试schedule；不得创建第二Task |
| beginAttempt commit、Activity ACK前 | 同attemptId exact replay |
| Provider受理、response丢失 | ledger outcome_unknown/external id裁决 |
| handler result checkpoint、Activity ACK前 | 同attempt exact replay结果 |
| terminal commit、Activity ACK前 | terminal receipt exact replay |
| capacity release ACK前 | 相同terminal identity重发 |
| capacity release后、follow-up前 | 槽已空；notify继续retry |
| duplicate/late terminal | Task与Batch member均返回原terminal |
| Thread clear后late notify | cancelled Batch稳定no-op |

## 被替代并必须删除

- `src/lib/task/queues.ts`、`enqueue.ts`与全部BullMQ worker host
- `src/lib/outbox/**`、`outbox.worker.ts`与Bull Board
- `src/lib/task/reconcile.ts`
- `src/lib/workers/attempt-recovery.ts`
- `src/lib/workers/user-concurrency-gate.ts`
- DB attempt claim/heartbeat freshness/stalled takeover
- ProjectAgent Wait/OperationBatch collecting/continuation Outbox
- generic TaskSubmissionWorkflow

业务handler、Provider fence、Resource materializer、Billing与Terminal事务逻辑保留，但必须
从BullMQ wrapper中拆出为Activity可调用的纯生产入口。

## 验证

- 从生产Task registry穷尽七类handler、scheduler class、retry/deadline、billing、
  materializer、Resource impact与followUpPolicy。
- 真实Temporal+MySQL故障注入：schedule ACK loss、Worker kill、heartbeat timeout、
  duplicate/late、cancel、terminal ACK loss、capacity release、Scheduler CAN与多Task Batch。
- Provider Critical：external id、明确拒绝、outcome_unknown与零盲目重提。
- Billing/Resource Critical：真实事务的freeze/settlement/materialization exact replay。
- 人工产品复验：长任务刷新/断线、并发排队、Canvas pending/terminal、Subagent详情与多Task
  单次follow-up。

真实收费Provider、生产规模并发、长视频/音乐/Voice生成、Temporal集群故障和部署切换仍是
发布环境盲区；未运行不得宣称架构完成。

## 发布边界

切换必须排空旧queued/processing Task与非终态Run/Wait；应用、Temporal Worker和migration
原子发布。仓库只创建migration/preflight文件；未经用户额外授权不执行共享或生产数据库
migration、回填、删除或清理。

没有BullMQ fallback、旧payload双读、Outbox保险、reconciler或feature flag双轨。

## 历史回归

- 旧Task同时由BullMQ job、DB status/attempt/heartbeat、Worker shutdown release与
  reconciler解释“谁在运行”。每次修复一个进程窗口都会引入新的stale时间窗。当前
  TaskWorkflow唯一拥有attempt，数据库只保存业务投影和结果。
- Task terminal与Agent continuation曾依赖Wait、seal、claim、Outbox和server-follow-up；
  早到/晚到/部分失败/lease丢失不断叠加分支。当前Batch成员在创建事务中冻结，最后一个
  terminal只产生一个新Turn。
- Outbox快速投递曾先后遗漏Operation、batch submit、Choice commitment和terminal内嵌
  session broadcast；持久命令存在但用户仍需刷新。当前changed refs是正式结果，SSE不再
  决定事实是否可见或执行是否继续。
- Provider execution字段多次击穿严格Task payload；reconciler随后重放已受理调用。当前
  进度envelope、handler checkpoint与Provider invocation ledger分权，outcome_unknown不
  允许Temporal重提。
- B+初次移植时image handler已从Provider ledger读取实际accepted route，video、music与
  voice却仍把请求payload中的primary model写入terminal result；当前只有image声明跨
  Provider等价route，因此尚未产生已知错误历史数据，但为其他模态增加route set后会把
  Resource provenance与结果provider静默记错。现在四类收费媒体统一要求submitted ledger
  route，缺失即失败关闭；单route和failover走同一交接入口。
- 音视频本地进程曾以`-shortest`、多路EOF或固定timer判断完成，出现99%停滞。确定性媒体
  primitive和deadline继续保留，迁移transport不得削弱这项业务执行防线。
- 旧Worker的shutdown release、stale attempt takeover与Task cancel分别判断执行是否已经
  停止；迁入Temporal后，Activity在handler checkpoint已提交、completion尚未ACK的窗口
  接收cancel，Workflow仍可能先观察到CancelledFailure并请求canceled terminal。这是
  “已提交业务结果优先于晚到控制”不变量换transport复发，而非新的重试策略。当前cancel、
  Workflow failure与terminal replay都先读取同一handler checkpoint；存在结果时只允许
  completed，容量、Billing与Resource随后按该唯一终态结算。

## 修改检查表

1. 新Task是否进入生产registry和唯一submitter/Scheduler？
2. Activity retry与business attempt是否使用同一稳定identity？
3. Provider outcome_unknown是否仍fail closed？
4. terminal、capacity release与follow-up是否严格解耦？
5. 多Task member是否创建时冻结并只产生一个新Turn？
6. 是否重新引入queue/outbox/reconcile/lease/timer或第二terminal writer？
7. handler业务是否从旧Bull wrapper拆出且没有复制一份？
8. 旧入口、writer、reader和测试治理引用是否一起删除？
