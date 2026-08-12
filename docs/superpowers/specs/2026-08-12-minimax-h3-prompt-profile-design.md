# MiniMax H3 专用 Prompt Profile 设计

## 背景

Waoowaoo 已经通过 `comfyui::minimax-h3-fast` 支持 MiniMax H3 的首帧图生视频和首尾帧视频生成。当前 `video-direction` Skill 负责为所有视频模型编写一份完整最终 Prompt，服务端把该 Prompt 逐字冻结并交给所选 Provider。H3 adapter 同样把 Prompt 原样写入 `MiniMaxH3ImageToVideo` 节点。

现有通用导演 Prompt 能表达镜头、表演、声音和跨 Segment 连续性，但没有使用 H3 更明确的多模态字段、参考帧对齐句式、说话人标识和对白标签。用户提供的 H3 指南以及一份外部 Prompt 示例说明，H3 更适合消费具有以下结构的英文 Prompt：

- `integrated_multimodal_description`
- `overall_soundscape`
- `non_diegetic_music`
- I2VA/FL2VA 参考帧对齐说明
- `[Shot N]` 和递增时间戳
- 稳定说话人 ID 与 `<d>[Language]...</d>` 对白

本设计把这些规则作为 H3 专用 Prompt 方言接入，同时保持现有创作所有权和执行链不变。

## 目标

- 让主 Agent 在项目选用 H3 时，直接一次性写出 H3 可执行的最终 Prompt。
- 让 Prompt 方言由视频模型 capability registry 显式声明，而不是由共享调用方根据 `modelKey`、Provider 名称或实现文件猜测。
- 保留 `video-direction` 作为唯一视频导演 Skill，保留主 Agent 作为完整最终 Prompt 的唯一 writer。
- 仅为 H3 的 `first_frame` 与 `first_last_frame` 模式启用 H3 格式。
- H3 只生成对白、动作声、环境声和非语言人声；背景配乐继续由独立音乐生产链路唯一负责。
- 保持 H3 adapter、工作流、Planner、Task payload 和异步终态协议不变。

## 非目标

- 不增加 H3 文生视频 T2VA。
- 不增加只有尾帧的 L2VA。
- 不把普通参考图模式推断成首帧模式。
- 不在服务端、Provider adapter 或提交层编译、改写或补写 Prompt。
- 不为 H3 创建第二个专业 Skill、第二个 Agent、第二份生成对象或平行导演结果。
- 不改变独立 BGM 的生成、混音或采用流程。
- 不把教程中尚未经过真实 H3 验证的写法提升为跨模型全局规则。

## 已确认产品决策

1. H3 Prompt 的 `non_diegetic_music` 固定写为 `N/A`。
2. H3 原生音轨只承载对白、动作声、环境声和非语言人声。
3. BGM 仍由 `music-direction` 与 `create_audio` 唯一负责。
4. Prompt Profile 由模型能力显式声明；H3 使用 `minimax_h3_v1`，其他当前视频模型使用 `generic_v1`。
5. H3 Profile 不覆盖通用导演方法，只决定最终 Provider Prompt 的表达方言。

## 权威边界与不变量

本变更复用现有模块边界，不改变权威入口：

- `src/lib/creative-skills/**` 继续拥有专业方法与完整最终 Prompt。
- 主 Agent 继续是每个 `video_generation_batch` 的唯一 writer。
- `src/lib/ai-registry/**` 继续拥有模型 capability 声明及合法值验证。
- `src/lib/project-production-context.ts` 继续是项目生产能力的唯一只读投影。
- `create_video` 继续接收 Agent 已完成的 exact items，Planner 只校验并逐字冻结。
- `src/lib/ai-providers/comfyui/**` 继续只映射 canonical options、媒体和已经冻结的 Prompt，不参与创作。

变更前后数量保持：

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 视频专业 Prompt writer | 1（主 Agent） | 1（主 Agent） |
| 视频专业 Skill | 1（`video-direction`） | 1（`video-direction`） |
| 媒体提交入口 | 1（`create_video`） | 1（`create_video`） |
| Provider Prompt 编译器 | 0 | 0 |
| H3 adapter 执行入口 | 1 | 1 |

因此不更新 `docs/architecture/**`：本设计没有新增或删除架构不变量，也没有改变权威入口归属。它只补全既有 registry capability 和唯一 Skill 的模型专用表达规则。

## 方案比较

### 采用：能力声明驱动的 H3 Prompt Profile

视频模型 registry 声明 `promptProfile`，项目生产上下文将其直接注入主 Agent，`video-direction` 按 profile 穷尽选择最终 Prompt 方言。

优点：

- 符合 capability registry 和专业单 writer 边界。
- 不以模型名称或 Provider 身份推断能力。
- H3 差异不会污染其他视频模型。
- 后续新增经验证的 Prompt 方言时可在同一穷尽类型上扩展。

### 拒绝：在 Skill 中判断 H3 的 `modelKey`

虽然修改较少，但会让共享创作 Skill 根据实现 identity 猜能力，新增同方言模型时还需继续添加特殊分支。

### 拒绝：在 H3 adapter 或提交层转换 Prompt

这会形成服务端第二个创作 writer，违反 CS-05、CS-07、APO-07、APO-08 和 WR-16，并重现仓库已经记录过的服务端拼接 Prompt 问题。

## Capability 契约

在 `src/lib/ai-registry/types.ts` 定义穷尽类型：

```ts
export type VideoPromptProfile =
  | 'generic_v1'
  | 'minimax_h3_v1'
```

`VideoCapabilities` 增加必需字段：

```ts
export interface VideoCapabilities {
  promptProfile: VideoPromptProfile
  // existing fields remain unchanged
}
```

模型目录要求：

- `comfyui::minimax-h3-fast` 显式声明 `promptProfile: 'minimax_h3_v1'`。
- 所有其他当前注册视频模型显式声明 `promptProfile: 'generic_v1'`。
- capability validator 只接受上述穷尽值并拒绝缺失或未知值。
- 不从 `provider`、`modelId`、`generationModeOptions` 或工作流节点反推 profile。

`ProjectProductionCapabilities.video` 增加：

```ts
readonly promptProfile: VideoPromptProfile
```

`resolveProductionCapabilities` 从已验证的视频 capability 原样投影该字段。`ProjectProductionContext.schemaVersion` 从 `5` 升为 `6`，所有构造该上下文的生产路径和有效测试 fixture 一次性切换，不保留旧版本分支。

如果所选视频模型没有合法 `promptProfile`，其 capability registry 注册必须失败；项目生产上下文不得补默认值。主 Agent 收到 `productionCapabilities.video = null` 时继续按现有边界停止可执行视频交付。

## Skill 选择与数据流

```text
视频模型 capability registry
  -> promptProfile
  -> ProjectProductionContext.productionCapabilities.video
  -> 当前 Turn 注入主 Agent
  -> video-direction 选择唯一最终表达方言
  -> 一个 video_generation_batch
  -> create_video 原样校验与冻结
  -> ComfyUI H3 adapter 原样写入工作流 prompt
```

`video-direction` 的导演推理顺序不变：

1. 以剧本、用户要求、已确认资产和已采纳 Creative Direction 为唯一剧情事实。
2. 建立整片时间线和内部镜头入口/出口状态。
3. 使用最少合法 Segment 装载完整时间线。
4. 为每个 Segment 选择一个受支持的输入模式和精确 Resource 引用。
5. 根据 `promptProfile` 把同一导演事实直接写成唯一最终 Prompt。

`generic_v1` 保持现有 Prompt 格式。`minimax_h3_v1` 使用下述专用契约。未知 profile 必须停止，不得回落到 `generic_v1`。

## H3 通用写作契约

- 除对白原文和画面内文字外，Prompt 全部使用英文。
- 每个 Prompt 只有一个 `integrated_multimodal_description`、一个 `overall_soundscape` 和一个 `non_diegetic_music`。
- `non_diegetic_music` 固定为 `N/A`，不得描述任何乐器、旋律、节拍、BPM 或配乐动态。
- H3 Prompt 不发送 `[风格]`、`[时长]`、`[参考]`、`[入口状态]`、`[出口状态]`、`[整体声音]`、`[约束]` 等通用标签；其中适用事实自然写进 H3 三字段。
- Prompt 中的 `<Picture 1>`、`<Picture 2>` 只表达本 Segment 的帧引用顺序；结构化 `references` 继续使用 canonical `resourceId + contentVersion + role + channel`。
- 每个 Shot 首句按“景别与机位关系 -> 唯一主运镜及速度/幅度 -> 主体落位 -> 当前动作”的顺序表达。
- 每个 Shot 只有一种主要运镜。附加描述不得形成与主运镜竞争的第二机身运动。
- 每个 Shot 都包含可见入口、一个向前的新变化和可见落点。
- 后一镜头不能换角度重演前一镜头已经完成的动作。
- 后续镜头使用严格递增的 `At 00:SS.mmm` 时间戳；最后一个 Shot 明确持续或落到该 Segment 的结束时间。
- 抽象情绪词转换为低幅度、可观察的呼吸、眉眼、嘴唇、下颌、肩颈、手部、步幅、身体朝向和世内视线变化。
- 有人物的 Prompt 继续明确：人物视线落在场景内对象上，不与镜头交汇；剧情明确打破第四面墙时除外。
- 默认使用硬切。禁止叠化、交叉溶解、淡入淡出、透明重叠和主体变形来掩盖不连续。
- 不生成字幕、标题、水印、拼贴、分屏或额外人物。

### 混合媒介稳定

当画面同时包含 2D、3D、写实或其他不同媒介时，Shot 1 必须声明整段稳定规则。规则至少明确主体的渲染媒介、轮廓/材质、颜色、比例、地面接触和场景光照保持一致，防止主体在视频中逐渐改变媒介。

示例句法：

```text
The girl remains consistently rendered as clean 2D cartoon line art within the photorealistic park, with stable outlines, flat colors, scale, ground contact, and scene lighting throughout the video.
```

这只是写作方法示例，不作为固定英文模板逐字复制；实际内容必须来自当前镜头事实。

## `first_frame`：I2VA Prompt

结构：

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] ...
overall_soundscape: ...
non_diegetic_music: N/A
```

约束：

- `references` 中恰好有一张 `channel=image, role=first_frame` 图片，没有 `last_frame` 或普通 reference 媒体。
- `<Picture 1>` 唯一对应该首帧。
- Shot 1 明确保持 Picture 1 中人物身份、外貌、服装、道具状态、主体位置和场景结构。
- 动作结构为“首帧锚定 -> 动作开始 -> 连续发展 -> 结果或反应”。
- 同一 Segment 可以包含多个镜头；切镜必须带来新的信息尺度、视角、场景或时间，并继续推进动作。
- 对资产板式首帧，参考图只锁定身份与设计；导演事实仍应避免无剧情依据的正面居中、僵硬姿态或直视镜头。

## `first_last_frame`：FL2VA Prompt

结构：

```text
How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 0.00-second mark of the target video; <Picture 2> (from [Shot 1]) aligns with the N.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] ...
overall_soundscape: ...
non_diegetic_music: N/A
```

`N.00` 使用该 item 的整数 `durationSeconds` 并保留两位小数。

约束：

- `references` 中恰好有一张 `first_frame` 和一张 `last_frame` 图片，顺序分别对应 `<Picture 1>` 和 `<Picture 2>`，没有其他 reference 媒体。
- FL2VA 使用一个连续 Shot，不在首尾帧插值段中切镜。
- 动作结构为“首帧状态 -> 可观察的连续物理动作链 -> 差异逐步缩小 -> 尾帧着陆”。
- 最后一句明确落入 Picture 2 的人物姿态、道具状态、空间关系、镜头角度、光线和构图。
- 首尾帧不存在合理连续物理路径时，不构造该 item；必须要求调整素材或创意。
- 禁止用变形、叠化、瞬移、透明融合或不可观察的抽象变化强行连接首尾帧。

## 对白、旁白与声音

### 说话人身份

- 同一人物在整个生成批次中保持同一 `(S1)`、`(S2)` 编号。
- 每个独立 Segment 首次出现该说话人时，重新描述年龄、性别、音高、音色、语速和必要口音，因为各 Segment 是彼此独立的 Provider 任务。
- 对白逐字保留来源，不能翻译、润色、缩写或补写。
- 说话人必须出镜或明确为画外来源，对白必须能在所在时间块结束前以自然语速说完。

对白格式：

```text
The young man with a low, restrained voice (S1) says: <d>[Chinese] 该走了。</d>
```

旁白格式：

```text
The man (S1) says in an off-screen voiceover: <d>[Chinese] ...</d>, while every visible character keeps their lips completely closed.
```

跨镜对白应明确声音持续关系；只有真实对白被 Segment 结尾截断且来源剧情明确要求时才使用 `<cutoff>`。不得为了迁就时长主动截断本可通过正确装段完整表达的对白。

### `overall_soundscape`

- 使用一至四句英文概括当前 Segment 的环境声、动作声和非语言人声。
- 声音必须跟随动作变化，例如脚步逐渐减速并停止，而不是只列静态音效名称。
- 不重复 `integrated_multimodal_description` 中的对白或歌唱原文。
- 不包含角色听不到的背景配乐。
- 无现场声音只有在来源明确要求完全静音时才写 `N/A`。

## 多 Segment 连续性

内部状态表和跨 Segment 接缝规则继续适用，但不作为 H3 的平行输出字段：

- 非首段的入口人物、服装、身体状态、位置、朝向、视线、道具、环境和持续声音自然写进 Shot 1。
- 非末段的出口状态自然写进最后动作的可见落点。
- 后段从下一个新节拍开始，不复述或重演前段已完成动作。
- 相邻 Segment 仍要求时间向前、状态兼容且具有可剪接的景别变化。
- 不宣称两个独立生成 Segment 之间具有帧级无缝插值。

## 明确失败条件

主 Agent 在以下情况停止构造可执行 H3 item，不得改用 `generic_v1`、改变输入模式或静默删除事实：

- `productionCapabilities.video.promptProfile` 缺失、未知或不是 `minimax_h3_v1`。
- H3 item 无法选择唯一的 `first_frame` 或 `first_last_frame` 模式。
- `first_frame` 模式的首帧数量不是一张，或混入末帧/普通参考媒体。
- `first_last_frame` 模式缺少任一帧、角色错误、顺序错误、多出帧或混入其他参考媒体。
- 首尾帧之间不存在合理连续的物理路径。
- 来源对白无法在 Segment 时长内自然说完，且无法通过合法的整片时间线和 Segment 装载解决。
- 最终 Prompt 无法同时满足英文主体、原文对白和 `non_diegetic_music: N/A`。
- 必需生产能力为空。

Planner 继续在报价和副作用前对结构化引用、输入模式和能力做最终确定性校验。Skill 的停止规则不能替代 Planner，也不能成为一条新的服务端状态解释。

## 文件改动

### `src/lib/ai-registry/types.ts`

- 新增 `VideoPromptProfile` 穷尽类型。
- 给 `VideoCapabilities` 增加必需 `promptProfile`。
- 把字段加入视频 capability 允许字段集。
- 验证缺失或未知值。

### `src/lib/ai-providers/*/models.ts`

- 所有生产视频 capability 条目显式声明 profile。
- ComfyUI H3 声明 `minimax_h3_v1`。
- 其他当前视频模型声明 `generic_v1`。

具体文件集合以生产 capability catalog 的穷尽枚举结果为准，不用硬编码一份文档文件清单作为第二权威。

### `src/lib/project-production-context.ts`

- 将 `promptProfile` 原样投影进 `productionCapabilities.video`。
- `schemaVersion` 一次性由 5 切换为 6。
- 不提供缺失 profile 的默认值或旧版本兼容分支。

### `src/lib/creative-skills/skills/video-direction/SKILL.md`

- 保留现有导演、表演、装段、参考和连续性方法。
- 增加按 `promptProfile` 穷尽选择最终 Prompt 方言的规则。
- 增加本规格已批准的 H3 I2VA、FL2VA、对白、声音、镜头句法、物理表演和混合媒介规则。
- 明确未知 profile 不得 fallback。
- 更新 Skill registry 中 `video-direction` 的版本。

### 不修改

- `src/lib/ai-providers/comfyui/h3.ts`
- `src/lib/ai-providers/comfyui/profiles.ts`
- H3 workflow JSON
- `src/lib/workspace-resource/generation-request.ts`
- create-video Operation、Task payload、provider invocation fence 和异步终态

如果实现调查发现上述“不修改”文件必须改变才能完成目标，先停止并重新评估设计，不以方便为由扩大范围。

## 验证策略

### 自动验证

只使用有独立 contract oracle 的验证：

1. capability validator 接受 `generic_v1` 和 `minimax_h3_v1`，拒绝缺失值与未知值。
2. 从生产 ComfyUI H3 registry 解析出的 profile 等于 `minimax_h3_v1`。
3. 对生产 capability catalog 中全部视频模型做 conformance 枚举，证明每个条目显式具有一个合法 profile。
4. 项目生产上下文从 registry 原样投影 H3 profile，且格式化 Turn context 包含该事实。
5. 现有 H3 submission contract 继续证明输入 Prompt 被逐字写入 `MiniMaxH3ImageToVideo`，没有服务端改写。
6. 执行 TypeScript typecheck 和受影响的现有 contract/integration tests。

不新增以下无独立 oracle 的测试：

- 搜索 Skill 文件中是否包含固定字符串。
- 让同一 Agent 生成 Prompt，再断言它与自己写的固定 Prompt 相等。
- mock 主 Agent 或 Provider 后断言调用次数。
- 用快照固定散文格式或具体措辞。

### 真实 H3 小样

真实质量验证使用少量、可观察的 A/B 小样：

1. I2VA：人物跑步、注意到路人、逐渐减速并停下；观察身份稳定、动作顺序、三镜时间与环境声变化。
2. FL2VA：首帧闭伞、尾帧开伞；观察连续物理路径、伞的状态变化和尾帧着陆。
3. 含中文对白的 I2VA；观察发音、对白完整性、口型、说话人身份和环境声。
4. 2D 人物处于写实场景；观察轮廓、颜色、比例、地面接触和场景光照是否保持媒介稳定。
5. 对每组使用相同来源事实比较当前通用 Prompt 与 H3 Profile Prompt，记录：身份稳定、动作完成、顺序正确、尾帧一致、声音正确、是否意外生成 BGM。

真实验证必须使用当前 H3 工作流和实时运行环境；节点注册或离线 graph 构建成功不能替代生成结果。

## 完成定义

### 实现完成

- 所有生产视频模型显式声明合法 `promptProfile`。
- H3 profile 被投影到当前 Turn。
- `video-direction` 能根据已注入 profile 直接写出唯一最终 H3 Prompt。
- 服务端和 adapter 不改写 Prompt。
- 适用 typecheck、contract 和 integration 验证通过，失败与盲区如实列出。

### 阶段完成

在实现完成基础上，四类真实 H3 小样均已运行并记录结果；已确认没有意外 BGM，且 I2VA/FL2VA、对白和混合媒介的关键行为达到接受标准。存在未验证组合时只能称实现完成或局部验证完成。

本阶段不使用“彻底解决”或“不会复发”；Prompt 效果仍受模型随机性、输入图质量和真实运行环境影响。

## 来源定位

H3 写作规则来自用户提供的教程和 Prompt 示例，并经当前仓库的 H3 工作流、能力和 Prompt 原样提交链路对照。教程是依据 MiniMax 官方指南整理的第三方材料，不作为不可变 Provider API 契约；未经真实 H3 验证的细节保留为本版本 profile 的可迭代创作方法。
