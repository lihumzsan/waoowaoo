<!-- architecture-module: ai-prompt-output-contract -->

# AI Prompt 与模型输出契约

## 设计理念

Prompt 是模型行为指令，不是结构化业务事实的第二权威。每个 Prompt 必须有稳定 identity、显式变量与语言版本；要求 JSON、数组或固定字段的结构化 Prompt 还必须服从一个生产 raw output schema。worker parser、stream preview、server normalizer、provider fixture 与 UI projector 都是同一输出协议的消费者，不得各自从文案猜测字段。

非结构化文本、图片、视频或音乐 Prompt 没有 JSON 字段协议，但仍必须经统一 catalog/template store 构建，并遵守变量、i18n、provider 输入和用户可见语义。不能因为本模块覆盖整个 Prompt 根目录，就给非结构化输出伪造 schema 或 stream adapter。

## 不变量

- **AP-01 — Prompt identity 唯一。** Prompt identity、模板路径、变量集合与 operation 绑定由 `AI_PROMPT_CATALOG` 声明；调用方不得直接读取模板、复制 Prompt 或根据文案猜 Prompt 类型。
- **AP-02 — 结构化 raw schema 唯一。** 结构化模型输出必须有一个生产 raw schema 作为接受边界。worker parser 与 structured-stream adapter 必须复用同一 raw schema；持久化 final schema 不得倒充 raw stream schema。只有一个当前形状且 parser 不分流时，不得要求模型输出固定 `version/schemaVersion` 装饰字段。
- **AP-03 — 协议变更整体审计。** 修改结构化输出字段、类型、层级、必填性、枚举或 identity 语义时，必须在同一变更中审计 Prompt、生产 raw schema、parser/normalizer、stream adapter、stable item key、持久化 projector、UI consumer 与外部 provider fixture；不适用项必须说明原因。持久 JSON 的不兼容变化必须排空并废弃旧实例，或一次性迁移后切换唯一 strict parser；不得使用双 schema、fallback 或默认值兼容。禁止只修改 Prompt 并假定其他层自动适配。
- **AP-03A — 章节视频声音契约按真实生成时间线分层。** `EditScriptShot.synchronousSound` 只表达 Shot 内同期声；`EditGenerationSegment.soundCues` 是可选但严格的 Segment 相对时间线，供唯一视频 Prompt builder 编译声音先行、跨 Shot 延续和画外对白揭示。无此叙事需要时使用显式空数组；cue 不成为独立音频轨、BGM 或跨 Segment 状态，也不得在下游重新猜测其来源。
- **AP-04 — Prompt 不写领域事实 identity。** 模型描述不得成为持久事实、资产、scope、生命周期或关联 identity 的权威；identity 必须来自领域输入、registry 或服务端 projector。禁止 substring、字符重合、历史消息或 UI 文案补认 canonical identity。
- **AP-04A — 模型只使用有界短引用。** 人物与场景使用输入动态枚举中的精确名称，镜头/分段/时间线使用仅在单次响应内有效的短 ref、序号或 clip order；服务端 resolver 是名称/短引用到 canonical UUID/系统 identity 的唯一解释者。Prompt 不得要求模型抄写数据库 UUID，持久化 final schema 也不得直接作为 raw model schema。关联失败必须拒绝整份输出，禁止猜测、旧协议 fallback 或把内部 ID 作为用户可见文案。
- **AP-05 — 未知输出显式失败。** 结构化 raw schema 应在协议边界拒绝未知或缺失字段；不得静默删除、补默认、降级成自由文本或让下游消费者各自容错。协议失败与 Task retry/terminal 继续服从异步生命周期模块。
- **AP-06 — Fixture 只是外部协议替身。** Golden provider fixture 必须通过同一生产 raw schema，但只能证明受控外部边界与内部真实主链兼容，不能证明真实模型必然服从 Prompt。Prompt 或 schema 变化时必须审计 fixture；不得让 fixture 自己定义期望协议。
- **AP-07 — 流式展示无业务裁决权。** structured stream 只消费已声明 raw item、stable key 与 merge rule，提供可丢弃预览。stream parse rejection 不得写 Task/resource 失败，最终业务状态仍由 durable owner 决定。
- **AP-08 — Freeform Playbook 不获得执行门禁。** 项目助手 Prompt 可以说明推荐完整制作配方、Choice 时机、失败重试、Resource 引用和非阻塞 Task 行为，但不得把 recommendation 写成工具 allowlist 或固定 next step。所有注入 Tool 可调用；同模型步骤 OperationBatch、聚合 Approval、后台 Run/Wait、输入 prerequisite、owner/scope、provider capability、破坏性确认和 Run fence 必须由代码 fail closed。Prompt 只能要求模型收到 Task receipt 后继续独立工作、不得轮询，并在 terminal update 时重新规划；它无权决定 Task 是否真正提交、Wait membership 或续跑次数。Main Agent Prompt 不得要求读取可用模型、选择 model/provider 或修改项目模型配置；这些事实由服务端正式配置 owner 解析。Prompt 遗漏 Choice 或停止调用时不得伪造领域事实或死锁用户；UI 与下一次用户消息仍可调用同一开放 Operation。
- **AP-09 — 专业知识与运行 Prompt 分层。** 主 Agent System Prompt 只保留身份、loop、工具与事实边界、计划与委派纪律、Task/Wait、Approval/Choice、Resource identity、失败、沟通和安全等运行规则；剧本、连续性、导演、风格、资产、视频、音乐和质量方法由注册式 Creative Skill 按需读取。Skill 不得包含或重定义 Operation schema、Task 生命周期、Approval/Choice、数据库 identity 或 provider wire 参数；严格 adapter 和确定性 builder 继续是原执行协议 owner。`style-development` 独占 Style Bible 与全局视觉语言；`asset-development` 独占角色/场景/道具资产设计，允许没有风格输入时独立工作，并在提供确认 Style Bible 时只消费而不改写它；旧 `visual-development` identity 已删除。迁移以原中英文有效规则并集为基线，只有完成调用者与替代证据审计的 obsolete 内容才可删除。
- **AP-10 — Creative Worker 输出协议穷尽且与 Task 分层。** Creative Worker 结构化输出只由 `creativeWorkOutputRegistry` 声明，当前只有 `screenplay_draft`、`edit_bible_bundle`、`continuity_analysis`、`style_bible`、`asset_prompt_set`、`video_prompt_set`、`music_direction` 与 `creative_review`，不存在 `story_analysis`。`style_bible` 区分 finalized 与 candidates；final 只能经 adopt Operation 成为结构化 Resource。`asset_prompt_set` 区分稳定身份、最终生图 Prompt 与可选风格来源。`video_prompt_set` 只允许 `kind + segments`，每段只允许 `key + durationSeconds + prompt + referenceKeys`；`prompt` 是唯一创意指令，必须内化当前段适用的全部导演与视频生成知识。Primary 只传总时长，服务端注入画幅与允许时长；final parser 验证 key 唯一、时长枚举和总和，不要求模型回传已有权威输入，也不验证无人消费的平行过程字段。画幅和默认开启的原生音频属于执行上下文，不是 Subagent 输出。完整结果只保存于 Creative Task result，Task lifecycle 与 Assistant continuation 只携带 reference projection。
- **AP-11 — 视频 Playbook 按时长显式但不自动串行。** 主 Agent System Prompt 只使用三个互斥区间：`<=15s` 单次生成、`>15s && <=180s` 完整短片配方、`>180s` 全局 Bible/Chapter 配方。任何视频制作必须先生成并采用 finalized Style Bible；15–180 秒的模糊 brief 先由 `screenplay_draft.openQuestions` 诊断并完成剧本，重复身份跨两个以上生成段必须先做资产，Primary 委派 video 时不得预设分段。只有大于 180 秒才建立 source 与全局 Bible，使用唯一 `splitEditBibleIntoChapterPlans` 与 `delegate_creative_work({delegation:{source:"chapters",...}})`；Context Compiler 要求精确 Style Bible revision。这个要求约束模型规划质量但不成为 Operation allowlist 或代码自动链：每步完成只恢复主 Agent，下一步均由其基于正式事实显式决定。
- **AP-12 — Worker 按 output 与目录选择 Skill，Primary 只描述创作目标。** Worker 初始上下文必须包含生产 Skill registry 的完整紧凑 catalog，`creative-core` 固定预载，唯一知识工具是 `read_skill`。Primary 的委派输入、Operation schema、output adapter 和服务端映射都不得携带 `requiredSkillIds`、推荐 Skill id 或固定专业角色；Worker 必须根据请求中的 `outputKind`、catalog 标题、摘要、标签和适用范围读取专业 Skill。Catalog 摘要与 Skill 正文可以声明某类 output 所需的同轮知识组合；当前 `video_prompt_set` 明确要求读取 `director-core`、`video-direction` 与 `quality-review`，但这仍是 Worker 消费的专业说明，不是服务端第二份映射、多个 Subagent 或多个输出。主 Agent Prompt 只需说明“专业创作应委派”，不能复制 catalog、Skill 正文或选择算法。
- **AP-13 — 项目事实、候选浏览与精确内容分层。** 主 Agent 每轮初始项目快照和 `get_project_context` 只提供确认剧本、正式 Style Bible 等保留 Binding 的紧凑工作集；`list_resources` 用于浏览候选/历史；完整内容只能由 `get_resource(resourceId, revisionId)` 取得。Prompt 必须要求生成后通过 Resource-native confirm/adopt 建立正式事实，不能让模型凭对话记忆、最近 Resource 或旧专业实体猜当前版本。媒体工具把语义 lineage 写入 `contextReferences`，只有真实图片进入 `imageReferences`。
- **AP-14 — 风格交互按用户意图分支。** 用户已明确风格时，Primary 直接委派 finalized Style Bible 并采用，不再询问或强制预览；风格缺失或模糊时，先委派三个严格文字候选并让用户选择，预览图是用户可选的收费步骤，不能在选择前自动提交；用户明确“你决定”时，Primary 可自行选择并采用一个文字候选。该规则只指导 Agent 交互，最终 Style Bible 事实仍只由 adopt Operation 和保留 Binding 写入。
- **AP-15 — 角色资产板版式由执行后缀唯一约束。** 专业 Skill 负责角色设计知识，不拥有 provider 最终版式。所有角色图片执行路径必须复用 `CHARACTER_PROMPT_SUFFIX`：固定单张 16:9 资产板，严格只有一张完整全身主图和一张同身份大脸近景；禁止三视图、动作/语境样本、额外人物和第三个视图。不得在 Skill、Route、Worker 或调用方追加第二份版式约束。

## 权威入口

- Prompt identity、模板路径与变量：`src/lib/ai-prompts/ids.ts`、`src/lib/ai-prompts/registry.ts`。
- Prompt 构建与模板读取：`src/lib/ai-prompts/build-prompt.ts`、`src/lib/ai-prompts/template-store.ts`。
- Prompt 模板：`src/lib/ai-prompts/templates/**`；非 catalog 历史模板仍须按 Prompt i18n guard 的迁移规则收敛。
- 按需专业知识：`src/lib/creative-skills/registry.ts` 与 `skills/**/SKILL.{zh,en}.md`；`style-development` 与 `asset-development` 是分离 identity，旧 `visual-development` 不得作为 alias 恢复。
- 无状态模型输出边界：`src/lib/creative-worker/output-registry.ts`；Task 输入/完整结果/reference projection 契约：`src/lib/creative-worker/task-contract.ts`、`src/lib/task/result-projection.ts`。它们服从独立的 Skill identity、output-kind registry 与 TaskDefinition，不得塞回 `AI_PROMPT_CATALOG`、从 Operation 名称推断或复制进 Assistant message。
- Bible/Chapter 专业输入边界：正式 Bible 与领域 schema 仍由既有 Edit Bible 模块拥有；`splitEditBibleIntoChapterPlans` 是唯一 Chapter splitter；`src/lib/edit-chapter/creative-context-service.ts` 只读取并校验正式事实与 Resource revision；`src/lib/creative-worker/context-compiler.ts` 只把这些输入纯派生为有界最小上下文，不产生 Prompt identity、领域事实或执行边。
- `standards/prompt-canary/**` 当前没有生产或测试消费者，只是未挂载的历史 canary 数据；它不是 Prompt、schema 或测试证据的 owner。修改时仍路由本模块以显式暴露该状态，不得把文件存在当成已验证。
- 生产 raw schema：由各领域 schema module 拥有；不得在本模块建立第二份通用字段 registry。调用链必须从 Prompt ID/字段引用追到实际 worker parser。
- Canvas raw stream 消费：`src/features/project-workspace/canvas/structured-stream/structured-stream-adapters.ts`，并同时服从 `canvas-node/CN-03`。
- Prompt i18n 与 registry 变量检查：`scripts/guards/prompt-i18n-guard.mjs`、`scripts/guards/prompt-semantic-regression.mjs`。

## 验证

- `scripts/guards/prompt-i18n-guard.mjs` 验证 catalog locale 模板、变量和禁止的直接模板读取；`scripts/guards/prompt-semantic-regression.mjs` 验证 catalog 占位符、主 Agent 长短任务委派纪律、双语 Skill 关键语义以及 `style-development`/`asset-development` 分离，并拒绝旧 `visual-development` 与同步 Subagent 语义回流。它们不证明任意 Prompt 与任意 schema 自动一致，也不证明真实模型会正确规划长片。
- `tests/golden-journey/self-tests/model-provider.test.ts` 使 deterministic provider fixture 通过适用生产 parser/schema；它不代替真实外部模型行为。
- `tests/unit/project-workspace/structured-stream-runtime.test.ts` 验证 raw item merge、attempt/seq 与终态边界；`tests/integration/provider/source-script-scene-stream.contract.test.ts` 验证源剧本的真实逐场 stream 协议。
- 适用 Golden/Critical Journey 由被改变的用户 observable 和模块不变量决定，禁止根据 Prompt 文件变化机械选择测试。observable 不变时记录不适用原因并运行原 canonical scenario；改变时按 `TG-11` 同步 contract、真实路径和 oracle。

## 历史回归

- Creative Worker 初版已经把专业知识移进 Skill，却仍在主 Agent 的同步 Tool Activity 内执行，并把完整结构化结果直接返回主模型；长片章节无法由持久后台 Subagent 并行，Activity/消息又开始承担生命周期和结果投影。当前输出 schema 保持 Worker 边界不变，执行容器切换为一个逻辑请求一个 `creative_work` Task；Task.result 保存完整输出，TaskDefinition reference projection 约束 Session/Wait/continuation 体积。
- 初版 `visual-development` 把 Style Bible 与角色/场景/道具生成知识放在同一 identity，资产变化可以混入全局风格裁决；导演设计与视频模型 Prompt 又主要藏在同一个自由文本字段里。首次纠正增加 strict `globalDirection + directorTimeline + finalPrompt`，但运行时只证明时间线连续，不能证明其判断进入真正被消费的 `finalPrompt`，反而要求 Primary 再解释一遍平行过程字段。当前删除旧视觉 identity并拆为 `style-development` 与 `asset-development`；视频结果同步删除平行导演字段，只保留执行元数据和唯一 `prompt`，由 Skill 约束所有适用专业判断直接内化。

- 制作规划 Prompt 的 raw beat/ledger/emotional cue 与 Canvas final-schema adapter 漂移，真实 Task processing 时预览失败，而终态 Journey 曾通过；现在 browser adapter 与 worker 复用生产 raw schema。
- 核心剪辑 Prompt 曾让模型重复输出 ledger persistent facts，再用字符重合率校验，形成第二事实 writer；现在模型只写镜头结构，事实由 ledger projector 独占。
- Golden provider 曾因 generic JSON、错误 prompt 路由或旧字段无法通过生产 parser；fixture 修复只能证明协议替身，不能成为 Prompt schema owner。
- Prompt 根目录曾没有通用架构路由，字段变化依赖人工记住 Schema/stream/fixture；现在所有 Prompt 先命中本模块，再沿实际调用链审计适用消费者。
- 已删除的 location spatial profile、旧 Soundscape plan 与 source script 曾要求模型重复输出固定版本标记，但系统没有第二协议或 reader 分支；这些字段只会扩大 Prompt/schema/fixture 漂移面。当前声音阶段只有一个 strict `BgmDesign` raw schema，最终 identity 与 timeline signature 由服务端构造。
- 核心剪辑、镜头执行计划与旧 Soundscape 曾分别要求模型回传资产 UUID、系统 shot identity 或 shot UUID；Canvas/对白/时间线再用 ID 作为缺名 fallback。当前核心计划与 BgmDesign 统一使用 raw 名称/短引用/clip order，服务端解析成 final identity。
- 2026-07 的分镜协议曾同时保留 Panel 图片链与全能参考旁路，Prompt owner 仍绑在旧链。当前核心镜头输出已缩减为动作/表演/对白/同步声音/连续性，执行计划只输出景别、运镜方式和运镜稳定性，视频 Prompt 只由 `src/lib/video-segments/prompt.ts` 构建。
- 项目助手系统 Prompt 曾在视频链路重构中从每种语言 174 行整体重写为 56 行；Choice/Approval、Task continuation、失败边界和权限模式随旧媒体说明一起被删除。真实模型在视觉风格图片完成后只输出“请选择”，而 deterministic Golden provider 硬编码了正确 Choice 工具，既有 guard 又没有覆盖非结构化系统 Prompt 的关键行为语义。后续完整 Prompt 又把 `allowedOperationIds`、并行 Operation group、固定下一步和“唯一视频入口”写成硬控制，导致 OpenAI Agents loop 被应用层限制成线性工具链；再后续虽开放工具，却把后台 Task wait 仍写成前台 suspension。当前中英文模板保留沟通、真实回执、Choice/Approval、失败重试、视觉安全与权限边界，同时明确“完整 toolset + advisory mainline + 同步骤独立调用 + Task receipt 非阻塞 + 后台单次 continuation + Resource 精确引用”；`prompt-semantic-regression` 要求这些闭环 token并拒绝旧 allowlist/group/旧媒体链回流。该 guard 只能反证 Prompt 契约被删除或旧门禁复入，不能证明真实外部模型始终服从 Prompt。
- 镜头执行计划的 structured-stream projector 曾把所有并行 Task snapshot 合成一个 entry，并用首个 `taskId/targetId` 代表全部章节；并行执行时只有一个 Canvas 节点能维持 stream → formal Query 的精确交接。当前 projector 与核心剪辑流统一按 `taskId + targetId` 分组，每个章节形成独立 node patch、terminal handoff 和 disclosure；流内容仍不获得领域写权。对应纯逻辑场景覆盖两个并行镜头计划不会串流，但用户已要求停止后续测试，最终 Golden 组合仍需复验。
- BGM 与环境音曾各自拥有结构化规划 Prompt、parser、Task 和资源侧计划字段，同一声音时间线由两条状态机分别解释；后续 AudioDesign 虽统一文本规划，仍输出两类生成事实。当前 `BGM_DESIGN_PLAN` 是唯一声音规划协议，输入仅含锁定剧本与渲染 clip 的 identity/duration 元数据；Prompt 明确禁止观看视频帧、分析原生音轨、最终视频或最终混音，并只输出 scorePresence、唯一整片 scoreCue 与 score/master automation。
- 一分钟创作简报曾生成 1757 字源剧本并被全局规划估成 275 秒；首次纠正只强化源剧本 Prompt，又用“每个 Beat 通常 15-45 秒”的通用区间估时。真实复发中，源剧本已压缩为单场、4 个 Beat、509 字，但全局规划仍按固定区间估成 115 秒，证明旧防线没有覆盖“紧凑剧本 + 多 Beat”的真实组合。当前防线让源剧本按用户时长控制全部正文规模，同时要求 Beat 时长只从对白、动作、反应、停顿和转场的实际表演时间派生；Beat 数量不得成为扩大片长的第二解释源。尚未用真实模型重复生成该案例，模型服从性仍是未验证盲区。
- 角色资产执行后缀曾固定“左全身 + 右上标准三视图 + 右下三个动作/语境样本”，导致一次生成出现多张重复人物，且回归断言只锁住旧 Prompt 字符串，没有反证资产可用性。当前后缀收敛为严格两个视图：一张完整全身与一张同身份大脸近景；Skill 保持专业设计职责，不追加版式。真实外部模型对“严格两个视图”的服从性仍需媒体抽样复验。

## 修改检查表

1. Prompt 是非结构化输出还是结构化 raw output？判断依据是什么？
2. Prompt identity、locale 模板和变量是否仍由 catalog/template store 唯一声明？
3. 生产 raw schema 与 parser/normalizer 在哪里？是否 strict/fail closed？
4. 是否存在 stream adapter、stable item key、projector、UI consumer；不适用原因是什么？
5. 字段或 identity 语义变化是否同步审计 provider fixture，而没有让 fixture 定义协议？
6. 是否改变既有 Journey observable；对应 canonical command 是否实际运行且无 skip/todo？
7. 是否让 Prompt、模型文本或 UI 获得了领域事实、scope、identity 或生命周期解释权？
