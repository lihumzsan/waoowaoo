# Assistant Choice 确认命令原子化（2026-07-12）

## 分类与历史分诊

- 任务类型：D（Architecture Incident）。
- 真实范围：项目 `fe60125e-6081-4052-b23f-6765c8cb1254`、剧集 `ad6cb93d-b523-4668-8d34-c2c60b263c8c`。
- 历史分类：同一不变量换形式复发。`1650444ce` 正确删除了“AI 停止且仍有 `nextAction` 就失败”的第二 Run 解释者，但保留了“结构化 Choice 只记录决定，再由 AI 转发确认 Operation”的旧规则。真实路径因此从“停止并失败”变成“停止并 completed”，仍需用户额外发送“继续”。
- 真实证据：Run `f87cae53-ed44-4328-a3c8-bf5bddd1048a` 完成 `confirm_bible` 后没有 `generate_edit_style_previews`；下一 Run `815b2464-ebc9-44cd-9b3d-0eb99337a699` 才生成视觉候选。该 Run 随后完成 `confirm_edit_style_preview`，但没有 `plan_chapters`；下一 Run `b4c5c27c-4d19-4d67-bcaa-e098c97f74c0` 才提交章节规划。

## 目标、非目标与禁止范围

目标：

1. 用户通过持久 Choice Offer 提交的确定性、非收费、事务型确认命令，不再由 AI 二次转发；Choice 消费与权威 Operation 写入原子完成。
2. 确认完成后，只从正式领域事实重新解析 Workflow，并把确认结果与刷新后的唯一状态交给 AI；删除同一回合的旧状态模拟。
3. 覆盖全部同类确认：剧本确认、制作规划确认、视觉风格选择、资产审核通过；禁止按阶段或 operation id 在 route/runtime 写特例。
4. 用户命令仍由 registry 映射到唯一 Operation；Choice route、renderer 与 Panel 不获得领域写权。
5. 后续创作动作仍由 AI 从刷新后的 `nextAction` 发起；收费媒体继续经过独立 plan/quote/Approval。

非目标：

- 不修改核心剪辑计划生成提示词、章节事实契约或 `plan_chapters` 内容校验。
- 不把任意 Workflow `nextAction` 变成服务端自动执行义务。
- 不自动批准 `generate_edit_style_previews`、资产返工或其他收费媒体操作。
- 不在本阶段把剧本录入、修改意见或收费返工 Choice 全部改为直接执行；这些需要 Task/Approval handoff 或新的 revision Operation 输入契约。
- 不执行 schema migration、数据回填或历史 Run 修复。

禁止范围：

- 禁止按 `confirm_bible`、`confirm_edit_style_preview` 或具体 stage 写分支。
- 禁止由模型文案、历史消息或 UI 文案推断用户是否确认。
- 禁止在数据库事务中调用外部 LLM。
- 禁止新增第二 Operation executor、第二 Workflow 状态机或失败 fallback。

并行边界：调查期间存在独立的视觉候选 Canvas/投影任务；该任务已经单独提交。本事故不修改其 renderer、Canvas registry、样式或 i18n，只复用其已落库的 Golden checkpoint 断言，并逐 hunk 审核本事故涉及的共享文件。

## 入口与所有权

| 入口/事实 | canonical identity / scope | 唯一 owner / writer | 本次语义 |
| --- | --- | --- | --- |
| Choice Offer | interruptionId + cardId + toolCallId + reviewed fingerprint | Choice handoff/settlement | 不变；仍是用户可提交命令的唯一授权单据 |
| ChoiceDecision | interruptionId + normalized response | `consumeProjectAgentChoiceInterruption` | 严格解析并只保存规范化决定 |
| Choice 命令映射 | choiceType + decision | `EDIT_FIRST_CHOICE_REGISTRY` | 新增穷尽的确认命令声明与输入构造 |
| 领域确认写入 | Operation id +领域实体 identity | 对应 registry Operation | writer 不变；Choice 消费事务只通过统一 invocation authority 调用 |
| 确认 Activity | runId + activityId + interruption causal identity | ProjectAgent Event reducer | 与命令结果同事务提交；不得由 AI 再创建同义确认 |
| Workflow | projectId + episodeId 正式领域事实 | `resolveEditFirstWorkflowState` | 确认提交后重新读取；不再应用旧状态 overlay |
| AI execution segment | choice-response interruptionId | Run event reducer | 只在数据库中原子取得一次续跑资格；事务提交后才调用 LLM |
| 后续媒体/Task | Operation plan、Approval、Wait、Task identity | 既有 invocation/handoff owner | 不变；AI 可从新状态发起，但服务端不自动执行 |

权威执行链：Choice control route → `consumeProjectAgentChoiceInterruption` → registry command resolver → `operations/invocation` 的事务型统一入口 → Operation `executeInTransaction`。route 只做鉴权、输入控制与调用 service。

## 正常与异常时序

正常确认：

1. 锁定当前 Run 与 pending Choice interruption。
2. 校验 interruption/card/tool identity 与受审资源 fingerprint。
3. 严格解析 ChoiceDecision，并由 registry 解析确认命令与 Operation 输入。
4. 在同一数据库事务内调用非收费事务型 Operation、写 Activity、消费 interruption、写 `run.execution_started` 与可见用户消息。
5. 提交后发布资源变更通知，重新读取正式 Workflow。
6. AI 只收到“Choice 已应用”的结果与确认后的新状态，再决定并调用后续动作。

结果矩阵：

| 情况 | 结果 |
| --- | --- |
| identity/fingerprint/decision 不合法 | 事务回滚；Choice 保持 pending；无领域写入、Activity 或 AI segment |
| registry 未声明确认命令 | 原地失败；不得猜测 nextAction |
| Operation 非事务型、收费、长任务或 schema 不匹配 | contract/conformance 失败；不得降级为 AI 转发 |
| Operation 执行失败 | 事务回滚；Choice 保持 pending；用户可重试 |
| 事务提交后 LLM/provider 失败 | 用户确认与 Activity 保留；Run 按真实模型错误结算，不重放确认 Operation |
| AI 从新状态正常停止 | Run completed；已确认事实保留；服务端不自动耗尽后续 `nextAction` |
| AI 发起收费媒体 Operation | 创建精确计划与 Approval；未批准不得提交 Task |
| 重复/并发 Choice 提交 | pending 行锁与 consumed 状态只允许一次成功 |
| 刷新、断线、晚到旧卡 | 持久 Offer/Decision/Activity/Workflow 投影；旧 fingerprint conflict |

## 事务、幂等与崩溃边界

- Choice 消费、确定性确认写入、Activity 与 execution-started Event 使用同一 Prisma transaction。四类确认 Operation 必须声明 `executeInTransaction`、`confirmation.kind=none`、非 long-running、非 external side effect。
- 外部 LLM 调用严格发生在事务提交之后；事务内只持久化 execution segment 资格。
- interruptionId 是用户命令的幂等身份；Choice `pending → consumed` 单调且不可重开。Activity 与 execution-started idempotency key 从该 identity 派生。
- 事务提交前崩溃等价于未发生；事务提交后、LLM 前崩溃保留已确认事实并由 Run recovery 明确处理，禁止再次执行确认。
- 资源变更通知发生在事务提交后，只用于刷新体验，不承担确认正确性。

## 删除项与数量变化

删除：

1. 确定性确认 Choice 的 `oldWorkflow + decision → temporary nextAction` 运行时 overlay。
2. 确认回合让 AI 调用 `approve_script` / `confirm_bible` / `confirm_edit_style_preview` / `approve_edit_script_assets` 的中转职责。
3. 模型确认前说明 + Operation 成功后再次说明造成的同义确认链路。

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 用户确认解释者 | 2（Choice registry 决定 + AI 再选择 Operation） | 1（Choice registry 命令） |
| 领域确认 writer | 1（Operation） | 1（同一 Operation） |
| 确认执行入口 | 1（AI Tool adapter）但发起者不确定 | 1（统一 invocation；Choice command/AI Tool 共用 authority） |
| 确认后 Workflow 状态源 | 2（旧 overlay + 新 DB） | 1（新 DB resolver） |
| 任意 nextAction 自动执行器 | 0 | 0 |

## 测试计划与盲区

适用证据：

- Registry Conformance：穷尽枚举生产 Choice registry，证明所有确认命令均映射到存在的非收费事务型 Operation，输入通过生产 schema；会拒绝新增确认 Choice 却遗漏命令、映射收费 Operation 或退回非事务执行。
- Critical Infrastructure：使用真实数据库与生产 consume/invocation owner，验证 Operation 失败时 Choice、领域状态、Activity 和 execution segment 全部回滚；验证重复提交只执行一次。只有一个明确的 Operation failure seam 才符合准入。
- Golden Journey：更新现有真实主线/下游 checkpoint，不新增 synthetic history 场景。点击制作规划确认后不发送“继续”即到视觉候选 Approval；选择视觉风格后不发送“好的继续”即创建 `plan_chapters` Wait/Task；刷新后确认呈现一次。
- 外部真实 LLM 是否每次调用推荐 nextAction 不是确定性 CI oracle；Golden provider 只证明生产状态、工具面与组合协议，真实模型 smoke 只能报告为附加证据。

未验证盲区：自由文本修改 Choice、`revise_bible` 当前 revisionNotes/完整 Bible 输入不一致、收费资产返工的直接 Approval handoff、真实付费模型行为。上述均不得宣称由本阶段解决。

### 实际验证结果

- `npm run typecheck`：通过。
- `npm run check:architecture`：通过；包含 Operation 唯一 invocation authority 等结构检查。
- `npm run test:logic`：93 个文件、422 个测试通过，0 skipped/todo。
- `npm run test:critical:task`：25 个文件、73 个测试通过，0 skipped/todo；包含真实 MySQL 上 Choice 确认成功、失败整笔回滚、重复消费与 execution segment 防重放。
- `npm run test:golden:self`：7 个文件、36 个测试通过；34 个场景全部挂载，0 skipped/todo。
- `npm run test:golden:variant:model-stop`：1 个 Golden 场景通过，0 skipped/todo。
- `npm run test:golden:mainline`：1 个完整空项目到最终持久结果的 Golden 场景通过，0 skipped/todo。
- 定向下游 Golden checkpoint：4 个 checkpoint 通过，0 skipped/todo；制作规划确认后无需用户唤醒即可到视觉候选 Approval，视觉风格确认后无需用户唤醒即可提交 `plan_chapters`，并验证两类成功呈现各一次。

这些证据验证生产入口、数据库、Redis、队列、worker、Outbox、SSE 与浏览器投影的组合行为；它们不把本地确定性模型模拟器解释成真实外部 LLM 输出保证。

## 历史回归矩阵

| 历史症状 | 根因 | 旧修复 | 当前防线 | 本次复发与失效原因 |
| --- | --- | --- | --- | --- |
| `confirm_bible` 后模型停止被判 Run 失败 | capability 被解释为 obligation | 删除 `PROJECT_AGENT_AI_TURN_PROTOCOL_REQUIRED` | model-stop Golden 证明可正常停止 | 只修正 Run 终态，没有修正 Choice 作为用户命令的所有权 |
| 制作规划确认后需用户再发“继续” | 确认由 AI 转发；确认后模型仍看到旧 snapshot | 提示词要求同回合继续 | 无真实模型确定性保证 | 新工具权限已刷新，但模型唯一权威状态未刷新 |
| 视觉风格确认后需用户再发“好的继续” | 同一 Choice relay + stale snapshot | 无独立修复 | 主线模拟器偶尔按私有顺序继续 | 外部模型正常停止，真实 Run 中没有 `plan_chapters` Activity |
| 一次确认出现两条成功语义 | Choice 请求 Activity、AI 前后文本与确认 Operation 缺少单一呈现 identity | 只保证数据库 Operation 一次 | durable Activity/Interruption | 执行事实唯一但用户可见投影未按因果 identity 合并 |
