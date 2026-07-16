<!-- architecture-module: ai-prompt-output-contract -->

# AI Prompt 与模型输出契约

## 设计理念

Prompt 是模型行为指令，不是结构化业务事实的第二权威。每个 Prompt 必须有稳定 identity、显式变量与语言版本；要求 JSON、数组或固定字段的结构化 Prompt 还必须服从一个生产 raw output schema。worker parser、stream preview、server normalizer、provider fixture 与 UI projector 都是同一输出协议的消费者，不得各自从文案猜测字段。

非结构化文本、图片、视频或音乐 Prompt 没有 JSON 字段协议，但仍必须经统一 catalog/template store 构建，并遵守变量、i18n、provider 输入和用户可见语义。不能因为本模块覆盖整个 Prompt 根目录，就给非结构化输出伪造 schema 或 stream adapter。

## 不变量

- **AP-01 — Prompt identity 唯一。** Prompt identity、模板路径、变量集合与 operation 绑定由 `AI_PROMPT_CATALOG` 声明；调用方不得直接读取模板、复制 Prompt 或根据文案猜 Prompt 类型。
- **AP-02 — 结构化 raw schema 唯一。** 结构化模型输出必须有一个生产 raw schema 作为接受边界。worker parser 与 structured-stream adapter 必须复用同一 raw schema；持久化 final schema 不得倒充 raw stream schema。只有一个当前形状且 parser 不分流时，不得要求模型输出固定 `version/schemaVersion` 装饰字段。
- **AP-03 — 协议变更整体审计。** 修改结构化输出字段、类型、层级、必填性、枚举或 identity 语义时，必须在同一变更中审计 Prompt、生产 raw schema、parser/normalizer、stream adapter、stable item key、持久化 projector、UI consumer 与外部 provider fixture；不适用项必须说明原因。持久 JSON 的不兼容变化必须排空并废弃旧实例，或一次性迁移后切换唯一 strict parser；不得使用双 schema、fallback 或默认值兼容。禁止只修改 Prompt 并假定其他层自动适配。
- **AP-04 — Prompt 不写领域事实 identity。** 模型描述不得成为持久事实、资产、scope、生命周期或关联 identity 的权威；identity 必须来自领域输入、registry 或服务端 projector。禁止 substring、字符重合、历史消息或 UI 文案补认 canonical identity。
- **AP-04A — 模型只使用有界短引用。** 人物与场景使用输入动态枚举中的精确名称，镜头/分段/时间线使用仅在单次响应内有效的短 ref、序号或 clip order；服务端 resolver 是名称/短引用到 canonical UUID/系统 identity 的唯一解释者。Prompt 不得要求模型抄写数据库 UUID，持久化 final schema 也不得直接作为 raw model schema。关联失败必须拒绝整份输出，禁止猜测、旧协议 fallback 或把内部 ID 作为用户可见文案。
- **AP-05 — 未知输出显式失败。** 结构化 raw schema 应在协议边界拒绝未知或缺失字段；不得静默删除、补默认、降级成自由文本或让下游消费者各自容错。协议失败与 Task retry/terminal 继续服从异步生命周期模块。
- **AP-06 — Fixture 只是外部协议替身。** Golden provider fixture 必须通过同一生产 raw schema，但只能证明受控外部边界与内部真实主链兼容，不能证明真实模型必然服从 Prompt。Prompt 或 schema 变化时必须审计 fixture；不得让 fixture 自己定义期望协议。
- **AP-07 — 流式展示无业务裁决权。** structured stream 只消费已声明 raw item、stable key 与 merge rule，提供可丢弃预览。stream parse rejection 不得写 Task/resource 失败，最终业务状态仍由 durable owner 决定。
- **AP-08 — Freeform Playbook 不获得执行门禁。** 项目助手 Prompt 可以说明推荐完整制作配方、Choice 时机、失败重试和 Resource 引用规则，但不得把 recommendation 写成工具 allowlist 或固定 next step。所有注入 Tool 可调用；内在输入、owner/scope、provider capability、收费 Approval、破坏性确认和 Run fence 必须由代码 fail closed。Prompt 遗漏 Choice 或停止调用时不得伪造领域事实或死锁用户；UI 与下一次用户消息仍可调用同一开放 Operation。

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

- 制作规划 Prompt 的 raw beat/ledger/emotional cue 与 Canvas final-schema adapter 漂移，真实 Task processing 时预览失败，而终态 Journey 曾通过；现在 browser adapter 与 worker 复用生产 raw schema。
- 核心剪辑 Prompt 曾让模型重复输出 ledger persistent facts，再用字符重合率校验，形成第二事实 writer；现在模型只写镜头结构，事实由 ledger projector 独占。
- Golden provider 曾因 generic JSON、错误 prompt 路由或旧字段无法通过生产 parser；fixture 修复只能证明协议替身，不能成为 Prompt schema owner。
- Prompt 根目录曾没有通用架构路由，字段变化依赖人工记住 Schema/stream/fixture；现在所有 Prompt 先命中本模块，再沿实际调用链审计适用消费者。
- 已删除的 location spatial profile、旧 Soundscape plan 与 source script 曾要求模型重复输出固定版本标记，但系统没有第二协议或 reader 分支；这些字段只会扩大 Prompt/schema/fixture 漂移面。当前声音阶段只有一个 strict `BgmDesign` raw schema，最终 identity 与 timeline signature 由服务端构造。
- 核心剪辑、镜头执行计划与旧 Soundscape 曾分别要求模型回传资产 UUID、系统 shot identity 或 shot UUID；Canvas/对白/时间线再用 ID 作为缺名 fallback。当前核心计划与 BgmDesign 统一使用 raw 名称/短引用/clip order，服务端解析成 final identity。
- 2026-07 的分镜协议曾同时保留 Panel 图片链与全能参考旁路，Prompt owner 仍绑在旧链。当前核心镜头输出已缩减为动作/表演/对白/同步声音/连续性，执行计划只输出景别、运镜方式和运镜稳定性，视频 Prompt 只由 `src/lib/video-segments/prompt.ts` 构建。
- 项目助手系统 Prompt 曾在视频链路重构中从每种语言 174 行整体重写为 56 行；Choice/Approval、Task continuation、失败边界和权限模式随旧媒体说明一起被删除。真实模型在视觉风格图片完成后只输出“请选择”，而 deterministic Golden provider 硬编码了正确 Choice 工具，既有 guard 又没有覆盖非结构化系统 Prompt 的关键行为语义。后续完整 Prompt 又把 `allowedOperationIds`、并行 Operation group、固定下一步和“唯一视频入口”写成硬控制，导致 OpenAI Agents loop 被应用层限制成线性工具链。当前中英文模板保留沟通、真实回执、Choice/Approval、Task continuation、失败重试、视觉安全与权限边界，同时改为“完整 toolset + advisory mainline + Resource 精确引用”；`prompt-semantic-regression` 要求这些闭环 token并拒绝旧 allowlist/group/旧媒体链回流。该 guard 只能反证 Prompt 契约被删除或旧门禁复入，不能证明真实外部模型始终服从 Prompt。
- BGM 与环境音曾各自拥有结构化规划 Prompt、parser、Task 和资源侧计划字段，同一声音时间线由两条状态机分别解释；后续 AudioDesign 虽统一文本规划，仍输出两类生成事实。当前 `BGM_DESIGN_PLAN` 是唯一声音规划协议，输入仅含锁定剧本与渲染 clip 的 identity/duration 元数据；Prompt 明确禁止观看视频帧、分析原生音轨、最终视频或最终混音，并只输出 scorePresence、唯一整片 scoreCue 与 score/master automation。
- 一分钟创作简报曾生成 1757 字源剧本并被全局规划估成 275 秒；首次纠正只强化源剧本 Prompt，又用“每个 Beat 通常 15-45 秒”的通用区间估时。真实复发中，源剧本已压缩为单场、4 个 Beat、509 字，但全局规划仍按固定区间估成 115 秒，证明旧防线没有覆盖“紧凑剧本 + 多 Beat”的真实组合。当前防线让源剧本按用户时长控制全部正文规模，同时要求 Beat 时长只从对白、动作、反应、停顿和转场的实际表演时间派生；Beat 数量不得成为扩大片长的第二解释源。尚未用真实模型重复生成该案例，模型服从性仍是未验证盲区。

## 修改检查表

1. Prompt 是非结构化输出还是结构化 raw output？判断依据是什么？
2. Prompt identity、locale 模板和变量是否仍由 catalog/template store 唯一声明？
3. 生产 raw schema 与 parser/normalizer 在哪里？是否 strict/fail closed？
4. 是否存在 stream adapter、stable item key、projector、UI consumer；不适用原因是什么？
5. 字段或 identity 语义变化是否同步审计 provider fixture，而没有让 fixture 定义协议？
6. 是否改变既有 Journey observable；对应 canonical command 是否实际运行且无 skip/todo？
7. 是否让 Prompt、模型文本或 UI 获得了领域事实、scope、identity 或生命周期解释权？
