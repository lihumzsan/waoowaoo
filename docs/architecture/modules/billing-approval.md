<!-- architecture-module: billing-approval -->

# 计费与审批

## 设计理念

确认不是“调用了 AI 就询问用户”的通用开关。只有执行前可以确定具体媒体输入与价格的收费媒体，才需要媒体报价确认。LLM 文本规划默认无需媒体确认；删除或不可逆覆盖属于破坏性确认，不伪装成媒体报价。

收费媒体的正确顺序是：先生成最终计划，再准确报价，再由用户批准，最后只提交同一计划中的任务。用户批准的是具体工作，不是一个未来可能发生的最大额度。

## 不变量

- **BA-00A — 组审批只展示计费项。** 同一模型 step 的声明式 Operation group 中，只要存在需要审批的计费成员，整组 Tool call 必须共同冻结在一个持久 Approval interruption 中；`approvalItems` 保存全部 SDK call identity，`operationPlan`/quote 只来自真正计费的成员。批准恢复原 serialized RunState 并一次放行全部成员，禁止第二次模型推理、非计费成员提前执行或创建业务专用组合 Operation。

- **BA-01 — 审批分类唯一。** `none`、`billable_media`、`destructive` 是 operation confirmation 的唯一分类；LLM 文本任务必须显式属于 `none`，不是漏配后的默认值。
- **BA-02 — 精确计划先于媒体审批。** `billable_media` 的审批前必须确定真实 Task、目标、模型、输入、数量和准确报价。需要 LLM 先生成媒体 Prompt 的用户可见长流程必须先作为独立文本 Task 完成；媒体 plan 只读其持久结果，不得在 approval preflight 调用 LLM、写领域记录或形成第二生命周期。不得先批准、再让 LLM 或媒体 worker 决定实际收费内容。
- **BA-03 — 批准必须有不可变来源。** 最终收费任务只能携带 `OperationPlanSnapshot → ApprovalGrant → OperationExecution → operationPlanTaskId` provenance；计划 identity、不可变 payload/quote hash、Grant identity 与 CAS `version` 才是授权裁决事实。三个审批表不得重复持久化永远固定、没有 reader 分支的 `contractVersion`。`operationConfirmed` 布尔字段已退役，route、worker、Task payload 和恢复 envelope 都不得重建该布尔轨道。
- **BA-04 — 统一最终门禁。** 未批准的收费媒体不得创建 Task、入队或调用供应商；UI、Agent、route、worker 的任何遗漏都不能绕过提交边界。
- **BA-05 — 免费确认不得隐含媒体授权。** 制作规划等免费 LLM 结果的审核只确认该结果及其业务字段，不得同时授权下一阶段收费媒体。视觉风格方案文本 Task 不授权图片；初次候选图与后续重生成图片都必须独立经过同一个 `plan → quote → approval → commit` operation，UI 必须展示该次图片任务的数量与 credits，用户批准后才可提交。
- **BA-06 — 父子计划不可扩大。** 父操作只能提交其已报价且获批准计划中的子任务；文本任务不得自动派生新的收费子任务。
- **BA-07 — Grant、业务投影与整批责任一次提交。** `invokeApprovedOperationPlan` 持有唯一 Prisma interactive transaction；Grant 消费、OperationExecution、operation-specific 业务写入、MutationBatch、全部 Task、全部额度冻结、Created lifecycle event 与每个 Task 的 durable enqueue responsibility 必须一起 commit 或一起 rollback。BullMQ 入队只消费 commit 后才可见的 `task.enqueue` Outbox，不再使用 `availableAt=9999` 暂存、第二阶段 release 或逐 Task 补偿。
- **BA-08 — 不存在可持久化的中间 Execution。** `committing` 仅存在于尚未提交的事务快照，数据库外只能观察到完整 `completed` execution；进程在任意语句后退出都会由 MySQL 回滚。相同 Grant 的并发/重复调用先锁定 Grant 行，完成后只返回同一持久 output，不另建 lease、attempt、`submitted` 或 `failed` 状态机。
- **BA-09 — 收费 operation 只有 plan/commit 入口。** `billable_media` definition 必须声明 plan 与 commit，且禁止声明 execute；非收费/破坏性 operation 才能声明 direct execute。registry runtime conformance、TypeScript discriminated definition 与 CI guard 共同阻止第二执行入口。
- **BA-10 — 投影只能发生在 commit 之后。** operation commit 期间产生的 Assistant structured parts 先写入 invocation-owned buffer；唯一事务成功后才向原 writer flush，失败/kill 时全部丢弃。commit 内不得直接调用 Redis、provider 或其他不可回滚外部副作用。
- **BA-12 — Channel 不得形成审批旁路。** API 与 Tool 共用 `invokeProjectAgentOperation`；`billable_media` 在任一 channel 都只能消费不可变 ApprovalGrant，direct operation 不得接收或忽略 Grant provenance。`channels` 必须在输入解析和任何业务执行之前强制。
- **BA-11 — Grant 只有一个消费写入者。** `invokeApprovedOperationPlan` 在锁定 Grant、创建 `OperationExecution` 后无条件消费 Grant；零 Task 与有 Task 计划使用同一条边。`approved-plan-submitter` 只验证 Grant 已绑定当前 execution 并创建计划内 Task，不得更新 Grant。通用 Task submitter 不接收 Grant/Execution/planTask 授权参数，任何收费媒体输入必须显式失败并回到批准计划入口。
- **BA-13 — Task runtime 不得启动同步计费。** 普通 Task 与批准 Task 必须通过 `transactional-create.ts` 在 Task/Created event/enqueue Outbox 同一事务内 freeze，Terminal Service 拥有 settle/rollback；不得保留 Task 创建后再授权计费的第二事务。worker 内部调用 `withTextBilling` 等同步包装时只执行 provider 并把 usage 留给外层 Task collector；不得创建第二个 sync freeze/confirm 生命周期，也不得让嵌套 collector 吞掉 Task usage。
- **BA-14 — 一个 Task type 只对应一种成本语义。** 同一 handler 可以复用实现，但文本分析与收费媒体生成必须使用不同 TaskType/Operation identity。`reference_character_description_extract` 属文本直提交流程；`reference_to_character` 属图片 `plan → quote → ApprovalGrant → commit`。payload 布尔值不得在 worker 内把一种 billing policy 变成另一种。
- **BA-15 — 计划预留 identity 必须显式。** plan 阶段创建、commit 阶段才物化且不等于 Task target 的实体 identity，必须由 `OperationPlan.reservedIdentityIds` 穷尽声明。不可变 snapshot、quote 与 Approval payload 共用这份 identity 契约；禁止只把父实体 ID 藏在 operation-specific metadata。任何合法作用域迁移必须显式重写 reserved identity、Task target、payload、metadata 与 dedupe identity 后再计算 hash，未映射 identity 必须失败或生成新 canonical identity，不得复用另一 project/attempt 的预留主键。
- **BA-16 — 零 Task 计划是原子 noop。** `billable_media` 的最终计划允许因全部目标已复用而包含零 Task；Grant、Execution 与 operation-specific plan writes 仍由同一 commit transaction 结算，Task submitter 返回空结果，invocation 投影为 `noop`。零 Task 不得与重复 Task identity 混为无效计划，也不得伪造占位 Task、跳过 plan writes 或建立第二条零 Task commit 分支。
- **BA-17 — 直接 UI 批准只能消费当前展示计划。** Canvas 等直接操作入口可以把用户点击已展示价格的按钮视为批准，但按钮必须持有完整 `OperationPlanView`，Grant 与 execute 必须消费该 View 的同一 `planSnapshotId`；Canvas 按钮正文只展示紧凑的“动作 + 格式化价格”，完整任务数与预计消耗通过同一 quote 的 title/可访问标签提供。禁止预览 plan A、点击后重新 plan B，或用不展示报价的普通按钮提交收费媒体。所有 Canvas 收费 action 只能经过 `CanvasActionButton`，免费规划与非计费合成不得伪装成收费按钮。
- **BA-18 — Episode scope 由计划产物裁决。** planner 必须从经过 project ownership 校验的真实 target 派生每个 PlannedTask 的 `episodeId`；snapshot writer 拒绝同一计划包含多个 episode，并以计划 Task scope 为 canonical episode。execute 只校验 session、project、operation 与可选的显式 scope 限制，commit context 必须从已批准 snapshot 注入 episode；禁止要求客户端在批准后重复提交同一 episode 事实或从 route body 重建 scope。

## 权威入口

- 媒体类型和是否属于收费媒体：`src/lib/billing/media-approval-policy.ts`。
- operation confirmation 分类：`src/lib/operations/types.ts` 和 `src/lib/operations/registry.ts`。
- 不可变计划与 hash：`src/lib/operations/operation-plan-snapshot.ts`。
- Grant 发放、Grant row lock 与单事务 plan invoke：`src/lib/operations/planned-operation-invocation.ts`。
- API/Tool channel 许可：`src/lib/operations/channel-policy.ts`；执行与 plan endpoint 必须在解析业务输入前调用同一 policy。
- API/Tool Operation 调用与审批分流：`src/lib/operations/invocation.ts`。
- Project UI 的唯一收费执行 route：`src/app/api/projects/[projectId]/operations/[operationId]/execute/route.ts`；route 只鉴权并把 immutable Grant provenance 交给统一 invocation，不解释媒体类型或 episode。
- Canvas 收费 action 解析与唯一按钮：`src/features/project-workspace/canvas/hooks/useWorkspaceCanvasBillableAction.ts`、`src/features/project-workspace/canvas/nodes/CanvasActionButton.tsx`；同一个 query result 同时提供可见 quote 与点击授权的 snapshot。
- ApprovalGrant 与充值/支付 route：`src/app/api/operation-approval-grants/**`、`src/app/api/payments/**` 只负责鉴权、参数和调用既有 grant/payment service，不得建立第二审批或账本 writer。
- 批准计划的唯一 Task 创建入口：`src/lib/task/approved-plan-submitter.ts`；它只消费已经由当前 invocation 绑定的 execution context，不拥有 Grant 消费权。
- 非媒体 Task 的统一提交：`src/lib/operations/submit-operation-task.ts` 与 `src/lib/task/submitter.ts`；这两个入口不接受批准 provenance，收费媒体调用在此 fail closed。
- 批准 Task 的 durable enqueue：`src/lib/outbox/types.ts` 的 `task.enqueue` → `src/lib/task/enqueue.ts`。
- TaskType 的 billing policy：`src/lib/task/definition.ts`；`src/lib/billing/task-policy.ts` 只执行 registry 指定的 policy，不维护第二份 TaskType 集合或 switch。
- `standards/pricing/**` 当前是 `scripts/check-pricing-catalog.mjs` 的校验输入，不是生产运行时计费 writer；生产金额由 `src/lib/ai-registry/pricing-*` 与 provider code catalog 解析。修改 standards pricing 必须同时审计运行时 catalog 与 `BUILTIN_PRICING_VERSION`，在双表示收敛前不得仅凭 JSON 变更宣称生产价格已改变。

调用层不得自行维护媒体类型名单、确认布尔值或报价任务的平行集合。

## 验证

- `tests/integration/task/approved-operation-plan-batch*.integration.test.ts` 与 `approval-grant-expiry-replay.integration.test.ts` 使用真实 MySQL 验证 Grant/Execution/业务写入/Task/freeze/outbox 全有或全无、并发重复、过期和持久重放。
- `tests/integration/billing/{ledger,service,submitter,user-transactions,stripe-recharge,invite-codes,api-contract}.integration.test.ts` 与 `tests/concurrency/billing/ledger.concurrency.test.ts` 验证真实账本事务、冻结/确认/回滚和并发一致性。
- `tests/unit/billing/{cost,mode,media-approval-policy,task-policy-base,task-policy-media,transaction-aggregation}.test.ts` 与 `tests/unit/operations/planning.test.ts` 只验证纯金额、policy、quote 和 plan 输入输出。
- `scripts/guards/{single-task-billing-owner-guard,no-hardcoded-operation-confirmed,single-operation-invocation-guard,task-submission-atomicity-guard}.mjs` 阻止第二 billing writer、审批旁路和事务外 Task 创建；结构 guard 不替代真实账本场景。
- `npm run check:pricing-catalog` 只验证 standards pricing 的结构及其 capability tier 字段；它不证明运行时代码 catalog 与 standards 值相同。
## 状态所有权

| 事实                                                           | 唯一所有者 / 写入者                                                                | 消费者                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| 规范化输入、最终 Task 列表与报价                               | `OperationPlanSnapshot` / plan endpoint                                            | Grant issuer、Execution、审计                 |
| 用户对该计划的授权与单次消费                                   | `ApprovalGrant` / `issueApprovalGrant` 发放、`invokeApprovedOperationPlan` 唯一消费 | 原子批次提交入口                              |
| 一次幂等执行与原子 output                                      | `OperationExecution` / `invokeApprovedOperationPlan`                               | 重复调用、审计                                |
| operation 业务投影、MutationBatch、计划内 Task、冻结与入队责任 | `invokeApprovedOperationPlan` 的同一 transaction；各 commit 只使用授权 transaction | Outbox dispatcher、Task worker、UI projection |
| BullMQ job                                                     | `task.enqueue` Outbox consumer                                                     | worker；不得解释审批或报价                    |

写入者变化：删除 Task/Job 的 `operationConfirmed`、收费 operation 的 direct execute、OperationExecution lease/attempt/submitted release 状态机和 operation-specific 事务外补偿。Grant 消费写入者从 `invokeApprovedOperationPlan` 的零 Task 分支与 `approved-plan-submitter` 的有 Task 分支两个收敛为前者一个；删除通用 submitter 的 `assertTaskApprovalAuthorization` 旁路。Task enqueue 从 HTTP commit 的即时外部副作用改为同事务持久 Outbox responsibility。

## 历史回归

- Soundscape 曾使用“最多 12 个音源”的上限授权：审批时真实音效 Prompt、数量和最终 Task 尚未确定。这类测试即使通过，也是在固化错误策略。
- `d8a1685dc` 收敛了 edit-first 的审批与任务生命周期契约，说明确认语义不能分散在 UI、operation 和 worker 中。
- 制作规划确认曾在 `bible_review` 副作用中直接提交视觉风格任务：后端虽持有报价，UI 未清楚展示 credits，且 Task 未绑定 Agent Wait。免费结果确认与收费媒体授权必须保持两个显式边沿。
- 视觉风格媒体 plan 曾为了得到精确图片 Prompt 而在 approval preflight 同步调用 LLM 并创建候选记录；虽然图片报价准确，却让 plan 成为第二个长任务执行器和领域 writer。现由普通文本 Task 先持久化方案，图片 plan 只读该 Task 的成功结果。
- Canvas 曾为按钮价格预取 plan A，点击 mutation 又创建 plan B 并自动签发 Grant；分镜图片和单镜头视频的专用 route 还遗漏 episode context，导致合法 Grant 被 scope mismatch 拒绝，视频详情普通按钮则完全不展示价格。旧 unit/conformance 只覆盖 plan、Grant 或节点结构，没有走通直接 UI 的“可见 quote → 同 snapshot Grant → commit”。现删除媒体专用提交 route 和各自 mutation，Canvas 只持有一个 plan handle，snapshot 从真实 Task target 取得 canonical episode，通用 execute 不再重新解释 scope。

## 修改检查表

1. 该 operation 是 `none`、`billable_media` 还是 `destructive`？理由是什么？
2. 若收费媒体，审批时最终输入和价格是否已经确定？
3. 是否复用统一 snapshot、Grant、Execution、计划级批次与 Outbox enqueue，而非新增局部确认逻辑？
4. 是否新增“未批准、计划变化、重复提交、父子任务扩大”的负向测试？
