# Assistant 架构治理执行策略（临时）

> 状态：临时执行基线。每完成一个阶段，必须把稳定的不变量回写到对应架构模块文档，并删除本文件中已经完成的临时说明。全部治理完成后删除本文件。
>
> 审计基线：`exp/assistant` @ `de004a5aa`，2026-07-10。
>
> 本文只定义治理顺序、唯一所有者、删除范围和验收闭环；它不是第二套运行时契约。发生冲突时，以 `AGENTS.md`、`docs/architecture/modules/*.md`、共享类型和已落地状态机为准。

## 1. 治理目标

Assistant 全链路最终只保留以下权威关系：

1. Choice 只记录不可变决定；Workflow 只根据正式事实计算 `stage`、`nextAction` 和允许能力。
2. Operation registry 是输入、审批分类、计划、报价、提交和输出契约的唯一来源。
3. Approval 必须绑定具体 OperationPlan；过渡期的 `confirmed` 只能来自真实用户确认，不能由内部执行器写死。
4. Task 是异步工作的权威事实；提交、重试、恢复、取消和终态只有一个状态机入口。
5. 资源、计费、Task 终态、TaskEvent、Wait 与 outbox 形成可恢复的原子交接。
6. Assistant continuation 由持久任务驱动，不由浏览器或进程内 Promise 链承担正确性。
7. Session State、SSE 和 Canvas 只投影带版本的权威状态，不从消息、文案、DOM 或 operationId 特判推断生命周期。

## 2. 已接受的审计修订

### 2.1 P0 收费确认断链采用两步迁移

不能让当前用户可见故障等待完整 ApprovalGrant 基建，也不能用硬编码 `confirmed: true` 热修。

第一步是类型化接通现有真实确认：

- 收费 Operation 的过渡输入必须在已确认调用分支中显式携带 `confirmed` 和计划报价信息。
- route、client、service 和 Task submitter 共用同一确认输入类型或 normalizer。
- `generate_edit_script_assets` 必须补齐 `plan → quote → commit`，不得继续由 service 内部临时规划收费 Task。
- 未确认、计划变化、重复提交、确认字段丢失必须有正负向集成测试。

第二步用 `ApprovalGrant` 替换布尔：

- Grant 至少绑定 user、project、episode、operationId、标准化输入指纹、计划指纹、报价上限、过期时间、消费状态和 requestId。
- Task 最终门禁验证 Grant 与当前计划一致且仅消费一次。
- API、Assistant tool 和 GUI 统一经过同一个 Operation invoke pipeline。
- 布尔确认旧入口在 Grant 全量切换后一次性删除，不长期双轨。

### 2.2 Assistant continuation 复用异步基础设施，但不预设为普通 Task

不新造独立 scheduler、job table 状态机或 retry policy。continuation 的持久权威是 Task terminal transaction 写出的 outbox command；BullMQ 优先复用为运输、worker lease、retry、dedupe 和 reconcile 基础设施，而不是终态权威。

是否把 continuation 暴露成正式 Task type，必须在 Task 单一 reconciler 和 terminal outbox 稳定后通过设计与 conformance 证明，不能提前决定。优先形态为：

`Task terminal transaction → AssistantContinuation outbox command → BullMQ transport → 唯一 continuation worker → CAS 消费 command → 统一 Assistant Run command`。

必须满足以下边界：

- continuation command 只消费已 resolved 的 Wait，并通过 `waitId + sourceRunId + continuationVersion` 幂等关联 source run、wait 和 continuation run。
- continuation 不进入媒体计费、Canvas target，也不得在完成后再次递归产生 task-terminal follow-up。
- 浏览器只读 continuation 状态，不再 claim 或执行。
- 进程内 `scheduledFollowUpChain` 删除。
- 如果最终证明适合作为正式 Task type，必须有独立 definition、queue routing、retry policy、payload schema、非计费声明与 registry conformance；不能落入 text queue 默认分支。
- 若现有异步基建不能表达 continuation 所需不变量，先补全共享边界，不允许在 Assistant 下新建私有队列状态机。

### 2.3 终态原子交接使用事务与 outbox

成功路径的目标顺序为：

1. provider/handler 在事务外完成不可回滚的外部工作。
2. 在同一 MySQL 事务内持久化正式业务资源、账务结算/回滚结果、Task 终态、terminal TaskEvent、Wait resolution 和 outbox。
3. 提交事务。
4. 事务外确认 BullMQ job。
5. outbox dispatcher 幂等投递 SSE、Assistant continuation 和 cache invalidation。

实施前必须测量事务内资源 DTO 读取的体量与锁时间。大 episode 不得把昂贵聚合或外部调用放进事务；可在事务前准备确定性数据，在事务内做版本校验和最终写入。

必须增加以下故障注入：资源写入前后、账务写入前后、Task terminal 前后、outbox 写入前后、事务 commit 后/BullMQ ack 前、Redis 投递前后、continuation 启动前后。

### 2.4 Run 状态机只使用现有真实状态集

当前状态集为：

- `running`
- `awaiting_choice`
- `awaiting_approval`
- `awaiting_task`
- `completed`
- `failed`
- `cancelled`

不为了对称新增 `queued`。每次转换必须校验合法前驱、run version/event sequence、requestId 和 terminal watermark。`completed`、`failed`、`cancelled` 不允许被旧事件反写。

control 必须先原子消费 interruption/wait，成功后才迁移 Run。心跳续锁失败不能忽略：失去锁所有权的 Run 必须停止模型流和后续写入，并进入明确的取消或失锁终态处理。

### 2.5 SSE 空窗按事件可恢复性治理

- 持久 lifecycle 事件可由 replay 追回，但仍需修复 bootstrap 与 subscribe 之间的水位协议，尤其是 cursor=0。
- 非持久 stream 增量无法靠当前 replay 完整恢复，是更高的实际风险；刷新后应以版本化正式 snapshot 重建，而不是拼接缺失 stream。
- `processedEventIdsRef` 必须改为最高连续 cursor 加有限乱序窗口，不能无限增长。

### 2.6 三个防遗漏项

- Choice 续跑中 operation 执行失败不得计入“已执行”并导致伪完成；纳入 Run settlement 状态机。
- `session-state GET` 不得承担 stale Run 取消写入；stale reconciliation 迁到唯一后台 reconciler。
- `processedEventIdsRef` 内存治理纳入 SSE 水位协议。

## 3. 明确不采用的方案

- 不通过新增局部 `if`、默认值、自动 fallback 或更长定时器治理。
- 不把 `confirmed: true` 写入内部 executor、service 或恢复路径。
- 不简单把 materialization/settlement 移到 Task completed 之后。
- 不新建第二套 Assistant continuation scheduler、job table 状态机或 retry policy。
- 不同时保留布尔确认和 ApprovalGrant 的长期双轨。
- 不让浏览器、历史消息或 Canvas renderer 成为业务生命周期写入者。
- 不因 Redis 不可用把 BullMQ job 判定为 missing。

## 4. 阶段 0：移除未闭合的 PlanRun 可执行面

### 目标

删除 PlanRun 的生产 runtime、公开 API、Operation registry 接线、Assistant/project context 投影和仅服务于该 runtime 的测试，防止未来误接线形成审批绕过和第二状态机。

### 本阶段删除

- `src/lib/plan-run-runtime/**`
- `src/app/api/plan-runs/**`
- PlanRun Operation definitions 与 registry wiring
- Project context、projection、phase 中的 PlanRun 读取
- 对应 route catalog 和仅验证 PlanRun runtime 的测试

### 本阶段不删除

- Prisma PlanRun/PlanStepRun/PlanRunEvent/PlanArtifact 模型
- 已应用或历史 migration
- 现有数据库记录

数据库结构删除属于独立高风险迁移，需要单独确认、数据保留策略和 rollback 方案。运行时代码删除后，遗留表只读且不再有生产入口。

### 验收

- 全仓无生产源码引用 `plan-run-runtime`、`create_plan_run`、`cancel_plan_run`、`retry_plan_step`。
- `/api/plan-runs/**` 不再进入 route catalog。
- Operation registry 测试证明 PlanRun operations 不存在。
- `no-plan-run-runtime` guard 进入 `test:guards`，阻止生产 runtime、API、operation 和 context marker 回流。
- typecheck、相关 unit/contract、guards 和 build:verify 通过。

## 5. 阶段 1：止血当前 P0

### 1A. 收费确认接通

权威入口：Operation plan/commit 与 Task submitter。

删除：route/client/service 手抄确认字段、无计划收费提交入口。

验证：每条 billable GUI/Assistant/API 链路的未确认拒绝、真实确认成功、计划变化拒绝、重复消费拒绝。

### 1B. Run 单调状态机

权威入口：ProjectAgentEvent reducer 中的共享 Run transition function。

删除：control 先写 running、任意状态 updateMany、失锁后继续写入、Choice 失败计为已执行。

验证：终态反写、重复 control、多标签页、晚到 stream、stale cancel 与 finish 竞争、失锁自我中止。

### 1C. VIDEO_GROUP 最终失败唯一写入者

权威入口：统一 worker final-failure → target-failure projector。

删除：`video.worker` attempt catch 的 `ProjectVideoGroup.failed` 直写和吞错。

验证：attempt 1 失败、attempt 2 成功期间 target 始终保持 generating，最终只写一次 completed。

### 1D. Task reconciler 与 Redis 四态

权威入口：单一 Task reconciler + durable TaskJobEnvelope。

删除：独立 watchdog Task 写入、startup 全量 processing→queued、重复 job data reconstruction、已删除 `maxAttempts` 语义。

Bull job observation 必须是 `alive | terminal | absent | unavailable`；只有明确 absent 才能做孤儿补偿。

验证：Redis timeout/disconnect 不创建第二 Task、不释放 dedupe、不回滚 billing；收费任务恢复保留完整 operation/billing metadata。

### 串并行约束

- 1A、1B、1C 可以由不同 owner 并行，因为分别拥有 Operation/Run/Video target 边界。
- 1D 与阶段 2 的 Task terminal/outbox 不能同时修改 Task service/reconcile/publisher；必须先完成 1D 或明确锁定接口后再进入阶段 2。
- 所有分支合并前由主审查者重新枚举写入者数量，禁止两个 agent 各自增加新入口。

## 6. 阶段 2：消除 Choice、Wait、Workflow 与 UI 多轨

### Choice

- 只持久化 immutable decision。
- 删除 Choice result handler 中的 project ratio、Bible、asset 等跨域写入。
- Workflow 根据 decision 产生正式 nextAction；副作用由 Operation 执行。

### Wait 状态准备

- claim 只作为租约协调；业务状态通过事件状态机推进。
- 为 continuation 定义 durable command identity 与失败、重试、耗尽、取消边沿，但本阶段不在 terminal outbox 落地前切换执行器。
- 现有浏览器 executor 和服务端 Promise chain 只在阶段 3 的 durable continuation 上线后同一变更删除，禁止先加第三入口。

### Workflow 与 Operation

- 删除第二套 `resolveEditFirstWorkflowCapabilityOperationIds` switch，prompt/tool/UI 读取同一 `allowedOperationIds`。
- 删除 `edit-first-operation-policy` 审批第二表，registry 成为唯一来源。
- Choice type、UI card、focus 和 runtime target 从 registry/definition 派生，删除 operationId 特判。

### UI/Session State

- 删除历史 message 状态 fallback。
- `session-state GET` 变成纯读。
- Canvas 删除 `__running` 和业务 status 预合并，只向纯 resolver 传事实快照。

## 7. 阶段 3：原子终态、唯一 continuation、取消语义和 ApprovalGrant

- 落地 Task terminal transaction/outbox 与 BullMQ ack 边界。
- 在 terminal outbox 稳定后接入唯一 continuation worker，并在同一变更删除浏览器 executor 与 `scheduledFollowUpChain`。
- 所有 terminal event 持久化；progress/stream 可按策略压缩或只实时传输。
- `canceled` 成为 Task、Event、Wait、Assistant、Canvas 的正式共享状态，不再映射为 failed。
- Run final message、Activity final event 与 Run terminal 进入 settlement 协议。
- 所有 `billable_media` Operation 强制 plan/quote/grant/commit；以 registry validation 和类型穷尽强制。
- Billing freeze/settle/rollback 使用显式结果类型，数据库异常不得伪装成余额不足；补 durable compensation reconciliation 与告警。

## 8. 阶段 4：注册式扩展和防线升级

- ChoiceDefinition registry。
- TaskDefinition registry，派生 queue、worker、retry、billing、target projector、materializer、presentation 和 conformance。
- Operation definition 派生 confirmation、planner、commit、UI card、focus policy 和 runtime target。
- Regex guard 优先升级为类型穷尽、registry validation 或 AST guard。
- `modules.json` 扩大 Assistant source/test/guard 覆盖到 routes、workflow、UI、Wait follow-up、SSE 和 Canvas integration。
- Guard 可达性检查必须证明每个 `guardPath` 被 CI 必跑命令引用。
- 行为质量 guard 覆盖 `tests/unit`，并验证新增测试实际被 runner 收集。

## 9. 阶段 5：删除体验性补丁

只有版本化事件、持久 continuation 和原子 settlement 已验证后，才能删除：

- 1.5 秒 session-state 正确性轮询
- thread catch-up 定时级联
- operationId/message fallback
- 依赖 TTL 的终态接力
- 非持久 terminal event
- 旧的 UI local lifecycle merge

refetch、轮询和 timer 可以保留为一致性校验或体验优化，但删除它们后不得暴露正确性空窗。

## 10. 每个工作项的完成定义

每个工作项必须在交付中回答：

1. 权威事实和唯一写入入口是什么？
2. 删除了哪些旧入口？
3. 写入者数量从多少降到多少？
4. 状态来源是否减少，是否仍存在双轨？
5. 正常、失败、取消、重试、重复、乱序、刷新和恢复中的适用边沿是否覆盖？
6. 新测试挂载到哪个必跑命令，runner 实际收集了多少文件/用例？
7. 哪个 guard 或类型约束保证旧旁路不能重新引入？
8. 对应架构模块文档、`modules.json`、共享类型、运行入口、测试和 guard 是否同步闭环？

未能回答任一项，不得宣称该架构工作完成。

## 11. 多 agent 执行规则

- 同一权威状态机同一时间只能有一个实现 owner。
- 其他 agent 可以并行负责只读证据、测试、guard、外围调用迁移，但不能同时修改同一核心文件。
- 每个 agent 开始前运行对应 architecture impact 并阅读必读模块文档。
- 子任务必须声明允许修改和禁止修改的文件边界。
- 主审查者负责全仓 `rg` 写入者复核、冲突检查、完整验证和最终提交。
- 并行化用于缩短独立工作流，不得以复制状态机、兼容层或临时 fallback 换速度。

## 12. P0 测试与 guard 挂载地图

新增测试文件不等于防线生效。下列每个工作包都必须同时进入对应必跑 suite：

| 工作包 | 必须覆盖的真实组合路径 | 必跑测试层 | 必须新增或补强的防线 |
|---|---|---|---|
| 收费确认接通 | GUI/API/Assistant → plan → operation → Task DB → billing freeze | unit、API integration、billing integration、system、regression | billable operation confirmation conformance；禁止未绑定确认与直接普通 `submitTask` |
| Run 单调状态机 | control consume、event reducer、DB status/version、双标签与失锁晚到写 | unit、API integration、system、regression | Run transition 穷尽 contract；Run status 单一写入者 guard；GET session-state 纯读 guard |
| VIDEO_GROUP retry | attempt 1 transient fail → queued → attempt 2 success/final fail → target projector | worker unit、task integration、system、regression | 禁止 worker attempt handler 直接写 target terminal |
| Task reconciler/JobEnvelope | startup、lease、Redis observation、恢复入队、billing/operation/trace 保留 | unit、task integration、system、regression | 单一 reconciler guard；TaskJobEnvelope conformance；scripts 独立 typecheck |
| Task terminal/outbox | resource、billing、Task、TaskEvent、Wait、outbox、Redis、BullMQ ack | task integration、billing integration、system、regression | terminal single-commit guard；terminal event 持久化 guard；outbox 幂等 conformance |
| Redis 四态 | alive、terminal、absent、unavailable 与 dedupe/P2002 路径 | unit、task integration、regression | observation 穷尽 union；禁止 queue error 映射 missing/absent |
| SSE/资源版本 | cursor=0、bootstrap gap、stream 缺失/乱序、旧 resourceVersion、多标签恢复 | unit、API integration、regression | snapshot/watermark contract；cache version guard；有界 event dedupe |

`tests/contracts/**` 当前不会被默认全量收集；新增 contract 必须有明确 package script，并加入 `test:guards`。`changed-file-test-impact` 对 `src/lib/task/**` 的测试映射还未把 `tests/integration/task/**` 作为充分证据，阶段 1D 必须同步修正该 guard，避免高价值 integration test 仍被视为“没有测试”。

## 13. 当前执行账本

### 阶段 0 — PlanRun 可执行面退役

- 状态：已完成，等待本次 commit/push。
- 权威入口变化：PlanRun runtime、5 个 API route、6 个 Operation、Project Context/Projection/Assistant phase 读取入口全部删除；生产入口由大于零降为零。
- 删除规模：32 个相关文件发生删除或收敛，净删除约 2250 行。
- 保留范围：Prisma 模型、历史 migration 和现有数据库数据未修改。
- 防回流：Operation registry 负向断言；`no-plan-run-runtime` guard 已登记 Assistant 模块并加入 `test:guards`。
- 验证：全量 unit 347 files / 1451 tests；guards 通过；typecheck 通过；`build:verify` 通过；route 构建产物中已无 `/api/plan-runs/**`。
- 未完成的独立高风险项：统计遗留 PlanRun 表数据、制定保留/导出/drop migration 与 rollback；没有新的明确授权前不执行。
