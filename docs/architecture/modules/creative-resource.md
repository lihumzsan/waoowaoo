<!-- architecture-module: creative-resource -->

# 创作 Resource 与 Lineage

## 目标与边界

`CreativeResource` 是文字、图片、音频、视频以及剧本、Chapter Continuity Plan、Creative Direction、资产清单、视频 Prompt Set 等已交付创作产物的统一不可变身份。一个 Resource 表示一次具体交付；它同时保存内容、媒体、执行来源和物化状态。临时文字选项属于当前 `request_choice`，不是持久 Resource。专业领域表仍只保存需要结构化查询的当前业务投影，不成为第二份产物内容。

本模块不决定创作顺序、模型选择、计费批准或专业创作判断。Operation registry、Provider capability、Billing/Approval 和 Creative Skill 各自继续拥有这些事实。

## 不变量

- **CR-01 — 一个短 Resource ID 只表示一个不可变产物。** `CreativeResource.id` 是唯一跨层身份，格式为 `r_` 加 128-bit SHA-256 base64url 摘要，总长 24 字符。通用生成由 `operationId + requestId + memberIndex` 确定，同一显式 alternatives request 的每个成员仍以不同 `memberIndex` 获得独立 Resource ID；领域导入由 `sourceType + sourceId` 确定。两者都经带长度分帧的共享 identity builder 生成。名称只用于显示，不能参与解析。禁止恢复 Revision、head、originKey、内容 hash identity 或调用方自造长 UUID。
- **CR-02 — Resource 预留与物化分离，但身份不变。** 异步提交事务先创建 pending Resource 和 Task；唯一 terminal materializer 在成功时把内容、媒体、provenance 与 `materializedAt` 一次写入同一 Resource。已物化 Resource 不得再次写内容。失败或取消只可结算未物化 Resource 的状态。
- **CR-03 — retry 是失败 Resource 的重新生成。** retry 只接受 failed Resource ID，并从同一 Operation 的唯一非 retry 初始 Plan/Task 重放该 Resource 首次提交时冻结的 prompt、模型路由、参数和输入；`new`、`prompt_set`、`manifest_assets` 等初始请求分支必须遵守同一规则，不能把某个请求 kind 当成“原始生成”的同义词。retry 只允许同一 Resource 从未物化状态完成，不接收任何可改写生成事实的字段；新 Task 的 scope 必须来自目标 Resource 与原始 Task 的 canonical scope，当前 Agent 所在 Episode 只用于证明调用资格，不能改写 project-scope Resource。alternatives 成员 retry 保留初始 `alternativeGroupExecutionId + memberIndex`，只重跑该成员，不创建新组或组级状态。用户要不同内容、修改后的输入或另一版本时，仍调用现有领域生成入口创建一个新 Resource，并用 Lineage 表达来源；不存在独立 `regenerate_asset` 协议。角色的晴天、雨夜、战损等状态是多个 Resource，不是同一 identity 的版本。
- **CR-04 — Lineage 只连接精确 Resource。** `CreativeResourceLineage` 的唯一事实是 `inputResourceId + role + position → outputResourceId`。服务端按 Resource ID 回库验证 owner、scope、schema、status 和真实内容。禁止从名称、当前选择、最近记录、数组位置、历史消息、Prompt、Canvas edge 或模型输出重新猜关联。
- **CR-05 — 当前选择是服务端的封闭关系。** 当前关系只允许 `adopted_creative_direction | adopted_asset_manifest | character_voice | project_asset_image` 四个穷尽 role，唯一 key 是 `scope + role + slotKey`，值只有 `resourceId`，由 Binding service 以 version CAS 写入。模型和 UI 不得读取或提交 Binding ID、任意 role、slot 或 expectedVersion；`adopt_creative_direction`、`adopt_asset_manifest`、`bind_voice` 与资产图片终态入口各自验证领域身份，前台替换由服务端读取当前 version，后台晚到保护只消费计划时冻结的内部 version。关系不复制内容、不保存第二 identity，也不改变或删除被换下的 Resource。
- **CR-06 — 引用协议只传 Resource ID。** Creative Work request、媒体 Operation、消息附件、Assistant Link View、Choice subject、Canvas 与领域投影都只传 `resourceId`。可选 `role` 只表达该输入在新输出中的语义，不参与定位。调用方不得同时传名称、短 key、origin、hash 或内容副本充当第二关联协议。
- **CR-07 — Video Prompt Set 直接拥有精确媒体引用。** `video_prompt_set.segments[].mediaResourceIds` 保存 Worker 已读取的图片/音频 Resource ID。Primary Agent 只把 Prompt Set 自身的 `resourceId` 提交给 `create_video.request.kind=prompt_set`；服务端读取 strict Prompt Set，验证每个媒体 Resource 必须存在于该 Prompt Set 的持久 Lineage、属于同一 owner/scope、已物化且类型合法，再按顺序冻结成视频 Task。Primary 不复制 prompt、时长或媒体 ID，也不执行名称到 ID 的映射。
- **CR-08 — Prompt Set 执行仍走唯一媒体入口。** `request.kind=prompt_set` 只是在 `create_video` planner 内展开多个 segment；每段仍经当前项目模型配置、同一 capability、PlanSnapshot、Billing/Approval、Task submitter 和 Resource materializer。它不是第二个视频执行器。文本生视频、重复媒体 ID、只有声音没有图片、超出图片/声音数量或非法时长必须在计划阶段失败。
- **CR-09 — 媒体语义输入与 provider 通道分离。** `contextReferences` 只进入 Lineage 和创作上下文；图片、音频和视频 provider 引用分别冻结为 `imageInputPositions`、`audioInputPositions`、`videoInputPositions`。三组位置必须存在、互斥、有序并符合模型 capability。Creative Direction、剧本和其他文字 Resource 不得伪装为 provider 媒体。
- **CR-10 — scope 与 owner 必须由服务端证明。** 用户级 Resource 可被显式采用；Project/Episode Resource 只能在允许的同 Project/Episode 范围使用。跨用户、跨 Project、非法跨 Episode、错误 schema、非 ready 或未物化引用原地失败。名称、bridge row 和“最近使用”都不能绕过该检查。
- **CR-11 — provenance 属于 Resource。** 每个成功 Resource 保存适用的 `operationId`、`inputHash`、Task/OperationExecution/executionSegment/toolCall identity、真实 prompt、最终 provider route `modelKey` 与执行参数。`inputHash` 只用于幂等与审计，不是 Resource identity。
- **CR-12 — 一个异步终态 writer。** `commitTaskTerminal` 的同一事务先执行适用领域 success projector，再调用 production Resource materializer，最后把精确 Resource refs 合并到 Task result、terminal event 和 Agent continuation。同一 Task 重放只能返回同一 Resource。timer、refetch、SSE 到达顺序和 UI 文案不承担正确性。
- **CR-13 — alternatives 是显式生成能力，不是通用候选状态。** `create_image.request.kind=new`、`create_video.request.kind=new`、`create_audio.request.kind=new` 与 standalone voice 可以由其 Operation contract 显式声明 `count=1..6`；同一个不可变计划、报价、Grant 与 Execution 原子预留 N 个独立 Resource/Task，每个 provider Task 的内部 `count` 仍为 1。只有 `count>1` 时初始 OperationExecution 才成为 group owner，成员 Resource 保存 `alternativeGroupExecutionId + memberIndex`；`count=1` 不创建组或组成员 identity。group count/status 只从成员派生，不存 selected/current/adopt。`assetBinding`、`manifest_assets`、`prompt_set`、`music_direction`、角色或多角色 voice、upload 与 merge 是领域批次/目标，不提供 alternatives，仍只用 `memberIndex` 表达自身顺序。临时文字多选只由 `request_choice` 拥有。
- **CR-14 — `mediaType` 是 fallback，`schemaId` 是专业语义。** 每个 Resource 必须声明 `text|image|audio|video` 和生产 registry 中的 schemaId。专业 renderer 优先，缺失时才使用媒体 renderer。新增专业结果优先增加 registry 声明，不得复制 Resource、Lineage、当前选择或生命周期。
- **CR-15 — 专业投影不复制产物身份。** `ProjectEpisodeSourceDocument.sourceResourceId` 和 `ProjectStoryCanon.storyCanonResourceId` 只保存精确 Resource ID；结构化字段是其领域查询投影。screenplay、Chapter Continuity Plan、Creative Direction 和 Asset Manifest 的 Resource scope 由 Creative Work output registry 裁决。采用 `chapter_continuity_plan` 时，Story Canon 与全部 Chapter 投影必须保存同一个计划 Resource/version；不存在独立 Canon 或 Chapter 产物。成功 screenplay Resource 可直接使用，不存在 confirmed screenplay 或“正式版本”副本。
- **CR-16 — 外部素材登记与物化两步分离，最终仍只创建 Resource。** 网页导入经唯一入口完成安全抓取、MediaObject 登记与异步物化。用户上传拆成两步：`api_project_upload_media` 是唯一登记入口，只做嗅探、重编码、内容寻址存储与 MediaObject 登记，并签发绑定 `userId + projectId + 媒体 identity + 预定域 Resource ID` 的附件 receipt（HMAC token）——不创建 CreativeResource、不广播画布；`register_uploaded_media` 是唯一物化入口，Tool 与 Project UI API 只是两个授权 channel，二者都调用同一个 Operation transaction。服务端验证 receipt 的 owner/scope 与登记媒体一致后按 `user_upload + projectId:sha256` 域 identity reserve + materialize 唯一 Resource并广播。同一内容任何时刻物化都收敛到同一 Resource ID。第一段成功而第二段失败时 receipt 是唯一恢复交接，重试只执行物化；不增加清理 timer。出处、sha256、MIME、大小和原文件名属于 provenance/执行参数。物化后下游仍只使用 Resource ID；receipt 不是第二引用协议，生成入口不能铸造 import schema。从未物化也从未被消息引用的登记（MediaObject + 存储对象）没有 TTL 生命周期，是已知边界。
- **CR-17 — 当前角色音色由 typed current selection 裁决。** `generate_voice.request.kind=single` 的 standalone target 可按显式 count 生成 alternatives；绑定到角色的 single target 仍只生成一个成员。`request.kind=characters` 在一次 Operation、一次报价和一次审批中展开多个明确角色成员，每个成员分别拥有一个新的音频 Resource 和一个 Task。成员终态彼此独立，批次可部分成功且只重试失败成员；`bind_voice` 由服务端替换当前选择，各成员生成终态 CAS 只在仍匹配计划时冻结的内部旧 version 时更新 `character_voice`，不能覆盖更晚的人工选择。新生成不是原位写入。物理删除必须拒绝 active Task、任何当前选择、下游 Lineage 和 alternatives 成员，并且不能删除共享 MediaObject。
- **CR-18 — 开放创作文档与不可变内容隔离。** `creativeData` 是 Resource 上单独的 schema-open CAS 文档，仅由 `edit_resource` 按 `creativeDataVersion` 做最小路径 Patch。内嵌 `$resourceRef` 只含 Resource ID并经过 owner/scope 校验。它不能改写 Resource 内容、provenance、Lineage、当前选择、Task 或生命周期。
- **CR-19 — UI 只消费最终 View。** Resource View 是卡片的唯一读模型；pending 摘要只从预留 Resource 和唯一 active Task 的冻结 payload 派生，ready 摘要从同一 Resource 的物化内容派生（未物化 Resource 的内容摘要为 empty，生成 prompt 属于 provenance，只在详情视图展示，不充当卡片内容）。card View 附带服务端一次性解析的 `inputSummaries`（引用输入的 name、mediaType、受保护媒体预览 URL）以及可选 `alternativeGroup`（opaque groupId、当前 member index/total、完整稳定有序 sibling View）；消费方不得从 operation name/memberIndex 推断组、按 resourceId 零散请求或用名称二次定位。materialized Lineage 输入缺行必须显式失败，不得回退显示领域 ID。Assistant Link View 只接受精确 Resource ID，文件名来自 Resource name，href 来自受保护媒体投影。Canvas edge 只来自持久 Lineage，同组不造 edge。
- **CR-20 — Resource 不裁决流程。** Resource 存在、缺失、旧生成结果或 Lineage 都只是事实。Operation 可调用性只由 registry channel、显式 input schema、scope、provider capability、审批和破坏性确认裁决；Workflow step、Canvas 位置或推荐顺序不能成为隐藏门槛。
- **CR-21 — 清单资产图按引用执行。** `create_image.request.kind=manifest_assets` 只接受当前 adopted `project.asset_manifest` 的精确 Resource ID 与可选 `manifestAssetIds` 子集；服务端校验 adopted Binding、按 `manifestAssetId` 解析项目资产身份与 `project_asset_image` Binding 当前 version，并从该 Manifest 的精确 Lineage 读取其创建时实际冻结的 Creative Direction（若存在）。唯一 Asset Prompt Compiler 以每项 `stableDescription + 冻结 Direction 的视觉字段 + Asset Format Policy` 编译最终执行 Prompt；没有冻结 Direction 时只组合稳定设计与 Format Policy。Worker、Primary 和调用方均不写或改写最终 Prompt。一次调用为每个资产创建一个图片 Task，Manifest 和实际存在的 Direction Resource 都写入每个 Task 的 Lineage。`request.kind=asset` 只服务清单之外的单个资产图。该窄分支仍在 `create_image` planner 内展开，复用同一 Billing/Approval、Task submitter 与 terminal materializer，不是第二图片执行器；非 adopted 清单、未知/重复 manifestAssetId、缺失身份、Direction Lineage 歧义/非法或空清单必须在计划阶段失败。
- **CR-22 — 配乐 cue 按引用执行。** `music_direction.cues[]` 是唯一最终配乐执行指令集合；空数组表示刻意不配乐且不存在下游音乐生成。`create_audio.request.kind=music_direction` 每次只接受该方向 Resource ID、一个精确 `cueKey` 与精确目标视频 Resource；服务端原样读取该 cue 的 `generationPrompt`，从 `startSeconds/endSeconds` 导出单次 duration 与 canonical `scoreCue` 窗口并按 music capability 校验，`maxReferenceVideos` 声明允许时把视频冻结为 `videoInputPositions`，否则只作为 Lineage 上下文。方向与视频 Resource 都进入该 BGM Task 的 Lineage。空 cues、未知 cue、窗口非法、视频时长缺失或窗口超出视频范围必须在计划阶段失败；Primary 不改写、不压缩、不合并或补充 cue 指令。当前 `merge_videos` 只有一个 music 输入，不拥有多个 cue 的时间线装配；没有显式装配能力时不得把多个独立 cue Resource 解释为已完成的整片配乐。
- **CR-23 — 用户来源转录仍由 `create_text` 唯一写入。** 当前消息附带图片中的原文只能通过 `create_text.content.kind=current_user_media_transcription` 物化为文本 Resource；服务端必须证明 `sourceResourceId` 属于该 exact user turn、回库验证 owner/project/ready/image，并把原图以 `role=source, position=0` 写入输出 Lineage。完整剧本仍使用同一个 `project.screenplay` schema，不创建 OCR Resource、正式副本、确认态或第二 writer；模型转录文本不能反向充当图片 identity 或校验依据。
- **CR-24 — Resource View 顺序来自创建事实。** Project Resource 列表按批次创建时间、批次内 `memberIndex`、最后才按 Resource ID 稳定排序；alternatives sibling View 按同一初始 OperationExecution 内的 `memberIndex`、Resource ID 排序。nullable `memberIndex` 的位置必须由查询显式声明，禁止依赖数据库默认 NULL 顺序。Canvas 与其他消费者直接使用该 View 顺序，不得按 hash ID、Task 完成时间或名称中的数字重新猜测。
- **CR-25 — Resource 没有归档语义。** 产品删除了 Canvas 的归档/恢复与节点隐藏两个组织动作:`set_resource_archived` Operation、archive service、Project UI archive route、`includeArchived` 读参数与 `hidden` 布局字段全部删除,Resource View 不再投影 `archivedAt`,默认列表、alternatives 成员、WorkingSet 与 Project Lite 统计一律返回全部未删除行,不存在第二种可见性解释。`creative_resources.archivedAt` 与 `project_canvas_node_layouts.hidden` 两个数据库列尚未 drop(需要单独授权的 migration),但已无 writer、无 reader,不得被任何新逻辑重新解释为可见性事实。物理删除仍按 CR-17 的既有约束执行。

## 状态与写入者

| 事实 | 唯一 owner / writer | 主要消费者 |
| --- | --- | --- |
| Resource identity、scope、schema、pending 状态 | Operation 提交事务 / Resource persistence | Task、Resource View、Canvas |
| Resource 不可变内容、媒体与 provenance | 同步 Operation 或 Task terminal materializer | Lineage、后续生成、Assistant |
| failed / canceled | Task terminal writer，仅限未物化 Resource | retry、Resource View |
| alternatives 成员归属 | 初始 approved Operation commit / Resource persistence | Resource View、Canvas preview |
| 精确依赖 | Resource materialization transaction 写 Lineage | planner、Canvas、诊断 |
| typed current selection | Binding service CAS；具体领域入口拥有输入 | Project Context、后续 Task |
| 专业当前结构 | 领域 service / terminal success projector | 领域 Query 与 renderer |
| Prompt Set 内容和媒体 ID | Creative Worker strict submission + terminal materializer | `create_video` planner |
| 清单资产最终执行 Prompt | Asset Prompt Compiler | `create_image.request.kind=manifest_assets` planner |
| provider invocation 至多一次 | Task checkpoint / Provider Gateway | Worker、reconciler |

## 权威入口

- 同步创建：`create_text`、`register_uploaded_media`（Agent 与 Project UI 共用的附件物化）、领域导入 service；`api_project_upload_media` 只登记附件，不创建 Resource。
- 异步创建：`create_image`、`create_audio`、`create_video`、`merge_videos`、`creative_work` 以及外部图片导入；全部复用 Operation plan/commit、Task 和 terminal materializer。
- alternatives group identity、reserve membership 与最终 group View：`src/lib/creative-resource/{identity,persistence,view-service}.ts`；生成 Operation 只通过统一 reserve 参数声明初始 group owner。
- 当前选择：`adopt_chapter_continuity_plan` 的单事务领域 service；`adopt_creative_direction`、`adopt_asset_manifest`、`bind_voice` 与资产图片终态入口复用服务端内部 Binding service，不存在 generic adopt Operation。
- 读取：Resource View、Assistant Link View、`list_resources`、Project Context 和领域投影。
- 编辑开放文档：`edit_resource`，只写 `creativeData`。

同一动作不得从 route、Primary Agent 或 UI 另建 writer。

## 正常、失败与并发时序

1. planner 解析所有显式 Resource ID，验证 scope、状态、schema、媒体类型和 capability。
2. plan snapshot 冻结 model/config、输入顺序、报价和审批事实。
3. commit 事务按 `operationId + requestId + memberIndex` 预留短 Resource ID，原子创建 Resource、Task、Created TaskEvent 与 FollowUpBatch membership。
4. Worker 只消费冻结 payload；provider 受理 identity 由 Task checkpoint 保存。
5. terminal success 在一个事务中投影领域事实、物化 Resource、写 Lineage、结算 Task/event/continuation。
6. 重复 terminal 或 replay 必须返回相同事实；不同 Task 不能物化已成功的 Resource。
7. 单次尝试失败由 Task retry owner 处理；业务最终失败才把未物化 Resource 设为 failed。用户 retry 创建新执行、沿用同一 Resource 和冻结输入。
8. 不同内容或另一媒体版本通过现有生成入口创建新 Resource；服务端 current-selection CAS 拒绝晚到覆盖。旧 Resource 仍可被 Lineage、历史消息或其他当前关系引用。

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

`20260801090000_remove_resource_candidate_sets` 删除无产品消费者的 `candidateSetId` 与候选索引，并把仍有真实用途的批次顺序字段改名为 `memberIndex`。直接生成契约同步删除 `count` 和文字 candidates；旧 Approval/RunState 不兼容，切换前必须排空。

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
| 直接生成候选协议 | `count + candidateSetId + candidateIndex + candidate card grouping` | 每次一个 Resource；明确领域批次只有 `memberIndex` |
| 模型选择当前 Resource | generic `adopt_resource(role/slot/expectedVersion)` | 领域 Operation；版本只在服务端内部 |

## 适用验证

- Logic 只保留 canonical Resource identity；Task/Operation conformance 只证明生产 registry 接线，不声称验证创作语义。
- 通用 Task Critical 只验证提交、终态、重放和并发基础设施；不再为每个 Resource 请求分支复制 planner/fixture 测试。
- 人工产品复验：Resource 创建、Task、Lineage、typed current selections、Assistant/Canvas 读取、刷新和真实模型组合；不使用脚本模型 Journey。

真实 provider 对 Prompt Set 多段视频的外部受理、计费和最终媒体仍是环境型盲区；未运行对应真实组合时不得宣称架构完成。

## 历史回归

- Resource 归档首次接入时，默认 Canvas list 与 WorkingSet 已排除归档项，但 Project Lite 的 total/ready/failed 仍统计全部行，导致右侧 Assistant 看见的活跃资源摘要与画布不一致；随后统一为所有默认集合显式 `archivedAt=null`。产品复盘后判定归档与节点隐藏都没有真实用户价值,且画布工具栏的可见性开关删除后会让两者变成不可逆操作,因此整层删除了 UI 入口、client hook、API route、Operation、archive service 与全部读过滤,而不是只摘掉按钮留下半截能力。删除时库中归档资源与隐藏节点均为 0 行,因此取消过滤没有数据可见性后果;两个数据库列保留待独立授权的 migration 清理。

- `CR-03` 已把 retry 定义为失败 Resource 的冻结输入重放，但旧 Primary Prompt 为阻止自主重复扣费，曾把所有 retry 一概限制为“修正输入且请求必须变化”。用户明确要求重新提交时，Primary 因而只读取旧 Task 并拒绝调用已有 retry 分支；planner、Task 和 Resource 防线本身都没有被触达。当前 Codex 运行指令与 Assistant Runtime 契约共同区分活动 Task 的队列 attempt、用户明确授权后以新报价和新 Task 执行的 exact retry、以及创建新 Resource 的 corrected-input regenerate；exact retry 仍只接受失败 Resource ID，不增加第二执行入口或输入 writer。
- Resource Lineage 的首次共享校验只验证 `userId + ready`，而 Binding 与 creativeData 又各自维护局部 Project/Episode 条件；同一用户可把另一 Project/Episode 的 ready Resource 冻结进生成输入，materializer 还会再次通过同一不完整校验。根因是 CR-10 没有落实为一个接收目标 scope 的权威裁判。当前 persistence validator 以输出 Resource 的 canonical scope 统一裁决 user/project/episode 兼容性，初次生成、retry、merge、creativeData 与终态物化全部复用；局部 scope 查询已删除。
- 完整用户剧本的第一次来源捕获只覆盖可由服务端 substring 证明的当前消息文字；图片上传虽然已经物化为 Resource，却只能作为媒体生成引用，Primary 与 Worker都读取不到像素。真实运行因此创建了一个没有正文的 `project.screenplay` 占位 Resource。当前不新增 OCR 持久实体：Primary 看图后的转录仍经唯一 `create_text` 事务写入，服务端把当前附图 Resource 固定为 source Lineage 并拒绝非当前 turn、非图片或重复引用。模型 OCR 内容正确性仍是人工样本复验边界。
- 初始 Resource spine 同时保存 Resource、Revision、head 和 origin；跨层又逐步只认 Revision，形成多个可合法出现但语义重叠的 identity。修补调用方只能减少某一种不一致，不能消除组合错误。本次直接删除 Revision/head/origin 协议。
- Resource retry 首次冻结输入收敛只把 `request.kind=new` 认作原始生成；随后 Video Prompt Set 新增 `request.kind=prompt_set`，初次多段视频与失败终态都能正常持久化，但单段 retry resolver 会忽略同一 Operation 的真实 Plan/Task，并错误返回 `CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_MISSING`。旧冻结输入测试只构造 `new`，Prompt Set Critical 又只验证全部成功，因此两条防线各自通过却没有反证“Prompt Set 中一个 provider 失败后只重试该 Resource”的真实组合。当前原始执行身份统一定义为同一 Operation 的唯一非 retry Plan/Task，所有重试仍只重放该 Task 的冻结 payload；真实 MySQL Critical 从生产 Prompt Set planner 创建两个 Task，令其中一个失败、另一个成功，再证明 retry 只为失败 Resource 创建一个同 identity Task、payload 除新 toolCallId 外完全一致且不触碰兄弟 Resource。该修复热更新后的预检/批准 route 曾分别保留新旧 resolver，暴露审批协议只比较内容 Hash、没有冻结 planner 语义；Billing Approval 现以 Snapshot 唯一 `executionContractRevision` 在任何二次读取前拒绝跨版本执行，Creative Resource 不另建版本裁判。
- Project-scope 图片 Resource 从 Episode 会话发起生成后以 `episodeId=null` 持久化；retry resolver 却把当前会话 Episode 当成目标 identity，既拒绝该失败 Resource，又只查 `Task.episodeId=currentEpisode`，因此返回 `CREATIVE_RESOURCE_RETRY_TARGET_INVALID`。根因是调用上下文 scope 与目标 canonical scope 混为一体，旧 retry 防线只覆盖 scope 相同的实例。当前 resolver 先以调用 Episode 拒绝跨 Episode 资源，再以 Resource 自身 scope 精确匹配原始 Task，planner 也按该 scope 创建新 Task 与解析引用；混合 project/episode scope 的一批 retry 显式拒绝。项目级素材可从任一同项目 Episode 会话重试，Episode 级素材仍只能从同一 Episode 重试。
- 异步 Resource 曾两次因 Task 运行字段击穿严格 payload：第一版生成 parser 漏接 `externalId`，随后共享 poll 新增 `externalPhase` 又使 voice/music/image/video 在 provider 已成功、handler checkpoint 已落盘后无法提交终态，失败提交也被同一 parser 回滚；reconciler 只能不断提高 attempt 并重放本地交接。上一版防线只把各 Creative Resource reader 收敛到共享清单，仍允许通用 progress writer 把任意 provider/stream 字段写入冻结 payload，因此同一不变量换字段复发。当前 Task service 是唯一持久进度 writer，并先经 `progress-payload.ts` 投影；Creative Work 与全部 Creative Resource parser 复用同一 Task runtime envelope，未声明的流式细节只进入 SSE。真实 voice 已由既有 provider checkpoint 恢复并完成；music、异步 image/video、merge 的完整真实组合仍是发布复验盲区。
- 参考资产回归的直接症状是视频生成未消费用户已选资产。上一版只保证 `request.kind=retry` 从旧 Task 恢复冻结引用，但初次 `video_prompt_set` 仍只输出自然语言 `referenceKeys`，Primary 必须根据名称、资源列表和历史上下文重新选择 ID；因此初次生成完全绕过 retry 防线，且曾把 Resource hash 当成执行需要的 ID。当前 Prompt Set 保存精确 `mediaResourceIds`，服务端只允许其持久 Lineage 中的真实 Resource，Primary 不再解释引用。
- 语义上下文与 provider 图片曾共用 `references`，导致 Creative Direction 文字被送入图片 provider。当前三种 provider 引用由冻结位置明确区分，旧 payload 不兼容。
- 通用媒体 Task 曾在提交后没有 pending Resource，Canvas 只能等终态或刷新；随后 SSE 失效又只命中一个 episode key。当前提交事务预留 Resource，Project 级失效覆盖所有 episode 参数变体，UI 仍只重读正式 View。
- Task terminal 曾把 storageKey/URL 等原始结果交给模型，Assistant 再从 Markdown 猜文件链接。当前 terminal 只交付 Resource refs，唯一 Link View 投影安全名称和地址。
- 同用户跨 Project Binding 曾因只校验 user 而被接受。Binding service 现在验证目标 owner/scope 和 Resource scope，跨 Project/Episode失败关闭。
- Project 删除曾只依赖数据库从 Project 向全部领域关系级联；当同一项目的输入 Resource 被输出 Resource 的 Lineage 引用时，输出端 `CASCADE` 尚未清除边，输入端 `RESTRICT` 已先拒绝删除。旧项目删除 Golden 只覆盖空项目或普通资产，Resource Golden 又从不删除项目，因此两条各自通过却没有反证组合。当前唯一 `delete_project` 事务先拒绝任何以项目 Resource 为输入、但输出不属于本项目的异常跨 scope Lineage，再由 Creative Resource owner 删除项目输出拥有的全部 Lineage；`inputResourceId RESTRICT` 继续保护单 Resource 删除语义。Chapter Planning owner 同事务清理自己的投影关系后才删除 Project。真实复杂项目删除曾人工复验通过，但当前不保留脚本 Journey；跨 scope Lineage 的完整组合仍需发布前复验。
- `confirmed_screenplay` 曾与成功 screenplay Resource 并存成为第二状态。确认入口和 Binding 已删除，调用方显式选择一个 screenplay Resource。
- 角色音色曾把“重新生成”解释为原位追加版本，使当前绑定与生成完成的晚到顺序竞争。现在每次生成创建新 Resource，只有 Binding CAS 决定当前音色。
- Prompt Set 之外的两条 Worker 产物执行链曾长期依赖 Primary 搬运内容：资产图要求 Primary 逐条把 Manifest 的自由生成文本抄进单资产生成，配乐要求 Primary 把 `music_direction` cue 时间线压缩改写成一条 `create_audio` prompt。资产链随后虽改为引用执行，Worker 自由文本仍与服务端固定格式后缀共同书写画幅和构图，真实结果出现 16:9 多视图资产板与 4:3 左特写右全身相冲突。当前 Asset Manifest 只保存稳定可见设计，唯一服务端 Compiler 从精确 Manifest Lineage 读取冻结 Direction 并叠加唯一 Format Policy；Primary、Worker 和旧常量不再拥有最终资产 Prompt。配乐由 `music_direction.cues[].generationPrompt` 分别拥有各自窗口的唯一创意指令，Primary 只传精确 `cueKey`，服务端冻结窗口。旧资产 schema 与旧 `score` 音乐协议不进入新 strict parser；引用旧 music_direction Resource 时显式失败并由 Primary 重新委派，不保留双读兼容。
- 上传曾经"粘贴即物化"：`api_project_upload_media` 在上传事务里直接 reserve + materialize `project.upload_image/upload_audio` Resource 并广播画布，用户往对话里粘贴一张仅供讨论的截图也会立刻在画布上出卡，画布被从未进入创作链路的素材污染；消息附件协议因此还把"上传 Resource ID"当作对话附件身份，模型输入与聊天层耦合了 Resource 生命周期。当前一次性切换为两步（CR-16）：上传只登记（MediaObject + 签发 owner/scope 绑定的 attachment receipt），Resource 只由 Agent 显式调用 `register_uploaded_media` 物化，画布只在物化时收到广播。历史消息里旧协议的 resource-marker 图片按协议不兼容处理：模型输入将其替换为显式占位文本并记录结构化日志，不静默跳过也不保留旧解析分支；消息接受层直接拒绝无 receipt 的附件引用。旧上传 Resource 行保持不变仍可正常引用。防线：附件的唯一解析权威是 `media-attachments/resolve.ts`（消息接受、模型输入、物化共用），receipt 由服务端 HMAC 签发验证；未物化登记的存储清理仍是已知边界。
- 同一批 `createMany` 预留的 10 个视频 Resource 曾拥有完全相同的 `createdAt`，列表查询却直接以 hash Resource ID 排序，Canvas 因而稳定显示为 08、10、04 等伪随机顺序。当前 Resource View 在创建时间之后显式使用语义明确的 `memberIndex`，ID 只作最终 tie-breaker；nullable index 的位置也由查询声明。
- Resource 首次统一时把所有“当前采用”抽象成模型可调用的 `adopt_resource(role, slotKey, expectedVersion)`。真实模型为普通文本构造了不存在的 screenplay role，并猜测版本，导致采用失败后仍继续用自然语言宣称完成。旧防线只校验 Binding 的 CAS 与 scope，没有证明模型拥有该领域关系。当前 generic Operation 和文案已删除，role 穷尽为四个服务端内部关系，模型只调用具体领域选择 Operation，前台版本由服务端读取，旧 RunState 不兼容。
- 直接生成曾为图片、视频和文字共同暴露 `count/candidates`，持久层再用 `candidateSetId`、Canvas grouping 和通用 adopt 协议维持一个产品从未提供的选择生命周期；`494dacbc7` 因无真实消费者删除了整套协议。Canvas 现在具备明确的多结果浏览消费者，但旧协议把 alternatives、当前采用与组节点混为一体，不能直接恢复。当前只为生产 Operation contract 明示的媒体 `new/standalone` 请求提供 alternatives：初始 OperationExecution 是组 owner，N 个成员仍是独立 Resource/Task，View 只提供有序浏览；generic adopt、selected/current、组级 lifecycle 与候选节点继续保持删除。文字临时多选仍归 `request_choice`，Prompt Set、多角色音色和 Manifest 资产等仍是不同语义的领域批次。

## 修改检查表

1. 是否只传一个短 Resource ID，且名称、hash、alias 没有成为第二身份？
2. 成功 Resource 是否只物化一次；retry 是否只完成同一未物化 Resource，regenerate 是否创建新 Resource？
3. Lineage、typed current selection、领域投影、Assistant、Canvas 和 Task 是否都使用同一 Resource ID，且模型没有看到 Binding role/version？
4. scope、schema、ready/materialized、媒体类型和 capability 是否在服务端统一验证？
5. Prompt Set 是否直接保存精确媒体 Resource ID，并且 Primary 只提交 Prompt Set Resource ID？
6. 是否复用既有 Operation、Billing/Approval、Task、Provider Gateway 和 terminal materializer，而非新增执行入口？
7. 是否删除旧 Revision/head/origin/referenceKeys parser、writer、fallback 和测试语义？
8. migration 是否 fail closed；旧 Task 是否在部署前排空；未验证环境盲区是否明确？
