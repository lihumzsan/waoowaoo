<!-- architecture-module: chapter-planning -->

# 章节核心剪辑规划

## 设计理念

章节核心剪辑计划把已确认剧本与章节事件组织成 shots 和 generationSegments。模型是镜头结构生成者，不是剧情事实、资产 identity 或生命周期事实的 owner。章节 ledger 是持久剧情事实的唯一权威；模型不得复制、改写、选择或补造第二份事实台账。

## 不变量

- **CP-00A — 规划资产可与核心剪辑并行。** 制作规划确认事务已经创建的 ProjectCharacter/ProjectLocation 是章节规划的资产菜单来源；确认视觉风格后，资产图片/空间档案任务可与 `plan_chapters` 并行。核心规划不得要求资产图片先完成，只要求角色与场景 identity/description 已存在；生成结果落库前必须重新读取资产状态，使并行期间已完成的图片投影为 completed requirement，避免事件先后顺序造成永久 pending。资产审核面向本集这一组共享 canonical 资产，章节 requirement 只参与完整性与受审 fingerprint，不产生“选择某章资产”的第二语义；用户动作只有确认整组资产或提交整组修改意见。

- **CP-01 — Ledger 事实唯一。** 入章事实来自 ledger snapshot，本章新增持久事实来自 ledger events。`persistentFactsIntroduced` 等 provenance 投影必须由服务端直接从本章 events 构造，模型输出不得包含事实台账字段。
- **CP-02 — 模型只写镜头结构。** structure prompt/schema 只允许 `shots` 与 `generationSegments`；额外字段必须由 strict schema 显式拒绝，不得静默删除。
- **CP-03 — 禁止自然语言事实 identity。** 不得用 substring、字符/token overlap、embedding 或其他语义相似度把模型文本解释为 canonical fact。
- **CP-04 — 资产 identity 由服务端解析。** 模型只从已确认 asset menu 的动态名称枚举输出 `locationName`、`characterName` 与 `speakerName`，并用本次响应内的短 `shotRef` 组织分段；模型输入和输出都不携带数据库 UUID。服务端唯一 resolver 以精确名称映射 ProjectLocation/ProjectCharacter UUID、校验对白归属，再把短 shotRef 一次性重写为系统 shot identity。未知名称、重复名称、未知引用或覆盖/顺序不完整必须原地失败，禁止模糊匹配、ID 回显或兼容旧 UUID 协议。subScene、performance、keyObjects 等描述无权创建新资产 identity。`performance` 字段必须存在，但允许规范化为空字符串，不能因缺少表演描述阻断整章计划。
- **CP-04A — UUID 是关联权威，名称只属于 View。** 持久化计划、资产 requirement、摄影执行计划、Storyboard、视频分组和 Soundscape 的业务关联只使用服务端生成或解析的 canonical identity。持久 JSON 中已有的名称字段不是关联或显示权威；服务端对外 View 必须按当前 UUID 重新投影人物/场景名称，因此重命名不得改变关联。消费者找不到 UUID 时必须显式失败，禁止退回历史名称 join、数组位置或直接显示 UUID。
- **CP-05 — 成功写入受 Task owner 约束。** EditScript 正式资源与 provenance 在同一 owner-fenced 成功事务提交；失败 attempt 不得写最终章节事实或计划。

## 权威入口

- 章节输入与 ledger：`src/lib/edit-chapter/input-assembler.ts`。
- 模型输出契约：`src/lib/edit-chapter/schemas.ts` 与 `src/lib/ai-prompts/templates/edit-script/structure/`。
- 模型引用解析与系统 shot identity：`src/lib/edit-chapter/schemas.ts`、`src/lib/edit-script/model-references.ts` 与 `src/lib/edit-script/service.ts`。
- 当前名称 View：`src/lib/edit-script/core-view.ts`；摄影执行计划的 raw 名称/短引用到 canonical identity 解析：`src/lib/edit-script/normalize.ts`。
- 持久事实投影：`src/lib/edit-chapter/persistent-facts.ts`。
- 核心计划生成与成功事务：`src/lib/edit-script/service.ts`。
- Task lifecycle、provider invocation 与重试仍分别服从 `async-task-lifecycle` 和 `provider-gateway`。

## 验证

- `tests/unit/edit-chapter/persistent-facts.test.ts` 是 Logic Specification：验证 ledger event facts 的确定性顺序、去重和 exact projection。
- `tests/golden-journey/self-tests/model-provider.test.ts` 验证协议替身输出可被生产 strict schema 消费；它不代替真实模型行为。
- `tests/golden-journey/journeys/structured-stream-preview.spec.ts` 如覆盖核心剪辑生成，则以其既有 canonical command 证明真实 UI/Task/worker/资源组合；未运行不得声称通过。
- `tests/golden-journey/journeys/mainline-downstream-continuation.spec.ts` 的并行批准场景验证核心剪辑与规划资产共享一个 Wait 并真实并行、核心剪辑 structured preview 可见，以及最终资产审核没有章节选择语义。
- `scripts/guards/chapter-plan-fact-authority-guard.mjs` 只反证模型事实字段、第二 provenance constructor 或旧自然语言 validator 被重新接回；它不证明用户行为。

## 历史回归

- `d14404a5c8` 引入模型事实字段与字符相似度 validator；中文改写与跨 event 合并在真实任务中触发误拒。
- `0ad107b247` 让错误显式进入 `PLAN_VALIDATION_FAILED`，但显式失败没有消除 ledger 与模型的双 writer。
- `0ad107b247`（2026-07-07）把核心规划切到模型直接回传资产 UUID；`8d5af4421e`（2026-07-08）又在 Canvas raw stream 中用 `name ?? id` 展示，最终让模型 UUID 直接成为用户可见标题和人物字段。旧防线只校验 ID 是否在菜单，无法反证模型抄错长 UUID，也没有约束 View 不得回显 identity。
- `4790562e89`、`7ffddcb88c` 与 `b742159568` 随后在对白、最终时间线和 Soundscape 中重复了“找不到名称就显示 ID”的同根因。当前防线是单一 raw schema + 服务端 exact resolver + UUID-only association + current-name View；部署时必须排空仍使用旧 raw UUID 协议的核心规划、摄影执行计划和 Soundscape planning attempt，禁止双协议并存。

## 修改检查表

1. 新字段属于镜头结构还是 ledger 事实？
2. 是否让模型、UI 或 prompt 文案获得了事实 identity 解释权？
3. provenance 是否完全由当前 chapter events 确定性投影？
4. strict schema 是否拒绝旧字段和未知字段？
5. 成功持久化是否仍受 `generationTaskId` owner fence 保护？
