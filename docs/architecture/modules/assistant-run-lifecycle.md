<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Thread、Turn 与交互生命周期

## 设计理念

Codex app-server 拥有单个 Agent 进程内的 Thread/Turn 与原生交互；Wao 拥有产品身份、准入、持久 View、刷新恢复、计费审批和跨进程唤醒。Session Manager 只做 placement、互斥、恢复和空闲停止，不再解释模型思考或工具选择。

## 不变量

- **ARL-01 — Project scope。** Product Thread 只属于 `(userId, projectId)`；不存在 Episode thread 或从消息推断 scope。
- **ARL-02 — 一个活跃 Turn。** 同一 Project Runtime 同时最多一个 Turn。新消息在活跃 Turn 可用 Codex `turn/steer`；明确取消用 `turn/interrupt`。不得另建 supersede 状态机。
- **ARL-03 — 产品 View 独立持久。** 用户消息、assistant item、Plan、Goal、request_user_input、Web Search、命令、Diff、MCP、Skill、Subagent、审批与 compaction 由事件 projector 写入 MySQL View；刷新不读取 Codex 本地文件格式。
- **ARL-04 — 原生请求原生响应。** Codex server request 以 `(turnId, runtimeRequestId)` 唯一；Wao 审批卡/选择卡只响应该 request。重复响应幂等，未知/已结算 identity 失败。
- **ARL-05 — 两类审批同一 UI、不同权威。** Shell/patch/sandbox 权限响应 Codex request；付费媒体响应 Wao PlanSnapshot/预算授权。UI 可统一展示，但不能互相授权。
- **ARL-06 — Runtime 终态不是 Task 终态。** Turn 可以在媒体 Task 仍运行时结束/停止；Temporal 继续完成 Task。FollowUpBatch 按持久 batch identity 至多一次向 Product Thread 注入新 Turn。
- **ARL-07 — 崩溃可恢复。** Runtime 退出或 Manager ownership 丢失时先记录 interrupted 并结算废弃 Turn；只有持久化过 Codex state 和 thread binding 才允许 resume。
- **ARL-08 — i18n。** UI 状态与错误来自当前 locale；Codex 原始协议方法名不得直接作为用户文案。

## 状态所有权

| 事实 | Owner / writer |
| --- | --- |
| Codex Thread/Turn 内部状态 | app-server；Wao 保存不透明 resume state |
| Product Thread/Turn/View | AssistantRuntime persistence/projector |
| 活跃 Runtime placement | Runtime Session Manager + ownership claim |
| 原生 request 等待/结算 | AgentTurnInteraction + runtimeRequestId |
| 付费授权 | OperationPlanSnapshot / ApprovalGrant / Billing ledger |
| 长期媒体终态 | Task Terminal Service / Temporal |
| Task 完成后的唤醒 | FollowUpBatch 唯一 writer |

## 正常与异常时序

用户消息先持久化，再准入 Runtime；start/resume 成功后开始 Turn，事件逐个投影，结束时 capture Workspace 与 Codex state。断线只影响 SSE 传输，刷新从 MySQL View 恢复。重复消息由 client message identity 拒绝；Manager 重启通过 ownership 与持久 binding reconcile；晚到旧 Runtime 事件因 Turn/runtime identity 不匹配而拒绝覆盖。

## 权威入口

- `src/lib/assistant-runtime/**`
- `src/lib/codex-runtime/runtime-session-manager.ts`
- `src/lib/agent-turn/**`
- `/api/projects/[projectId]/assistant/**`
- `src/features/project-workspace/components/workspace-assistant/**`

## 验证

真实协议 smoke 与持久层场景覆盖 start/resume、steer、interrupt、request response、进程退出、Manager 重启、断线刷新、重复消息、晚到事件、Task late completion 和 FollowUpBatch 至多一次。关键 UI renderer 由共享 View union 穷尽，未知关键 item 明确显示错误。

## 修改检查表

- 是否把 Codex 内部状态误当成产品聊天事实，或反过来？
- 是否出现第二个 active-turn/steer/interrupt 判定器？
- 原生审批和计费审批是否只统一外观、没有混用 authority？
- Runtime 退出后 Task 是否仍可完成且只唤醒一次？
