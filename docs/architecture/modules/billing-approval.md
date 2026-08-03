<!-- architecture-module: billing-approval -->

# 计费与审批

## 设计理念

所有收费 Operation 先形成不可变 PlanSnapshot 和 quote，再由用户逐次批准或预算授权，最后才创建 Task/扣费。Web、Wao MCP 与未来 CLI 都调用同一 planning/submit service；渠道不拥有价格、余额、冻结或重试语义。

## 不变量

- **BA-01 — 价格唯一。** 价格目录、模型/参数和输入数量经 billing policy 计算；模型、UI、MCP schema 与客户端不得自行估价。
- **BA-02 — 计划先于副作用。** 付费前完成权限、模型、参数、WorkspaceResource 引用、Placement、输出数量与路径冲突校验；PlanSnapshot 创建前不得提交 Provider 或创建 pending Resource。
- **BA-03 — 冻结同一输入。** Snapshot 冻结实际读取的 `resourceId + contentVersion + workspacePath`、Operation revision、模型参数、输出 Placement 和 quote。Production Manifest 的执行快照就是该 Snapshot，不建立第二份冻结。
- **BA-04 — Project scope。** 收费 Project Operation 只以 `userId + projectId` 授权；资源身份来自冻结引用，不存在 Episode/Chapter/scopeRef 推断。
- **BA-05 — 授权精确。** ApprovalGrant 只授权一个 Snapshot 或明确金额/范围/期限的预算；Codex shell/patch 审批不能授权消费，普通 request_user_input 也不能。
- **BA-06 — 提交幂等。** 同一 API/MCP request identity、Snapshot 与 execution identity 重放返回同一 Task/Batch；输入或 contract revision 不同则 typed conflict，不能再扣费。
- **BA-07 — 账本唯一。** Billing ledger 是冻结、扣减、退回和展示的唯一 writer；Task、Provider webhook、UI 和 Agent 都不能直接改余额。
- **BA-08 — attempt 与业务收费分离。** Provider attempt 可重试，但同一业务执行只持有一份授权和费用。未提交 Provider 的失败释放冻结；已经产生不可撤销成本的结算遵循 ledger policy。
- **BA-09 — 批量仍是一次计划。** `submit_production_manifest` 对整个批次一次校验/报价/授权，然后以稳定 item identity 扇出。每项结果独立，失败项续跑复用原 Snapshot，不重新收费成功项。
- **BA-10 — 审批结果可审计。** 用户、Project、Snapshot、Grant、Task/Batch、金额、币种、catalog revision 和时间均持久化；UI 只消费服务端 View。
- **BA-11 — 报价消费 canonical Task 字段。** Production planner、billing policy 与 Task handler 必须消费同一冻结 payload；视频/音频时长以 `durationSeconds` 为唯一 Task 字段，billing 和执行只能在各自边界把它映射成价格/provider 所需的 `duration`，不能从自由 `generationOptions` 或旧字段另行解释。
- **BA-12 — 破坏性审批冻结精确输入。** 非计费删除在展示审批卡前先按 Operation schema 规范化输入；approval identity 必须包含 canonical input hash，卡片展示精确目标，执行只消费同一份规范化输入。只绑定 Turn/call/operation 的通用“确认删除”不能授权另一组目标。
- **BA-13 — 取消或清空先到则不得开始副作用。** 浏览器 Turn cancel 与 pending/decided interaction 在 Project 锁下原子关闭；浏览器审批证明要求同 Turn 未取消且 Thread 未进入 clear。同步写、approved-plan 提交和 direct durable execution 在业务事务内按 Project→Thread→Turn 获取同一 effect fence，先取消或 clear 则不能创建 Task、扣费或删除资源。

## 权威入口

| 事实或动作 | 唯一入口 |
| --- | --- |
| 价格与 quote | `src/lib/billing/**`、pricing catalog |
| PlanSnapshot 与 request identity | `src/lib/operations/planning.ts`、`operation-plan-snapshot.ts`、`api-request-identity.ts` |
| Grant 与执行重验证 | operation approval routes + `operation-plan-revalidation.ts` |
| Task/Batch 原子提交 | `src/lib/task/approved-plan-submitter.ts`、`transactional-create.ts`、Wao MCP production executor |
| 余额与交易 | `src/lib/billing/ledger.ts` / `service.ts` |
| 用户 View | billing reporting + profile/assistant UI |

## 失败与恢复

报价过期不会静默重算；contract/model/资源版本变化要求新 Snapshot。提交 ACK 不明时按 request/execution identity 查询同一结果。Task 创建与 Temporal dispatch 之间必须原子或显式补偿；Provider 结果晚到只由当前 attempt/terminal CAS 接受。取消只停止未承诺的后续执行，不能伪造退款。

## 验证

真实 MySQL/Redis/Temporal critical suites 覆盖余额不足、重复 plan/execute、并发提交、冻结释放、Provider retry、晚到终态、批量部分失败和续跑不重复收费。Operation registry conformance 穷尽验证所有 Resource-producing/收费能力都声明 Placement、Plan 与计费 policy。

## 修改检查表

- 新收费入口是否仍只调用共享 plan/submit/ledger？
- Snapshot 是否冻结实际版本、Placement 和 quote，而不是只保存 prompt？
- MCP/Web/CLI 是否共享 request identity 与幂等执行？
- 批量重试是否只处理失败 item，且不会重新扣成功 item？

## 历史回归

- WorkspaceResource clean cutover 首版把 Manifest 的 `durationSeconds` 正确冻结到 Task payload，但通用视频计费与新视频 handler 仍读取旧 `generationOptions.duration`；四段 15 秒 Manifest 因而在审批前被误判为“缺时长”，即使绕过报价也会在执行时丢失时长。当前 Task schema 的 `durationSeconds` 是唯一事实，billing 与 provider 调用分别显式映射；视频/音频计划缺时长在 planner 原地失败。
- 同一批次修复时，通用 planning policy 已向含图片/视频的 Plan metadata 冻结 `projectVideoRatio`，但 WorkspaceResource commit 的严格领域 metadata schema 未组合这份共享字段；批准后的 OperationExecution 因此在 Task/Resource 事务前连续失败。当前比例快照 schema 与 key 由 ratio policy 导出，领域 commit 显式组合它，严格解析仍拒绝所有未知 metadata。
- Codex Runtime 与 Wao MCP 首次接通时把短期 bearer 同时当作“可调用能力”和“用户已批准”的证明；容器内代码若取得该 bearer，可自行建立 MCP session 并伪造 elicitation accept。当前 bearer 只授予传输能力；每次计费或破坏性执行的 elicitation 带稳定 approval identity，Grant/执行 writer 必须再验证由 Wao 登录态交互 route 已持久化的同 Turn 浏览器决定。Runtime 返回值本身永远不能签发用户授权。
- 浏览器审批证明首次只绑定 Turn、call 与 Operation，删除客户端可复用同一 request identity 替换目标输入。当前破坏性审批先规范化输入，将 canonical input hash 纳入 approval identity 并把精确目标展示给用户；执行路径复用该规范化值，不能在批准后重新解释原始参数。
- Interrupt 首版只在 MCP 入口检查易失 AbortSignal；等待审批期间持久 cancel 已提交后，晚到 accept 仍可经过 browser proof 创建执行。当前 interaction、approval proof 与所有 effect transaction 都检查同一 `cancelRequestId`，并用 Project 锁确定 cancel/effect 的先后关系。
- Thread clear 首版没有进入 approval/effect fence；清空已 claim 后，旧 Turn 的晚到 MCP 调用仍能签发 Grant 或提交 Task。当前浏览器证明、MCP binding 与事务 effect fence 都检查 `clearRequestId`，并共享 Project→Thread→Turn 锁序。
