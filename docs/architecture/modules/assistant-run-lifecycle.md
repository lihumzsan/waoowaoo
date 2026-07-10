<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Run 生命周期

## 设计理念

Assistant 是受服务端运行时约束的决策者，不是流程状态的权威来源。一次 run 的开始、等待、任务关联、恢复、结算和失败必须由服务端持久状态与锁协调；模型消息、UI 文案或工具输出不能自行宣告流程已完成。

## 不变量

- **AR-01 — 服务端权威。** thread/run 的 append、终态、锁和恢复由服务端管理；客户端和模型不得持有第二套 run 状态。
- **AR-02 — 每回合有结算语义。** 一个 turn 必须明确是完成、等待用户、等待 Task、继续 Agent 还是失败；零输出、伪完成和停滞必须显式报错或进入明确状态。
- **AR-02A — Choice 续跑不可静默完成。** 用户提交结构化选择后，服务端必须重新读取 Workflow；若存在已启用的权威 `nextAction`，本回合必须执行该 operation、进入 approval/choice/Task 等等待态或显式失败，不得只输出成功文案后把 run 标记为完成。
- **AR-03 — Task 终态驱动继续。** Task 成功/失败后的唤醒只由持久任务终态触发，并以幂等方式关联到对应 run。
- **AR-03A — 失败不授权改写。** 已确认剧本的制作规划任务失败只允许 Assistant 解释并等待用户决定；失败终态不得自动授权重写剧本或提交新输入。
- **AR-04 — 用户界面只呈现产品语义。** 运行卡片可展示本地化操作名和任务数量，不得展示 taskType、targetType、targetId、operationId、原始工具参数或原始工具结果；这些字段只用于诊断日志和持久协议。
- **AR-04 — 工具契约在 registry。** operation 的输入、confirmation、agentFlow、plan/commit 与输出 schema 必须在 registry 统一声明；不得以 operation id 特判或从文案反推控制流。
- **AR-05 — 并发与心跳可证明。** 锁、心跳、超时取消和恢复必须由同一运行时状态协调；旧 run 不得覆盖新 run 的结果。
- **AR-06 — Run 转换单调。** Run 只使用 `running`、`awaiting_approval`、`awaiting_choice`、`awaiting_task`、`completed`、`failed`、`cancelled` 七种状态。状态转换必须经事件 reducer 校验合法前驱并执行 CAS；三个终态不可重开。失去 DB heartbeat 或 Redis lock 所有权必须中止模型流并进入 `cancelled/run_lock_lost`，不得继续写入或伪装成业务失败。

## 权威入口

- Project-agent runtime：`src/lib/project-agent/`。
- Operation registry 验证：`src/lib/operations/registry.ts`。
- Operation 类型和 agentFlow：`src/lib/operations/types.ts`。

## 验证

- `tests/unit/project-agent/runtime-routing-*.test.ts` 按 bootstrap、choice、workflow、approval 与 settlement 验证运行时路由。
- `tests/unit/project-agent/run-state-machine.test.ts` 验证七状态转换、终态单调和 expected-status 门禁。
- `tests/unit/project-agent/run-heartbeat.test.ts` 验证 DB/Redis 续租失败和异常都会触发 ownership loss。
- `tests/unit/project-agent/interruption-consume.test.ts` 验证重复/并发消费由 pending 状态 CAS 拒绝，基础设施故障不会伪装成重复提交。
- `tests/unit/project-agent/interruption-reopen.test.ts` 验证 interruption 按消费代次幂等重开且失败显式上报。
- `tests/unit/project-workflow/edit-first-*.test.ts` 按剧本、规划、分镜视频与渲染音频验证失败状态不会开放错误操作。
- `tests/unit/project-agent/tool-adapter-gates.test.ts` 验证工具确认与执行门禁。
- `tests/unit/operations/registry.test.ts` 验证 operation metadata、confirmation 和 agentFlow。
- `scripts/guards/no-client-agent-control.mjs` 阻止客户端成为 Agent 控制面。
- `scripts/guards/no-assistant-fixed-workflow-surface.mjs` 阻止将固定流程伪装成 Agent 自主运行。
- `scripts/guards/no-history-state-inference.mjs` 阻止从历史消息推断当前业务状态。
- `scripts/guards/no-project-agent-direct-task-submit.mjs` 阻止 Assistant 控制层直接提交 Task 并绕过 operation/Wait。
- `scripts/guards/no-plan-run-runtime.mjs` 阻止已退役的 PlanRun runtime、API 与 operation 入口重新形成第二套 Assistant 执行状态机。
- `tests/integration/api/specific/workflow-lab-service.integration.test.ts` 与 `workflow-lab-style-choice.integration.test.ts` 验证 Lab Choice 也经同一事件 reducer 投影并共用目标 runtime identity，Approval checkpoint 不伪造不可消费的运行态。
- `scripts/guards/project-agent-run-state-machine-guard.mjs` 扫描全 `src` 的 Run、Activity、Interruption 生命周期写入，阻止 reducer 外重新出现第二写入者，并阻止 session-state GET 恢复 stale cancellation 副作用。仅允许 `heartbeatAt` 与已消费 interruption `runState` 清理两个明确的非生命周期维护写入。

## 历史回归

- `227b2d288` 收敛 server-owned append、heartbeat 与 Redis lock；`41c5a13a` 随后仍修复 run settlement race，说明局部加锁不能替代完整 run 语义。
- `7f8e161be` 修复 stale bootstrap、heartbeat、tool leak、noop/stall 等多个症状，表明需要把这些症状收敛为同一生命周期契约。
- 制作规划 choice 曾通过局部副作用提交视觉风格 Task，导致模型文案、候选记录、run/Wait 三套状态分离；Choice 只负责落用户决定，异步执行必须回到 registry 与 runtime。

## 修改检查表

1. 此改动触及哪一种 run 结算结果？
2. 谁写入权威状态，谁只能读取或投影？
3. Task 终态如何幂等地唤醒正确 run？
4. 并发、重放、心跳超时和取消是否有测试？
5. 是否新增了按 operation id 或消息文本的控制流特判？若是，必须重做为 registry/状态机语义。
6. Choice 落库后若 Workflow 存在 `nextAction`，run 是否证明已执行、等待或显式失败？
7. 此转换是否带有可区分同状态代次的持久 `runVersion/eventSeq`？仅比较 status 不能阻止 ABA，未具备版本围栏时必须明确记录为未完成风险。
