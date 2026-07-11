<!-- architecture-design: assistant-execution-segment-convergence -->

# Assistant 执行段交接收敛

## 事故与目标

这是 `BUG-AR-004` 的实施设计。它不是某个 Choice 卡片的局部错误，而是一次
`task_follow_up` 执行段结束时，Activity、Wait、Run、Thread 和 Outbox 的交接仍有
多个写入者。

目标是让任一模型执行段只通过一个权威入口结算：工具只返回业务结果；唯一的
Execution Segment Settlement 根据该结果，在一次可恢复的数据库交接中更新所有
Assistant 生命周期事实。Choice、Approval、Task 与普通完成只是这一入口的不同
结果类型，不得按 operation id 产生特殊分支。

本设计不改变 OpenAI Agents SDK 的职责：SDK 继续执行模型和工具循环。持久 Run、
用户可恢复的 Interaction、任务续跑和 Outbox 确认属于本产品，必须由服务端协议
维护。

## 发现的旧多写入链

当前 `task_follow_up` 把 command id 伪装成运行中的 Activity，并将其传入整个模型上下文。
于是同一个 Activity 可能被下列路径结束：

| 旧入口 | 触发时机 | 写入的同一事实 |
| --- | --- | --- |
| `agents-tool-adapter` | 续跑中第一个普通工具开始 | 结束 follow-up Activity |
| `bindProjectAgentWaitToTasksInTransaction` | 普通工具改为等待 Task | 结束前序 Activity |
| `settleProjectAgentInterruptionSuspension` | Choice 或 Approval 挂起 | 结束前序 Activity |
| `finalizeProjectAgentWaitFollowUp` | 续跑最终结算 | 结束 follow-up Activity、follow Wait、推进 Run |

真实事故为：续跑 Activity 已由普通只读工具结算，随后 `script_review` Choice 再次
结束同一 Activity，Activity CAS 以
`PROJECT_AGENT_ACTIVITY_TRANSITION_RACED` 失败。随后旧的 stream/outbox 路径仍可能
确认投递，造成 checkpoint、Wait、Run 和 UI 投影不一致。

“若已结束则忽略”不在可选方案中：它会让多个 writer 的错误变成静默数据污染。

## 新的权威模型

每个 `ProjectAgentExecutionSegment` 有一个不可变 identity，且只有
`src/lib/project-agent/execution-handoff.ts` 这一模块可以把它从 open 结算为终态或交接至新的等待。
任何工具和 adapter 都不得持有、传递或写入 predecessor Activity id。

```text
模型 / 工具循环
  -> 返回 typed execution outcome（不写 Assistant 生命周期）
  -> execution-handoff（唯一 writer）
       锁定 Run 与（续跑时）Wait claim，验证 execution fence
       写 assistant message / checkpoint
       不创建 execution segment Activity；只结算 Operation / waiting Activity 自己的生命周期
       按 outcome 创建 Interaction 或 Task Wait，或推进 Run 终态
       写事件与 Session Outbox
       仅提交成功后确认 continuation Outbox
```

结果类型必须是穷尽联合，而不是由 Run status 或文案猜测：

| Outcome | 事务内结果 |
| --- | --- |
| `completed` | message + Run completed；执行段不拥有 Activity，工具已各自结算自己的 Activity |
| `failed` / `outcome_unknown` / `delivery_exhausted` | message + Run failed；执行段不伪造一个 terminal Activity |
| `awaiting_choice` | message + Choice Interaction + 新 waiting Activity + Run awaiting_choice |
| `awaiting_approval` | prepared Approval intent + message + Approval Interaction + 新 waiting Activity + Run awaiting_approval |
| `awaiting_task` | message + Task Wait + 新 waiting Activity + Run awaiting_task |

“当前执行段”不是“当前运行中的工具”。一个执行段可先读取多次、执行多个短操作，
最后再挂起；这些内部 Activity 只记录各工具本身，不能决定或提前终结该执行段。

## Writer 所有权

| 事实 | 唯一 writer | 其他层的权限 |
| --- | --- | --- |
| Execution segment 执行身份 | `executionSegmentId + run.execution_started + continuation checkpoint` | 不是 `ProjectAgentActivity`，不得伪造为 Activity |
| Operation / waiting Activity | tool adapter 与事件 reducer | 仅创建/结束自身的 Activity；不得承载 execution segment 生命周期 |
| Choice / Approval Interaction | execution-handoff 的 outcome projector | Choice/Approval 先提供已验证、不可见的 intent/offer |
| Task Wait | execution segment settlement 的 Task outcome projector | Task submission 只在同一事务提供 Task identity |
| Continuation checkpoint、Thread message、Wait followed、Run 终态 | execution-handoff | Outbox worker 只 claim、调用、在成功后 ack |
| Session Outbox | event append transaction | 任何调用方不得单独发布 |

## 原子性、崩溃和重放

1. 续跑开始前，checkpoint 仍先以 command id 记录 `running`，阻止第二次模型执行。
2. Choice、Approval、Task 先持久化不可见 intent；settlement 在同一数据库事务中写入
   message/checkpoint、执行段结果与 outcome 的生命周期事实。提交前任何 fence 或 claim 失效都整体回滚。
3. checkpoint 只能在上述事务成功后是 `settled`。不再存在“message 已保存、
   checkpoint settled，但 Activity/Wait/Run 未结算”的状态。
4. 已有 `settled` checkpoint 的 Outbox 重放只调用同一 settlement 的幂等 finalize
   分支，不会重跑模型或工具。
5. settlement 抛错时，Outbox command 不得 ack；claim 被释放，命令保留可重试资格。
   delivery exhaustion 也必须通过同一 settlement 写出明确失败，成功后才能 dead-letter。

Choice/Approval/Task 新等待的 Event、Activity 与 Run 状态可在同一事务内由现有 reducer
投影；此设计不要求把外部模型调用放入数据库事务。模型调用前后的不可逆边界由
`executionSegmentId + checkpoint + fence` 管理。

## 明确删除项

- `ProjectAgentContext.currentActivityId`、`followUpActivityId` 与所有 `previousActivityId` 参数；
- 普通工具 adapter 在开始新工具前结束 follow-up Activity 的分支，以及 task-follow-up Activity 的创建；
- Choice、Approval、Task Wait helper 各自结束 predecessor Activity 的分支；
- `checkpointProjectAgentWaitFollowUp` / `finalizeProjectAgentWaitFollowUp` 对 command Activity 的分裂式结算；
- stream body drain 成功即等同于 Outbox delivery 成功的隐式约定；
- 将 checkpoint message 持久化与生命周期结算拆成两个可独立成功阶段的语义。

## 范围与非目标

范围包括 user turn、Choice/Approval 决定恢复和 task follow-up 三类执行段，以及
Choice、Approval、Task、普通完成和失败五种结果。所有现有五种 Choice 必须通过
registry 自动复用同一 Choice outcome；不为它们增加专属 lifecycle 代码。

本阶段不修改领域 Workflow 业务规则、Choice Offer 结构、模型 prompt 或 UI renderer。
对已经处于损坏中间态的历史数据不做自动伪造卡片；修复部署后应通过正式恢复 Run
创建新的、可验证的 Offer。任何生产数据修复需另行授权。

## 验证矩阵

真实 MySQL 组合测试必须覆盖：

- 四种 execution segment 来源：user、choice response、approval response、task follow-up；
- 五种结果：completed、failed、awaiting_choice、awaiting_approval、awaiting_task；
- task follow-up 在 0 次与至少 1 次普通工具后进入每种等待结果；
- Choice registry 全部实例、Approval 和 Task 共用同一 conformance；
- 每个事务写入点的故障注入、旧 execution fence、claim 失效、重复 Outbox 投递、
  crash 后 checkpoint replay、并发/重复用户控制和刷新恢复；
- 断言不存在 `outbox accepted && wait claimed`、同一 Activity 两次终态、消息存在但
  无匹配权威 Run/Interaction/Wait，或 UI/持久 Run 状态分离。

guard 必须从生产调用图而不是固定字符串证明：continuation command 不能重新变成
Activity，且只有各 Activity 自己的生命周期入口能产生其 terminal Event；旧
adapter/Choice/Approval/Wait/finalizer 入口重新出现时，最小恶意 fixture 必须失败。

## 历史回归矩阵

| 历史缺陷 | 旧防线为何不足 | 本次防线 |
| --- | --- | --- |
| BUG-AR-001 | 只证明 Run/lock 所有权，没有枚举一段续跑内部的 Activity writer | segment 唯一 writer + lifecycle matrix |
| BUG-AR-002 | 验证 Task terminal 聚合，没有验证 follow-up 的最终结算与挂起交接 | Task follow-up → tool → suspension 真实 MySQL 场景 |
| BUG-AR-003 | 修复 Choice fence 的错误后置裁决，但保留了 predecessor Activity 多 writer | unified outcome settlement，Choice 不传 predecessor id |
| BUG-AR-004 | 尚未保护；真实 screenplay review 首次暴露 | 反证同一 Activity 被第二 writer 终结必失败，当前生产链路通过 |

## 完成准则

仅当旧 writer 已删除、权威入口可定位、历史目录与模块文档已更新、测试实际收集并
通过、guard 可反证且不存在上述残余双轨时，才能称为 Assistant execution-segment
交接架构完成。
