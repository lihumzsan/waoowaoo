<!-- architecture-module: ai-prompt-output-contract -->

# AI Prompt 与模型输出契约

## 设计理念

Prompt 是模型行为指令，不是结构化业务事实的第二权威。每个 Prompt 必须有稳定 identity、显式变量与语言版本；要求 JSON、数组或固定字段的结构化 Prompt 还必须服从一个生产 raw output schema。worker parser、stream preview、server normalizer、provider fixture 与 UI projector 都是同一输出协议的消费者，不得各自从文案猜测字段。

非结构化文本、图片、视频或音乐 Prompt 没有 JSON 字段协议，但仍必须经统一 catalog/template store 构建，并遵守变量、i18n、provider 输入和用户可见语义。不能因为本模块覆盖整个 Prompt 根目录，就给非结构化输出伪造 schema 或 stream adapter。

## 不变量

- **AP-01 — Prompt identity 唯一。** Prompt identity、模板路径、变量集合与 operation 绑定由 `AI_PROMPT_CATALOG` 声明；调用方不得直接读取模板、复制 Prompt 或根据文案猜 Prompt 类型。
- **AP-02 — 结构化 raw schema 唯一。** 结构化模型输出必须有一个生产 raw schema 作为接受边界。worker parser 与 structured-stream adapter 必须复用同一 raw schema；持久化 final schema 不得倒充 raw stream schema。
- **AP-03 — 协议变更整体审计。** 修改结构化输出字段、类型、层级、必填性、枚举或 identity 语义时，必须在同一变更中审计 Prompt、生产 raw schema、parser/normalizer、stream adapter、stable item key、持久化 projector、UI consumer 与外部 provider fixture；不适用项必须说明原因。禁止只修改 Prompt 并假定其他层自动适配。
- **AP-04 — Prompt 不写领域事实 identity。** 模型描述不得成为持久事实、资产、scope、生命周期或关联 identity 的权威；identity 必须来自领域输入、registry 或服务端 projector。禁止 substring、字符重合、历史消息或 UI 文案补认 canonical identity。
- **AP-05 — 未知输出显式失败。** 结构化 raw schema 应在协议边界拒绝未知或缺失字段；不得静默删除、补默认、降级成自由文本或让下游消费者各自容错。协议失败与 Task retry/terminal 继续服从异步生命周期模块。
- **AP-06 — Fixture 只是外部协议替身。** Golden provider fixture 必须通过同一生产 raw schema，但只能证明受控外部边界与内部真实主链兼容，不能证明真实模型必然服从 Prompt。Prompt 或 schema 变化时必须审计 fixture；不得让 fixture 自己定义期望协议。
- **AP-07 — 流式展示无业务裁决权。** structured stream 只消费已声明 raw item、stable key 与 merge rule，提供可丢弃预览。stream parse rejection 不得写 Task/resource 失败，最终业务状态仍由 durable owner 决定。

## 权威入口

- Prompt identity、模板路径与变量：`src/lib/ai-prompts/ids.ts`、`src/lib/ai-prompts/registry.ts`。
- Prompt 构建与模板读取：`src/lib/ai-prompts/build-prompt.ts`、`src/lib/ai-prompts/template-store.ts`。
- Prompt 模板：`src/lib/ai-prompts/templates/**`；非 catalog 历史模板仍须按 Prompt i18n guard 的迁移规则收敛。
- `standards/prompt-canary/**` 当前没有生产或测试消费者，只是未挂载的历史 canary 数据；它不是 Prompt、schema 或测试证据的 owner。修改时仍路由本模块以显式暴露该状态，不得把文件存在当成已验证。
- 生产 raw schema：由各领域 schema module 拥有；不得在本模块建立第二份通用字段 registry。调用链必须从 Prompt ID/字段引用追到实际 worker parser。
- Canvas raw stream 消费：`src/features/project-workspace/canvas/structured-stream/structured-stream-adapters.ts`，并同时服从 `canvas-node/CN-03`。
- Prompt i18n 与 registry 变量检查：`scripts/guards/prompt-i18n-guard.mjs`、`scripts/guards/prompt-semantic-regression.mjs`。

## 验证

- `scripts/guards/prompt-i18n-guard.mjs` 验证 catalog locale 模板、变量和禁止的直接模板读取；`scripts/guards/prompt-semantic-regression.mjs` 验证 catalog 占位符与少量历史关键字段。它们不证明任意 Prompt 与任意 schema 自动一致。
- `tests/golden-journey/self-tests/model-provider.test.ts` 使 deterministic provider fixture 通过适用生产 parser/schema；它不代替真实外部模型行为。
- `tests/unit/project-workspace/structured-stream-runtime.test.ts` 验证 raw item merge、attempt/seq 与终态边界；`tests/integration/provider/source-script-scene-stream.contract.test.ts` 验证源剧本的真实逐场 stream 协议。
- 适用 Golden/Critical Journey 由被改变的用户 observable 和模块不变量决定，禁止根据 Prompt 文件变化机械选择测试。observable 不变时记录不适用原因并运行原 canonical scenario；改变时按 `TG-11` 同步 contract、真实路径和 oracle。

## 历史回归

- 制作规划 Prompt 的 raw beat/ledger/emotional cue 与 Canvas final-schema adapter 漂移，真实 Task processing 时预览失败，而终态 Journey 曾通过；详见 `canvas-structured-stream-preview-2026-07-12`。
- 核心剪辑 Prompt 曾让模型重复输出 ledger persistent facts，再用字符重合率校验，形成第二事实 writer；详见 `chapter-plan-persistent-fact-authority-2026-07-12`。
- Golden provider 曾因 generic JSON、错误 prompt 路由或旧字段无法通过生产 parser；fixture 修复只能证明协议替身，不能成为 Prompt schema owner。
- 本模块的治理来源、路由改造与历史矩阵见 `architecture-impact-prompt-contract-governance-2026-07-12`。

## 修改检查表

1. Prompt 是非结构化输出还是结构化 raw output？判断依据是什么？
2. Prompt identity、locale 模板和变量是否仍由 catalog/template store 唯一声明？
3. 生产 raw schema 与 parser/normalizer 在哪里？是否 strict/fail closed？
4. 是否存在 stream adapter、stable item key、projector、UI consumer；不适用原因是什么？
5. 字段或 identity 语义变化是否同步审计 provider fixture，而没有让 fixture 定义协议？
6. 是否改变既有 Journey observable；对应 canonical command 是否实际运行且无 skip/todo？
7. 是否让 Prompt、模型文本或 UI 获得了领域事实、scope、identity 或生命周期解释权？
