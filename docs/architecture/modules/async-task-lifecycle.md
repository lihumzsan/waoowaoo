<!-- architecture-module: async-task-lifecycle -->

# Temporal 异步 Task 生命周期

## 为什么是这样

Task 是长运行执行的唯一业务事实。执行许可（attempt、retry、timeout、cancel、容量）归 Temporal；
业务事实（Task / Billing / Resource / FollowUp）归 MySQL owner。两者不互相解释。

不用 BullMQ、Outbox、DB claim/lease/heartbeat、reconciler 或 Redis 并发闸。历史上这些东西同时
解释"谁在运行"，每修一个进程窗口就多一个 stale 窗口。共享边界见
[Temporal 持久执行边界](durable-execution.md)。

## 不变量

- **TL-01 — Task 创建只有一个事务入口。** 校验、计费冻结、Task 行、pending Resource 与
  FollowUp 成员在同一事务提交，提交后才调度执行。route、Worker、调用方不得自己拼 Task 行，
  也不得在 commit 后带外启动执行。
- **TL-05 — attempt 只有一个 owner。** business attempt 由 Workflow 创建并投影到 Task。DB
  status、lease、heartbeat 新鲜度或队列 job 都无权另行 claim attempt。
- **TL-06 — 基础设施 retry 不消耗 business attempt。** 同一 attempt identity 复用。只有确定且
  已归一化的失败经 registry policy 裁决后才推进下一次 business attempt；仍可重试时不得写
  Task/Resource/Billing 最终失败。
- **TL-08 — Provider 调用有独立幂等 fence。** ledger 冻结 logical identity、输入指纹、route、
  external id 与结果。只有明确未受理、或 Provider 支持同一幂等身份时才允许重提；受理结果不明
  写 `outcome_unknown` 并停止自动提交。收费 handler 必须从 ledger 读取实际 accepted route 写
  终态与 provenance——请求里的 primary model 不是成功来源事实。
- **TL-09 — terminal writer 唯一。** Task 终态、Billing 结算、Resource/Lineage 物化与 FollowUp
  成员更新在同一事务提交；exact replay 返回同一 receipt。长 Activity 不直接写终态。
- **TL-10 — 已提交结果优先于晚到取消。** handler result checkpoint 一旦提交，即使 cancel 随后
  到达也必须按该结果收口，不得改写为 cancel/failed/refund。Task 终态不可重开；Provider 补偿只能
  由已提交的 canceled receipt 触发。
- **TL-12 — 批次成员在创建事务冻结。** 一次调用创建多个 Task 必须全建或全滚，并在同一事务冻结
  完整成员集。不存在 collecting/seal 阶段；早到、重复、乱序终态都由成员 identity 幂等收口。
- **TL-16 — 结果只物化一次。** 每种媒体 Task 由 registry 指向唯一 materializer；相同 Task/result
  replay 必须幂等。Task result 是交接输入，不是第二领域数据库。
- **TL-22 — 执行平面不可用时提交失败关闭。** 无法确认执行已被持久接受时，调用方不得宣称 Task
  已提交；禁止 fire-and-forget、旁路队列或周期扫描兜底。
- **TL-23 — 失败、重试、取消是三种事实。** 仍可重试时只投影 retrying；最终失败只持久化 registry
  code、内部诊断、受限 details 与 origin 组成的同一 FailureRecord；Task 是该事实唯一 owner，Resource
  只保存生命周期并通过当前 taskId 读取失败。用户取消只写 canceled 且 failure 必须为空；公开出口
  只能投影 allow-list details，消费者不得从文案反解状态。
- **TL-24 — Worker 只执行冻结计划。** payload 携带 planner 已验证的模型、canonical 参数与精确
  Resource 版本。handler 不读当前项目配置、不补 capability 默认、不换模型、不静默丢弃已冻结字段。

## 权威入口

- Task 定义、registry 与原子创建：`src/lib/task/**`
- 执行调度与 Workflow/Activity：`src/lib/temporal/**`
- Provider 提交 fence：`src/lib/task/provider-invocation.ts`
- 终态与物化：`src/lib/task/terminal/**`、`src/lib/workspace-resource/task-materializer.ts`

## 踩过的坑

- 收费媒体只有 image 从 ledger 读实际 accepted route，video/music/voice 写请求里的 primary
  model → 新增实例漏接既有契约 → 四类统一走同一交接入口，缺 route 原地失败（TL-08）。
- 取消补偿曾在 poll/handler catch 里直接调 Provider cancel，可能取消已经赢得本地终态的工作 →
  补偿顺序早于终态裁决 → 只有 terminal 拿到正式 canceled receipt 后才补偿（TL-10）。
- 换 transport 后 cancel 与 completed 的竞态复发过一次：同一"已提交结果优先"不变量，上一版
  防线只覆盖旧 Worker → 现在 cancel、失败结算与 replay 都先读同一 handler checkpoint。
- 音视频本地进程曾用 `-shortest`、多路 EOF 或固定 timer 判断完成，出现 99% 停滞 → 用传输层
  信号猜业务完成 → deadline 只从明确媒体时长派生。
- 终态 materializer 曾在成功/失败/取消三条路径都先解析完整领域 payload；契约一分歧，
  Provider 尚未调用的确定性失败也无法收口，Temporal 反复重试同一个不可能成功的终态 →
  失败与取消只消费 registry、target 与 canonical error，完整 payload 只属于成功路径。
- Task 与 WorkspaceResource 曾各存一份 errorCode/errorMessage，Worker 又在持久化前覆盖 Provider
  原因；新增 reader 每次只接一部分字段，同一失败换入口反复丢失 → Task 独占完整 FailureRecord，
  checkpoint、Temporal 与 follow-up 原样传递，Resource 只经 taskId 投影（TL-23）。
- COS 曾返回 `UserNetworkTooSlow`，但 S3 adapter 没有把该 Provider identity 归一化为可重试网络失败；
  通用 retry 因 fallback `INTERNAL_ERROR` 不可重试而在第一次上传后终止，已经付费生成的媒体无法物化且
  用户冻结额度只能回滚 → 外部存储 adapter 显式归一化低速、超时、限流与 5xx，基础设施 retry 在
  同一 business attempt 内复用已生成结果（TL-06/23）。
