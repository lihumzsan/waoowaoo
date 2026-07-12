<!-- architecture-module: chapter-planning -->

# 章节核心剪辑规划

## 设计理念

章节核心剪辑计划把已确认剧本与章节事件组织成 shots 和 generationSegments。模型是镜头结构生成者，不是剧情事实、资产 identity 或生命周期事实的 owner。章节 ledger 是持久剧情事实的唯一权威；模型不得复制、改写、选择或补造第二份事实台账。

## 不变量

- **CP-01 — Ledger 事实唯一。** 入章事实来自 ledger snapshot，本章新增持久事实来自 ledger events。`persistentFactsIntroduced` 等 provenance 投影必须由服务端直接从本章 events 构造，模型输出不得包含事实台账字段。
- **CP-02 — 模型只写镜头结构。** structure prompt/schema 只允许 `shots` 与 `generationSegments`；额外字段必须由 strict schema 显式拒绝，不得静默删除。
- **CP-03 — 禁止自然语言事实 identity。** 不得用 substring、字符/token overlap、embedding 或其他语义相似度把模型文本解释为 canonical fact。
- **CP-04 — 资产 identity 显式。** locationId 与 characterId 只能来自已确认 asset menu 的动态枚举；subScene、performance、keyObjects 等描述无权创建新资产 identity。`performance` 字段必须存在，但允许规范化为空字符串，不能因缺少表演描述阻断整章计划。
- **CP-05 — 成功写入受 Task owner 约束。** EditScript 正式资源与 provenance 在同一 owner-fenced 成功事务提交；失败 attempt 不得写最终章节事实或计划。

## 权威入口

- 章节输入与 ledger：`src/lib/edit-chapter/input-assembler.ts`。
- 模型输出契约：`src/lib/edit-chapter/schemas.ts` 与 `src/lib/ai-prompts/templates/edit-script/structure/`。
- 持久事实投影：`src/lib/edit-chapter/persistent-facts.ts`。
- 核心计划生成与成功事务：`src/lib/edit-script/service.ts`。
- Task lifecycle、provider invocation 与重试仍分别服从 `async-task-lifecycle` 和 `provider-gateway`。

## 验证

- `tests/unit/edit-chapter/persistent-facts.test.ts` 是 Logic Specification：验证 ledger event facts 的确定性顺序、去重和 exact projection。
- `tests/golden-journey/self-tests/model-provider.test.ts` 验证协议替身输出可被生产 strict schema 消费；它不代替真实模型行为。
- `tests/golden-journey/journeys/structured-stream-preview.spec.ts` 如覆盖核心剪辑生成，则以其既有 canonical command 证明真实 UI/Task/worker/资源组合；未运行不得声称通过。
- `scripts/guards/chapter-plan-fact-authority-guard.mjs` 只反证模型事实字段、第二 provenance constructor 或旧自然语言 validator 被重新接回；它不证明用户行为。

## 历史回归

- `d14404a5c8` 引入模型事实字段与字符相似度 validator；中文改写与跨 event 合并在真实任务中触发误拒。
- `0ad107b247` 让错误显式进入 `PLAN_VALIDATION_FAILED`，但显式失败没有消除 ledger 与模型的双 writer。

## 修改检查表

1. 新字段属于镜头结构还是 ledger 事实？
2. 是否让模型、UI 或 prompt 文案获得了事实 identity 解释权？
3. provenance 是否完全由当前 chapter events 确定性投影？
4. strict schema 是否拒绝旧字段和未知字段？
5. 成功持久化是否仍受 `generationTaskId` owner fence 保护？
