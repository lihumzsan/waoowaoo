<!-- architecture-module: billing-approval -->

# 计费与审批

## 设计理念

确认不是“调用了 AI 就询问用户”的通用开关。只有执行前可以确定具体媒体输入与价格的收费媒体，才需要媒体报价确认。LLM 文本规划默认无需媒体确认；删除或不可逆覆盖属于破坏性确认，不伪装成媒体报价。

收费媒体的正确顺序是：先生成最终计划，再准确报价，再授权，最后只提交同一计划中的任务。用户设置可以决定由报价卡显式批准，或由系统自动授权这一次精确报价；两者都不构成未来预算、Run grant 或模糊的“跳过计费”能力。

## 不变量

- **BA-00A — 一个模型步骤至多对应一次交互收费决定，每个 Tool call 保持精确授权。** Runtime 可以接收同一步骤的多个收费调用，包括同一个 Operation 的多个调用。开启计费确认时，持久 Approval 必须保存完整 member 列表，每个成员包含自己的 SDK `approvalId/toolCallId`、operation identity、不可变 plan/quote 与同一 serialized RunState；UI 把成员 quote 合计为一张卡，用户只批准或拒绝一次。关闭计费确认时不创建 Approval Interruption，每个 Tool call 仍先持久化独立 plan/quote 并签发精确 Grant，然后进入同一个执行与扣费入口。两种模式都不是 Workflow group、Run 预算或未来授权，也不得合并成员的执行 identity。

- **BA-01 — 审批分类唯一。** `none`、`billable_media`、`destructive` 是 operation confirmation 的唯一分类；LLM 文本任务必须显式属于 `none`，不是漏配后的默认值。
- **BA-02 — 精确计划先于媒体审批。** `billable_media` 的审批前必须确定真实 Task、目标、模型、输入、数量和准确报价。需要 LLM 先生成媒体 Prompt 的用户可见长流程必须先作为独立文本 Task 完成；媒体 plan 只读其持久结果，不得在 approval preflight 调用 LLM、写领域记录或形成第二生命周期。不得先批准、再让 LLM 或媒体 worker 决定实际收费内容。
- **BA-03 — 批准必须有不可变来源。** 最终收费任务只能携带 `OperationPlanSnapshot → ApprovalGrant → OperationExecution → operationPlanTaskId` provenance；计划 identity、不可变 payload/quote hash、Snapshot 唯一 `executionContractRevision`、Grant identity 与 CAS `version` 才是授权裁决事实。该 revision 必须来自生产 Operation registry 的 `planContractRevision`，只在 Snapshot 保存一次，并且真实选择审批后的 planner/commit 协议；Grant 与 Execution 禁止复制。三个审批表仍不得重复持久化永远固定、没有 reader 分支的 `contractVersion`。`operationConfirmed` 布尔字段已退役，route、worker、Task payload 和恢复 envelope 都不得重建该布尔轨道。
- **BA-04 — 统一最终门禁。** 未批准的收费媒体不得创建 Task、入队或调用供应商；UI、Agent、route、worker 的任何遗漏都不能绕过提交边界。
- **BA-05 — Choice 不得隐含媒体授权。** 通用 Choice 只解决当前决定；即使 Offer 带有原子 commitment，也只允许 registry 明示的非收费、事务型单一 Operation。Creative Direction 的创建或采用不授权预览图，剧本/Story Canon/Chapter 决定不授权任何下游媒体。每次收费图片、音频或视频都必须独立经过自己的 `plan → quote → approval → commit`。
- **BA-06 — 父子计划不可扩大。** 父操作只能提交其已报价且获批准计划中的子任务；文本任务不得自动派生新的收费子任务。
- **BA-07 — Grant、业务投影与整批责任一次提交。** `invokeApprovedOperationPlan` 持有唯一 Prisma interactive transaction；Grant 消费、OperationExecution、operation-specific 业务写入、全部 Task、全部额度冻结、Created lifecycle event 与每个 Task 的 durable enqueue responsibility 必须一起 commit 或一起 rollback。BullMQ 入队只消费 commit 后才可见的 `task.enqueue` Outbox，不再使用 `availableAt=9999` 暂存、第二阶段 release 或逐 Task 补偿。
- **BA-08 — 不存在可持久化的中间 Execution。** `committing` 仅存在于尚未提交的事务快照，数据库外只能观察到完整 `completed` execution；进程在任意语句后退出都会由 MySQL 回滚。相同 Grant 的并发/重复调用先锁定 Grant 行，完成后只返回同一持久 output，不另建 lease、attempt、`submitted` 或 `failed` 状态机。
- **BA-09 — 收费 operation 只有 plan/commit 入口。** `billable_media` definition 必须声明 plan 与 commit，且禁止声明 execute；非收费/破坏性 operation 才能声明 direct execute。registry runtime conformance、TypeScript discriminated definition 与 CI guard 共同阻止第二执行入口。
- **BA-10 — 投影只能发生在 commit 之后。** operation commit 期间产生的 Assistant structured parts 先写入 invocation-owned buffer；唯一事务成功后才向原 writer flush，失败/kill 时全部丢弃。commit 内不得直接调用 Redis、provider 或其他不可回滚外部副作用。
- **BA-12 — Channel 不得形成审批旁路。** API 与 Tool 共用 `invokeProjectAgentOperation`；`billable_media` 在任一 channel 都只能消费不可变 ApprovalGrant，direct operation 不得接收或忽略 Grant provenance。`channels` 必须在输入解析和任何业务执行之前强制。
- **BA-11 — Grant 只有一个消费写入者。** `invokeApprovedOperationPlan` 在锁定 Grant、创建 `OperationExecution` 后无条件消费 Grant；零 Task 与有 Task 计划使用同一条边。`approved-plan-submitter` 只验证 Grant 已绑定当前 execution 并创建计划内 Task，不得更新 Grant。通用 Task submitter 不接收 Grant/Execution/planTask 授权参数，任何收费媒体输入必须显式失败并回到批准计划入口。
- **BA-13 — Task runtime 不得启动同步计费。** 普通 Task 与批准 Task 必须通过 `transactional-create.ts` 在 Task/Created event/enqueue Outbox 同一事务内 freeze，Terminal Service 拥有 settle/rollback；不得保留 Task 创建后再授权计费的第二事务。worker 内部调用 `withTextBilling` 等同步包装时只执行 provider 并把 usage 留给外层 Task collector；不得创建第二个 sync freeze/confirm 生命周期，也不得让嵌套 collector 吞掉 Task usage。
- **BA-14 — 一个 Task type 只对应一种成本语义。** 同一 handler 可以复用实现，但文本分析与收费媒体生成必须使用不同 TaskType/Operation identity。`reference_character_description_extract` 属文本直提交流程；`reference_to_character` 属图片 `plan → quote → ApprovalGrant → commit`。payload 布尔值不得在 worker 内把一种 billing policy 变成另一种。
- **BA-15 — 计划预留 identity 必须显式。** plan 阶段创建、commit 阶段才物化且不等于 Task target 的实体 identity，必须由 `OperationPlan.reservedIdentityIds` 穷尽声明。不可变 snapshot、quote 与 Approval payload 共用这份 identity 契约；禁止只把父实体 ID 藏在 operation-specific metadata。任何合法作用域迁移必须显式重写 reserved identity、Task target、payload、metadata 与 dedupe identity 后再计算 hash，未映射 identity 必须失败或生成新 canonical identity，不得复用另一 project/attempt 的预留主键。
- **BA-16 — 零新 Task 计划仍走原子 commit。** `billable_media` 的最终计划允许因全部目标已复用而包含零个待提交 Task；Grant、Execution 与 operation-specific plan writes 仍由同一 commit transaction 结算，Task submitter 返回空结果。没有 active dependency 时 invocation 投影为 `noop`；存在 `taskDependencies` 时 Assistant 投影为对既有 Task 的同一 durable Wait。零新 Task 不得与重复 Task identity 混为无效计划，也不得伪造占位 Task、跳过 plan writes 或建立第二条 commit 分支。
- **BA-17 — 直接 UI 批准只能消费当前展示计划。** 任何直接媒体操作入口若把用户点击视为批准，控件必须持有完整 `OperationPlanView`，Grant 与 execute 消费同一 `planSnapshotId`；禁止预览 plan A、点击后重新 plan B，或用未展示报价的普通按钮提交收费媒体。当前 Canvas 只展示 Resource/Task，没有专用收费 action。
- **BA-18 — Episode scope 由计划产物裁决，Resource scope 由动作显式携带。** planner 必须从经过 ownership 校验的 CreativeResource target 与输入 Resource ID 派生每个 PlannedTask 的 `episodeId`；snapshot writer 拒绝混合 episode。registry 在 planner 前回库解析每个 Resource ID，并拒绝缺失 scope、非法 schema 或跨 project 输入，禁止通过默认 Chapter、数组位置或最近记录推断。
- **BA-19 — 计划只因契约或内容变化失效。** `OperationPlanSnapshot` 与 `ApprovalGrant` 不得使用 TTL、`expiresAt`、timer 或轮询决定有效性。未消费 Grant 的唯一最终校验先比较 Snapshot 的 `executionContractRevision` 与当前 registry definition；不一致时禁止再次调用旧/新 planner 解释同一输入，并在 Grant 锁事务撤销授权。revision 一致时才重新调用当前纯 `plan` 与统一 quote，比较 `inputHash`、`planHash`、`quoteHash`；完全一致才消费 Grant，任一变化都不得创建 Execution、Task、冻结或 Outbox。已完成 Execution 的幂等重放直接返回同一持久 output，不受后续契约或计划变化影响。planner 必须对相同事实确定性输出；随机预留 identity、时间戳或调用顺序不得进入计划 Hash。
- **BA-20 — 聚合 Approval 不合并执行身份。** 一张 Assistant Approval 卡可以表示同一模型步骤的多个收费成员并合计 quote，但每个成员仍拥有独立的 `toolCallId + OperationPlanSnapshot → ApprovalGrant → OperationExecution` 链。`issueApprovalGrantGroup` 只把“全部成员可授权或全部不授权”放进一个事务，任一 snapshot/owner/identity 错误必须整组回滚；恢复时不得用 operationId、首成员 plan 或聚合 quote 代替成员 Grant。成员 Task 可进入同一个 OperationBatch Wait，但各自 commit、冻结、Execution 与幂等重放保持独立。
- **BA-21 — 计划必须在批准前证明 Task 资源作用域结构完整。** quote 与不可变 snapshot 写入都必须从 `TaskDefinition.terminalResourceImpact` 穷尽解析每个 PlannedTask 的必需 project/episode scope；最终 Task 提交还必须在写入前验证 episode 真实属于该 project。禁止让缺失必需 scope 的计划先获得报价或 Grant，也禁止让越权 scope 写入任何 Task。Operation planner、snapshot writer 和 Task submitter 必须复用同一个 resolver，不得各自维护 TaskType 或资源名单。
- **BA-22 — 已运行 Task 是不可变计划依赖，不是待提交 Task。** planner 发现同 canonical target、同输入签名的 active Task 时，必须把其完整 identity、TaskType、target 与 episode 冻结为 `OperationPlan.taskDependencies`，并从报价与新 Task 列表中排除。snapshot writer 在批准前校验该 Task 仍 active 且属于同一 user/project/episode/type/target；变化则使计划失效并重新报价。批准 commit 不得重新提交或重复收费 dependency；Assistant 只能把它与本 Tool member 的新 Task 原子加入当前 OperationBatch Wait。同签名 completed target 直接跳过，active target 输入签名冲突必须显式失败，禁止覆盖运行中的生成。
- **BA-23 — 失败重试重新报价，不继承授权。** Agent 可以根据 Task terminal 的失败 refs 显式调用同一或其他收费 Operation，但每次调用都必须重新构造当前 exact plan/quote，并按当前用户设置重新取得显式 Approval 或这一次精确报价的自动 Grant。失败 Task、旧 Grant、同一 Run 或用户先前的批准均不构成预算授权；系统不得在没有新 Tool call 时静默重提收费工作。
- **BA-23A — 等价 Provider 路由不产生第二次计费。** Provider Gateway 只有在生产 registry 证明 route set 成员使用同一产品 capability、同一 canonical options 与同一冻结价格时，才可在 typed pre-accept rejection 后推进路由。推进继续消费原 `OperationPlanSnapshot → ApprovalGrant → OperationExecution → Task`，不得重新报价、重新申请 Approval、再次冻结 credits 或创建第二 Execution；任何价格不等价必须在 registry 构造时 fail closed，而不是运行时补差价。
- **BA-24 — 外部支付终态必须进入同一账本。** Stripe Checkout 充值以 `payment_intent` 作为 canonical external identity，并把 credits、最小货币单位金额与币种冻结在充值流水；refund 以及 `charge.dispute.funds_withdrawn` 只能由已验签 webhook 通过 ledger 的唯一 adjustment writer 按精确比例扣回。退款失败或 `charge.dispute.funds_reinstated` 只恢复此前同一 Stripe object 的实际 debit；`dispute.created/closed` 不解释资金事实。事件乱序、重复、跨币种、超额或找不到原充值必须 fail closed，禁止按用户最近充值猜测。
- **BA-25 — Stripe SDK 只拥有外部协议，不拥有账本事实。** Checkout Session HTTP、参数编码、响应类型、Webhook HMAC 与 Event union 必须由官方 `stripe` SDK 处理；Checkout client 必须关闭 SDK 网络重试并固定 `apiVersion`，Webhook 必须从 route 提供的受限 raw body 一次性 `constructEvent`，禁止 SDK 验签后再手写 JSON parser。项目继续唯一拥有 recharge quote、metadata policy、`payment_intent` identity、refund/dispute 解释、幂等键和 ledger transaction；SDK Event 不得直接写余额或建立第二 writer。Webhook route 必须以显式 code→status 映射回应 Stripe 重投递契约：验签失败与不可变事实违规返回 4xx 终止重投，本地事实缺失与基础设施失败返回 5xx 保持重投，禁止由通用错误归一化的消息子串猜测状态码；响应体不携带账本细节。
- **BA-26 — Voice Design 按冻结字符数计费。** `CREATIVE_RESOURCE_VOICE` 只能使用 `apiType=voice + unit=character`；`generate_voice.request.kind=characters` 的一个 Plan 可以包含多个独立 Voice Task，quote 必须逐 Task 从各自冻结的 `previewText` 以 Unicode code point 数计算 quantity，再由通用计划报价汇总为一次批准金额。FAL Qwen Voice Design 1.7B 的 production pricing catalog 以每字符 credits 声明 `$0.09 / 1000 characters` 的换算价。每个 Task 终态只可用同一 payload 返回的 `actualCharacters` 独立结算，不能按音频时长、字节数、Agent 估算或 provider 文案重算；部分失败只回滚失败成员的冻结，成功成员正常结算。

## 权威入口

- 媒体类型和是否属于收费媒体：`src/lib/billing/media-approval-policy.ts`。
- operation confirmation 分类：`src/lib/operations/types.ts` 和 `src/lib/operations/registry.ts`。
- 不可变计划、执行契约 revision 与 hash：`src/lib/operations/operation-plan-snapshot.ts`；revision 的生产声明由同一个 Operation registry definition 的 `planContractRevision` 提供。
- Grant 发放、聚合 Approval 的全有或全无 `issueApprovalGrantGroup`、registry 驱动的当前计划重验证、Grant row lock 与单事务 plan invoke：`src/lib/operations/planned-operation-invocation.ts`。
- Assistant 计费确认设置的唯一持久事实是 `UserPreference.assistantBillingConfirmationRequired`；UI 只通过既有 `/api/user-preference` Operation writer 更新，runtime 只通过 `src/lib/project-agent/billing-confirmation.ts` 读取。自动模式仍由 `approval-preflight.ts` 创建不可变 snapshot 并通过既有 Grant issuer 授权，不得建立第二种扣费凭证。
- API/Tool channel 许可：`src/lib/operations/channel-policy.ts`；执行与 plan endpoint 必须在解析业务输入前调用同一 policy。
- API/Tool Operation 调用与审批分流：`src/lib/operations/invocation.ts`。
- Project UI 的唯一收费执行 route：`src/app/api/projects/[projectId]/operations/[operationId]/execute/route.ts`；route 只鉴权并把 immutable Grant provenance 交给统一 invocation，不解释媒体类型或 episode。
- Assistant 收费卡片与审批 transport：`src/features/project-workspace/components/workspace-assistant/billing-action-items.ts` 及 Project Agent approval 协议；可见 quote 与点击授权必须来自同一 snapshot。
- ApprovalGrant 与充值/支付 route：`src/app/api/operation-approval-grants/**`、`src/app/api/payments/**` 只负责鉴权、参数和调用既有 grant/payment service，不得建立第二审批或账本 writer。
- Stripe 外部协议入口：`src/lib/payments/stripe-client.ts` 创建关闭网络重试的官方 client，`src/lib/payments/stripe-checkout.ts` 创建 Checkout Session，`src/lib/payments/stripe-webhook.ts` 只从官方 `constructEvent` 解释已验签外部事实；余额变更全部调用 `src/lib/billing/ledger.ts` 的 recharge/adjustment transaction writer。
- 批准计划的唯一 Task 创建入口：`src/lib/task/approved-plan-submitter.ts`；它只消费已经由当前 invocation 绑定的 execution context，不拥有 Grant 消费权。
- 非媒体 Task 的统一提交：`src/lib/operations/submit-operation-task.ts` 与 `src/lib/task/submitter.ts`；这两个入口不接受批准 provenance，收费媒体调用在此 fail closed。
- 批准 Task 的 durable enqueue：`src/lib/outbox/types.ts` 的 `task.enqueue` → `src/lib/task/enqueue.ts`。
- TaskType 的 billing policy：`src/lib/task/definition.ts`；`src/lib/billing/task-policy.ts` 只执行 registry 指定的 policy，不维护第二份 TaskType 集合或 switch。
- 计划 Task 的资源作用域结构校验：`src/lib/operations/planning.ts` 的 `assertOperationPlanTaskResourceScopes` 复用 `TaskDefinition.terminalResourceImpact`；quote 与 snapshot writer 都必须在持久化或发放 Grant 前调用它。episode/project 归属由共享 Task 提交 primitive 在任何 Task 写入前验证。
- 计划中既有 active Task dependency 的解析与批准前 scope/status 校验：`src/lib/operations/operation-plan-snapshot.ts`；批准提交只由 `src/lib/operations/planned-operation-invocation.ts` 把 dependency identity 交给既有 Assistant Wait，不创建或计费第二个 Task。
- `standards/pricing/**` 当前是 `scripts/check-pricing-catalog.mjs` 的校验输入，不是生产运行时计费 writer；生产金额由 `src/lib/ai-registry/pricing-*` 与 provider code catalog 解析。修改 standards pricing 必须同时审计运行时 catalog 与 `BUILTIN_PRICING_VERSION`，在双表示收敛前不得仅凭 JSON 变更宣称生产价格已改变。

调用层不得自行维护媒体类型名单、确认布尔值或报价任务的平行集合。

## 验证

- `tests/integration/task/approved-operation-plan-batch*.integration.test.ts` 与 `approval-plan-change-replay.integration.test.ts` 使用真实 MySQL 验证 Grant/Execution/业务写入/Task/freeze/outbox 全有或全无、久置且内容未变的 Grant 仍可消费、两个审批表不存在 `expiresAt`、执行契约变化时不重跑 planner 并原子撤销、计划或报价变化时原子撤销，以及已完成 Execution 的持久重放。
- `tests/integration/task/approved-operation-plan-batch-atomic-wait.integration.test.ts` 还验证已运行 dependency 不会生成第二个 Task 或第二笔收费，并与本次新 Task 一起进入唯一 durable Wait。
- `tests/unit/operations/planning.test.ts` 只验证计划 scope、identity 与冻结输入的纯逻辑；`tests/integration/task/create-task-dedupe.integration.test.ts` 使用真实数据库验证 Task 提交去重与 scope。
- `tests/integration/billing/{ledger,service,stripe-recharge,invite-codes,api-contract}.integration.test.ts` 与 `tests/concurrency/billing/ledger.concurrency.test.ts` 验证真实账本事务、冻结/确认/回滚和并发一致性。
- `stripe-recharge.integration.test.ts` 使用 Stripe SDK 生成真实签名 header，并验证部分退款、重复事件、退款失败恢复、争议创建/关闭不改余额、资金扣回/恢复事件和未知 payment intent 拒绝。
- `tests/unit/billing/{cost,runtime-usage,transaction-aggregation}.test.ts` 只验证纯金额和聚合算法。
- `npm run check:pricing-catalog` 只验证 standards pricing 的结构及其 capability tier 字段；它不证明运行时代码 catalog 与 standards 值相同。
## 状态所有权

| 事实                                                           | 唯一所有者 / 写入者                                                                | 消费者                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| 规范化输入、最终新 Task、既有 active Task dependency 与报价   | `OperationPlanSnapshot` / plan endpoint                                            | Grant issuer、Execution、Assistant Wait、审计 |
| 用户对该计划的授权、内容重验证与单次消费                       | `ApprovalGrant` / `issueApprovalGrant` 发放、`invokeApprovedOperationPlan` 唯一重验证、撤销或消费 | 原子批次提交入口                              |
| 一次幂等执行与原子 output                                      | `OperationExecution` / `invokeApprovedOperationPlan`                               | 重复调用、审计                                |
| operation 业务投影、计划内 Task、冻结与入队责任 | `invokeApprovedOperationPlan` 的同一 transaction；各 commit 只使用授权 transaction | Outbox dispatcher、Task worker、UI projection |
| BullMQ job                                                     | `task.enqueue` Outbox consumer                                                     | worker；不得解释审批或报价                    |

写入者变化：删除 Task/Job 的 `operationConfirmed`、收费 operation 的 direct execute、OperationExecution lease/attempt/submitted release 状态机和 operation-specific 事务外补偿。Grant 消费写入者从 `invokeApprovedOperationPlan` 的零 Task 分支与 `approved-plan-submitter` 的有 Task 分支两个收敛为前者一个；删除通用 submitter 的 `assertTaskApprovalAuthorization` 旁路。Task enqueue 从 HTTP commit 的即时外部副作用改为同事务持久 Outbox responsibility。

## 历史回归

- BGM 与环境音首次组成同一付费审批组时，interruption 只持久化首成员的 `operationPlan`，runtime 也只调用一次 Grant issuer；这使“一个 UI 批准”错误地等价于“只有一个 Operation 获得付费执行权”。当前 Approval payload 穷尽保存每个 `approvalId + toolCallId + planSnapshotId`，聚合 plan 只服务 UI 报价；即使旧固定声音链已经删除，同一步自由组合多个收费 Operation 仍逐成员获得精确授权。
- 聚合 Approval 改为按 `toolCallId` 精确映射 Grant 后，runtime 虽只在 `approved=true` 时签发 Grant，却对批准与拒绝无条件构建同一 approved invocation map；即使绕过该错误，SDK 为被拒绝调用生成的明确 rejection output 也会被误判为“执行 outcome 丢失”。真实计费卡取消因此先原子消费 `approved=false` 决定，再抛出 `PROJECT_AGENT_APPROVAL_GRANT_MEMBER_MISMATCH` 或 `PROJECT_AGENT_TOOL_OUTCOME_MISSING`，被 control route 泛化为 `EXTERNAL_ERROR` 并错误结算 Run。旧 Golden 只穿过批准分支，Interruption 单测只证明拒绝决定可消费，没有组合 route、RunState 恢复、Grant 映射与 tool outcome 投影。当前只有批准分支构建并穷尽校验 Grant map；拒绝分支直接对原 SDK Tool call 执行 `state.reject`，outcome collector 只依据 SDK 的权威 `isToolApproved(...) === false` 识别非执行结果，其他 outcome 缺失仍 fail-closed，且不创建 Grant、Execution 或 Task。真实卡片拒绝/重新报价属于人工产品复验，账本零副作用由保留的 MySQL Critical 验证。
- 计费卡取消随后以换形式第三次复发：`3f4f624b9` 修复了消费后的 Grant 映射与 outcome 判定（第二道关），`344d6d697` 让新用户消息把 pending 审批原子消费为拒绝（决定语义），但两者都没有覆盖第一道关——HTTP control 准入。旧 `executeProjectAgentCommand` 先做 scope 级 Run slot 检查、再解析 control 目标：被新消息消费掉的旧审批卡仍可点击，点击撞上新 run 的 `PROJECT_AGENT_RUN_ACTIVE` 409；对活跃 run 自身发 control 也因 slot 检查不带 `excludeRunId`、Redis scope lock 无同 runId 重入而被自我否决。前端又叠加三处失效：control 响应原文被 rethrow 且审批卡 `void onCancel()` 无 catch（unhandled rejection 直达 Next overlay）、Panel 把原始错误替换为通用文案导致 Composer 的错误分流永不命中、审批卡无 in-flight 禁用允许双击。当前准入顺序反转为"先解析目标、已解决即返回 typed `PROJECT_AGENT_CONTROL_ALREADY_RESOLVED` 平静响应、仍可行动才做带 `excludeRunId` 的 slot 检查与同 runId lock 接管"（AR-01B），前端卡片持单次决策态并把 stale 冲突消费为刷新加本地化提示；旧"先 slot 后解析"路径已删除。真实旧卡竞态与双击组合仍属人工产品复验盲区。

- 旧 Soundscape/BGM 各自维护文本 plan 与收费生成；统一 BgmDesign 后仍保留“先规划再生成”的固定创意链。当前旧 planner/generator pair 删除，独立 `create_audio` 像其他媒体 Operation 一样为本次完整输入形成精确计划与授权；音乐方向 Creative Task 免费但绝不自动派生收费任务。
- `d8a1685dc` 收敛了 edit-first 的审批与任务生命周期契约，说明确认语义不能分散在 UI、operation 和 worker 中。
- 制作规划确认曾在专用 Choice 副作用中直接提交视觉风格任务。当前专用 Choice 与固定链均已删除；通用 Choice 的 commitment 明确拒绝收费/长任务，任何媒体调用都必须在下一次独立 Operation 中形成精确报价边沿。
- 视觉风格媒体 plan 曾为了得到精确图片 Prompt 而在 approval preflight 同步调用 LLM 并创建候选记录；虽然图片报价准确，却让 plan 成为第二个长任务执行器和领域 writer。现由普通文本 Task 先持久化方案，图片 plan 只读该 Task 的成功结果。
- Canvas 曾为按钮价格预取 plan A，点击 mutation 又创建 plan B 并自动签发 Grant；分镜图片和单镜头视频的专用 route 还遗漏 episode context，导致合法 Grant 被 scope mismatch 拒绝，视频详情普通按钮则完全不展示价格。旧 unit/conformance 只覆盖 plan、Grant 或节点结构，没有走通直接 UI 的“可见 quote → 同 snapshot Grant → commit”。现删除媒体专用提交 route 和各自 mutation，Canvas 只持有一个 plan handle，snapshot 从真实 Task target 取得 canonical episode，通用 execute 不再重新解释 scope。
- 多章节 Canvas 在“全部”范围恢复逐章视频节点后，每个节点会立即预取自己的付费计划；旧 action 只携带 episodeId 与 shotIds，chapterId 在 projection → renderer → plan request 三层被丢失，planner 因而进入默认章节解析并对多章节 episode 显式拒绝。旧 Logic 只验证节点存在，旧 Golden 也没有在最终全部范围保持 browser-observation clean，因此统一计费入口本身仍可制造 403。当前视频计划 View 把所属 chapterId 作为必填 scope，两个单段生成 action 与 request builder 原样传递，四个只处理单章的连续/资产参考视频 input schema 在 planner 前拒绝缺失 chapterId；Canvas/播放器的完整组合改为人工产品复验。
- Operation plan 与 Grant 曾统一写入 15 分钟 `expiresAt`。真实创作流程中用户在报价卡停留超过 15 分钟后，Assistant control 先消费 interruption，再由 `issueApprovalGrant` 抛出 `OPERATION_PLAN_EXPIRED`，导致一张仍可点击的卡片变成原始 Runtime Error；旧 Critical 场景只证明“过期 Grant 无副作用”和“已消费 Grant 可重放”，没有覆盖真实 Assistant 控制顺序，也把 timer 固化成正确性来源。当前协议删除两个 `expiresAt` 与所有时间判断；所有收费 Operation 由同一 registry planner 和三个 Hash 进行内容重验证，变化时撤销旧 Grant，未变化时无论停留多久都可执行。
- Video Prompt Set retry 的冻结输入识别从 `request.kind=new` 扩展为所有非 retry 初始分支后，本地 Next 长运行进程让审批预检与批准执行分别命中新、旧 route bundle：预检生成了正确的一任务报价，批准后的旧 planner 却返回 `CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_MISSING`。旧防线只用三个内容 Hash 重跑“当前 planner”，默认跨请求 planner 语义相同；代码热更新或滚动发布可以让这个前提失效。当前每个收费 Operation 在生产 registry 声明真实 `planContractRevision`，Snapshot 单点冻结；批准执行先比较 revision，不一致即原子撤销且不调用 planner。迁移以无默认值的 NOT NULL 列阻止旧 runtime 在切换后继续写未版本化快照；首次部署仍必须先排空审批命令并停止旧进程，已完成 Execution 的 durable replay 不受影响。
- Operation plan 曾只校验 payload、quote 与 episode 一致性，没有从 Task registry 验证每个 Task 的终态资源作用域；因此测试 fixture 和潜在 planner 可以生成引用不存在或跨 project episode 的不可执行计划，直到 Grant 消费后的 Task 提交才失败。旧审批原子性场景证明了“同一计划全有或全无”，却没有反证“计划本身能通过权威 Task 边界”。当前 quote、snapshot 与 Task submitter 复用 `TaskDefinition.terminalResourceImpact` 的同一作用域 resolver，缺失或越权在批准前 fail closed。
- Segment 新链曾让 Canvas 单卡与 Assistant 批量共用无目标 episode 输入，导致单卡预取的是整集报价、同一次批准也提交整集 Task。旧测试只断言两者调用相同 Operation，没有断言同一 Operation 的 scope 与计划 Task 集合。当前共享 scope contract 让 Canvas 明确单段、Assistant 明确 pending 批量，quote、snapshot、Grant 与 commit 始终消费同一精确计划；批量 planner 在报价前排除同签名 active/completed Segment。
- Stripe webhook 最初只处理 Checkout 成功，退款、退款失败和争议不会改变已发额度；签名校验与充值幂等测试只能证明“不会重复加”，无法反证“外部资金逆转后额度仍可消费”。当前充值流水冻结 payment intent 和换算事实，refund 与 Stripe 明确的 `funds_withdrawn/funds_reinstated` 争议资金事件只追加 signed adjustment；`dispute.created/closed`（包括 inquiry）不再被猜成资金移动，退款失败或资金恢复按原 debit 精确恢复。旧充值若没有 payment intent/billingMeta 不会按最近订单猜测而会显式失败并要求人工对账，这是上线前需确认的历史数据盲区。
- Stripe Checkout 曾手写 form encoding/fetch/response parser，Webhook 又独立实现 signature header、HMAC、timing-safe compare 和 Event JSON parser；这让协议升级与类型解释同时由项目承担，也存在“验签一次、再解析一次”的双入口风险。当前官方 SDK 是 Checkout wire 与 Webhook signature/Event 的唯一解释器，`maxNetworkRetries: 0` 保持单次创建语义；原有双向五分钟时间窗、自定义 fail-closed 错误、payment intent 关联、refund/dispute policy 与 ledger 幂等 writer 均保留。真实 Stripe Checkout 网络调用仍属于付费外部环境盲区，交付只声明本地类型、协议和账本场景证据，不宣称 live API 已验证。

## 修改检查表

1. 该 operation 是 `none`、`billable_media` 还是 `destructive`？理由是什么？
2. 若收费媒体，审批时最终输入和价格是否已经确定？
3. 是否复用统一 snapshot、Grant、Execution、计划级批次与 Outbox enqueue，而非新增局部确认逻辑？
4. 是否新增“未批准、计划变化、重复提交、父子任务扩大”的负向测试？
