<!-- architecture-module: creative-resource -->

# 创作 Resource、Revision 与 Lineage

## 设计理念

创作系统需要一个可被 Agent、Canvas 和后续生成共同引用的统一产物身份，但不需要把所有专业领域压成一张通用 JSON 表。`CreativeResource` 是跨领域的创作产物脊柱：它给文字、图片、音频、视频以及剧本、Story Canon、剪辑表、角色图、场景图、BGM、章节视频等专业产物提供稳定身份、不可变 Revision、真实生成来源和显式血缘。已有专业领域表继续保存可查询、可编辑的结构化业务事实；ResourceRevision 保存一次生成所交付的不可变内容或当时的领域快照。

`text / image / audio / video` 只回答“没有专业 renderer 时如何展示和处理媒体”，不是四套业务实体，也不限制专业语义。剧本与剪辑表仍由 `schemaId`、领域 origin 和专业 renderer 区分；最终成片只是 `video` Resource，不拥有专用最终成片卡片。

## 不变量

- **CR-01 — 一个稳定 Resource，多次不可变 Revision。** `CreativeResource.id` 是产物 identity；成功生成、修改或重生成只能追加 `CreativeResourceRevision` 并原子推进 `headRevisionId`，不得原地改写历史 Revision。通用候选以 `operationId + requestId + candidateIndex` 形成唯一 origin；专业产物以 `sourceType + sourceId` 形成唯一 origin，同一专业实体不得创建第二个 Resource。
- **CR-02 — 只有确需结构化查询的事实才进入领域投影。** Creative Worker 成功物化的 `screenplay` Revision 只保存剧本文本及写作元信息；生成、粘贴和导入只改变 `source`，不复制为“正式/确认剧本”，也不登记生产资产、场景范围或第二套叙事实体状态。Story Canon adoption、Chapter adoption 与项目资产可保留严格、可追溯投影；图片、音频、视频、Creative Direction、连续性和 Prompt 结果都只存在于 Resource spine，不建立专用阶段表。
- **CR-03 — 四种媒体只是 fallback。** 每个 Resource 必须声明一个 `mediaType=text|image|audio|video` 和一个穷尽注册的 `schemaId`。`schemaId` 决定专业语义与首选 presentation；仅在没有专业 renderer 时才使用 mediaType renderer。新增剧本变体、图片角色或其他专业内容主要增加 schema/renderer 声明，不得复制 Resource、Revision、Lineage 或 Binding 模型。
- **CR-03A — Creative Direction 是结构化文字 Resource。** Creative Task 终态把 final 或每个候选分别物化为 `mediaType=text + schemaId=project.creative_direction` 的不可变 Revision；内容严格为 `styleSummary/rawUserStyle + visual/narrative/directing/editing/sound/assetPolicy`，其中规则与禁止项归入所属领域。Task id/candidate key 构成稳定 origin，实际输入 revisions 构成 lineage。`adopt_creative_direction` 不复制内容，只把被选中的精确 Revision 写入 canonical Binding。Canvas 使用 schema-aware renderer 展示结构化内容，不建立第二实体或默认预览图。
- **CR-04 — Lineage 只记录实际输入 Revision。** 每条 `CreativeResourceLineage` 必须从精确的 `inputRevisionId + role + position` 指向输出 Revision。Revision ID 全局唯一且不可变，调用方不得再附带 resourceId、内容副本或 fingerprint 充当第二身份；服务端从数据库解析 owner、scope、schema 与真实内容。不得从当前 head、最近资源、数组位置、Prompt、历史消息或 Canvas edge 反推输入。
- **CR-05 — 生成与采用分离。** 生成候选只创建 Resource/Revision；把某个候选用于项目角色、插槽或 canonical 选择，只能通过 `CreativeResourceBinding` 的 `scope + role + slotKey` CAS 更新。选择不得删除、覆盖或重新生成其他候选。Binding 保存精确 `resourceId + revisionId`，刷新后仍指向同一 Revision。
- **CR-06 — provenance 冻结真实调用。** 每个成功 Revision 必须保存适用的 `operationId`、稳定输入 hash、Task/OperationExecution/executionSegment/toolCall identity、实际 prompt、modelKey 与生成参数。缺失适用来源时必须显式失败；不得用模型事后总结、UI 文案或当前配置补造历史来源。
- **CR-07 — 一个异步终态 writer。** 异步创作输出只由 `commitTaskTerminal` 的同一事务调用 production Task materializer；该事务在领域 success projector 之后写 Revision/Lineage，并把真实 Resource refs 合并进 Task result、Task terminal Event 和 Agent continuation。重放同一 Task 只能返回同一 Revision；失败/取消只结算本次预留候选，不覆盖专业 Resource 的上一个成功 head。
- **CR-08 — 通用生成与专业采用/执行不重复动作。** `create_text/create_image/create_audio/create_video` 从空项目或显式 Resource revisions 创建通用产物；`create_text.current_user_text` 还可在事务内验证并原样保存当前用户消息的精确连续片段，不经过模型改写；`merge_videos` 只按显式顺序合成精确 video revisions。专业创作判断全部进入 Skill + `creative_work`，确定性的 Story Canon/Chapter/Creative Direction 采用、资产媒体生成与渲染仍可保留独立 Operation，但不得恢复旧 LLM writer、固定顺序或专用确认卡。全部入口复用同一个 Operation invocation、Task、计费和 Resource materializer。
- **CR-09 — 引用必须先证明 owner 与 scope。** 任一输入 Revision、Binding 或 API Query 必须由服务端按 revisionId 回库验证 user、project、episode scope、status 与 schema；跨项目或错误 scope 原地失败。用户级通用资产可被显式采用到项目，但不得通过 bridge row、名称或最近记录推断归属。
- **CR-10 — Canvas 只投影持久 Resource View。** Resource API/View service 是 ResourceCard 的唯一查询投影；卡片摘要只能从 head Revision content 或 pending Resource 的冻结 prompt 纯派生，structured content 的语义字段选择由 Resource schema registry 声明，Canvas renderer 只消费最终 summary View，不解释领域 JSON，也不持久化摘要。Canvas 优先把 origin 与既有专业节点 identity 对齐并复用专业 renderer，再使用通用 ResourceCard。节点只来自持久 Resource、当前 Task 或 structured stream 的真实事实，边只来自 Lineage。最终渲染完成后显示普通 VideoCard；任何阶段都不得投影专用 final timeline，进行中或失败的渲染仍由通用 Task/Assistant 生命周期表达。
- **CR-11 — 候选是同一调用的独立资源。** 一次 count=N 的调用必须产生 N 个稳定 candidate Resource，并共享 candidateSetId；成功候选不会因兄弟失败而重提。Agent 重试必须显式引用失败 resourceId，只提交失败候选；retry Tool 分支不得接收 prompt、references、时长、画幅、声音或 provider 参数，服务端只能从该 Resource 第一次 `request.kind=new` 的失败 Task 恢复完整冻结 payload，并以新的执行 identity 重提同一内容。同一 provider invocation 的至多一次保证继续由 Task checkpoint 负责，不建立第二套 logicalInvocationId 或 outcome 协议。
- **CR-12 — Resource 不裁决创作顺序。** Resource 存在、缺失、旧 Revision 或 Lineage 仅是可读事实。Operation 是否可调用由 registry channel、显式输入 schema、owner/scope、provider capability、计费批准和破坏性确认裁决；Workflow step、Canvas 位置和“上游是否推荐完成”不得成为硬门。
- **CR-13 — Resource Tool 参数只表达产品语义。** `schemaId` 必须从按 mediaType 穷尽分组的生产 Resource registry 生成 enum；通用语义用对应 `generic.*`，不得允许模型发明新 identity。文本结果以 `single|candidates` 分支表达；异步媒体的全部新创作参数只存在于 `request.kind=new`，`request.kind=retry` 只接受失败 Resource identity。Agent-facing 图片/视频/音乐字段使用跨 provider 产品名，且不得包含 `modelKey`、`*Model` 或 provider 参数；实际模型由服务端正式配置唯一解析。`generationOptions` 只是在批准计划与 Revision provenance 中冻结的内部执行快照，不是公开 Tool 参数。服务端解析出的 modelKey 对应 capability registry 是允许字段和值的唯一裁判，不支持必须 typed-fail，禁止跨模型默认或 provider 参数透传。
- **CR-14 — pending 卡片显示冻结提交事实。** 异步 Resource Operation 必须在提交 Task 的同一事务预留 pending Resource，并写入可 replay 的 Resource broadcast；Resource View 从该 Resource 当前唯一 active Task 的冻结 payload 投影 prompt、model、options 与精确 inputs。它只负责让卡片和原始提示词立即可见，不得把 pending 当成成功 Revision，也不得由客户端从工具文案补造。ready/failed/canceled 仍只由 Task Terminal writer 结算。
- **CR-15 — 剧本无需确认状态，风格采用使用唯一 Binding。** 任意成功 `screenplay` Revision 都是可精确引用的剧本；系统不保存 `confirmed_screenplay` Binding，也不创建同内容副本。项目当前采用的风格只由 `adopt_creative_direction` 写 `scope=project + role=adopted_creative_direction + slotKey=primary`，绑定精确不可变 Revision；通用 `adopt_resource` 必须拒绝该保留角色。Creative Direction 默认是文字 Resource，采用不生成预览图或下游产物。
- **CR-16 — 语义上下文与 provider 媒体引用分离。** `contextReferences` 只表达会进入 lineage 和专业推理上下文的精确 Resource Revision，可以是文字、图片、音频或视频；`create_image.imageReferences` 只表达图片 provider 输入，`create_video.mediaReferences` 是图片与声音共用的唯一视频媒体输入列表。提交前按 Resource 的真实 `mediaType` 分类，并在严格 Task payload 中冻结 `imageInputPositions` 与 `audioInputPositions`；Worker 按各自序列保持顺序，adapter 只能收到规范化后的 `referenceImages` 与 `referenceAudios`。不得把 Creative Direction、剧本或其他文字 Resource 当作 provider 媒体发送，不得增加声音专用公共字段，也不得为了兼容旧 `references` 或 `imageReferences` 猜测视频媒体语义。
- **CR-17 — 读取工具各自只有一种职责。** `get_project_context` 返回紧凑事实与当前正式 Binding；它不指定当前剧本或下一步。`list_resources` 有界浏览候选、历史与可复用 Resource；精确跨层输入只传 revisionId，服务端解析所属 Resource。Primary Agent 必须显式选择所需剧本 Revision，不得从最近记录、历史消息或 head 推断。
- **CR-18 — Revision 记录实际执行路由。** Agent 和业务 Operation 不选择 provider/model，但每个成功媒体 Revision 的 provenance 必须保存本次 Task invocation 最终实际使用的 `modelKey`。当 Provider Gateway 在同一等价 route set 内进行受控 pre-accept 路由切换时，materializer 只能读取 durable invocation route checkpoint，不能继续记录初始配置、当前配置或模型事后文字。
- **CR-19 — Resource 提供开放但隔离的创作文档。** 每个 Resource 可以持有一份 schema-open、版本化的 `creativeData` JSON 文档，供用户和 Agent 保存任意当前创作资料；新增创作概念不要求新增数据库字段或 Operation 分支。它只由 `edit_resource` 以 `creativeDataVersion` CAS 和最小 object-path Patch 写入，嵌入的 `$resourceRef` 只能包含 revisionId，并由服务端验证 owner 与 scope。`creativeData` 不是 Revision、provenance、Lineage、Binding、Task 或生命周期事实。
- **CR-20 — 角色音色使用保留动态 Binding。** `project.voice_reference` 是项目级 audio Resource；新建与原位重生成只由 `generate_voice` 追加 Revision。角色当前音色只由 Binding service 写入 `scope=project + role=character_voice + slotKey=characterId`，产品入口只有 `bind_voice` 以及 `generate_voice target=character` 的 Task 终态 CAS。通用 `adopt_resource` 必须拒绝该 role。绑定冻结精确 Revision；生成期间发生的较新绑定造成显式冲突但不丢弃已生成音频。删除音色必须拒绝 active Task、任意 Binding 和下游 Lineage，且不删除共享 MediaObject。
- **CR-21 — Project 级剧本与 Episode 投影分离。** `screenplay`、`story_canon`、`creative_direction` 和 `asset_manifest` 的 Resource scope 由 Creative Work 输出 registry 穷尽声明为 Project；同一 Project 的任意 Episode 可以显式引用同一精确 Revision。`ProjectEpisodeSourceDocument` 和 `ProjectStoryCanon` 仍是 Episode-scope 查询投影，identity 分别是 `(episodeId, sourceRevisionId)` 与 `episodeId`。Chapter Plan、连续性和执行性创作结果继续按 registry 声明保持 Episode scope。
- **CR-22 — 剧本与资产清单分权。** 用户在当前消息提供的完整剧本可由 `create_text.current_user_text` 以 `classification.kind=screenplay` 直接保存为项目级 `project.screenplay` Revision；这一步只做精确来源捕获，不创作、不改写、不确认，也不自动委派 Worker。从零创作或修改剧本由 `story-development + creative_work(outputKind=screenplay)` 完成，结果同样只拥有文本和写作元信息。`asset-development` 独占生产资产范围：它在一个 `asset_manifest` Subagent Task 内读取精确 screenplay，并在存在 adopted Creative Direction 时由服务端自动接收完整方向、自行判断与资产相关的政策，完成必要角色、地点、道具的筛选、归一、外观设计和最终媒体 Prompt；方向缺失不构成失败。每项仍提供可在来源剧本文本中验证的逐字 `sourceExcerpt`；服务端只编译稳定 `manifestAssetId` 并验证歧义与来源证据，不建立 screenplay entity registry、scene ranges、独立 extraction 输出或第二套资产状态。
- **CR-23 — 资产采用与图片生成分离。** `adopt_asset_manifest` 是项目资产 identity 的唯一批量采用入口；它通过共享 Project asset writer 创建或复用 `ProjectCharacter/ProjectLocation`，只写 `adopted_asset_manifest` Binding，不创建图片 Task。图片仍只能由 `create_image` 生成；`project.character_image/location_image/prop_image` 在计划阶段由单一 asset-image format policy 强制 4:3 固定后缀，完成后才以 `project_asset_image + variantId` Binding 关联目标资产。Creative Direction 不包含 composition，generic image 不消费该 policy。

## 状态所有权

| 事实 | 唯一 owner / writer | 消费者 |
| --- | --- | --- |
| 当前专业结构化业务状态 | 对应领域 table / 既有领域 service 或 Task success projector | 专业 Query、Operation、专业 renderer |
| 跨领域产物 identity 与当前 head | `CreativeResource` / Resource persistence service | Agent tools、Resource View、Canvas |
| 一次不可变交付 | `CreativeResourceRevision` / 同步 Resource Operation 或 Task Terminal materializer | Lineage、Binding、审计、后续生成 |
| 精确生成输入关系 | `CreativeResourceLineage` / Revision append transaction | Agent、Canvas edge、来源诊断 |
| 项目采用与 canonical 选择 | `CreativeResourceBinding` / Binding service CAS | Agent、Canvas、后续显式读取 |
| 异步候选 pending | Operation 的 Task 提交事务（预留 Resource + Task + broadcast） | Resource View、Canvas |
| 异步候选 ready/failed/canceled | `commitTaskTerminal` | Agent continuation、Resource View |
| Creative Direction final/候选 Revisions | Creative Task terminal materializer | Primary、Canvas、adopt Operation |
| 剧本文本与写作元信息 | `screenplay` Task terminal materializer，或 `create_text.current_user_text` 的精确 screenplay 分支 | Primary、Story Canon/Chapter/continuity、Asset Worker、Canvas |
| 剧本/Story Canon/Creative Direction 的 Project scope | Creative Work output registry + Task terminal materializer | 同 Project 各 Episode 的显式采用/委派 |
| 当前采纳的 Creative Direction Binding | `adopt_creative_direction` transactional Operation | Project Context、Task 创建时的统一方向注入 |
| Task 冻结的完整方向 revision 与内容 | `delegate_creative_work` server compiler + output registry | 全部非方向生产者 Creative Worker、Resource lineage |
| 当前 Asset Manifest 与 Project asset identity | `adopt_asset_manifest` + shared Project asset writer | Project assets、Primary、图片生成 |
| 资产图片固定版式与绑定 | asset-image format policy + `create_image` terminal materializer | 图片 provider、Project asset consumers |
| 当前角色音色 Binding | Binding service；产品入口 `bind_voice` 或 `generate_voice` 终态 CAS | Project Context、Agent、Resource View |
| Resource 当前开放创作文档 | `CreativeResource.creativeData` / `edit_resource` CAS transaction | Agent、Resource View、通用或专业 renderer |
| ResourceCard 最终 View | `view-service.ts` 从上述持久事实纯投影 | API、React Query、Canvas renderer |

## 权威入口

- 共享类型与 schema registry：`src/lib/creative-resource/contracts.ts`、`schema-registry.ts`。
- origin、scope 与输入 hash：`src/lib/creative-resource/identity.ts`。
- Resource/Revision/Lineage 唯一持久化入口：`src/lib/creative-resource/persistence.ts`。
- Binding 唯一写入入口：`src/lib/creative-resource/binding-service.ts`。
- 异步 Task 终态物化：`src/lib/creative-resource/task-materializer.ts`，只由 `src/lib/task/terminal/service.ts` 调用。
- ResourceCard 查询投影：`src/lib/creative-resource/view-service.ts` 与 `src/app/api/projects/[projectId]/resources/route.ts`。
- Agent 通用生成与读/采用工具：`src/lib/operations/domains/creative-resource/**`；仍通过全局 Operation registry/invocation。
- 失败 Resource 的精确重试输入解析：`src/lib/creative-resource/generation-retry.ts`；它只按 target Resource、Task type/operation 与持久 OperationPlan 的 `request.kind=new` 选择唯一原始失败 Task，不按最近记录或历史消息猜测。
- Creative Direction 专业采用：`src/lib/operations/domains/assistant/creative-direction-ops.ts`；它只更新 adopted Binding，Resource Revision 已由 Task terminal materializer 写入。
- Screenplay 与 Asset Manifest 契约、服务端 manifest identity/来源证据校验：`src/lib/screenplay/**`；资产采用：`creative-asset-ops.ts` 与 `project-asset-writer.ts`。
- 资产图片固定版式：`src/lib/asset-generation/asset-image-format.ts`；它只由 `create_image` planning 使用。
- 剧本 Task 终态物化与“无确认副本”约束：`src/lib/creative-resource/creative-work-materialization.ts`、`task-materializer.ts`、`contracts.ts`。
- 角色音色生成、绑定与删除策略：`src/lib/operations/domains/voice/voice-ops.ts`、`src/lib/voice/voice-resource-service.ts`；全部关系写入仍复用 `binding-service.ts`。
- Resource 开放创作文档的唯一写入入口：`src/lib/creative-resource/creative-data.ts` 与 `edit_resource`；任意键只存在于隔离的 `creativeData`，系统字段不进入 Patch namespace。
- 当前工作集与精确 Revision 查询：`src/lib/creative-resource/view-service.ts`；`get_project_context`、`list_resources`、`get_resource` 只投影该唯一服务的不同 View。
- Canvas Resource 投影和 fallback renderer：`workspace-node-resource-projection.ts`、`nodes/renderers/resource-card.tsx`；专业 renderer 仍由 Canvas registry 选择。
- 数据表：`prisma/schema.prisma` 的 `CreativeResource*`；`20260717120000_add_creative_resource_spine` 创建 Resource 脊柱，`20260720190000_add_creative_resource_data` additive 增加开放创作文档及 CAS version，`20260722230000_canonical_screenplay_asset_manifest` 将 Resource 精确身份收敛为全局唯一 `revisionId`，`20260724190000_decouple_screenplay_asset_manifest` 把 Project 资产关联切换为 manifest-owned identity；`20260724223000_creative_direction_cutover` 显式作废不满足六领域契约的旧视觉 Bible Resource/Revision/Binding/Lineage。本任务只提交 migration 文件，不执行共享数据 migration。

## 验证

- `tests/contracts/project-agent-toolset-conformance.test.ts` 从生产 Operation/Resource registry 证明所有 tool-visible Operation 对 Agent 可见、不再存在 Workflow allowlist，并穷尽校验 Resource schemaId、new/retry、Agent 模型配置入口为零、nullable enum 与无匿名 permissive schema。
- `tests/unit/creative-resource/creative-data.test.ts` 以纯 Patch 函数为 oracle，反证新增字段要求领域分支、无关字段被覆盖及原型路径污染；Tool conformance 同时证明开放值通过 JSON string 边界表达，不能越过到系统字段。
- `tests/contracts/{task-definition,canvas-node}-conformance.test.ts` 穷尽验证 Task materializer 声明和 ResourceCard/专业 renderer 接线。
- `tests/golden-journey/journeys/freeform-resources.spec.ts` 从空项目通过真实 UI、Agent SDK、Operation、Approval、Task、worker、DB、Outbox、SSE 与 Canvas 验证多候选、部分失败精确重试、显式 Lineage、Binding、刷新恢复和直接文字转视频。
- 自由组合 Golden 应证明专业 Resource 可被 Primary 以精确 Revision 任意组合，剧本无需确认卡、Creative Direction 默认无预览，最终成片只显示普通 VideoCard。
- 同一自由组合 Golden 还应证明 Project-scope screenplay/Story Canon Revision 可被第二个 Episode 显式采用，而两个 Episode 分别拥有自己的严格领域投影。
- Provider/Task/Billing Critical suites 继续证明同 attempt 至多一次、quote approval、原子 Task terminal 和失败恢复；Resource 层不得 mock 这些生产 owner。

## 历史回归

- 通用视频第一次失败后，Primary 曾把“Retry the four exact frozen video-segment generations”作为四条新 prompt 再次调用 `create_video`，而旧 retry schema 同时允许模型填写新 prompt/references；系统因此给原 Resource 创建了四条内容相同、无参考图的新 Task，并把错误结果推进为 head。原 Golden 的 retry provider 也重新提交了同一句 prompt，只证明失败 identity 被复用，没有反证创作输入是否被改写。当前 `retry` 分支只能提交失败 Resource identity，服务端从唯一原始 `request.kind=new` 失败 Task 克隆冻结 payload，仅替换本次执行 identity；缺失、歧义、内容不匹配或引用失效均 typed-fail，不再允许模型重写。Freeform Golden 同时核验 retry 后 Revision 仍保存原 prompt。
- 通用异步图片首次真实并行调用时，provider 已成功且媒体 checkpoint 已持久化，但外部轮询把 `externalId` 写入 Task 的显式运行 envelope 后，Creative Resource 终态 parser 因漏登记该字段而 strict-reject，三条 Task 反复恢复并停在估算 99%。既有 Golden 只覆盖同步测试 provider，没有执行“异步 externalId 已持久化后再重放 handler checkpoint 并物化 Revision”的组合，因此未能反证。当前生成契约显式登记 `externalId` 运行字段，解析结果仍只返回冻结业务输入；真实终态仍由 checkpoint + `commitTaskTerminal` 唯一物化，不允许前端补完成或再次调用 provider。异步 provider 的完整真实组合仍由后续 Golden 复验。
- `merge_videos` 上线时另建了一份只登记 `ui/meta/externalId/sync` 的严格 Task envelope；统一 submitter 与 progress writer 持久化 `flow*/stage/message/displayMode` 后，Worker、Resource View 和 Terminal materializer 都 strict-reject。同一异常还使失败与用户取消事务在物化 Resource 终态时回滚，reconciler 因而持续恢复同一 processing Task。上一版只修复生成 Task 的 `externalId` 单字段，未把运行 envelope 收敛成所有 Creative Resource Task 共用的唯一契约，所以新 Task kind 换形式复发。当前生成与合并 parser 共同扩展 `task-runtime-envelope.ts` 的穷尽运行字段，仍严格剥离后只向领域返回冻结业务 payload；禁止每个 Task kind 再维护私有运行字段清单。真实多段合并从提交、进度、终态到 Canvas 刷新的组合仍是未验证盲区。
- 通用媒体 Task 曾只有终态 Resource broadcast；Task 已提交并持有冻结 prompt，但 Canvas 必须等终态或偶然 refetch 才出现节点，导致用户无法确认是否已经提交。当前 Task 提交事务原子写 pending Resource、Task 和 Resource broadcast，Resource View 只从唯一 active Task 投影原始 prompt；终态 Revision writer 未改变。
- Canvas 曾把专业源剧本的桥接 ID 当作节点 identity，匹配失败后创建 raw JSON 重复卡，又仅凭剧本存在投影制作规划与主链连线。当前 screenplay Revision 直接作为文字 Resource 投影；Story Canon/Chapter/规划只在各自真实事实存在时出现，边只来自持久 Lineage。
- 旧系统把产物依赖编码为 Workflow 的 `allowedOperationIds`、推荐 step 和固定 continuation；首次修正只删除 gating，却保留 WorkflowView、固定 Choice 和专业 writer，仍会强迫剧本进入确认/制作规划链。当前连推荐投影也一并删除；工具资格只来自完整 Operation registry 与 Operation 自身显式契约，Canvas 只显示持久 Resource/领域 View。
- 仅删除 Workflow 而不先让 Operation 自足会把“轮到此步骤时上游必然存在”的隐含假设暴露为错误执行。当前所有开放 Operation 仍经 registry schema/prerequisite、owner/scope、provider capability 和 plan/commit fail closed；缺少必要输入不会静默跳过或伪造产物。
- 把专业领域全部改成通用 JSON 会丢失关系查询、类型安全和既有卡片；保留两套独立资产系统又会产生双 writer。当前专业 table 与 Resource 脊柱拥有不同事实：前者保存当前领域结构，后者保存不可变跨领域交付、provenance、Lineage 与 Binding；Task terminal 是二者异步交接的同一事务边界。
- Binding service 曾只验证 Resource 属于同一用户，允许把 project A/episode A 的 Resource 写入 project B Binding；CR-09 文档和同用户正常 Golden 没有覆盖跨项目同用户攻击。当前 Binding 先验证 target project/episode owner，再只允许用户级 Resource 显式采用、同 project 或同 episode Resource；跨项目和跨 episode 原地 NOT_FOUND。跨项目同用户负向组合仍需在真实 Resource Golden 中持续保留。
- 自由剧本曾继续调用旧专业确认 Operation；随后虽改成精确 Resource Revision，仍保存 `confirmed_screenplay` Binding，导致“成功 Revision”和“正式剧本”双轨。当前彻底删除确认入口与 Binding：成功 Revision 就是剧本，Primary 在每个调用中显式引用所需代次。
- Creative Direction 是文字 Resource，早期通用媒体输入却只有一组 `references`，业务层把 Creative Direction revision 当作图片引用送进图片 provider，三张资产在外部请求前一起失败。当前契约把语义上下文与真实图片引用拆开，lineage 同时保留两者，provider 只接收图片；旧 payload 不兼容，部署前必须排空旧版本 queued/processing Creative Resource 媒体 Task，禁止双读 fallback。
- OpenRouter GPT Image 2 曾在上游账户硬限额时直接失败，即使系统还声明了等价的 FAL GPT Image 2 能力；若业务层或 Agent 自行改 provider，会产生第二执行入口、第二报价和重复 Resource。当前只允许 Provider Gateway 在同一声明式等价 route set 内、确认首路由未受理且没有 external id 时切换，并把最终路由写入同一 invocation checkpoint；Resource materializer 据此记录真实 modelKey。同一路由已受理、结果不确定或异步 external id 已存在时绝不切换。
- 固定流程切换后，screenplay/Story Canon Resource 虽属于同一 Project，Episode 投影表却把 `sourceRevisionId`/`storyCanonRevisionId` 设为全局唯一，第二个 Episode 显式采用同一 canon 会被数据库约束拒绝；同时 Creative Task 仍把这三类全局 canon 物化为 Episode Resource，使 `list_resources` 在其他 Episode 看不到它们。当前输出 registry 是 scope 唯一裁判，这三类产物物化为 Project Resource；投影唯一性改为 Episode scope，跨 Project 仍由 owner/scope 校验失败关闭。
- 2026-07-23 的 canonical screenplay 重构把生产资产候选登记进剧本契约，并要求后续 manifest 对登记实体 exact-once 覆盖；一次只出现但真实承载坠落结尾的“崖底”被剧本 Worker 归为“山顶延伸空间”后，资产 Worker 与 fail-closed materializer 都无法合法补回。2026-07-24 首次纠正只增强 canonicalization 的地点提示，仍让错误 owner 决定生产资产范围，因而无法消除同根因复发。当前删除该分析输出和 Skill：`screenplay` 只拥有文本/写作元信息，`asset_manifest` 在一个 Task 内独占资产筛选、设计和 Prompt；服务端仅校验逐字来源证据、歧义和稳定 manifest identity。旧 canonical Revision 保留为不可变历史但不能进入新输出契约；`creative_work_v6` 部署前必须排空 v5 queued/processing Task/Wait，不保留双 parser。真实模型对一次性关键空间的筛选质量仍需真实生成复验，确定性契约只保证它不能用无来源或冲突条目静默通过。
- 旧视觉 Bible 最初只拥有视觉字段，资产清单又通过显式 source material 与当前 Binding 二次核对，视频、音乐、剧本和章节路径则依赖 Primary 是否记得传递，形成多个注入者和不一致门槛。仅让所有 Subagent 主动读取 Project Context 仍会扩大权限、复制版本判断并让运行中 Task 受换绑影响；按工种裁剪六领域又会让服务端替模型静态判断影视工种之间的关联。当前唯一 writer 仍是 `adopt_creative_direction`，唯一 Task 输入编译者仍是 `delegate_creative_work` 服务端：它一次读取 adopted Binding，向全部非方向生产者冻结完整精确 Direction 与 revisionId，Worker 在自身专业边界内判断相关内容；Primary 手动传方向、Chapter conditional style、Asset 当前 Binding 核对、领域裁剪和“方向必需”门槛全部删除。Conformance 从生产 registry 穷尽反证漏接；`creative_work_v7` 部署前必须排空 v6 queued/processing Task/Wait，不保留双 parser。

## 修改检查表

1. 新产物的 Resource identity、schemaId、scope、唯一 writer 和专业 origin 是否明确？
2. 是否追加 Revision 而非改写历史，并保存真实 prompt/model/输入 Revision？
3. 专业领域表与 Resource 是否各自只拥有一种事实，没有第二 writer？
4. 候选失败重试是否只提交失败 resourceId，成功候选与 provider invocation 不重复？
5. Canvas 是否优先专业 renderer，fallback 是否只依赖 mediaType，edge 是否只来自 Lineage？
6. 是否错误地用 Workflow、Canvas 位置、旧 head 或 stale 诊断阻止 Agent 调用？
7. 剧本是否只保存文本/写作元信息且直接使用成功 Revision、没有确认或生产资产 registry；正式风格是否只来自 adopted Creative Direction Binding 且采用不产生预览或下游副作用？
8. `contextReferences`、`create_image.imageReferences` 与 `create_video.mediaReferences` 是否在 Task、按类型冻结的位置、provider 输入、lineage 和 provenance 中保持各自语义？
9. 成功 Revision 是否记录 durable invocation 的实际 provider route，而不是初始或当前配置？
10. `character_voice` 是否只经保留入口写入，自动绑定是否用冻结 version 拒绝旧覆盖，删除是否拒绝 Binding/Lineage/active Task？
