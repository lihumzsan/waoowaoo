<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Run 生命周期

## 设计理念

Assistant 是受服务端运行时约束的决策者，不是流程状态的权威来源。一次 run 的开始、等待、任务关联、恢复、结算和失败必须由服务端持久状态与锁协调；模型消息、UI 文案或工具输出不能自行宣告流程已完成。

## 不变量

- **AR-01 — 服务端权威。** thread/run 的 append、终态、锁和恢复由服务端管理；客户端和模型不得持有第二套 run 状态。
- **AR-02 — 每回合有结算语义。** 一个 turn 必须明确是完成、等待用户、等待 Task、继续 Agent 还是失败；零输出、伪完成和停滞必须显式报错或进入明确状态。
- **AR-03 — Task 终态驱动继续。** Task 成功/失败后的唤醒只由持久任务终态触发，并以幂等方式关联到对应 run。
- **AR-04 — 用户界面只呈现产品语义。** 运行卡片可展示本地化操作名和任务数量，不得展示 taskType、targetType、targetId、operationId、原始工具参数或原始工具结果；这些字段只用于诊断日志和持久协议。
- **AR-04 — 工具契约在 registry。** operation 的输入、confirmation、agentFlow、plan/commit 与输出 schema 必须在 registry 统一声明；不得以 operation id 特判或从文案反推控制流。
- **AR-05 — 并发与心跳可证明。** 锁、心跳、超时取消和恢复必须由同一运行时状态协调；旧 run 不得覆盖新 run 的结果。

## 权威入口

- Project-agent runtime：`src/lib/project-agent/`。
- Operation registry 验证：`src/lib/operations/registry.ts`。
- Operation 类型和 agentFlow：`src/lib/operations/types.ts`。

## 验证

- `tests/unit/project-agent/runtime-routing.test.ts` 验证运行时路由。
- `tests/unit/project-agent/tool-adapter-gates.test.ts` 验证工具确认与执行门禁。
- `tests/unit/operations/registry.test.ts` 验证 operation metadata、confirmation 和 agentFlow。
- `scripts/guards/no-client-agent-control.mjs` 阻止客户端成为 Agent 控制面。
- `scripts/guards/no-assistant-fixed-workflow-surface.mjs` 阻止将固定流程伪装成 Agent 自主运行。
- `scripts/guards/no-history-state-inference.mjs` 阻止从历史消息推断当前业务状态。

## 历史回归

- `227b2d288` 收敛 server-owned append、heartbeat 与 Redis lock；`41c5a13a` 随后仍修复 run settlement race，说明局部加锁不能替代完整 run 语义。
- `7f8e161be` 修复 stale bootstrap、heartbeat、tool leak、noop/stall 等多个症状，表明需要把这些症状收敛为同一生命周期契约。

## 修改检查表

1. 此改动触及哪一种 run 结算结果？
2. 谁写入权威状态，谁只能读取或投影？
3. Task 终态如何幂等地唤醒正确 run？
4. 并发、重放、心跳超时和取消是否有测试？
5. 是否新增了按 operation id 或消息文本的控制流特判？若是，必须重做为 registry/状态机语义。
