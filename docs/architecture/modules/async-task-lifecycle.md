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
- **TL-06A — 终态立即撤销瞬时运行态。** 结构化流和 optimistic runtime 在 Task 终态到达时必须立即退出；历史 `task-submitted` 消息不得继续充当 active Task。源剧本生成和制作规划生成即使复用同一 worker，也必须使用不同 Task type 与 target。
- **TL-06B — 目标失败只跟随最终终态。** 单次 worker attempt 失败且仍会重试时不得把业务目标写成 `failed`；只有 Task 确认进入最终失败终态后，统一目标失败同步才可落库诊断。
- **TL-06C — 终态携带物化资源。** 影响 Canvas 的 worker 必须在业务资源持久化后、Task completed 事件前，通过统一 materialization registry 读取正式 Query DTO。客户端处理顺序固定为 Query Cache → Task terminal → runtime clear → 异步 invalidation；不得把 refetch 时机当作终态 UI 接力。
- **TL-07 — Queue 观察与恢复只有一个裁判。** BullMQ 只负责运输，Task DB 仍是业务生命周期权威。Queue 观察必须穷尽表达 `alive`、`terminal`、`absent`、`unavailable`；Redis 不可用不得解释成 job 丢失。恢复、超时终止和 DB ↔ BullMQ 对账必须由同一个 reconciler 执行，Next 启动逻辑、独立脚本和 worker handler 不得各自改写同一 Task 或业务目标终态。

## 状态所有权

| 事实 | 唯一所有者 / 写入入口 | 消费者 |
| --- | --- | --- |
| Task 状态、attempt、heartbeat 与错误诊断 | DB `Task` / `src/lib/task/service.ts` 的显式状态边 | worker、reconciler、UI、Agent |
| 是否允许下一次 attempt | `src/lib/task/retry-policy.ts` | worker 生命周期；BullMQ 只执行 attempts/backoff |
| BullMQ job 存在性与运输状态 | BullMQ / `src/lib/task/queues.ts` | reconciler 只观察，不直接解释业务终态 |
| DB Task → BullMQ payload | `src/lib/task/job-envelope.ts` | 初次提交与恢复入队 |
| 丢失 job 恢复、stale timeout 与终态对账 | `src/lib/task/reconcile.ts` | instrumentation 只启动唯一 reconciler |

## 权威入口

- Task 类型与状态：`src/lib/task/types.ts`。
- 提交、队列与计费边界：`src/lib/task/submitter.ts`。
- Task 服务与终态写入：`src/lib/task/service.ts`。
- Task → BullMQ 完整 envelope：`src/lib/task/job-envelope.ts`；Task type → queue 的穷尽映射：`src/lib/task/queues.ts`。
- Queue 四态观察与唯一恢复 cycle：`src/lib/task/reconcile.ts`；`src/instrumentation.ts` 只负责启动，不写 Task。
- Operation 到 Task 的提交适配：`src/lib/operations/submit-operation-task.ts`。
- Canvas 终态物化：`src/lib/workspace-resource/materialized-resource.ts`；客户端接力：`src/lib/query/materialized-resource-cache.ts`。
- 重试判定：`src/lib/task/retry-policy.ts`；LLM Task registry：`src/lib/llm-observe/task-policy.ts`。

## 验证

- `tests/integration/task/create-task-dedupe.integration.test.ts` 验证去重与重复提交。
- `tests/regression/task-dedupe-recovery.test.ts` 与 `tests/regression/task-enqueue-billing-rollback.test.ts` 验证恢复、补偿和回滚。
- `tests/unit/task/service-operation-metadata.test.ts` 验证 operation metadata 语义。
- `tests/unit/task/job-envelope.test.ts` 验证恢复入队不会丢失 billing、operation、scope、priority 与 trace。
- `tests/unit/task/reconcile-target-sync.test.ts` 验证 queue unavailable 零写入以及最终失败投影。
- `tests/integration/task/task-reconcile-queue.integration.test.ts` 验证真实 DB + Redis 下 queued/absent 的完整恢复时序。
- `scripts/guards/task-submit-compensation-guard.mjs` 检查 route 的 create + submit 补偿标记。
- `scripts/guards/no-operation-direct-submit-task.mjs` 阻止 operation 绕过统一提交边界。
- `scripts/guards/no-project-agent-direct-task-submit.mjs` 阻止 Assistant choice/runtime 绕过 operation registry 直接提交 Task。
- `scripts/guards/task-target-states-no-polling-guard.mjs` 阻止以 polling 伪造目标状态。
- `scripts/guards/single-task-reconciler-guard.mjs` 阻止第二 watchdog、instrumentation 直接写 Task，以及四态观察/完整 envelope 被绕过。
- `scripts/guards/no-worker-attempt-target-terminal-write.mjs` 阻止单次 worker attempt 提前写业务目标终态。

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
