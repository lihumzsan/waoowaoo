# Assistant nextAction 停止误判复发治理

## 分类与证据

- 任务类型：D（Architecture Incident）。
- 真实范围：项目 `c908a508-0961-41a2-81c4-c54c3c480e52`、剧集 `d9691954-fde9-4319-9fd5-59ebf7ec3b42`。
- 已确认事实：`confirm_bible` 只有一次成功 Activity，Bible 已锁定；视觉风格候选、Task、OperationPlan、ApprovalGrant 与 OperationExecution 均未创建；Run 随后被 `PROJECT_AGENT_AI_TURN_PROTOCOL_REQUIRED` 结算为失败。
- 历史分类：同根因复发。既有 incident 已记录“成功工具后模型停止”和“单一确认事实重复展示”，但当前产品仍把可用 `nextAction` 解释为本回合义务，且项目助手提示词仍描述已删除的“制作规划确认自动授权并提交视觉候选”路径。

## 目标、非目标与边界

目标：

1. `nextAction` 只表达当前允许/推荐的 AI 能力，不再成为 Run 必须在同一回合耗尽的义务。
2. 模型在没有 completion/tool/protocol 错误时正常停止，Run 结算为 `completed`；领域状态停留在当前正式阶段。
3. 制作规划确认只锁定规划和画面比例；视觉风格候选继续由 AI 显式调用独立 `billable_media` Operation，并经过报价与批准。
4. 提示词不得在 Tool 成功前宣告动作已完成，也不得在没有真实 Task receipt 时宣告生成已开始。

非目标：

- 不让服务端执行 `nextAction`，不新增确定性工作流执行器或第二状态机。
- 不改变 Choice、Approval、Task、Outbox、Wait、continuation 或收费媒体提交协议。
- 本阶段不修改 Golden Journey、model simulator、测试场景或测试 oracle；这些防线缺口由下一阶段单独治理。
- 不修复 UI 重复投影；本阶段只保证领域操作与 Run 事实不重复、不误判。

禁止范围：

- 禁止按 `confirm_bible` 或 `generate_edit_style_previews` 写运行时特判。
- 禁止从 AI 文案猜测是否应该继续、是否已生成或是否应失败。
- 禁止把空输出、剩余能力、timer、polling、refetch 或事件先后顺序作为业务失败依据。
- 禁止绕过 `plan → quote → ApprovalGrant → commit` 提交视觉候选 Task。

并行任务边界：本阶段只有当前工作区 owner 修改下列生产/架构文件；测试目录保持只读。

## 全部入口与投影

| 入口/阶段 | 权威入口 | 本阶段语义 |
| --- | --- | --- |
| 用户普通消息、Choice/Approval 回复 | Assistant chat route → `createProjectAgentChatResponse` | 创建或恢复唯一 execution segment，不直接执行下一业务动作 |
| AI Tool 调用 | Operation registry → `invokeProjectAgentOperation` | AI 是动作发起者；registry、channel、schema、fence 与审批裁决合法性 |
| 制作规划确认 | `confirm_bible` Operation | 唯一写入 Bible confirmed/locked 与画面比例；不创建视觉候选 |
| 视觉候选准备 | `generate_edit_style_previews` Operation | 独立收费媒体计划与批准入口 |
| AI 正常停止 | runtime `onFinish` terminal 分支 | 没有 waiting handoff、tool error 或 completion error 时结算 `completed`，即使 Workflow 仍有 `nextAction` |
| Task 终态恢复 | Outbox → Wait continuation → runtime | 沿用既有唯一 continuation；失败 Task 仍按 policy 结算失败解释回合 |
| 用户界面 | 持久 Thread、Run、Interruption、Wait、Task 的 Session 投影 | 不从历史文案或 remaining action 推断失败 |
| 调试入口 | Run/Event/Activity 日志与持久错误字段 | 真正协议错误可诊断；remaining `nextAction` 不再写 primary failure |

## 状态、事实与所有权

| 事实 | canonical identity / scope | 唯一 owner / writer | 消费者 |
| --- | --- | --- | --- |
| 当前 Workflow 与 `nextAction` | project + episode 正式领域事实 | `resolveEditFirstWorkflow` | AI state snapshot、tool enablement、UI/debug |
| AI 是否发起领域动作 | execution segment + toolCallId | AI Tool call，经 Operation invocation 提交 | Activity、领域服务、Task/Approval |
| Run 结算 | runId + runVersion + eventSeq | runtime / execution-handoff / event reducer | Session、Thread、UI |
| Bible confirmed | editBibleId / episode scope | `confirm_bible` → `confirmEpisodeEditBible` | Workflow、Canvas、视觉候选 planner |
| 视觉候选收费授权 | planSnapshotId → grantId → executionId | planned operation invocation | Task submitter、账本、UI Approval |

写入者数量不变：领域动作发起者仍为 AI Tool call 一个；Run 终态 writer 仍为既有 settlement authority 一个。删除的是第二个“remaining action 失败解释者”，不是新增 writer。

## 时序与结果矩阵

| 情况 | 结果 |
| --- | --- |
| AI 输出文字后正常停止，Workflow 仍有 `nextAction` | Run `completed`；领域状态不变；下一用户/AI 回合可继续 |
| AI 合法返回空文字且没有 Tool | Run `completed`；不伪造领域结果或 Task |
| AI 调用 Tool 并产生 Choice/Approval/Task handoff | 沿用 `awaiting_choice` / `awaiting_approval` / `awaiting_task` |
| AI Tool 返回声明的 tool error | Run `failed/tool_error` |
| provider completion、stream 或持久化失败 | 沿用明确 failure/cancelled 语义 |
| 用户取消/拒绝 Approval | 沿用 interruption 决定和后续 AI 回合，不自动提交 |
| Task 成功、失败、取消、重试、重复、晚到、replay | 沿用 Wait/Outbox/continuation identity 与 terminal owner；本阶段不改变 |
| 刷新、断线、并发请求 | 从持久 Run/Thread/Session 恢复；remaining action 不产生额外事实 |

## 事务、幂等与崩溃边界

- 删除 remaining-action 失败分支不会移动任何领域事务边界。
- Tool 已提交的领域事实仍由 invocation-owned transaction 与 Run fence 保护；正常停止只能结算 Run/Thread，不能回滚或扩大前序事实。
- Choice/Approval/Task handoff 仍优先于普通 completed settlement，并由 execution-handoff 原子提交。
- `toolCallId`、execution segment、run fence、Wait commandId 与 Approval provenance 保持现有幂等身份。
- 进程在 Tool commit 后、Run settlement 前崩溃仍由现有 execution handoff / Run recovery 处理；不得用 `nextAction` 重放领域动作。

## 删除项与数量变化

删除：

1. runtime 的 `unresolvedWorkflowAction → PROJECT_AGENT_AI_TURN_PROTOCOL_REQUIRED` 失败分支。
2. Task follow-up policy 的 `workflowNextActionIsObligation` 第二解释字段。
3. 中英文提示词中的“制作规划确认自动授权并提交视觉候选”“不要调用生成工具/不要再次计费确认”旧协议。
4. Assistant 生命周期文档中“模型停止且仍有义务必须失败”的不变量。

修改前后：

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| AI 领域动作发起入口 | 1 | 1 |
| 服务端领域动作执行入口 | 1（Operation invocation） | 1 |
| Run 普通停止解释 | 2（正常完成 / remaining action 失败） | 1（正常完成） |
| `nextAction` 业务语义 | capability + obligation | capability |
| 视觉候选授权入口 | 1 | 1 |

## 测试计划与本阶段盲区

产品修复提交后，用户授权独立测试收敛阶段。没有新增场景清单；既有
`GJ-MODEL-STOPS-AFTER-CONFIRM` 现在从空项目经过真实 UI、Task、MySQL、
Redis、worker、Outbox 与 Session 路径到达制作规划确认，只在外部模型边界
注入“`confirm_bible` 成功后正常停止”。只读 oracle 断言 Bible confirmed、
Run completed、Workflow 为 `ready_to_generate_style_previews`，且视觉候选、
图片 Task、ApprovalGrant 与 OperationExecution 均为零。

本阶段完成的既有防线修复：

- 删除 `workflowNextActionIsObligation` 的旧 Logic 断言。
- model-stop provider 只在已观察到完成的 `confirm_bible` tool call 时停止，不再在任意首个 Tool output 后停止。
- 场景声明与真实入口统一为 `not_started → ready_to_generate_style_previews`，且 `allowFailedRun=false`。
- `npm run test:golden:variant:model-stop`：1 passed，0 failed，0 skipped，0 todo。
- 相关 Logic/Harness：3 files、26 tests passed，0 skipped，0 todo；`npm run typecheck` passed。

deterministic mainline model 的固定 happy-path 顺序仍只用于外部模型替身和系统链路验证，不能作为真实 LLM 提示词行为证据；本 incident 不要求外部 LLM 必须继续调用工具。

本阶段未验证盲区：真实模型在新提示词下是否稳定继续发起独立视觉候选 Approval（不作为确定性测试目标）；模型完全空输出的浏览器呈现；历史 failed Run 的旧错误文案展示；重复 success UI 投影。

## 历史回归矩阵

| 历史症状 | 根因 | 旧修复 | 当前防线 | 本次复发与失效原因 |
| --- | --- | --- | --- | --- |
| `confirm_bible` 成功后仍有视觉候选动作，Run 失败 | prompt/context/completion 协议未一致 | remaining `nextAction` 显式失败，禁止服务端执行 | 真实 model-stop Golden + durable oracle | 防线现验证正常停止完成且零后续副作用，不再把 capability 写成 Run 失败 |
| 制作规划确认曾自动提交视觉候选 | 免费确认与收费媒体授权合并 | 拆为独立 billable operation | billing contract、operation registry | 项目助手提示词仍保留已删除的自动提交旧协议 |
| 完整 Journey 通过而真实模型失败 | deterministic model 私有顺序替代 LLM 判断 | 固定优先级走通全链 | mainline 只证明系统链；model-stop 独立注入停止 | model-stop 已真实到达 Bible 确认；mainline 不再被解释为提示词行为证明 |
| 一次确认显示两次 | live/persisted/Activity 投影缺少统一呈现 identity | 仅检查持久 message/toolCall identity | mainline final oracle | 不检查同一消息内语义重复或浏览器可见 lifecycle 次数；本阶段暂不修 UI |
