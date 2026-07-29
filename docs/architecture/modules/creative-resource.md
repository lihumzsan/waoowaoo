<!-- architecture-module: creative-resource -->

# 创作 Resource 与 Lineage

## 目标与边界

`CreativeResource` 是文字、图片、音频、视频以及剧本、Story Canon、Creative Direction、资产清单、视频 Prompt Set 等创作产物的统一不可变身份。一个 Resource 表示一次具体交付；它同时保存内容、媒体、执行来源和物化状态。专业领域表仍只保存需要结构化查询的当前业务投影，不成为第二份产物内容。

本模块不决定创作顺序、模型选择、计费批准或专业创作判断。Operation registry、Provider capability、Billing/Approval 和 Creative Skill 各自继续拥有这些事实。

## 不变量

- **CR-01 — 一个短 Resource ID 只表示一个不可变产物。** `CreativeResource.id` 是唯一跨层身份，格式为 `r_` 加 128-bit SHA-256 base64url 摘要，总长 24 字符。通用生成由 `operationId + requestId + candidateIndex` 确定，领域导入由 `sourceType + sourceId` 确定；两者都经带长度分帧的共享 identity builder 生成。名称只用于显示，不能参与解析。禁止恢复 Revision、head、originKey、内容 hash identity 或调用方自造长 UUID。
- **CR-02 — Resource 预留与物化分离，但身份不变。** 异步提交事务先创建 pending Resource 和 Task；唯一 terminal materializer 在成功时把内容、媒体、provenance 与 `materializedAt` 一次写入同一 Resource。已物化 Resource 不得再次写内容。失败或取消只可结算未物化 Resource 的状态。
- **CR-03 — retry 与 regenerate 是两种动作。** retry 只接受 failed Resource ID，重放该 Resource 首次提交时冻结的 prompt、模型路由、参数和输入，并只允许同一 Resource 从未物化状态完成；它不接收任何可改写生成事实的字段。重新生成、修改、角色状态变化或用户需要另一方案时必须创建一个新 Resource，并用 Lineage 表达来源。角色的晴天、雨夜、战损等状态是多个 Resource，不是同一 identity 的版本。
- **CR-04 — Lineage 只连接精确 Resource。** `CreativeResourceLineage` 的唯一事实是 `inputResourceId + role + position → outputResourceId`。服务端按 Resource ID 回库验证 owner、scope、schema、status 和真实内容。禁止从名称、当前 Binding、最近记录、数组位置、历史消息、Prompt、Canvas edge 或模型输出重新猜关联。
- **CR-05 — Binding 只保存一个 Resource ID。** 当前采用关系的唯一 key 是 `scope + role + slotKey`，值只有 `resourceId`，由 Binding service 以 version CAS 写入。Binding 不复制内容，不保存第二 identity，不改变或删除被换下的 Resource。Creative Direction、Asset Manifest、角色音色和资产图片继续由各自保留入口写其命名空间。
- **CR-06 — 引用协议只传 Resource ID。** Creative Work request、媒体 Operation、消息附件、Assistant Link View、Choice subject、Canvas 与领域投影都只传 `resourceId`。可选 `role` 只表达该输入在新输出中的语义，不参与定位。调用方不得同时传名称、短 key、origin、hash 或内容副本充当第二关联协议。
- **CR-07 — Video Prompt Set 直接拥有精确媒体引用。** `video_prompt_set.segments[].mediaResourceIds` 保存 Worker 已读取的图片/音频 Resource ID。Primary Agent 只把 Prompt Set 自身的 `resourceId` 提交给 `create_video.request.kind=prompt_set`；服务端读取 strict Prompt Set，验证每个媒体 Resource 必须存在于该 Prompt Set 的持久 Lineage、属于同一 owner/scope、已物化且类型合法，再按顺序冻结成视频 Task。Primary 不复制 prompt、时长或媒体 ID，也不执行名称到 ID 的映射。
- **CR-08 — Prompt Set 执行仍走唯一媒体入口。** `request.kind=prompt_set` 只是在 `create_video` planner 内展开多个 segment；每段仍经当前项目模型配置、同一 capability、PlanSnapshot、Billing/Approval、Task submitter 和 Resource materializer。它不是第二个视频执行器。文本生视频、重复媒体 ID、只有声音没有图片、超出图片/声音数量或非法时长必须在计划阶段失败。
- **CR-09 — 媒体语义输入与 provider 通道分离。** `contextReferences` 只进入 Lineage 和创作上下文；图片、音频和视频 provider 引用分别冻结为 `imageInputPositions`、`audioInputPositions`、`videoInputPositions`。三组位置必须存在、互斥、有序并符合模型 capability。Creative Direction、剧本和其他文字 Resource 不得伪装为 provider 媒体。
- **CR-10 — scope 与 owner 必须由服务端证明。** 用户级 Resource 可被显式采用；Project/Episode Resource 只能在允许的同 Project/Episode 范围使用。跨用户、跨 Project、非法跨 Episode、错误 schema、非 ready 或未物化引用原地失败。名称、bridge row 和“最近使用”都不能绕过该检查。
- **CR-11 — provenance 属于 Resource。** 每个成功 Resource 保存适用的 `operationId`、`inputHash`、Task/OperationExecution/executionSegment/toolCall identity、真实 prompt、最终 provider route `modelKey` 与执行参数。`inputHash` 只用于幂等与审计，不是 Resource identity。
- **CR-12 — 一个异步终态 writer。** `commitTaskTerminal` 的同一事务先执行适用领域 success projector，再调用 production Resource materializer，最后把精确 Resource refs 合并到 Task result、terminal event 和 Agent continuation。同一 Task 重放只能返回同一 Resource。timer、refetch、SSE 到达顺序和 UI 文案不承担正确性。
- **CR-13 — candidate 是独立 Resource。** 一次 `count=N` 预留 N 个短 Resource ID，可共享一个 `rs_…` candidateSetId。兄弟候选成功或失败互不覆盖；retry 显式列出失败 Resource ID。candidateSetId 只表达同批浏览关系，不是内容 identity。
- **CR-14 — `mediaType` 是 fallback，`schemaId` 是专业语义。** 每个 Resource 必须声明 `text|image|audio|video` 和生产 registry 中的 schemaId。专业 renderer 优先，缺失时才使用媒体 renderer。新增专业结果优先增加 registry 声明，不得复制 Resource、Lineage、Binding 或生命周期。
- **CR-15 — 专业投影不复制产物身份。** `ProjectEpisodeSourceDocument.sourceResourceId` 和 `ProjectStoryCanon.storyCanonResourceId` 只保存精确 Resource ID；结构化字段是其领域查询投影。screenplay、Story Canon、Creative Direction 和 Asset Manifest 的 Resource scope 由 Creative Work output registry 裁决。成功 screenplay Resource 可直接使用，不存在 confirmed screenplay 或“正式版本”副本。
- **CR-16 — 外部素材也只创建 Resource。** 网页导入和用户上传经各自唯一入口完成安全抓取/嗅探、MediaObject 登记和同步或异步物化；同一外部来源通过领域 identity 收敛。出处、sha256、MIME、大小和原文件名属于 provenance/执行参数。下游仍只使用 Resource ID，生成入口不能铸造 import schema。
- **CR-17 — 当前角色音色由 Binding 裁决。** 每次 `generate_voice` 都创建新的音频 Resource；`bind_voice` 或生成终态 CAS 只更新 `character_voice` Binding。新生成不是原位写入。删除必须拒绝 active Task、任何 Binding 和下游 Lineage，并且不能删除共享 MediaObject。
- **CR-18 — 开放创作文档与不可变内容隔离。** `creativeData` 是 Resource 上单独的 schema-open CAS 文档，仅由 `edit_resource` 按 `creativeDataVersion` 做最小路径 Patch。内嵌 `$resourceRef` 只含 Resource ID并经过 owner/scope 校验。它不能改写 Resource 内容、provenance、Lineage、Binding、Task 或生命周期。
- **CR-19 — UI 只消费最终 View。** Resource View 是卡片的唯一读模型；pending 摘要只从预留 Resource 和唯一 active Task 的冻结 payload 派生，ready 摘要从同一 Resource 的物化内容派生。Assistant Link View 只接受精确 Resource ID，文件名来自 Resource name，href 来自受保护媒体投影。Canvas edge 只来自持久 Lineage。
- **CR-20 — Resource 不裁决流程。** Resource 存在、缺失、旧生成结果或 Lineage 都只是事实。Operation 可调用性只由 registry channel、显式 input schema、scope、provider capability、审批和破坏性确认裁决；Workflow step、Canvas 位置或推荐顺序不能成为隐藏门槛。
- **CR-21 — 清单资产图按引用执行。** `create_image.request.kind=manifest_assets` 只接受当前 adopted `project.asset_manifest` 的精确 Resource ID 与可选 `manifestAssetIds` 子集；服务端校验 adopted Binding、按 `manifestAssetId` 解析项目资产身份与 `project_asset_image` Binding 当前 version、原样读取每项 `generationPrompt`（叠加固定资产版式），一次调用为每个资产创建一个图片 Task，manifest Resource 写入每个 Task 的 Lineage。Primary 不复制 prompt、不重供绑定、不手动附加引用；`request.kind=asset` 只服务清单之外的单个资产图。该窄分支仍在 `create_image` planner 内展开，复用同一 Billing/Approval、Task submitter 与 terminal materializer，不是第二图片执行器；非 adopted 清单、未知/重复 manifestAssetId、缺失资产身份或空清单必须在计划阶段失败。
- **CR-22 — 配乐按引用执行。** `music_direction` 输出的 `score` 是唯一最终配乐执行指令（null 表示刻意不配乐且不存在下游音乐生成）。`create_audio.request.kind=music_direction` 只接受该方向 Resource ID 与精确目标视频 Resource；服务端原样读取 `score.generationPrompt`、从视频 MediaObject 真实时长导出 duration 并按 music capability 校验，`maxReferenceVideos` 声明允许时把视频冻结为 `videoInputPositions`，否则只作为 Lineage 上下文。方向与视频 Resource 都进入 BGM Task 的 Lineage。null score、时长缺失或超出能力范围必须在计划阶段失败；Primary 不改写、不压缩、不补充配乐指令。

## 状态与写入者

| 事实 | 唯一 owner / writer | 主要消费者 |
| --- | --- | --- |
| Resource identity、scope、schema、pending 状态 | Operation 提交事务 / Resource persistence | Task、Resource View、Canvas |
| Resource 不可变内容、媒体与 provenance | 同步 Operation 或 Task terminal materializer | Lineage、后续生成、Assistant |
| failed / canceled | Task terminal writer，仅限未物化 Resource | retry、Resource View |
| 精确依赖 | Resource materialization transaction 写 Lineage | planner、Canvas、诊断 |
| 当前采用 | Binding service CAS | Project Context、后续 Task |
| 专业当前结构 | 领域 service / terminal success projector | 领域 Query 与 renderer |
| Prompt Set 内容和媒体 ID | Creative Worker strict submission + terminal materializer | `create_video` planner |
| provider invocation 至多一次 | Task checkpoint / Provider Gateway | Worker、reconciler |

## 权威入口

- 同步创建：`create_text`、上传 Operation、领域导入 service。
- 异步创建：`create_image`、`create_audio`、`create_video`、`merge_videos`、`creative_work` 以及外部图片导入；全部复用 Operation plan/commit、Task 和 terminal materializer。
- 采用：Binding service 及其 `adopt_creative_direction`、`adopt_asset_manifest`、`bind_voice`、资产图片终态入口。
- 读取：Resource View、Assistant Link View、`list_resources`、Project Context 和领域投影。
- 编辑开放文档：`edit_resource`，只写 `creativeData`。

同一动作不得从 route、Primary Agent 或 UI 另建 writer。

## 正常、失败与并发时序

1. planner 解析所有显式 Resource ID，验证 scope、状态、schema、媒体类型和 capability。
2. plan snapshot 冻结 model/config、输入顺序、报价和审批事实。
3. commit 事务按 `operationId + requestId + candidateIndex` 预留短 Resource ID，创建 Task 与 outbox。
4. Worker 只消费冻结 payload；provider 受理 identity 由 Task checkpoint 保存。
5. terminal success 在一个事务中投影领域事实、物化 Resource、写 Lineage、结算 Task/event/continuation。
6. 重复 terminal 或 replay 必须返回相同事实；不同 Task 不能物化已成功的 Resource。
7. 单次尝试失败由 Task retry owner 处理；业务最终失败才把未物化 Resource 设为 failed。用户 retry 创建新执行、沿用同一 Resource 和冻结输入。
8. regenerate 创建新 Resource；Binding 更新以 version CAS 拒绝晚到覆盖。旧 Resource 仍可被 Lineage、历史消息或其他 Binding 引用。

## Video Prompt Set 直连

```text
video_prompt_set Resource ID
          │ server reads strict segments + lineage
          ▼
validate exact media Resource IDs and model capability
          │
          ├─ segment 1 → pending video Resource + Task
          ├─ segment 2 → pending video Resource + Task
          └─ segment N → pending video Resource + Task
```

Prompt Set Resource 本身和实际媒体 Resource 都写入每段视频的 Lineage。模型不提交 alias、role 映射或可见名称；`@ImageN` / `@AudioN` 只由执行层按已验证顺序构造。

## 一次性切换

`20260729090000_collapse_creative_resource_identity` 删除 `CreativeResourceRevision`、`headRevisionId`、`originKey`、Binding 的第二 identity 以及旧 Lineage 字段，把内容和 provenance 移到 Resource，并把领域投影切成单一 Resource ID。该 migration 通过一次性 guard key 在发现任何旧 Resource、Source Document 或 Story Canon 数据时立即失败；它不猜测、复制或覆盖数据。

部署前必须排空旧协议 queued/processing Creative Resource Task、Creative Work Task 与对应 Agent Wait，并在明确授权下清理预发布旧数据后再执行 migration。本任务只提交 migration 文件，不执行 migration 或数据清理。协议直接切到 `creative_work_v10`，不保留旧 parser、双读或兼容字段。

## 复杂度变化

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 跨层 Resource identity | `resourceId + revisionId + originKey/hash` 三类 | 一个短 `resourceId` |
| 内容持久实体 | Resource + Revision | Resource |
| 引用关系解释者 | Primary 名称映射 + 服务端校验 | 服务端校验 |
| Binding value identity | 两个 | 一个 |
| Lineage 端点 identity | Revision | Resource |
| Video Prompt Set 到视频执行 | Prompt 复制、引用重选、再提交 | Prompt Set ID 一次提交 |

## 适用验证

- Logic：短 identity 的分帧确定性、Resource 物化一次性、retry 冻结 payload、引用位置互斥、Prompt Set strict output 和媒体 ID 校验。
- Conformance：Operation registry 的 `prompt_set`、`manifest_assets`、`music_direction` 窄分支、公开 Tool schema、Creative Work output registry、Binding 保留角色和 Assistant Link View。
- Integration：Task terminal 原子物化、Binding CAS、领域投影、失败恢复和同 Resource replay。
- Golden：Resource 创建、Task、Lineage、Binding、Assistant/Canvas 读取和刷新组合。

真实 provider 对 Prompt Set 多段视频的外部受理、计费和最终媒体仍是环境型盲区；未运行对应真实组合时不得宣称架构完成。

## 历史回归

- 初始 Resource spine 同时保存 Resource、Revision、head 和 origin；跨层又逐步只认 Revision，形成多个可合法出现但语义重叠的 identity。修补调用方只能减少某一种不一致，不能消除组合错误。本次直接删除 Revision/head/origin 协议。
- 参考资产回归的直接症状是视频生成未消费用户已选资产。上一版只保证 `request.kind=retry` 从旧 Task 恢复冻结引用，但初次 `video_prompt_set` 仍只输出自然语言 `referenceKeys`，Primary 必须根据名称、资源列表和历史上下文重新选择 ID；因此初次生成完全绕过 retry 防线，且曾把 Resource hash 当成执行需要的 ID。当前 Prompt Set 保存精确 `mediaResourceIds`，服务端只允许其持久 Lineage 中的真实 Resource，Primary 不再解释引用。
- 语义上下文与 provider 图片曾共用 `references`，导致 Creative Direction 文字被送入图片 provider。当前三种 provider 引用由冻结位置明确区分，旧 payload 不兼容。
- 通用媒体 Task 曾在提交后没有 pending Resource，Canvas 只能等终态或刷新；随后 SSE 失效又只命中一个 episode key。当前提交事务预留 Resource，Project 级失效覆盖所有 episode 参数变体，UI 仍只重读正式 View。
- Task terminal 曾把 storageKey/URL 等原始结果交给模型，Assistant 再从 Markdown 猜文件链接。当前 terminal 只交付 Resource refs，唯一 Link View 投影安全名称和地址。
- 同用户跨 Project Binding 曾因只校验 user 而被接受。Binding service 现在验证目标 owner/scope 和 Resource scope，跨 Project/Episode失败关闭。
- Project 删除曾只依赖数据库从 Project 向全部领域关系级联；当同一项目的输入 Resource 被输出 Resource 的 Lineage 引用时，输出端 `CASCADE` 尚未清除边，输入端 `RESTRICT` 已先拒绝删除。旧项目删除 Golden 只覆盖空项目或普通资产，Resource Golden 又从不删除项目，因此两条各自通过却没有反证组合。当前唯一 `delete_project` 事务先拒绝任何以项目 Resource 为输入、但输出不属于本项目的异常跨 scope Lineage，再由 Creative Resource owner 删除项目输出拥有的全部 Lineage；`inputResourceId RESTRICT` 继续保护单 Resource 删除语义。Chapter Planning owner 同事务清理自己的投影关系后才删除 Project。`GJ-FREEFORM-RESOURCE-CREATION` 在真实 Resource、Lineage、Binding、Story Canon、Chapter 与多 Episode 均存在后通过生产 UI 删除，并以数据库 Oracle 验证无残留项目关系。
- `confirmed_screenplay` 曾与成功 screenplay Resource 并存成为第二状态。确认入口和 Binding 已删除，调用方显式选择一个 screenplay Resource。
- 角色音色曾把“重新生成”解释为原位追加版本，使当前绑定与生成完成的晚到顺序竞争。现在每次生成创建新 Resource，只有 Binding CAS 决定当前音色。
- Prompt Set 之外的两条 Worker 产物执行链曾长期依赖 Primary 搬运内容：资产图要求 Primary 逐条把 manifest `generationPrompt` 抄进 `create_image.kind=asset`，配乐要求 Primary 把 `music_direction` cue 时间线压缩改写成一条 `create_audio` prompt——后者本身就是「另一个模型改写同一创作判断」，且「原样使用」只有提示词纪律而无契约保证。参考资产回归（见上）已证明这类 Primary 解释层是漂移面。`creative_work_v11` 为 `music_direction` strict 输出增加必填可空 `score`，`manifest_assets`（CR-21）与 `music_direction`（CR-22）由此补齐引用执行；当前 v13 只继续切换 Worker 提交/trace 协议，不改变这些 Resource schema 和执行 owner。无 `score` 键的旧 music_direction Resource 引用执行时仍显式失败，由 Primary 重新委派。

## 修改检查表

1. 是否只传一个短 Resource ID，且名称、hash、alias 没有成为第二身份？
2. 成功 Resource 是否只物化一次；retry 是否只完成同一未物化 Resource，regenerate 是否创建新 Resource？
3. Lineage、Binding、领域投影、Assistant、Canvas 和 Task 是否都使用同一 Resource ID？
4. scope、schema、ready/materialized、媒体类型和 capability 是否在服务端统一验证？
5. Prompt Set 是否直接保存精确媒体 Resource ID，并且 Primary 只提交 Prompt Set Resource ID？
6. 是否复用既有 Operation、Billing/Approval、Task、Provider Gateway 和 terminal materializer，而非新增执行入口？
7. 是否删除旧 Revision/head/origin/referenceKeys parser、writer、fallback 和测试语义？
8. migration 是否 fail closed；旧 Task 是否在部署前排空；未验证环境盲区是否明确？
