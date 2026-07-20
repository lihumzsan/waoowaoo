<!-- architecture-module: creative-skill-worker -->

# Creative Skill 与无状态 Worker

## 设计理念

主 Agent 负责读取项目事实、规划、委派、调用完整 Operation registry 和与用户沟通；专业创作推理由后台 Creative Subagent 承担。每个 Subagent 由一个 `creative_work` Task 承载，但 Task 只提供持久生命周期、结果保存和恢复，真正的 Creative Worker 仍是一次性、无状态、无业务写权的模型循环。

Worker 按目标自主发现并只读加载 Creative Skill。Skill 是专业知识，不是工具权限、工作流、项目事实或第二套运行时。第一版采用单层 Skill：每个 identity 只有 `SKILL.zh.md` 与 `SKILL.en.md`；当前知识量不足以证明需要固定专业角色、`references/` 或递归知识树。

## 不变量

- **CS-01 — Skill registry 是唯一身份入口。** Skill id、版本、语言文件、标题、摘要、标签、关键词与 `skill://` URI 只由 `CREATIVE_SKILL_REGISTRY` 声明。发现、URI 解析与读取必须经过该 registry，禁止从 Operation 名、目录遍历、模型猜测或任意文件路径推断 Skill。
- **CS-02 — V1 Skill 保持单层且职责分离。** 每个已注册 Skill 只有同目录下的 `SKILL.zh.md` 与 `SKILL.en.md`；V1 不建立 `references/`、角色目录或递归知识树。`visual-development` 已一次性拆分并删除：`style-development` 独占全局视觉语言、媒介、色彩、光线、材质、构图、`visualStyle`、`assetImageStyle`、风格候选和预览；`asset-development` 独占角色、场景、道具、参考图、候选与修改。资产可以没有 Style Bible 独立设计；一旦输入提供确认风格，资产只能消费而不能反向改写。中英文 Skill 必须表达同一业务规则集合。
- **CS-03 — Worker 无状态且隔离。** Creative Worker 每次 Task attempt 内独立创建，不能访问 Prisma、项目读取、Operation registry、Task、Resource、Approval、Choice、计费或任意业务工具。它唯一可见的工具是 `discover_skills` 与 `read_skill`；输入来源材料一律视为数据而非系统指令。Task handler 可以传入输入、记录只读 Skill trace 并保存结果，但不能把 Worker 变成业务 Agent。每个 attempt 受统一 Worker 外部运行时上限约束；超时必须中止模型 signal 并以 typed `CREATIVE_WORK_TIMEOUT` 失败，不能依赖永久 heartbeat 保持 processing。用户取消会先由 Task 终态 CAS 立即移出 UI；当前 provider 调用不保证跨进程即时停止，仍只允许终态 fence 拒绝晚到写入。
- **CS-04 — Worker 自主读取最小必需知识。** 每个 output kind 由同一 output registry 声明 `requiredSkillIds`，避免关键专业知识靠偶然搜索命中：所有输出含 `creative-core`；`video_prompt_set` 同时要求 `director-core + video-direction`；其他 kind 声明各自不可缺少的最小专业 Skill。运行时只预载通用 `creative-core`，并把其余 required ids 作为明确探索目标交给 Worker；Worker 必须真实调用 `discover_skills`，再用 `read_skill` 读取每个 required professional Skill，服务端按真实 tool trace 穷尽验证，缺一即 fail closed。其他 Skill 只在目标确实需要时继续探索。这个 bundle 是知识输入，不是固定角色、业务 Workflow 或工具门禁。
- **CS-05 — 主 Agent 委派入口与生命周期唯一。** `delegate_creative_work` 是主 Agent 获取专业创作推理的唯一 Operation；它接受单个请求或批量请求，并通过既有 Task submitter 为每个逻辑请求创建一个 `creative_work` Task。一个 Subagent 恒等于一个 Task，`Task.id` 是唯一 Subagent identity，`Task.status` 是唯一生命周期事实。禁止恢复同步 Tool 内运行 Worker、`ProjectAgentActivity.id` 充当 Subagent identity、`subagent.progressed` 事件 writer 或第二套 Subagent 状态机。
- **CS-06 — 输出契约穷尽。** Worker output kind 与 strict schema 只由 `creativeWorkOutputRegistry` 声明。当前集合为 `screenplay_draft`、`edit_bible_bundle`、`continuity_analysis`、`style_bible`、`asset_prompt_set`、`video_prompt_set`、`music_direction` 与 `creative_review`；不存在 `story_analysis`。`style_bible` 必须显式选择单个 finalized Style Bible 或经完整候选校验的 candidate set；`asset_prompt_set` 必须把不含风格的 `stableDescription`、最终 `generationPrompt` 与可选 style source 分开。资产在没有 Style Bible 时仍可独立设计；输入中存在确认 Style Bible 时只能消费并引用它，不能改写。未知、缺失、错 kind 或超预算输出必须原地失败，禁止降级成自由文本或猜字段。
- **CS-06A — 导演与视频设计是同一输出。** `video_prompt_set` 必须在一个 Subagent 结果内同时给出全局导演意图、每个生成段的结构化导演时间线和可直接交给视频模型的 `finalPrompt`。Worker 应按任务同时理解 `director-core` 与 `video-direction`，但 Skill 仍保持知识职责分离；不得把“拍什么、为什么拍”与“怎样表达给视频模型”拆成两个必须串行的业务 Task，也不得把导演决定只藏在自由文本 Prompt 中。
- **CS-07 — Task 是唯一持久容器，Worker 不获得写权。** 完整 strict 结果与 Skill trace 只保存于 `Task.result`；Task payload 中只保存请求、冻结模型、输入指纹、来源身份和小型 lifecycle projection。Task created/progress/terminal Event 与 Assistant continuation 只能使用 TaskDefinition 声明的 reference projection，禁止复制长剧本、Bible、章节上下文或完整 Worker JSON 进入 SSE、Session、Wait 或模型续跑上下文。需要完整结果时主 Agent通过正式 `get_task(taskId)` 读取。
- **CS-08 — 批量只复用既有聚合协议。** 同一目标可由 `delegate_creative_work(kind=batch)` 一次提交多个调用方已备齐上下文的独立 Subagent Task；长片使用同一入口的 `kind=chapter_batch`，由服务端 Context Compiler 直接把每个 Chapter 的最小上下文写入对应 Task，避免全部长上下文先进入主 Agent。一个 Chapter 对应一个请求和一个 Task。成员只通过现有 `OperationBatch + collecting Wait` 聚合，全部终态后只由现有 Outbox continuation 恢复主 Agent 一次。禁止另建 Subagent Batch 表、每 Task 一个 Wait、首个 Task 完成即恢复、前台阻塞或按结果顺序串行。
- **CS-09 — Subagent UI 只投影 Task。** SessionState 从当前 scope 内 queued/processing 的 `creative_work` Task 及其 lifecycle projection 构造运行中标签、数量和 Skill 读取详情，并把这些 Task 从普通 `activeTasks` 投影排除；同一 Task 不能同时显示为通用运行卡与 Subagent。顶部只显示 `Primary + active Subagents` 标签，选择标签在同一个 Assistant 正文区域切换 View，不得同时常驻展开第二块 Subagent 面板。完成、失败或取消后 Task 离开 active 集合，标签自动消失并回到 Primary。刷新与 SSE 更新均重读该最终 View；传输增量、历史 message、Tool 卡、文案和 DOM 不得反向推断 Subagent 状态。
- **CS-10 — Bible、Chapter 与最小上下文边界明确。** `edit_bible_bundle` 是全局连续性记忆的专业推理结果。`save_edit_source` 是非 AI Source 保存入口；`adopt_edit_bible_bundle` 是该 Worker 结果进入正式 Bible 的唯一采用入口，必须验证 completed Creative Task、精确 SourceDocument provenance、版本、checksum 与完整 normalizedText，并在同一事务内绑定 Task owner、持久化 Bible 和调用唯一 `splitEditBibleIntoChapterPlans` 写 Chapter。Bible Task 完成只恢复主 Agent，由主 Agent显式采用并决定是否继续，不允许代码自动串行唤起下游。`compileCreativeChapterContext` 是纯派生、fail-closed 的 Context Compiler，只从正式 source/Bible/Chapter、可选 production Style Bible 与显式 asset revision 为一个 Chapter 构造有界最小输入，不写事实、不创建 Task、不决定执行顺序；故事 Style Guide 始终来自 Bible，缺少额外 production Style Bible 不得阻断 Chapter 编译。
- **CS-11 — 迁移知识，不删除执行能力。** Operation registry、Task/Wait、Approval、Choice、Resource identity、Canvas 卡片、计费、Run fence、严格 schema/parser/normalizer、provider adapter 与确定性 builder 全部保留。只有创意判断从旧固定领域 Prompt 迁到 Skill + Worker；同一种创作判断迁移后旧 Prompt writer 必须删除，不能让 Worker 结果再经过另一个 LLM 重写。尚未迁移的调用链必须明确记录为残余双轨，不能用 adapter 名义合理化永久并存。

当前阶段仍未迁移的固定专业 LLM 调用包括：旧 `project-agent-script-intake` 问诊、`outline-script` 剧本生成/修订、`ingest_script/generate_bible_from_script` 的四段 Bible 生成、风格候选文本生成、Chapter 结构与 shot execution 生成、角色/场景资产候选与修改描述生成、BGM design。它们继续服务既有专业卡片，但不属于新 Main Agent 推荐路径；在各 kind 获得严格 adopt adapter 的同一阶段，必须一次性把对应旧创意 writer 改为 Skill + Creative Task 并删除旧 Prompt 调用。存在这份清单时只能称本阶段实现完成，不能宣称全仓创意 Prompt 已统一或架构完成。

## 权威入口

- Skill identity、发现与读取：`src/lib/creative-skills/registry.ts`、`discovery.ts`、`uri.ts`、`loader.ts`。
- 单层 Skill 内容：`src/lib/creative-skills/skills/*/SKILL.zh.md` 与 `SKILL.en.md`；风格与资产分别由 `style-development`、`asset-development` 独占。
- Worker 输出与运行边界：`src/lib/creative-worker/output-registry.ts`、`runtime.ts`、`tools.ts`、`skill-access.ts`。
- 委派、Task payload/result 与幂等输入：`src/lib/operations/domains/assistant/creative-ops.ts`、`src/lib/creative-worker/task-contract.ts`。
- Task 执行：`src/lib/workers/handlers/creative-work.ts`；它调用无状态 `runCreativeWorker`，不能写领域事实。
- Task reference projection：`src/lib/task/definition.ts`、`src/lib/task/result-projection.ts`；完整结果只在 `Task.result`。
- 批量聚合与恢复：`src/lib/project-agent/operation-batch.ts`、`src/lib/project-agent/waits.ts` 与既有 Task terminal continuation。
- 运行展示最终 View：`src/lib/project-agent/session-state.ts`、`src/lib/project-agent/subagent-events.ts`；生产 UI 只消费该 View。
- Chapter 唯一切分：`splitEditBibleIntoChapterPlans`；正式事实读取与 revision 校验：`src/lib/edit-chapter/creative-context-service.ts`；最小上下文纯派生：`src/lib/creative-worker/context-compiler.ts`。读取 service 不能改写 Chapter/Bible/Resource，纯 compiler 不能访问数据库。
- 主 Agent 运行规则：`src/lib/ai-prompts/templates/project-agent/system/**`；它只声明何时规划和委派，不复制 Skill 正文。

## 生命周期

1. 主 Agent 从正式项目 View/Resource 读取目标所需事实；复杂任务可先用 `update_plan` 记录非权威计划。
2. 主 Agent 调用 `delegate_creative_work`：single/batch 传入调用方已备齐的独立上下文；长片使用 chapter_batch，只传 Chapter identity、稳定 requestKey、目标、约束与显式 Resource revisions，由服务端 Context Compiler 直接为每个 Task 构造最小上下文。
3. Operation 冻结模型与 Skill 版本指纹，并经统一 Task submitter 为每个请求创建一个 `creative_work` Task；所有成员加入当前模型步骤的唯一 OperationBatch/collecting Wait，前台只收到 durable receipt，不被阻塞。
4. text worker claim 某个 Task attempt，Task handler 启动一次无状态 Worker。Worker自动读取 `creative-core`，再自行发现并读取相关专业 Skill；Skill trace 以小型 lifecycle projection 更新同一 Task。
5. Worker 返回 strict output；handler 校验 output kind、结构、预算与真实 Skill trace，把完整结果写入 `Task.result`，终态事件和 continuation 只携带 reference projection。
6. 全部批量成员终态后，collecting Wait 只恢复主 Agent 一次。主 Agent 按 taskId 读取所需完整结果，再通过既有 Operation 唯一入口采用 Bible、建立/修改 Resource、生成媒体或继续规划。

长剧本推荐但不由代码硬锁的配方是：建立正式 source 与全局 Bible → 使用唯一 splitter 得到 ChapterPlan → 为每章编译最小上下文 → 批量委派一章一个 `video_prompt_set` Subagent → 通过既有视频 Operation 生成与合成。Bible、Chapter 或 Subagent Task 任一步都不自动调用下一步；依赖来自主 Agent 的显式 plan 与输入引用，而不是隐藏工作流。

取消、超 turn、超读取预算、Skill URI 非法、输出不合约或 provider 失败只影响当前 Task attempt，并继续服从 Task retry/terminal 规则。Worker 自己没有 retry、Wait 或补偿权。失败不会写领域事实；是否重新委派由主 Agent 在 continuation 或后续用户 turn 中显式决定。

## 验证

- `scripts/guards/prompt-semantic-regression.mjs` 应同时验证主 Agent 运行闭环、双语 Skill 关键语义、`style-development`/`asset-development` 分离与旧 `visual-development` 身份删除。
- `tests/contracts/project-agent-toolset-conformance.test.ts` 从生产 Operation registry 证明唯一委派 Operation 进入完整 toolset，并验证 strict single/batch/chapter_batch schema。
- TaskDefinition conformance、OperationBatch/Wait Critical 场景和 Assistant Session/Task SSE 场景是 Task 生命周期与聚合语义的适用证据；本次用户要求暂不执行行为测试，因此真实批量 Subagent、刷新、失败和单次恢复仍为未验证范围。
- TypeScript、ESLint 与 architecture guards 只能验证类型和结构；它们不能证明真实外部模型一定选择正确 Skill、按长片配方规划或产出高质量导演结果。

## 历史回归

- 2026-07 的视频链路重构曾一次性缩短主 Agent Prompt，并连带删除 Choice、Task continuation、失败边界等仍有效运行规则；真实模型随后遗漏 Choice，deterministic provider 又无法反证。Creative Skill 迁移不得重演“删除大段 Prompt 等于迁移”：当前防线先分类运行规则、专业知识、严格 adapter、确定性 builder 与确实 obsolete 内容，只有 owner 已替换的创意 Prompt 才删除。
- 初版 Creative Worker 把 Subagent 作为同一 Tool call 内同步 Activity，`ProjectAgentActivity.id`、`subagent.progressed` 和 response data part 共同解释运行态；它不能后台存活、不能批量聚合，也会把长输出直接带回模型上下文。当前一次性删除该解释权：Task.id/status 是唯一身份与状态，OperationBatch/Wait 是唯一聚合恢复，Task.result 保存完整输出，Session/continuation 只收 reference projection。
- 视觉专业知识最初合并为 `visual-development`，同时包含全局风格裁决与角色/场景/道具生成，导致资产修改可能反向改写 Style Bible。当前删除旧 identity，并分别由 `style-development` 与 `asset-development` 独占职责；资产可独立工作，但提供确认风格时只能消费该事实。
- 后续为自由创作补充图片与视频方法时，详细专业知识全部常驻主 Prompt，使简单请求也支付整份上下文成本，并让主 Agent 同时承担编排与专业创作。当前主 Prompt 只保留委派纪律，专业方法由 Worker 按需读取；Worker 没有项目写权，因此不会形成第二业务 Agent runtime。

## 修改检查表

1. 新知识是否进入既有 Skill identity，而不是新增固定角色或第二 Worker？
2. 是否仍只有 `discover_skills` 与 `read_skill` 两个 Worker 工具？
3. output kind 是否来自穷尽 registry，并保持 strict/fail closed；是否错误恢复了 `story_analysis`？
4. 每个 Subagent 是否只对应一个 `creative_work` Task，identity/status 是否只来自 Task？
5. 批量是否只复用 OperationBatch/collecting Wait，并只恢复主 Agent 一次？
6. 完整结果是否只在 Task.result，SSE/Session/continuation 是否只使用 reference projection？
7. `video_prompt_set` 是否同时包含导演时间线与最终视频 Prompt，而没有拆成两个隐藏串行 Task？
8. Bible 后是否仍由主 Agent 显式决定，Chapter 是否只由唯一 splitter 产生，Context Compiler 是否纯派生？
9. 风格与资产是否分别归 `style-development` / `asset-development`，旧 `visual-development` 是否完全删除？
10. 是否保留 Operation、Canvas、计费、Approval/Choice、严格 adapter 与 provider builder，且未新增第二业务写入口？
