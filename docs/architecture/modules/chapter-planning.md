<!-- architecture-module: chapter-planning -->

# 章节核心剪辑规划

## 设计理念

章节计划把已确认剧本与章节事件组织成镜头和视频 Segment。模型是镜头结构与运镜决策者，不是剧情事实、资产 identity、资源生命周期或空间站位的第二 owner。系统不再生成分镜图；“分镜”只指最终直接提交给视频模型的镜头与 Segment 计划。

## 不变量

- **CP-00A — 章节需求先于资产生成完成。** `plan_chapters` 必须先完成本集全部章节的 EditScript 与资产 requirement 持久化，Workflow 才能开放 `generate_edit_script_assets`。二者禁止并行或共享 Operation Group；否则图片完成投影可能早于迟到 requirement，留下永久 pending。Canvas 可以提前投影已知资产，但只有 Workflow 的 `allowedOperationIds` 明确开放该 Operation 后才能展示动作或预取收费计划。资产审核面向本集唯一共享资产集。
- **CP-01 — Ledger 事实唯一。** 入章事实来自 ledger snapshot，本章新增持久事实来自 ledger events。provenance 只能由服务端投影，模型不得输出第二份事实台账。
- **CP-02 — 核心镜头契约最小且严格。** structure 输出只包含场景、动作、人物表演、对白、同步声音、时长、连续性与 `generationSegments`。`visibility`、`role`、`keyObjects`、lighting、空间站位、blocking、机位与生成 Prompt 都不属于该契约；strict schema 必须拒绝未知字段。
- **CP-03 — 禁止自然语言事实 identity。** 不得用 substring、token overlap、embedding 或数组位置将模型文本解释为 canonical fact。
- **CP-04 — 资产 identity 由服务端解析。** 模型只从动态名称枚举输出 `locationName`/`characterName`/`speakerName`，并使用本次响应内的短 `shotRef` 组织 Segment。唯一 resolver 精确映射 UUID、校验对白归属并生成系统 shot identity。未知名称、重名、未知引用、顺序或覆盖不完整必须整份失败。
- **CP-04A — UUID 是关联权威，名称只属于 View。** 持久计划、requirement、镜头执行计划、Video Segment 与 Ambient Sound 关联只使用 canonical identity。对外 View 必须按当前 UUID 重新投影名称；缺失关联显式失败，禁止回退到历史名称、位置或 UUID 文案。
- **CP-05 — 成功写入受 Task owner 围栏。** EditScript 与 ShotExecutionPlan 的正式资源在 owner-fenced 事务中提交；失败或晚到 attempt 不得改写章节事实。
- **CP-06 — 镜头执行计划只决定三个字段。** 模型输入只是 `structure_json + visual_style + aspect_ratio`；每个 shot 只输出 `shotScale` 与 `cameraMovement.{movement,stability}`。`stability` 是镜头动态的稳定程度，只能是 `locked/stable/smooth/subtle_shake/handheld`。焦段、景深、机位、角度、构图、灯光、轴线、站位、道具位置与 Prompt 都不得输出。
- **CP-07 — Video Segment 是唯一视频资源。** `ProjectVideoSegment` 以 `(editScriptId, segmentId)` 作为 canonical identity，只由 `generate_video_segments` 计划/批准链提交。参考图只来自已确认的角色与场景资产；最终 Prompt、有序参考图与 `inputSignature` 在批准时冻结进 Task payload，不得在资源表建立第二可编辑事实。超过模型 `maxReferenceImages` 必须整段失败，禁止截断。
- **CP-08 — 视频原生音频永远开启。** Segment 计划与 worker 都必须把 `generateAudio=true` 写入 provider 选项；缺失或 false 原地失败。原生片段音频、连续 Ambient Sound 和 BGM 是三条独立音轨，最终合成时才混合。

## 权威入口

- 章节输入与 ledger：`src/lib/edit-chapter/input-assembler.ts`。
- 核心计划契约与解析：`src/lib/edit-chapter/schemas.ts`、`src/lib/edit-script/types.ts`、`src/lib/edit-script/normalize.ts`。
- 核心计划与镜头执行计划 Prompt：`src/lib/ai-prompts/templates/edit-script/structure/**`、`shot-execution-plan/**`。
- Style Bible：`src/lib/edit-script/style-bible-prompt.ts`；视频使用 `visualStyle`，资产图使用 `assetImageStyle.{lighting,texture,composition}`。
- 核心计划、镜头执行计划与 owner-fenced 持久化：`src/lib/edit-script/service.ts`、`src/lib/workers/handlers/edit-script-structured-generate.ts`。
- Video Segment 计划、Prompt 与 Task：`src/lib/video-segments/{planning,prompt,types}.ts`、`src/lib/operations/domains/video-segments/index.ts`、`src/lib/workers/video.worker.ts`。
- Ambient Sound 规划/生成：`src/lib/ambient-sound/**`。

## 验证

- `tests/unit/edit-script/shot-execution-normalize.test.ts` 反证旧执行字段和非法稳定性枚举。
- `tests/golden-journey/self-tests/model-provider.test.ts` 让受控 provider 输出通过生产 strict schema；它不证明真实模型必然服从 Prompt。
- `tests/golden-journey/journeys/mainline-complete.spec.ts` 验证多章节从计划到 `ProjectVideoSegment`、原生音频、Ambient Sound、BGM 和成片的真实主链，并拒绝独立分镜图 Task/Panel/VideoGroup 回流。

## 历史回归

- `994b738981` 曾把第二次 LLM 分镜 Prompt 改成纯函数，但保留了独立 Operation、route、TaskType、worker、Workflow 阶段与 Panel 实体；只替换实现没有删除旧解释权。后续“全能参考”又作为旁路追加，使图片 Panel 与资产参考同时能生成视频。本次防线是一次性删除 Storyboard/Panel/图片阶段、空间档案和旧双模式，只保留唯一 `ProjectVideoSegment` 入口。
- 多章节旧链曾通过 `updatedAt desc`、数组位置与 panel fallback 推断归属，导致异步顺序改变时停在无法推进的阶段。当前计划、Segment、Task 与媒体全程显式传递 `editScriptId + segmentId`。
- 核心计划曾让模型回传 UUID，Canvas、对白、最终时间线与环境音又以 ID 作为缺名 fallback；当前 raw 模型协议只使用名称/短引用，服务端是唯一 identity resolver，UI 不回显 ID。
- 章节规划与共享资产生成曾被放进同一并行 Operation Group；图片 Task 完成时，另一个章节的 requirement 可能尚未提交，完成投影只能更新当时已存在的行，迟到行永久停在 pending。首次改为串行后，Canvas 仍根据“已出现一个资产/脚本”提前挂载生成按钮并预取收费 plan，服务端只能以 episode gate 的 500 拒绝。旧 Golden 只证明 Task 时序，没有保持浏览器错误清洁。当前防线删除并行组，并让 Canvas 动作只消费 Workflow `allowedOperationIds`；完整 Journey 同时断言资产 Task 创建时间与零浏览器 5xx。
- 本次是不兼容的 D 类协议切换。用户已决定废弃旧项目与旧数据，因此不提供 migration、backfill、fallback 或双轨 parser；新系统对旧形状显式失败。

## 修改检查表

1. 字段是否属于动作/表演/声音/连续性或三项镜头执行决策？
2. 是否重新引入 Panel、分镜图、空间档案、双视频模式或第二可编辑 Prompt？
3. Segment identity、`inputSignature`、参考图顺序和 Task owner 是否稳定且 fail closed？
4. 参考图超限是否显式失败，`generateAudio` 是否始终为 true？
