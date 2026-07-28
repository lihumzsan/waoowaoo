<!-- architecture-module: ai-prompt-output-contract -->

# AI Prompt 与模型输出契约

## 设计理念

Prompt 只告诉 Primary 如何判断、如何使用 Skill/Subagent 与注册式 Operation；它不实现工作流。专业创作输出由 Creative Worker 的严格 outputKind schema 裁决并物化为不可变 Resource。执行层只验证结构、scope、精确引用和 provider capability，不从自然语言内容猜业务状态。

## 不变量

- **AP-01 — Primary 没有通用固定主链。** 系统 Prompt 不包含 stage、next action、剧本确认、风格专用卡、固定分段数量/时长或隐藏工具顺序。Primary 根据目标与当前 Resource 自由组合能力。窄化的产品规划纪律只有两条，外加一份交付性质核对：其一，当用户要求交付总时长超过 15 秒的完整视频作品时，Primary 在媒体执行前先创建或复用并采用匹配的 Creative Direction，再为最终成片真实会复用的可见实体建立 Asset Manifest 与必要参考资产；其二，总时长超过 60 秒的完整成片，配乐默认进入交付评估——先委派 `music_direction` 做 spotting 判断（`score: null` 表示刻意不配乐并如实告知用户），非空 `score` 经 `create_audio.request.kind=music_direction`（只传方向 Resource ID 与成片视频引用，服务端直读最终配乐指令并导出时长）生成整片配乐，再经 `merge_videos` 的 `music` 输入显式混音。交付性质核对（跨镜头参考资产、跨镜头音色、分段自带声音、统一画幅、配乐已判断）不规定顺序。以上全部只约束 Primary 的计划质量，不改变任一 Operation 的合法输入、不增加服务端前置门禁，也不让时长自动选择 Chapter、Worker 数量或分段配方。
- **AP-02 — 专业判断只有 Skill + Creative Worker。** screenplay 创作/修改、Story Canon、continuity、Chapter plan、Creative Direction、asset/video prompt、music direction 与 review 只能由 `creative_work` 产生。公共 Worker system Prompt 不承载任一专业方法；专业知识来自 Worker 按目录读取的 Skill，结构和执行事实来自当前 output schema 与服务端编译输入，只有实际开放额外能力时才追加该能力的安全协议。`create_text.current_user_text` 只允许保存当前用户消息的精确连续原文；完整用户剧本必须显式标记 `classification.kind=screenplay` 并写 `project.screenplay`，这是来源捕获而不是第二创作 writer。`screenplay` 只拥有文本和写作元信息；生产资产筛选、设计与 Prompt 只由一个 `asset-development + outputKind=asset_manifest` Subagent Task 决定。
- **AP-03 — outputKind 严格穷尽。** 每个 outputKind 在生产 output registry 声明 schema、适用 Skill 与 Resource schema；当前剧本 kind 是 `screenplay`，不存在 `canonical_screenplay` 或额外 canonicalization Skill。完整 canonical JSON Schema作为 Worker attempt 输入数据，固定 `submit_result({outputJson})` 用同一 registry schema和冻结上下文校验；未知字段、缺失字段、不支持组合或错误引用返回字段 issues，只有同一次 Run 修正通过才完成，不容忍兼容 JSON。
- **AP-04 — 结果与过程分离。** reasoning/stream 只用于运行展示，不拥有领域事实；失败的 `submit_result` 候选与 issues 只存在于本次模型 loop，不写 Task、stream 或领域状态。Task terminal 的 strict accepted result 才能物化正式 Resource。UI 不从 reasoning、markdown 标题或文案推断完成状态。
- **AP-05 — Choice 内容由模型填写，身份由服务端生成。** Primary 以 `confirm|select|select_with_actions|select_per_group_text` 穷尽 authoring 分支填写当前问题、说明、options、labels 与精确 subject；模型不提交 group key、option value 或跨列表 `when` 引用。服务端唯一 builder 生成 canonical group/option identity，并把确认或精确 option 内嵌的 commitment 转成现有持久 Offer。通用 Choice 不包含业务类型、固定按钮或未来步骤；原子 commitment 只能调用 registry 明示的当前非收费事务 Operation。用户关闭卡片投影 canonical `{kind:"cancelled"}`，只取消当前决定而不取消 Run/Task；Primary 必须尊重该结果并重新规划、等待或交付，不得立即重复强迫同一 Choice。
- **AP-06 — `>180s` 只是规划信号。** Prompt 可要求 Primary 评估并行、上下文、恢复与连续性；服务端不得把时长变成 Chapter/Story Canon/continuity 分支。Primary 若需要 Chapter，先委派 `chapter_plan`，再显式采用；每单元 180 秒仅是采用时的局部校验。
- **AP-07 — Creative Direction 是单一纯文本/结构化 Resource。** 每个 Task 恰好返回并物化一份完整最终 Direction；Worker 内部完成取舍，输出契约不表达候选集合。只有用户明确要求预览时才调用普通图片 Operation，且预览不改变 Direction identity。
- **AP-08 — 输入只用精确 Resource。** Creative Work request 与媒体 Operation 对 Resource 输入只传全局唯一 resourceId 及显式用途；服务端回库解析 schema、owner、scope 和真实内容。禁止附带调用方文本，或从最近记录、数组位置、历史消息与模型输出 offset 推断。下游参考资产生成经 `create_image.request.kind=manifest_assets` 只传 adopted Asset Manifest 的精确 Resource ID（可选 `manifestAssetIds` 子集），服务端直读每项 `generationPrompt` 并把 manifest Resource 写入 Lineage；Primary 不复制 prompt，也不得把文字 Resource 放进只接受真实图片 Resource 的 `imageReferences`。
- **AP-09 — Provider 约束不升级为运行时流程。** 允许时长、画幅、参考数量与模型能力来自 capability registry；Prompt 可据此规划一次请求，但不能据此建立代码阶段、eligibility 或自动分支。AP-01 的 `>15s` 完整作品纪律是明确的 Primary 产品规划政策，不是由 Provider capability 推导的 Operation 门禁；它不规定段数、逐段时长或 Chapter。
- **AP-10 — 单份模板与显式输出语言。** Primary System Prompt、conversation-summary 模板与 Worker system prompt 都是单份英文的模型侧文本，不按 locale 分叉；Prompt 语言是实现细节，不决定用户可见语言。用户可见语言由显式规则拥有：模型的一切用户可见输出（回复、Choice 卡片文案、失败说明、Resource 显示名）跟随用户在对话中实际使用的语言，当前轮没有语言信号时默认英文；conversation-summary 显式记录用户对话语言并保留原文引用。用户可见创作产物的语言由 creative-core 与各 Skill 的内容语言条款拥有：最终视频提示词与资产 `generationPrompt` 与内容语言一致，`score.generationPrompt` 按音乐模型真实能力固定英文。Creative Skill 仍是不分语言的单份专业文档；UI 文案继续走 i18n（含 `copy.ts` 的 Operation 标题表与 session-state locale），与 Prompt 语言无关。
- **AP-11 — Tool discovery 只发现能力，固定 gateway 只传输调用。** Primary 的每个模型步骤都只看到 `load_tools` 与 `execute_operation` 两个稳定 SDK tools。`load_tools` 的 registry 派生目录只帮助选择能力；模型按精确 id 加载当前目标的最小充分集合，loader 返回的 canonical `parameters` 才是参数契约，目录简介不能充当 eligibility、工作流、调用顺序或参数说明。加载不代表执行；后续步骤必须精确复制 `operationId`，只按返回 Schema 构造 `argumentsJson` 调用固定 gateway，不得把 Operation id 当工具名或猜测参数。所有具体能力说明都必须遵守同一规则，不能把 `generate_voice` 等按需 Operation 写成顶层直连工具。Gateway envelope 不解释业务参数，服务端仍用同一 runtime schema 校验。未加载/未知 id 是可恢复纠正且绝不执行。Task 提交回执不是终态，当前回合不得立即 `get_task` 或轮询；只在终态 continuation 后按需加载并读取精确 taskId。工具选择仍由 Primary 根据用户目标与当前事实判断。

## 权威入口

- Prompt catalog：`src/lib/ai-prompts/registry.ts`、`ids.ts`。
- Primary Prompt：`src/lib/ai-prompts/templates/project-agent/system/**`。
- Skill catalog：`src/lib/creative-skills/**`。
- Creative output registry 与唯一提交校验：`src/lib/creative-worker/output-registry.ts`、`output-submission.ts`、`task-contract.ts`。
- Resource schema/materialization：`src/lib/creative-resource/schema-registry.ts`、`creative-work-materialization.ts`、`task-materializer.ts`。
- 通用 Choice：`src/lib/project-agent/choice-offer.ts`、`choice-result.ts`。
- Primary Tool discovery：`src/lib/project-agent/toolset.ts`、`tool-discovery.ts` 与单份 Primary Prompt。

## 验证

- `tests/contracts/project-agent-toolset-conformance.test.ts` 从生产 registry 验证 Primary 完整 capability toolset、简短目录与 canonical load definitions；`tests/unit/project-agent/tool-discovery.test.ts` 反证加载前后顶层 tools 数组变化，并验证精确加载结果携带 registry Schema。
- `tests/unit/creative-worker/output-submission.test.ts` 通过真实 Agents loop 反证动态/宽松 output transport、一次性晚校验和错误后另起 Run；`tests/contracts/creative-result-resource-conformance.test.ts`、`tests/unit/creative-resource/creative-work-materialization.test.ts` 验证 strict outputKind 到 Resource 的唯一映射。
- `tests/golden-journey/self-tests/model-provider.test.ts` 验证模型替身协议 fail closed；`freeform-resources.spec.ts` 通过自然语言目标验证真实 Tool/Task/Resource 组合。

## 历史回归

- Prompt 曾先被过度缩短而遗漏 Choice/Approval/Task 规则，随后又把 `allowedOperationIds`、固定下一步、固定段数/逐段时长和 15/180 秒三档配方写回系统 Prompt。当前删除通用时长路由与分段配方；`>15s` 只保留为“完整视频先统一方向并制作实际会用的参考资产”的 Primary 产品规划纪律，明确不增加 Operation 前置条件、服务端门禁、Chapter 分支或固定分段数量，semantic guard 同时拒绝旧配方与新纪律丢失。
- 旧 script intake、Story Canon、核心剪辑、镜头计划、风格预览与 BGM 各有 prompt/schema/worker，和 Creative Skill 形成竞争 writer。当前删除专用模板与 worker，专业结果只经 output registry 物化。
- 旧结构化 stream projector 把 token 增量当正式领域内容，刷新和并发会造成空窗或串流。当前 stream 只展示运行状态，正式 Resource 在 Task terminal 一次接手。
- 旧 source script/Story Canon schema 要求模型回传系统 identity、版本标记或重复 persistent facts，服务端再用启发式校验，形成第二事实来源。当前 identity/fingerprint/lineage 由服务端构造，模型只输出创作内容。
- 风格选择曾默认生成九宫格预览并进入专用 Choice，随后文字输出仍保留 final/candidates 双模式；真实方向任务会为一次请求写多份完整政策并放大 structured output 成本。当前每个 Creative Direction Task 只物化一个普通 Resource，预览图是用户明确要求时的独立图片 Operation。
- 一分钟内容曾因 Beat 数量被固定估时扩大到数分钟。首次修正只发生在 Prompt 层（约束估时口径、删除逐拍固定时长先验），没有改动请求契约：`video_prompt_set` 仍要求调用方交出一个精确秒数，缺失即拒绝，运行时又强制分段之和精确等于该秒数。用户没有说明时长时，Primary 只能猜一个数，估算误差被下游强制转化为拖慢的表演；随后新增的 `screenplay.estimatedDurationSeconds` 又在无估时方法的新路径上长出第二个休眠时长解释源，构成同一不变量的换路径复发。当前把时长权威显式化为 `durationIntent`：`mode=fixed` 承载用户明确说明或近似表达的目标，故“一分钟”“约一分钟”“一分钟左右”统一解释为固定 60 秒；多个 Chapter/请求必须先分配固定份额且总和精确等于用户总时长，不能各自重复获得完整预算。`mode=derive` 只用于用户未说明时长，由导演 Worker 从真实对白语速、可见动作与必要停顿决定总时长；Beat/Chapter 估时降级为规划参考，`screenplay.estimatedDurationSeconds` 已删除。服务端保持既有单请求 strict 校验，不新增跨请求时长状态机或代码门禁；多请求分配服从度仍需真实模型抽样验证。
- 完整 Operation registry 上线后，Prompt 的“所有工具可用”与 runtime 的全量 Schema 注入被绑定成同一个概念，导致每一步重复发送所有长描述和严格参数定义。首次按需加载又把“下一步新增具体 Operation tool”当作 Schema 交付方式：虽然减少首步 token，却改变多轮 tools 前缀并破坏缓存，且把所有加载后的复杂 schema 重新交给不同 Provider 的 function validator。旧 Prompt/单测只约束“加载与执行分步”，没有约束顶层工具定义稳定。当前双语 Prompt 统一为“`load_tools` 返回 canonical parameters → 后续调用固定 `execute_operation`”，具体 Schema 只追加在消息尾部；Task 回执与终态读取规则保持不变。
- 媒体段落后来仍把 `generate_voice` 写成可直接调用的顶层工具，模型因而跳过通用 discovery gateway 并得到 `PROJECT_AGENT_TOOL_NOT_FOUND`；旧语义 guard 只锁定通用 `load_tools + execute_operation` 说明，没有检查具体 Operation 示例是否违约。当前双语 Prompt 把两个音色调用位置都改成“加载精确 `generate_voice` id，后续步骤经 `execute_operation` 执行”，并由现有语义 guard 锁定，不新增语音专用入口。
- 人物非写实安全规则曾只出现在 Primary Prompt 末尾，但 Creative Worker 不读取 Primary System Prompt；Primary 又必须原样消费 Worker 最终 `generationPrompt`，因此事后改写会产生第二创意 writer。当前 Primary 在委派 `creative_direction` 与 `asset_manifest` 前把“明显风格化、非照片写实的人物身份参考”冻结为请求约束，使 Direction 和 Manifest Prompt 自身合规；环境仍可保留 CCTV/VHS/纪录片质感。该策略按用户决策仅由 Prompt 引导，模型与外部 Provider 服从度仍是生成复验盲区。
- 剧本 canonicalization 曾在输出契约中同时拥有剧本文本、scene/entity registry 和生产资产候选；Primary 又被要求复制实体名单给 Asset Worker。真实“坠落到崖底”只在结尾出现一次，被前一 Worker 合并进山顶后，下游 exact coverage 反而禁止补回。Prompt 级地点细化只修正一次启发式，没有修正事实 owner。当前双语 Prompt 与语义 guard 明确：`screenplay` 不登记生产资产，Primary 委派 `asset_manifest` 只传精确 screenplay Resource、用户目标和不能从该 Resource 推导的约束，绝不手写名单或手动附带 Creative Direction；已采纳方向由服务端向全部非方向生产者冻结完整精确内容，Asset Worker 自行使用相关政策。资产筛选、设计与 Prompt 在一个 Subagent Task 内完成。终态失败的 `errorCode` 由 Task View 确定性展示，Primary 在任何重派前必须先给出用户可见解释且请求发生真实变化；模型叙述不再承担错误事实本身。
- Creative Worker 为兼容 Azure/OpenAI Structured Outputs 曾把 canonical schema删除范围、长度、数组数量、pattern 等关键字后交给 Provider；结果是 transport 会接受本地 Zod 必然拒绝的组合，而本地校验只在 run 完成后发生，模型无法纠正。当前 output schema不再进入 Provider output contract：完整文档作为本次输入事实，固定 `submit_result` 在同一 Agents loop 内返回有界字段 issues 并接受纠正；成功前没有 Task result writer，成功后也不再二次解析或 repair。
- Prompt 语言曾按 UI locale 双份维护：Primary/summary 各两份模板、Worker prompt 三组 zh/en 常量、tool-discovery 与附件包装的双语文案，输出语言只是模板语言的隐性副作用。每条规则要中英各改一遍、parity 只能人工核对，长对话压缩后英文摘要还会丢失用户语言信号。当前全部模型侧文本收敛为单份英文，输出语言由 AP-10 的显式规则拥有（跟随用户实际语言，无信号默认英文），conversation-summary 显式记录用户语言并保留原文引用；用户可见 Operation 标题的 i18n（`copy.ts` 标题表 + session-state locale）不受影响。残留：`ProjectAgentContext.locale → resolveOperationLocale → TaskJobData.locale` 链仍被冻结进 Task payload 但已无消费者，待后续批次连同客户端 locale 传参一并删除。真实模型对“无信号默认英文”的遵循度是发布验证盲区。

## 修改检查表

1. 是否新增了专业输出却绕过 Creative output registry？
2. 是否让 `create_text`、UI、route 或 worker 成为第二专业 writer？
3. Prompt 是否恢复固定阶段、next action、确认门或固定分段配方；`>15s` 纪律是否仍只约束 Primary 规划而未变成 Operation/服务端门禁？
4. Choice 是否只描述当前决定，Creative Direction 预览是否仍需用户明确请求？
5. Resource 输入是否只使用精确 resourceId 并回库校验，结果是否保留真实 lineage？
6. 双语 Primary Prompt、单份 Skill 与适用 Conformance/Golden 是否同步？
