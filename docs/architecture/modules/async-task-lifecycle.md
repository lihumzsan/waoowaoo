<!-- architecture-module: async-task-lifecycle -->

# 异步任务生命周期

## 设计理念

route、queue、worker、DB、Agent 和 Canvas 必须对同一个 Task 生命周期说同一种语言。Task 是长运行外部工作的权威事实；UI 只投影状态，Agent 只根据明确终态继续，不得由任一层猜测或补造状态。

## 不变量

- **TL-01 — 单一提交入口。** 创建并提交 Task 必须经由统一 submitter；operation、route、worker 不得各自直连队列并重写生命周期语义。
- **TL-02 — 显式状态边。** 开始、等待用户、等待外部 provider、完成、失败、取消、重试必须有明确允许的状态转移和责任方。
- **TL-03 — 范围与目标一致。** project、episode、chapter 和 target identity 必须从统一 payload/normalizer 派生；写入方与读取方不得使用不同 scope 语义。
- **TL-04 — 提交失败可补偿。** 创建记录后提交任务若失败，必须有显式补偿；不得留下孤儿记录、冻结金额或不可恢复 dedupe 状态。
- **TL-05 — 重试有唯一策略。** 错误分类决定是否重试；LLM 任务的模型输出校验失败可由队列重试，临时供应商错误同样可重试，鉴权、配置、余额和内容安全等永久失败不得重试。队列、worker 与 Agent 不能叠加隐式重试或把永久失败吞掉。
- **TL-06 — 终态驱动下游。** Task 完成/失败是唤醒 Agent 和刷新 Canvas 的唯一业务边；不得用轮询、历史消息或局部 loading 推断替代。
- **TL-06A — 终态立即撤销瞬时运行态。** 结构化流和 optimistic runtime 在 Task completed/failed/canceled 终态到达时必须立即退出；历史 `task-submitted` 消息不得继续充当 active Task。Overlay 不得用 TTL 承担清理正确性。Structured stream 以 `streamRunId + stepAttempt + seq` 拒绝旧、重复和乱序 chunk，旧 attempt 的终态不得封锁新 retry。源剧本生成和制作规划生成即使复用同一 worker，也必须使用不同 Task type 与 target。
- **TL-06B — 目标失败只跟随最终终态。** 单次 worker attempt 不得把业务目标写成 `failed`，即使当前 `maxAttempts=1` 也不例外；只有 Task 确认进入最终失败终态后，统一目标失败 projector 才可落库。Chapter/Final render 等 `renderStatus` 字段同样受此约束，不能用字段别名绕过。
- **TL-06C — 终态携带物化资源。** 影响 Canvas 的 worker 必须在业务资源持久化后、Task completed 事件前，通过统一 materialization registry 读取正式 Query DTO。客户端处理顺序固定为 Query Cache → Task terminal → runtime clear → 异步 invalidation；不得把 refetch 时机当作终态 UI 接力。
- **TL-06D — 物化资源版本是强制门禁。** `materializedResources` 只支持声明了版本 scheme、正式 DTO 构造器、DTO 版本提取器和 comparator 的资源 kind。聚合 DTO 的版本必须覆盖其所有可变子资源；版本与 DTO 必须作为同一快照校验和交接。客户端应用结果穷尽区分 `applied`、`duplicate`、`stale`、`identity-conflict`、`missing` 与 `invalid`；duplicate/stale 是合法重放，不得投影为业务失败。跨 Task、重复、replay 或乱序 envelope 不能用旧 DTO 覆盖新 Query Cache。缺失版本必须终止该资源交接，禁止退回 taskId、事件时间或接收顺序。
- **TL-07 — Queue 观察与恢复只有一个裁判。** BullMQ 只负责运输，Task DB 仍是业务生命周期权威。Queue 观察必须穷尽表达 `alive`、`terminal`、`absent`、`unavailable`；Redis 不可用不得解释成 job 丢失。恢复、超时终止和 DB ↔ BullMQ 对账必须由同一个 reconciler 执行，Next 启动逻辑、独立脚本和 worker handler 不得各自改写同一 Task 或业务目标终态。
- **TL-08 — 批准批次与业务投影一次提交、commit 后入队。** `billable_media` 的 operation-specific 业务写入、MutationBatch、Grant、OperationExecution、Task/freeze/Created event/`task.enqueue` Outbox responsibility 必须在唯一 MySQL 事务持久化；enqueue command 无需未来时间暂存，因为事务 commit 前对 dispatcher 不可见。初次 Outbox 入队与 queued/absent reconciler 恢复必须复用同一 Execution completed 门禁。HTTP 响应、Redis 可用性、第二阶段 release 和逐 Task 补偿都不承担整批正确性。
- **TL-09 — SSE 单握手与复合持久水位。** 服务端必须先订阅 Redis channel，再读取 bootstrap，并按 snapshot → buffered live 精确去重交接。运输水位必须分别携带 TaskEvent 数字游标与 MutationBatch `(createdAt,id)` 游标；当客户端尚无 Mutation 水位时，bootstrap 必须发送显式 recovery checkpoint，使正式 Query 失效并建立 Mutation 水位，禁止只补 Task 导致另一事实域永久脱漏。客户端刷新后从持久水位重连，持续 replay polling 不得承担正确性。
- **TL-10 — 业务目标写入必须携带 Task 所有权 fence。** 会进入 `generating` 的持久资源必须在 Task 创建事务中记录 `generationTaskId`（或同等 execution identity）；成功、失败与取消 projector 只能以 `(resourceId, generationTaskId, activeStatus)` CAS。旧 Task 晚到只能成为 no-op，未知 target/type 组合必须显式失败。
- **TL-11 — 三种终态 handoff 必须注册。** 每个 TaskDefinition 必须显式声明 success handoff、failure projector 与 cancel projector；不得用 helper 默认 `none` 掩盖缺失。Terminal Service 在同一事务内按 registry 调用 projector。取消只撤销当前 Task 的目标所有权并回到可重试的 pending，不得复用 failure projector 或写成 `failed`。
- **TL-12 — EditBible 成功事务持锁。** `persistGeneratedEditBibleBundle` 必须从事务第一步 `FOR UPDATE` 锁定 Bible，并校验 id、episode、sourceDocument、generationTaskId 与 generating。source read、bundle validation、chapter/style/Bible 全部写入在同一持锁事务，最终以完整 owner fence CAS；旧 Task 成功、失败或取消不得覆盖新 owner。

## 状态所有权

| 事实                                              | 唯一所有者 / 写入入口                                                          | 消费者                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Task 状态、attempt、heartbeat 与错误诊断          | DB `Task` / `src/lib/task/service.ts` 的显式状态边                             | worker、reconciler、UI、Agent                               |
| 是否允许下一次 attempt                            | `src/lib/task/retry-policy.ts`                                                 | worker 生命周期；BullMQ 只执行 attempts/backoff             |
| BullMQ job 存在性与运输状态                       | BullMQ / `src/lib/task/queues.ts`                                              | reconciler 只观察，不直接解释业务终态                       |
| DB Task → BullMQ payload                          | `src/lib/task/job-envelope.ts`                                                 | 初次提交与恢复入队                                          |
| 批准计划的整批 Task/freeze/enqueue responsibility | `src/lib/task/approved-plan-submitter.ts`                                      | OperationExecution 与 Outbox worker                         |
| 批准 Task 的初次与恢复 BullMQ 入队门禁            | `task.enqueue` Outbox 与 reconciler / `src/lib/task/enqueue.ts`                | BullMQ worker                                               |
| 丢失 job 恢复、stale timeout 与终态对账           | `src/lib/task/reconcile.ts`                                                    | instrumentation 只启动唯一 reconciler                       |
| SSE Task/Mutation 重放水位                        | `src/lib/sse/protocol.ts` 的复合 cursor；服务端握手 `src/app/api/sse/route.ts` | `useSSE` 只投影并持久化 transport cursor                    |
| ProjectEditBible 当前生成所有权                   | `ProjectEditBible.generationTaskId` / Task 创建事务 hook                       | 持锁 success projector 与 terminal failure/cancel projector |

## 权威入口

- Task 类型与状态：`src/lib/task/types.ts`。
- Task 静态契约（queue、retry、execution protocol、success/failure/cancel handoff）：`src/lib/task/definition.ts`；新增 TaskType 必须通过穷尽 `satisfies` 与 conformance。
- 提交、队列与计费边界：`src/lib/task/submitter.ts`。
- Task 服务与终态写入：`src/lib/task/service.ts`。
- Task → BullMQ 完整 envelope：`src/lib/task/job-envelope.ts`；Task type → queue 的穷尽映射：`src/lib/task/queues.ts`。
- Queue 四态观察与唯一恢复 cycle：`src/lib/task/reconcile.ts`；`src/instrumentation.ts` 只负责启动，不写 Task。
- Operation 到 Task 的提交适配：`src/lib/operations/submit-operation-task.ts`。
- 批准计划到整批 Task 的唯一入口：`src/lib/task/approved-plan-submitter.ts`；初次入队：`src/lib/task/enqueue.ts`。
- Canvas 终态物化：`src/lib/workspace-resource/materialized-resource.ts`；客户端接力：`src/lib/query/materialized-resource-cache.ts`。
- 物化版本协议：`src/lib/workspace-resource/materialized-resource-version.ts`。
- 重试判定：`src/lib/task/retry-policy.ts`；LLM Task registry：`src/lib/llm-observe/task-policy.ts`。

## 验证

- `tests/integration/task/create-task-dedupe.integration.test.ts` 验证去重与重复提交。
- `tests/regression/task-dedupe-recovery.test.ts` 与 `tests/regression/task-enqueue-billing-rollback.test.ts` 验证恢复、补偿和回滚。
- `tests/unit/task/service-operation-metadata.test.ts` 验证 operation metadata 语义。
- `tests/unit/task/job-envelope.test.ts` 验证恢复入队不会丢失 billing、operation、scope、priority 与 trace。
- `tests/unit/task/reconcile-target-sync.test.ts` 与 `reconcile-queue-lifecycle.test.ts` 验证 queue unavailable 零写入、批准 Task 恢复仍经过 Execution completed 门禁，以及最终失败投影。
- `tests/integration/task/task-reconcile-queue.integration.test.ts` 验证真实 DB + Redis 下 queued/absent 的完整恢复时序。
- `tests/integration/task/approved-operation-plan-batch.integration.test.ts` 验证真实 DB 下批准批次的 Task/freeze/outbox 原子性。
- `tests/contracts/task-definition-conformance.test.ts` 验证每个 TaskType 的 queue/retry/execution/success/failure/cancel 声明被必跑 guard suite 收集。
- `tests/unit/sse/server-session.test.ts`、`tests/unit/operations/sse-ops.test.ts` 与 `tests/integration/api/contract/task-run-routes.test.ts` 验证 subscribe-before-bootstrap、复合游标、缺失 Mutation 水位的 recovery checkpoint、buffer 去重和 abort cleanup。
- `tests/unit/query/materialized-resource-cache.test.ts` 验证物化资源跨 Task 和乱序交接不回退。
- `scripts/guards/task-submit-compensation-guard.mjs` 检查 route 的 create + submit 补偿标记。
- `scripts/guards/no-operation-direct-submit-task.mjs` 阻止 operation 绕过统一提交边界。
- `scripts/guards/no-project-agent-direct-task-submit.mjs` 阻止 Assistant choice/runtime 绕过 operation registry 直接提交 Task。
- `scripts/guards/task-target-states-no-polling-guard.mjs` 阻止以 polling 伪造目标状态。
- `scripts/guards/single-task-reconciler-guard.mjs` 阻止第二 watchdog、instrumentation 直接写 Task，以及四态观察/完整 envelope 被绕过。
- `scripts/guards/no-worker-attempt-target-terminal-write.mjs` 阻止单次 worker attempt 提前写业务目标终态。
- `scripts/guards/materialized-resource-version-guard.mjs` 阻止物化资源版本退化为无类型字符串、taskId fallback 或无条件 cache replace。
- `scripts/guards/sse-durable-watermark-guard.mjs` 阻止恢复 5 秒 replay polling、丢失复合水位或颠倒 subscribe/bootstrap 顺序。
- `scripts/guards/edit-bible-task-ownership-guard.mjs` 阻止 ProjectEditBible 回退为无 Task fence 的成功/失败写入。

## 本批 migration 发布门禁（必须人工执行，当前未应用）

`20260711020000` 至 `20260711050000` 只能在维护窗口整体切换，禁止旧/新协议双轨运行：

1. 暂停新 Task/Operation/Assistant Run 提交并停止 worker 消费；等待 BullMQ 与 DB 中所有 active Task 排空。
2. 用只读查询证明 `SELECT COUNT(*) FROM tasks WHERE status IN ('queued','processing')` 为 `0`；并额外证明 `SELECT COUNT(*) FROM tasks WHERE type = 'edit_style_previews_generate'` 为 `0`，因为该父 Task 协议已删除且不提供双轨兼容。同时证明没有待交付的 Outbox command 和等待中的 Assistant Run/Wait。任一计数非零立即中止发布。
3. 不得从已被 progress 合并污染的 `Task.payload` 回填 `executionFingerprint`，也不得猜测 `ProjectEditBible.generationTaskId`。本批采用“排空后切换”，不是数据回填。
4. 在应用 migration、部署新代码、启动 dispatcher/worker 后，先验证 guard、schema 与只读健康检查，再恢复提交流量。
5. `20260711030000` 会删除 `operationConfirmed`；因此 migration 与新应用必须作为同一维护窗口切换，禁止旧应用实例继续写入。

## 历史回归

- `95254ae71` 尝试收敛 AI 与 Task 重试，但错误分类没有成为唯一来源时，重试仍会在多层复发。
- `ba753a204` 去除隐式队列重试后，后续又需要显式任务生命周期与错误分类，说明“删重试”本身不能替代契约。
- Git 历史严格口径下已有 8 次直接 queue/retry/reconcile 修复；扩展到终态 SSE 与业务目标生命周期则为 10 次。反复出现的共同根因不是 BullMQ 本身，而是 retry、watchdog、worker handler 和启动恢复曾同时解释 Task/target 状态。

## 修改检查表

1. Task 的 scope、target、输入类型和输出类型的权威来源是什么？
2. 每个状态边由谁写入，失败与取消如何表现？
3. 任务提交失败时，哪些记录、队列项、冻结或锁需要补偿？
4. 错误如何分类，哪一层有权重试？
5. 是否覆盖 route → Task → worker → DB → stream 的真实组合路径？
6. Redis unavailable、queued+absent 恢复、terminal failed reason、stalled/late event 是否均有显式行为测试？
