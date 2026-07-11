<!-- architecture-module: billing-approval -->

# 计费与审批

## 设计理念

确认不是“调用了 AI 就询问用户”的通用开关。只有执行前可以确定具体媒体输入与价格的收费媒体，才需要媒体报价确认。LLM 文本规划默认无需媒体确认；删除或不可逆覆盖属于破坏性确认，不伪装成媒体报价。

收费媒体的正确顺序是：先生成最终计划，再准确报价，再由用户批准，最后只提交同一计划中的任务。用户批准的是具体工作，不是一个未来可能发生的最大额度。

## 不变量

- **BA-01 — 审批分类唯一。** `none`、`billable_media`、`destructive` 是 operation confirmation 的唯一分类；LLM 文本任务必须显式属于 `none`，不是漏配后的默认值。
- **BA-02 — 精确计划先于媒体审批。** `billable_media` 的审批前必须确定真实 Task、目标、模型、输入、数量和准确报价。不得先批准、再让 LLM 或 worker 决定实际收费内容。
- **BA-03 — 批准必须有不可变来源。** 最终收费任务只能携带 `OperationPlanSnapshot → ApprovalGrant → OperationExecution → operationPlanTaskId` provenance；`operationConfirmed` 布尔字段已退役，route、worker、Task payload 和恢复 envelope 都不得重建该布尔轨道。
- **BA-04 — 统一最终门禁。** 未批准的收费媒体不得创建 Task、入队或调用供应商；UI、Agent、route、worker 的任何遗漏都不能绕过提交边界。
- **BA-05 — 免费确认不得隐含媒体授权。** 制作规划等免费 LLM 结果的审核只确认该结果及其业务字段，不得同时授权下一阶段收费媒体。视觉风格初次生成与后续重生成都必须独立经过同一个 `plan → quote → approval → commit` operation；UI 必须展示该次图片任务的数量与 credits，用户批准后才可提交。
- **BA-06 — 父子计划不可扩大。** 父操作只能提交其已报价且获批准计划中的子任务；文本任务不得自动派生新的收费子任务。
- **BA-07 — Grant、业务投影与整批责任一次提交。** `invokeApprovedOperationPlan` 持有唯一 Prisma interactive transaction；Grant 消费、OperationExecution、operation-specific 业务写入、MutationBatch、全部 Task、全部额度冻结、Created lifecycle event 与每个 Task 的 durable enqueue responsibility 必须一起 commit 或一起 rollback。BullMQ 入队只消费 commit 后才可见的 `task.enqueue` Outbox，不再使用 `availableAt=9999` 暂存、第二阶段 release 或逐 Task 补偿。
- **BA-08 — 不存在可持久化的中间 Execution。** `committing` 仅存在于尚未提交的事务快照，数据库外只能观察到完整 `completed` execution；进程在任意语句后退出都会由 MySQL 回滚。相同 Grant 的并发/重复调用先锁定 Grant 行，完成后只返回同一持久 output，不另建 lease、attempt、`submitted` 或 `failed` 状态机。
- **BA-09 — 收费 operation 只有 plan/commit 入口。** `billable_media` definition 必须声明 plan 与 commit，且禁止声明 execute；非收费/破坏性 operation 才能声明 direct execute。registry runtime conformance、TypeScript discriminated definition 与 CI guard 共同阻止第二执行入口。
- **BA-10 — 投影只能发生在 commit 之后。** operation commit 期间产生的 Assistant structured parts 先写入 invocation-owned buffer；唯一事务成功后才向原 writer flush，失败/kill 时全部丢弃。commit 内不得直接调用 Redis、provider 或其他不可回滚外部副作用。
- **BA-12 — Channel 不得形成审批旁路。** API 与 Tool 共用 `invokeProjectAgentOperation`；`billable_media` 在任一 channel 都只能消费不可变 ApprovalGrant，direct operation 不得接收或忽略 Grant provenance。`channels` 必须在输入解析和任何业务执行之前强制。
- **BA-11 — Grant 只有一个消费写入者。** `invokeApprovedOperationPlan` 在锁定 Grant、创建 `OperationExecution` 后无条件消费 Grant；零 Task 与有 Task 计划使用同一条边。`approved-plan-submitter` 只验证 Grant 已绑定当前 execution 并创建计划内 Task，不得更新 Grant。通用 Task submitter 不接收 Grant/Execution/planTask 授权参数，任何收费媒体输入必须显式失败并回到批准计划入口。
- **BA-13 — Task runtime 不得启动同步计费。** 普通 Task 与批准 Task 必须通过 `transactional-create.ts` 在 Task/Created event/enqueue Outbox 同一事务内 freeze，Terminal Service 拥有 settle/rollback；不得保留 Task 创建后再授权计费的第二事务。worker 内部调用 `withTextBilling` 等同步包装时只执行 provider 并把 usage 留给外层 Task collector；不得创建第二个 sync freeze/confirm 生命周期，也不得让嵌套 collector 吞掉 Task usage。
- **BA-14 — 一个 Task type 只对应一种成本语义。** 同一 handler 可以复用实现，但文本分析与收费媒体生成必须使用不同 TaskType/Operation identity。`reference_character_description_extract` 属文本直提交流程；`reference_to_character` 属图片 `plan → quote → ApprovalGrant → commit`。payload 布尔值不得在 worker 内把一种 billing policy 变成另一种。

## 权威入口

- 媒体类型和是否属于收费媒体：`src/lib/billing/media-approval-policy.ts`。
- operation confirmation 分类：`src/lib/operations/types.ts` 和 `src/lib/operations/registry.ts`。
- 不可变计划与 hash：`src/lib/operations/operation-plan-snapshot.ts`。
- Grant 发放、Grant row lock 与单事务 plan invoke：`src/lib/operations/planned-operation-invocation.ts`。
- API/Tool channel 许可：`src/lib/operations/channel-policy.ts`；执行与 plan endpoint 必须在解析业务输入前调用同一 policy。
- API/Tool Operation 调用与审批分流：`src/lib/operations/invocation.ts`。
- 批准计划的唯一 Task 创建入口：`src/lib/task/approved-plan-submitter.ts`；它只消费已经由当前 invocation 绑定的 execution context，不拥有 Grant 消费权。
- 非媒体 Task 的统一提交：`src/lib/operations/submit-operation-task.ts` 与 `src/lib/task/submitter.ts`；这两个入口不接受批准 provenance，收费媒体调用在此 fail closed。
- 批准 Task 的 durable enqueue：`src/lib/outbox/types.ts` 的 `task.enqueue` → `src/lib/task/enqueue.ts`。
- TaskType 的 billing policy：`src/lib/task/definition.ts`；`src/lib/billing/task-policy.ts` 只执行 registry 指定的 policy，不维护第二份 TaskType 集合或 switch。

调用层不得自行维护媒体类型名单、确认布尔值或报价任务的平行集合。

## 验证

- `tests/unit/billing/media-approval-policy.test.ts` 覆盖统一媒体分类。
- `tests/unit/operations/planning.test.ts` 覆盖计划报价与确认额度边界。
- `tests/unit/operations/planning.test.ts` 也反证 tool-only Operation 不能通过 API plan endpoint 暴露计划或开始业务处理。
- `tests/unit/operations/reference-character-{authority,planning}.test.ts` 验证参考图文本提取与图片生成拥有不同 Task billing policy，图片计划绑定目标所有权并生成 image quote，未获 Grant 的 API 调用显式失败。
- `tests/integration/task/approved-operation-plan-batch.integration.test.ts` 用真实 MySQL 验证 Grant/Execution/业务写入/全 Task/freeze/outbox 全有或全无、余额不足回滚、Task batch 后故障回滚与并发重复调用串行化。
- `tests/integration/task/approval-grant-expiry-replay.integration.test.ts` 用真实 MySQL 证明未消费 Grant 过期后零执行副作用，已消费 Grant 超 TTL 只返回同一持久 output 且不再次 commit。
- `tests/unit/worker/soundscape-plan-worker.test.ts` 与 `soundscape-generate-worker.test.ts` 覆盖 Soundscape 任务链路。
- `tests/unit/billing/task-runtime-billing.test.ts` 验证 Task runtime 不读取同步 Billing mode、不创建第二计费生命周期，并把 usage 保留给 Terminal Service。
- `scripts/guards/single-task-billing-owner-guard.mjs` 强制 Task billing 只保留 transaction API，并禁止重新导出 Terminal Service 之外的 Task settle/rollback 写入口。
- `scripts/guards/no-hardcoded-operation-confirmed.mjs` 阻止在生产源码中写死批准状态。
- `scripts/guards/no-media-provider-bypass.mjs` 阻止绕过统一媒体供应商入口。
- `scripts/guards/no-project-agent-direct-task-submit.mjs` 阻止 Assistant choice/runtime 绕过 operation registry 直接提交任务。
- `scripts/guards/approval-plan-batch-authority-guard.mjs` 强制不可变 Grant provenance、单事务 authority，并禁止 lease/`submitted`/9999 暂存协议回归。
- `scripts/guards/single-operation-invocation-guard.mjs` 强制 API/Tool adapter 只能调用统一 invocation authority。

`tests/unit/operations/planning.test.ts` 穷尽要求所有 `billable_media` operation 同时提供 plan/commit；任何计划外 Task 都在最终提交边界失败。收费文本 LLM operation 属于 `confirmation:none`，不得因为 `effects.billable` 被误归类为媒体审批。

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

## 修改检查表

1. 该 operation 是 `none`、`billable_media` 还是 `destructive`？理由是什么？
2. 若收费媒体，审批时最终输入和价格是否已经确定？
3. 是否复用统一 snapshot、Grant、Execution、计划级批次与 Outbox enqueue，而非新增局部确认逻辑？
4. 是否新增“未批准、计划变化、重复提交、父子任务扩大”的负向测试？
