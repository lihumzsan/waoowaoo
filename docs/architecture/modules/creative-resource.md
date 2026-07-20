<!-- architecture-module: creative-resource -->

# 创作 Resource、Revision 与 Lineage

## 设计理念

创作系统需要一个可被 Agent、Canvas 和后续生成共同引用的统一产物身份，但不需要把所有专业领域压成一张通用 JSON 表。`CreativeResource` 是跨领域的创作产物脊柱：它给文字、图片、音频、视频以及剧本、Bible、剪辑表、角色图、场景图、BGM、章节视频等专业产物提供稳定身份、不可变 Revision、真实生成来源和显式血缘。已有专业领域表继续保存可查询、可编辑的结构化业务事实；ResourceRevision 保存一次生成所交付的不可变内容或当时的领域快照。

`text / image / audio / video` 只回答“没有专业 renderer 时如何展示和处理媒体”，不是四套业务实体，也不限制专业语义。剧本与剪辑表仍由 `schemaId`、领域 origin 和专业 renderer 区分；最终成片只是 `video` Resource，不拥有专用最终成片卡片。

## 不变量

- **CR-01 — 一个稳定 Resource，多次不可变 Revision。** `CreativeResource.id` 是产物 identity；成功生成、修改或重生成只能追加 `CreativeResourceRevision` 并原子推进 `headRevisionId`，不得原地改写历史 Revision。通用候选以 `operationId + requestId + candidateIndex` 形成唯一 origin；专业产物以 `sourceType + sourceId` 形成唯一 origin，同一专业实体不得创建第二个 Resource。
- **CR-02 — 专业领域事实不被通用表替代。** 剧本、Bible、剪辑表、角色、场景、BGM 设计、视频 Segment 与渲染结果继续由各自领域 service/table 保存当前可查询业务状态。ResourceRevision 只拥有跨领域引用所需的不可变交付内容、领域快照、fingerprint、provenance 和 lineage。领域 writer 与 Resource materializer 必须位于同一个权威 Operation 或 Task terminal transaction；不得由客户端、Canvas 或后台扫描补写。
- **CR-03 — 四种媒体只是 fallback。** 每个 Resource 必须声明一个 `mediaType=text|image|audio|video` 和一个穷尽注册的 `schemaId`。`schemaId` 决定专业语义与首选 presentation；仅在没有专业 renderer 时才使用 mediaType renderer。新增剧本变体、图片角色或其他专业内容主要增加 schema/renderer 声明，不得复制 Resource、Revision、Lineage 或 Binding 模型。
- **CR-03A — Style Bible 是结构化文字 Resource。** finalized Worker 风格结果只经 `adopt_style_bible` 写成 `mediaType=text + schemaId=project.style_bible` 的不可变 revision；Task id 是专业 origin，Worker 输入 Resource revision 是 lineage。候选结果不得写入该 schema。Canvas 使用 schema-aware Style Bible renderer 展示摘要、视觉表达、光线、材质与构图，不把结构化内容退化成 raw JSON；这仍是通用 ResourceCard 的专业变体，不建立第二实体。
- **CR-04 — Lineage 只记录实际输入 Revision。** 每条 `CreativeResourceLineage` 必须从精确的 `inputRevisionId + fingerprint + role + position` 指向输出 Revision。不得从当前 head、最近资源、数组位置、Prompt、历史消息或 Canvas edge 反推输入。输入后来产生新 Revision 不改写旧 Lineage；陈旧诊断可以提示，但不得自动禁止 Agent 使用旧 Revision。
- **CR-05 — 生成与采用分离。** 生成候选只创建 Resource/Revision；把某个候选用于项目角色、插槽或 canonical 选择，只能通过 `CreativeResourceBinding` 的 `scope + role + slotKey` CAS 更新。选择不得删除、覆盖或重新生成其他候选。Binding 保存精确 `resourceId + revisionId`，刷新后仍指向同一 Revision。
- **CR-06 — provenance 冻结真实调用。** 每个成功 Revision 必须保存适用的 `operationId`、稳定输入 hash、Task/OperationExecution/executionSegment/toolCall identity、实际 prompt、modelKey 与生成参数。缺失适用来源时必须显式失败；不得用模型事后总结、UI 文案或当前配置补造历史来源。
- **CR-07 — 一个异步终态 writer。** 异步创作输出只由 `commitTaskTerminal` 的同一事务调用 production Task materializer；该事务在领域 success projector 之后写 Revision/Lineage，并把真实 Resource refs 合并进 Task result、Task terminal Event 和 Agent continuation。重放同一 Task 只能返回同一 Revision；失败/取消只结算本次预留候选，不覆盖专业 Resource 的上一个成功 head。
- **CR-08 — 通用生成与专业 Operation 共存但不重复动作。** `create_text/create_image/create_audio/create_video` 是从空项目或显式 Resource references 创建通用产物的 Operation；`merge_videos` 是把两个以上精确 video Revision 按显式顺序合成为一个普通 video Resource 的唯一通用入口，不调用生成模型，也不冒充专业章节渲染。既有剧本、Bible、剪辑、资产、BGM、渲染 Operation 全部保留其专业输入、领域写入和卡片。两类 Operation 复用同一个 Operation invocation、计费 plan/commit、Task、Provider Gateway 和 Resource materializer，不得为 Agent 另建后台命令协议。
- **CR-09 — 引用必须先证明 owner 与 scope。** 任一输入 Resource/Revision、Binding 或 API Query 必须验证 user、project、episode scope；跨项目引用、revision 不属于 resource、fingerprint 不一致均原地失败。用户级通用资产可被显式采用到项目，但不得通过 bridge row、名称或最近记录推断归属。
- **CR-10 — Canvas 只投影持久 Resource View。** Resource API/View service 是 ResourceCard 的唯一查询投影；Canvas 优先把 origin 与既有专业节点 identity 对齐并复用专业 renderer，再使用通用 ResourceCard。节点只来自持久 Resource、当前 Task 或 structured stream 的真实事实，边只来自 Lineage。最终渲染完成后显示普通 VideoCard；任何阶段都不得投影专用 final timeline，进行中或失败的渲染仍由通用 Task/Assistant 生命周期表达。
- **CR-11 — 候选是同一调用的独立资源。** 一次 count=N 的调用必须产生 N 个稳定 candidate Resource，并共享 candidateSetId；成功候选不会因兄弟失败而重提。Agent 重试必须显式引用失败 resourceId，只提交失败候选；retry Tool 分支不得接收 prompt、references、时长、画幅、声音或 provider 参数，服务端只能从该 Resource 第一次 `request.kind=new` 的失败 Task 恢复完整冻结 payload，并以新的执行 identity 重提同一内容。同一 provider invocation 的至多一次保证继续由 Task checkpoint 负责，不建立第二套 logicalInvocationId 或 outcome 协议。
- **CR-12 — Resource 不裁决创作顺序。** Resource 存在、缺失、旧 Revision 或 Lineage 仅是可读事实。Operation 是否可调用由 registry channel、显式输入 schema、owner/scope、provider capability、计费批准和破坏性确认裁决；Workflow step、Canvas 位置和“上游是否推荐完成”不得成为硬门。
- **CR-13 — Resource Tool 参数只表达产品语义。** `schemaId` 必须从按 mediaType 穷尽分组的生产 Resource registry 生成 enum；通用语义用对应 `generic.*`，不得允许模型发明新 identity。文本结果以 `single|candidates` 分支表达；异步媒体的全部新创作参数只存在于 `request.kind=new`，`request.kind=retry` 只接受失败 Resource identity。Agent-facing 图片/视频/音乐字段使用跨 provider 产品名，且不得包含 `modelKey`、`*Model` 或 provider 参数；实际模型由服务端正式配置唯一解析。`generationOptions` 只是在批准计划与 Revision provenance 中冻结的内部执行快照，不是公开 Tool 参数。服务端解析出的 modelKey 对应 capability registry 是允许字段和值的唯一裁判，不支持必须 typed-fail，禁止跨模型默认或 provider 参数透传。
- **CR-14 — pending 卡片显示冻结提交事实。** 异步 Resource Operation 必须在提交 Task 的同一事务预留 pending Resource，并写入可 replay 的 Resource broadcast；Resource View 从该 Resource 当前唯一 active Task 的冻结 payload 投影 prompt、model、options 与精确 inputs。它只负责让卡片和原始提示词立即可见，不得把 pending 当成成功 Revision，也不得由客户端从工具文案补造。ready/failed/canceled 仍只由 Task Terminal writer 结算。
- **CR-15 — 剧本与风格采用使用保留 Binding。** 当前确认剧本只由 `confirm_script_resource` 写入 `scope=episode + role=confirmed_screenplay + slotKey=primary`；当前正式风格只由 `adopt_style_bible` 写入 `scope=episode + role=adopted_style_bible + slotKey=primary`。两者都绑定精确不可变 Revision，不能从最近文字 Resource、历史消息、Canvas 位置或旧专业表猜测。通用 `adopt_resource` 必须拒绝这两个保留角色，避免第二 writer。确认与采用不复制 Resource，也不新建同内容剧本。
- **CR-16 — 语义上下文与媒体引用分离。** `contextReferences` 只表达会进入 lineage 和专业推理上下文的精确 Resource Revision，可以是文字、图片、音频或视频；`imageReferences` 只表达允许送入图片/视频 provider 的真实图片 Revision。Task payload、报价和 Revision provenance 同时冻结两组引用；provider adapter 只能收到规范化后的 `imageReferences`。不得把 Style Bible、剧本或其他文字 Resource 当作图片 URL 发送，也不得为了兼容旧 `references` 猜测媒体语义。
- **CR-17 — 读取工具各自只有一种职责。** `get_project_context` 返回当前项目/剧集的紧凑工作集，包含保留 Binding 指向的确认剧本、正式 Style Bible 及必要 fingerprint/version；`list_resources` 用一次有界查询浏览当前剧集、当前项目和用户级通用资产中的候选、历史与可复用资源，按持久 `createdAt,id` 稳定排序并在全局 limit 内返回，同一 Resource identity 只出现一次，并且只暴露 `creativeData` 的版本与顶层键，不能把开放文档批量塞入模型上下文；`get_resource` 按 `resourceId + revisionId` 返回一个精确不可变 Revision 的完整内容，并返回该 Resource 当前完整 `creativeData + creativeDataVersion` 供显式编辑。三者共同消费 Resource/Binding View service，不得各自推断“当前剧本”或“当前风格”。
- **CR-18 — Revision 记录实际执行路由。** Agent 和业务 Operation 不选择 provider/model，但每个成功媒体 Revision 的 provenance 必须保存本次 Task invocation 最终实际使用的 `modelKey`。当 Provider Gateway 在同一等价 route set 内进行受控 pre-accept 路由切换时，materializer 只能读取 durable invocation route checkpoint，不能继续记录初始配置、当前配置或模型事后文字。
- **CR-19 — Resource 提供开放但隔离的创作文档。** 每个 Resource 可以持有一份 schema-open、版本化的 `creativeData` JSON 文档，供用户和 Agent 保存任意当前创作资料；新增创作概念不要求新增数据库字段或 Operation 分支。它只由 `edit_resource` 以 `creativeDataVersion` CAS 和最小 object-path Patch 写入，嵌入的 `$resourceRef` 必须验证精确 Revision owner 与 fingerprint。`creativeData` 不是 Revision、provenance、Lineage、Binding、Task 或生命周期事实，任何消费者不得据此宣称媒体已生成、采用或完成，也不得用它覆盖实际生成来源。Tool 必须明确要求先读、少改、保留无关字段，并禁止为总结、润色或推测而写入。

## 状态所有权

| 事实 | 唯一 owner / writer | 消费者 |
| --- | --- | --- |
| 当前专业结构化业务状态 | 对应领域 table / 既有领域 service 或 Task success projector | 专业 Query、Operation、专业 renderer |
| 跨领域产物 identity 与当前 head | `CreativeResource` / Resource persistence service | Agent tools、Resource View、Canvas |
| 一次不可变交付及 fingerprint | `CreativeResourceRevision` / 同步 Resource Operation 或 Task Terminal materializer | Lineage、Binding、审计、后续生成 |
| 精确生成输入关系 | `CreativeResourceLineage` / Revision append transaction | Agent、Canvas edge、来源诊断 |
| 项目采用与 canonical 选择 | `CreativeResourceBinding` / Binding service CAS | Agent、Canvas、后续显式读取 |
| 异步候选 pending | Operation 的 Task 提交事务（预留 Resource + Task + broadcast） | Resource View、Canvas |
| 异步候选 ready/failed/canceled | `commitTaskTerminal` | Agent continuation、Resource View |
| finalized Style Bible revision | `adopt_style_bible` transactional Operation | Asset/video Worker input、Chapter Context、Canvas |
| 当前确认剧本 Binding | `confirm_script_resource` transactional Operation | Project Context、Primary、Creative Worker inputs |
| 当前正式风格 Binding | `adopt_style_bible` transactional Operation | Project Context、资产/视频 Worker、Chapter Context |
| Resource 当前开放创作文档 | `CreativeResource.creativeData` / `edit_resource` CAS transaction | Agent、Resource View、通用或专业 renderer |
| ResourceCard 最终 View | `view-service.ts` 从上述持久事实纯投影 | API、React Query、Canvas renderer |

## 权威入口

- 共享类型与 schema registry：`src/lib/creative-resource/contracts.ts`、`schema-registry.ts`。
- origin、scope、fingerprint 与输入 hash：`src/lib/creative-resource/identity.ts`。
- Resource/Revision/Lineage 唯一持久化入口：`src/lib/creative-resource/persistence.ts`。
- Binding 唯一写入入口：`src/lib/creative-resource/binding-service.ts`。
- 异步 Task 终态物化：`src/lib/creative-resource/task-materializer.ts`，只由 `src/lib/task/terminal/service.ts` 调用。
- ResourceCard 查询投影：`src/lib/creative-resource/view-service.ts` 与 `src/app/api/projects/[projectId]/resources/route.ts`。
- Agent 通用生成与读/采用工具：`src/lib/operations/domains/creative-resource/**`；仍通过全局 Operation registry/invocation。
- 失败 Resource 的精确重试输入解析：`src/lib/creative-resource/generation-retry.ts`；它只按 target Resource、Task type/operation 与持久 OperationPlan 的 `request.kind=new` 选择唯一原始失败 Task，不按最近记录或历史消息猜测。
- Style Bible 专业采用：`src/lib/operations/domains/assistant/creative-style-ops.ts`；它是 `project.style_bible` 的唯一 writer，并复用 Resource persistence，不建立领域旁路。
- Resource-native 剧本确认与保留角色约束：`src/lib/operations/domains/creative-resource/resource-ops.ts`、`src/lib/creative-resource/contracts.ts`；通用采用入口不能写保留角色。
- Resource 开放创作文档的唯一写入入口：`src/lib/creative-resource/creative-data.ts` 与 `edit_resource`；任意键只存在于隔离的 `creativeData`，系统字段不进入 Patch namespace。
- 当前工作集与精确 Revision 查询：`src/lib/creative-resource/view-service.ts`；`get_project_context`、`list_resources`、`get_resource` 只投影该唯一服务的不同 View。
- Canvas Resource 投影和 fallback renderer：`workspace-node-resource-projection.ts`、`nodes/renderers/resource-card.tsx`；专业 renderer 仍由 Canvas registry 选择。
- 数据表：`prisma/schema.prisma` 的 `CreativeResource*`；`20260717120000_add_creative_resource_spine` 创建 Resource 脊柱，`20260720190000_add_creative_resource_data` additive 增加开放创作文档及 CAS version；本任务不执行共享数据 migration。

## 验证

- `tests/contracts/project-agent-toolset-conformance.test.ts` 从生产 Operation/Resource registry 证明所有 tool-visible Operation 对 Agent 可见、不再存在 Workflow allowlist，并穷尽校验 Resource schemaId、new/retry、Agent 模型配置入口为零、nullable enum 与无匿名 permissive schema。
- `tests/unit/creative-resource/creative-data.test.ts` 以纯 Patch 函数为 oracle，反证新增字段要求领域分支、无关字段被覆盖及原型路径污染；Tool conformance 同时证明开放值通过 JSON string 边界表达，不能越过到系统字段。
- `tests/contracts/{task-definition,canvas-node}-conformance.test.ts` 穷尽验证 Task materializer 声明和 ResourceCard/专业 renderer 接线。
- `tests/golden-journey/journeys/freeform-resources.spec.ts` 从空项目通过真实 UI、Agent SDK、Operation、Approval、Task、worker、DB、Outbox、SSE 与 Canvas 验证多候选、部分失败精确重试、显式 Lineage、Binding、刷新恢复和直接文字转视频。
- `tests/golden-journey/journeys/mainline-complete.spec.ts` 证明现有专业主链仍完整，专业卡片未被通用 fallback 替代，最终成片只显示普通 VideoCard。
- Provider/Task/Billing Critical suites 继续证明同 attempt 至多一次、quote approval、原子 Task terminal 和失败恢复；Resource 层不得 mock 这些生产 owner。

## 历史回归

- 通用视频第一次失败后，Primary 曾把“Retry the four exact frozen video-segment generations”作为四条新 prompt 再次调用 `create_video`，而旧 retry schema 同时允许模型填写新 prompt/references；系统因此给原 Resource 创建了四条内容相同、无参考图的新 Task，并把错误结果推进为 head。原 Golden 的 retry provider 也重新提交了同一句 prompt，只证明失败 identity 被复用，没有反证创作输入是否被改写。当前 `retry` 分支只能提交失败 Resource identity，服务端从唯一原始 `request.kind=new` 失败 Task 克隆冻结 payload，仅替换本次执行 identity；缺失、歧义、内容不匹配或引用失效均 typed-fail，不再允许模型重写。Freeform Golden 同时核验 retry 后 Revision 仍保存原 prompt。
- 通用异步图片首次真实并行调用时，provider 已成功且媒体 checkpoint 已持久化，但外部轮询把 `externalId` 写入 Task 的显式运行 envelope 后，Creative Resource 终态 parser 因漏登记该字段而 strict-reject，三条 Task 反复恢复并停在估算 99%。既有 Golden 只覆盖同步测试 provider，没有执行“异步 externalId 已持久化后再重放 handler checkpoint 并物化 Revision”的组合，因此未能反证。当前生成契约显式登记 `externalId` 运行字段，解析结果仍只返回冻结业务输入；真实终态仍由 checkpoint + `commitTaskTerminal` 唯一物化，不允许前端补完成或再次调用 provider。异步 provider 的完整真实组合仍由后续 Golden 复验。
- 通用媒体 Task 曾只有终态 Resource broadcast；Task 已提交并持有冻结 prompt，但 Canvas 必须等终态或偶然 refetch 才出现节点，导致用户无法确认是否已经提交。当前 Task 提交事务原子写 pending Resource、Task 和 Resource broadcast，Resource View 只从唯一 active Task 投影原始 prompt；终态 Revision writer 未改变。
- Canvas 曾把专业源剧本 Resource 的 `sourceDocumentId` 当作专业源剧本节点 identity，匹配失败后创建一张展示 raw JSON 的通用文本卡；同时仅凭 `prompt_generated_script` 就投影不存在的制作规划并用硬编码主链顺序连线。当前专业源剧本只通过领域快照中的 `editBibleId` 复用专业节点；自由 `create_text` 没有专业 origin，始终保留普通文本卡；制作规划只来自真实规划事实，边只来自持久 Lineage。
- 旧系统把产物依赖编码为 Workflow 的 `allowedOperationIds`、step visibility 和固定 continuation：新能力必须同时接入 runtime、Choice、Canvas 和 Golden 的多份阶段表，漏接一次就会隐藏真实产物或强迫 Agent 停在计划点。当前 WorkflowView 只保留推荐主链投影；工具资格来自完整 Operation registry 与 Operation 自身显式契约，Canvas 从持久 Resource/领域 View 显示真实产物。
- 仅删除 Workflow 而不先让 Operation 自足会把“轮到此步骤时上游必然存在”的隐含假设暴露为错误执行。当前所有开放 Operation 仍经 registry schema/prerequisite、owner/scope、provider capability 和 plan/commit fail closed；缺少必要输入不会静默跳过或伪造产物。
- 把专业领域全部改成通用 JSON 会丢失关系查询、类型安全和既有卡片；保留两套独立资产系统又会产生双 writer。当前专业 table 与 Resource 脊柱拥有不同事实：前者保存当前领域结构，后者保存不可变跨领域交付、provenance、Lineage 与 Binding；Task terminal 是二者异步交接的同一事务边界。
- Binding service 曾只验证 Resource 属于同一用户，允许把 project A/episode A 的 Resource 写入 project B Binding；CR-09 文档和同用户正常 Golden 没有覆盖跨项目同用户攻击。当前 Binding 先验证 target project/episode owner，再只允许用户级 Resource 显式采用、同 project 或同 episode Resource；跨项目和跨 episode 原地 NOT_FOUND。跨项目同用户负向组合仍需在真实 Resource Golden 中持续保留。
- 自由剧本确认曾继续调用只认识 `ProjectEditBible` 的旧专业确认 Operation；模型明明持有刚生成的剧本文本，仍因没有旧领域实体而失败，随后又从历史消息或 Task 猜稿并创建第二份不同剧本。当前确认对象改为精确 Resource Revision，并由保留 Binding 独占“当前确认剧本”；项目上下文直接投影该事实，确认操作不复制正文。旧专业确认入口继续只服务其专业实体，不再被自由 Resource 路径冒充。
- Style Bible 是文字 Resource，早期通用媒体输入却只有一组 `references`，业务层把 Style Bible revision 当作图片引用送进图片 provider，三张资产在外部请求前一起失败。当前契约把语义上下文与真实图片引用拆开，lineage 同时保留两者，provider 只接收图片；旧 payload 不兼容，部署前必须排空旧版本 queued/processing Creative Resource 媒体 Task，禁止双读 fallback。
- OpenRouter GPT Image 2 曾在上游账户硬限额时直接失败，即使系统还声明了等价的 FAL GPT Image 2 能力；若业务层或 Agent 自行改 provider，会产生第二执行入口、第二报价和重复 Resource。当前只允许 Provider Gateway 在同一声明式等价 route set 内、确认首路由未受理且没有 external id 时切换，并把最终路由写入同一 invocation checkpoint；Resource materializer 据此记录真实 modelKey。同一路由已受理、结果不确定或异步 external id 已存在时绝不切换。

## 修改检查表

1. 新产物的 Resource identity、schemaId、scope、唯一 writer 和专业 origin 是否明确？
2. 是否追加 Revision 而非改写历史，并保存真实 prompt/model/输入 Revision？
3. 专业领域表与 Resource 是否各自只拥有一种事实，没有第二 writer？
4. 候选失败重试是否只提交失败 resourceId，成功候选与 provider invocation 不重复？
5. Canvas 是否优先专业 renderer，fallback 是否只依赖 mediaType，edge 是否只来自 Lineage？
6. 是否错误地用 Workflow、Canvas 位置、旧 head 或 stale 诊断阻止 Agent 调用？
7. 当前剧本/风格是否只来自保留 Binding，确认/采用是否没有复制 Resource 或第二 writer？
8. `contextReferences` 与 `imageReferences` 是否在 Task、provider 输入、lineage 和 provenance 中保持各自语义？
9. 成功 Revision 是否记录 durable invocation 的实际 provider route，而不是初始或当前配置？
