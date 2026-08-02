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
