<!-- architecture-module: durable-execution -->

# Temporal 持久执行边界

## 为什么是这样

Temporal 只处理真正跨秒跨分钟、且必须在 Web/Agent 退出后继续的媒体与生产 Task。交互式
Codex Thread/Turn、模型 stream、approval、Workspace placement 不进入 Temporal。

Workflow history 不是第二份产品数据库：业务事实仍由 MySQL owner 写，Temporal 只拥有执行许可、
retry/cancel 顺序和容量调度。历史上把交互式 Agent Turn 塞进 Temporal 产生过一个巨大的
Coordinator（model history、RunState、快速用户消息、approval ACK 全在里面），已整体删除；
Task 与交互式 Agent 的唯一交点是一个稳定 batchId 的完成通知。

## 不变量

- **DE-02 — Workflow 只拥有执行许可。** Workflow 可以调度 Activity、等待 heartbeat、推进
  business attempt、释放容量；Task/Resource/Billing/Provider/Operation 的持久状态只由所属
  MySQL service 写。
- **DE-03 — Workflow 必须确定性。** 数据库、Redis、HTTP、对象存储、Provider、随机数与系统时间
  只在 Activity 读取。History 只保存有界 identity、policy 版本与必要结果，不保存 Prompt、模型
  history、媒体或 token delta。
- **DE-04 — Activity 至少一次，副作用自行幂等。** Temporal retry 不提供业务 exactly-once。
  数据库写、Provider submit、计费与 Resource 物化使用所属 owner 的 canonical identity；相同
  identity 不同 payload 必须拒绝。
- **DE-05 — 产生 Task 的 Operation 只有一条 transport。** 所有 Agent/API/UI 调用先进入同一个
  execution workflow，由 persistence Activity 在一个事务中提交 Operation 输出、Task、Resource
  与批次，再进入调度。禁止 DB commit 后 fire-and-forget，禁止旁路队列或同步 Provider fallback。
- **DE-06 — execution 是 immutable envelope。** Workflow 一次输入后完成，不建立 Update/Query
  命令状态机。start ACK 丢失按相同 execution identity 读取结果，不重做 domain 写入。
- **DE-07 — 计费授权先于 Task。** billable Operation 必须携带冻结 Plan snapshot 与精确 Grant；
  Activity 在同一事务校验后才创建 Task。MCP elicitation 只是用户交互，不能替代 Grant owner。
- **DE-09 — Provider 结果不明时不自动重提。** 已有 external id 或能证明未受理才可安全恢复；
  超时、断线、ACK 丢失且受理结果不明写 `outcome_unknown` 并停止盲目提交。
- **DE-10 — 终态交接顺序可恢复。** 先原子提交 Task/Billing/Resource/批次成员，再释放容量，
  最后执行 follow-up 通知。通知 pending 不得继续占用 Provider 容量。
- **DE-13 — clear 关闭旧批次。** clear 事务取消旧 Thread 未完成批次；晚到 Task 只能结算成员，
  不能唤醒新 Thread。follow-up 必须从批次读取 user/project/thread/context，不信任 caller 提供
  的 scope。
- **DE-14 — cancel 不覆盖已提交完成。** checkpoint/terminal 已提交时业务事实优先；cancel 只
  阻止尚未发生的执行。Provider 补偿独立重试，不能反向阻塞终态、容量释放或 follow-up。
- **DE-16 — 执行平面不可用时长任务失败关闭。** 无法进入 Temporal 时返回 stable typed
  infrastructure code，不退回同步执行、旁路队列或 fire-and-forget。
- **DE-17 — 正式 Worker 使用不可变身份和穷尽版本策略。** 生产 build id 与镜像必须不可变；每种
  Workflow 由同一 registry 声明生命周期和版本行为，有限执行 pinned，持续执行 auto-upgrade。
  持续执行的变更必须可重放既有 history。蓝绿切换只可由唯一入口显式 bootstrap/promote，
  旧版本仍拥有执行或未 drained 时不可 retire；普通应用部署不得管理 Worker 槽位或改变路由。每个
  执行 registry 版本行为的 Worker 都必须注册 Deployment options；源码 Docker 开发环境只由开发路由
  初始化入口在两类版本化 poller 就绪后激活本地 Build ID，且不得复用正式 namespace。
- **DE-19 — migration 只前进。** 已发布 migration 字节不变；不兼容的 schema 或 Workflow payload
  必须在发布前排空对应实例。部分 schema 或未知来源 fail closed。
- **DE-20 — 持久控制面有复杂度预算。** 新增 timer、lease、claim、reconciler、execution receipt
  或第二状态 projector 默认是复发信号，由 `architecture:durable-budget` 分域报告，不能靠移动
  文件隐藏代码。
- **DE-21 — Agent 发起的执行服从 Turn cancel fence。** 首次创建执行或业务写入时在同一事务锁定
  origin Turn；Turn 必须仍活跃且未请求取消。已完成的 execution 可精确 replay，取消先提交时
  不得启动新的持久执行。
- **DE-22 — Temporal 失败只用一个版本化 codec。** Activity 把含原生证据的完整 FailureRecord 编码进唯一协议；
  client 必须遍历 `WorkflowFailedError → ActivityFailure → ApplicationFailure` cause chain 并恢复同一
  记录。Workflow wrapper、API 与 MCP 不得分别重建、覆盖原生证据或猜测 code；协议缺失或畸形必须显式失败关闭。

## 权威入口

- Temporal config/client/worker、Workflow 与 Activity：`src/lib/temporal/**`
- 源码 Docker 开发路由初始化：`scripts/temporal/dev-route-init.sh`
- Operation 持久派发：`src/lib/operations/durable-dispatch.ts`、`durable-execution.ts`
- Task registry / 提交 / 终态：`src/lib/task/**`
- AssistantRuntime 不属于 Temporal：`src/lib/assistant-runtime/**`

## 踩过的坑

- 对外接受的批量上限与执行 receipt / 批次协议上限不一致，中间区段可报价获批却在提交后确定性
  失败 → 两处各自声明上限 → 单一常量被 generation batch、Grant 提交与批次共同消费。
- approved-plan 路径的未知确定性错误直接抛回 Temporal，而 direct 路径才走统一 retry policy；
  一个旧 Plan 因此每 30 秒无限重放事务 → 两条路径两套错误裁决 → 共用唯一 retry policy，
  领域契约与 schema 错误一律 non-retryable。
- Turn interrupt 首版没有进入执行的事务边界，审批等待后晚到的执行可能在用户已停止时创建 Task
  → 取消与首次副作用没有共同 fence → 以 Project 锁串行决定（DE-21）。
- Operation Activity 已携带 typed `ApplicationFailure`，但 client 原样抛最外层 `WorkflowFailedError`，
  通用 normalizer 不遍历 cause chain，真实 Workspace 路径错误仍变成 Internal error → Operation、
  Task 与 Scheduler 边界共用版本化 failure codec，client 只在该入口解码（DE-22）。
- Worker 首版把全部 Workflow 默认 pinned，蓝绿退役保护又只存在于 rollout 脚本；持续 Scheduler
  永远不能自然 drained，普通 Compose 部署绕过脚本停掉旧槽位后，已冻结额度的 Task 无法开始 →
  生命周期版本策略进入穷尽 registry，应用部署隔离 Worker，退役同时校验实际绑定执行（DE-17）。
- 源码 Docker Worker 曾被启动命令强制为 unversioned，但 Workflow registry 已显式声明版本行为；
  Temporal 一旦保留了 `local` Current Version，新批准的执行就无人消费，手工切回 unversioned 又会在
  首轮 Workflow Task 被服务端拒绝 → 旧检查只覆盖正式蓝绿槽位 → 开发 Worker 同样强制版本化，并由
  唯一启动门禁在 Web 前验证 Worker 运行事实、两类队列注册和 Current Version（DE-17）。
