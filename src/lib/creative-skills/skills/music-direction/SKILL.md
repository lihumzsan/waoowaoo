---
name: music-direction
description: Use when creating narrative music, environmental sounds, or voice previews for confirmed characters.
---

# 音乐与声音设计

## 作用

根据当前目标创作配乐、环境音效或已确认人物的音色试听。你是音乐 cue、Caption、歌词、声音描述和试听台词的唯一创作者；执行层只校验、冻结、映射、生成和合成，不会改写或补全创作输入。配乐判断使用已经锁定的剧情、最终视频提示词、剪辑事实和真实成片时间线。

先按用户目标选择音频类型。人物音色请求直接使用下方“人物音色设计”，环境音请求使用“环境音效模式”；只有音乐请求才应用配乐窗口、音乐生成模式与混音规则。三种类型共享同一严格音频批次结果，不共享各自的创作参数。

## 事实边界

- 优先读取项目文件夹中最终视频提示词、剧本、创作方向与成片 Resource；剧情理解来自这些锁定文本，精确时间边界来自 `score_timeline` 视频 Resource 的真实 duration。
- 没有实际提供视频帧或音轨时，不声称观看或听取了它们。可以基于最终视频提示词规划剧情配乐，但必须如实区分文本事实与实际视听观察。
- 只使用 Wao 提供的 canonical Resource id + contentVersion，不猜测路径或 identity。Composition Plan item 必须引用恰好一个 `channel: "context"`、`role: "score_timeline"` 的完整待配乐视频；Prompt item 的 references 只按机器 Schema 与注入能力使用。
- Creative Direction 非空时，把与叙事、导演、剪辑、声音和视觉节奏有关的已采纳政策转译为音乐决定，不能只照抄形容词。
- `name`、`overview`、`globalContinuity`、`assumptions`、`warnings` 等用户可见内容跟随用户与项目的语言，不固定为某一种自然语言。

## 先决定“哪里需要音乐”

- 从人物压力、关系变化、信息揭示、风险、动作强度、对白密度、环境真实感和段落转换判断音乐是否有叙事价值。
- 不默认全片铺满，也不默认一定要有音乐。不配乐时返回 `decision: "no_audio"` 与空 `items`；需要配乐时使用 `decision: "produce"`，且至少包含一个 item。
- cue 是一次独立生成并放到时间线上的完整乐段。可以只为任意多个不连续窗口创作 cue；没有 cue 的部分由最终 mixer 保持数字静音，不生成一条全片音乐再裁剪。
- cue 数量只由剧情与听觉连续性决定，不设置创作上限。避免因镜头切换机械切曲；需要共享主题、音色、混响和运动惯性的连续段落应设计为同一个 cue。
- 独立 cue 不共享生成状态。跨 cue 的统一感来自 `globalContinuity` 以及兼容的调性世界、速度范围、配器家族、音色、空间和母题设计，不能假装 Provider 记住上一段。

## 只按注入能力选择生成模式

先读取非空的 `productionCapabilities.music`，再读取其 `generationMode`。音乐能力只有以下两个穷尽模式：

- `prompt`：按“Prompt 模式”创作。
- `composition_plan`：按“Composition Plan 模式”创作。

能力为空、`generationMode` 缺失或值不属于以上两种时停止提交。只使用注入的 capability 数据和本 Turn 注入的严格输出 Schema；不根据 Provider、模型名称、文件存在、历史默认值或输出内容猜测模式，也不自动换模式或降级。

## Prompt 模式

- 每个音乐 item 的 `prompt` 是最终 provider-ready Caption。直接写清音乐风格边界、配器与音色、速度与律动、调性与和声、结构弧线、演唱安排、空间和混音目标、对白安全及需要排除的俗套；不要把待改写的草稿或需要下游解析的计划塞给执行层。
- Caption 必须非空且不超过注入的 `promptMaxCharacters`，以 `promptTargetCharacters` 作为内容密度参考。执行层会逐字冻结并发送 `prompt`，不会再重写、扩写、摘要或从其他字段拼装 Caption。
- `durationSeconds` 只能从非空的 `durationSecondsOptions` 选择，或在注入的 `durationSecondsRange` 内选择整数。时间线配乐使用 Schema 的 `startSeconds` 记录创作起点；各 Prompt cue 不得重叠，且已知真实时间线时不能越过其 duration。生成不会自动装配，最终位置必须在 `merge_videos.musicCues` 显式提交。
- `vocalMode` 只能从注入的 `vocalModeOptions` 选择。请求需要人声但能力不含 `vocal`，或请求需要纯器乐但能力不含 `instrumental` 时，停止提交而不是擅自改变创作意图。
- `vocalMode: "vocal"` 时必须同时写 `lyrics`：内容非空、完整、可直接演唱，并用清晰的方括号段落标签组织段落。`lyrics` 是最终 provider-ready 歌词，执行层逐字冻结，不会生成或改写歌词。
- `vocalMode: "instrumental"` 时必须省略 `lyrics`，不能输出空字符串、占位词或器乐标记。
- 只有注入能力与机器 Schema 同时支持时才使用结构化音乐参数：`bpm` 落在 `bpmRange` 内，`keyScale` 来自 `keyScaleOptions`，`timeSignature` 来自 `timeSignatureOptions`。能力未声明对应选项时省略字段，把需要的音乐信息直接写进最终 Caption；字段与 Caption 必须一致。
- `references`、`purpose`、`musicalDirection`、`dialogueSafety` 等可选字段只在当前机器 Schema 允许且有真实事实时使用。不要发明能力字段，也不要输出 Prompt variant 不接受的 `compositionPlan`、`startMs`、`fadeInMs`、`fadeOutMs` 或 `gainDb`。

## Composition Plan 模式

### Cue 与 chunk

- 一个 item 是一个 **cue**；`startMs` 决定该 cue 在完整视频中的绝对起点。
- 一个 cue 的 `compositionPlan.chunks` 是同一次生成内部按顺序连续发生的音乐段落。chunk 不是多条提示词或多次生成；所有 chunks 共同生成一条连续音频。
- chunk 数量按 cue 内真正发生的音乐结构选择。不要为了显得精细而按每个镜头机械拆分。
- cue 时长只有一个来源：所有 `chunk.durationMs` 之和。不要另写 `durationSeconds` 或结束时间。
- Composition Plan 能控制 chunk 时长，但不能保证 chunk 内逐 beat、逐 hit 的毫秒事件。短促节奏、重音或转折写进对应 chunk 的 `text` 与 styles，不承诺具体毫秒命中画面。

### 能力硬边界

- 所有限制均读取 `productionCapabilities.music`：`maxChunks`、`minChunkDurationMs`、`maxChunkDurationMs`、`minPlanDurationMs`、`maxPlanDurationMs`、`maxPositiveStyles`、`maxNegativeStyles` 与 `contextAdherenceOptions`。
- 每个 chunk 与 plan 总时长都必须在注入范围内，styles 数量不能超过注入上限，`contextAdherence` 只能从注入选项选择。任一必要限制为空或与计划不兼容时停止提交，不猜测、不截断、不自动换模式。
- styles 使用 Provider 要求的英文；Composition Plan BGM 为纯器乐，不写歌词。
- 不在 styles、段落文字或方向中点名真实艺人、乐队、受版权保护的歌曲或复制歌词。

### 写每个 chunk

- `text` 用英文方括号标注段落功能，再写清这一段的音乐行为；纯器乐段不写歌词。
- `positiveStyles` 具体描述流派边界、配器、音区、织体、节奏密度、速度或 BPM、调性/调式、动态、空间与演奏法。第一 chunk 建立整条 cue 的总体音色与风格。
- `negativeStyles` 主动排除错误情绪、错误配器、俗套、过密频段和人声；不要依赖一个笼统的 `instrumental` 解决所有排除项。
- `contextAdherence` 表示该 chunk 对相邻上下文的跟随强度。需要连续主题和自然演化时选择能力允许的较高值；只有确需明显结构转向时才降低，同时保持整条 cue 的音乐逻辑。
- 相邻 chunks 应构成可听懂的弧线：建立、转化、加强、耗减、悬置或解决。明确哪些材料保持、哪些参数变化，避免每段另起新歌。

### 混音与时间线

- 为对白和旁白保留中频空间，控制打击瞬态、镲片、密集旋律与持续高能占用。
- 每个 item 按机器 Schema 填写 `startMs`、`fadeInMs`、`fadeOutMs` 和 `gainDb`。淡入淡出都不能超过该 cue 的 Composition Plan 总时长。
- 每个 item 引用恰好一个 canonical `score_timeline` context reference；`startMs + sum(chunk.durationMs)` 不能越过该视频的真实 duration。
- 多个 cue 可以重叠；重叠会由 mixer 真实叠加独立生成的音乐，只在确需分层且音乐关系经过设计时使用。
- 最终 mixer 只消费 `merge_videos.musicCues` 显式冻结的放置与时长，在 cue 间保留静音，并对完成的 BGM 总线进行对白 ducking。不要在 Composition Plan 中补偿这些机械行为。
- 不要输出 Composition Plan variant 不接受的 `prompt`、`durationSeconds`、`vocalMode`、`lyrics`、`genre`、`mood`、`bpm`、`keyScale`、`timeSignature`、`startSeconds`、`purpose`、`musicalDirection` 或 `dialogueSafety`。

## 音乐理论与叙事

- 区分画面表面情绪与音乐应承载的深层立场：冷静旁观、主观压力、共情支持、程序性控制或最低存在感。
- 根据叙事决定速度、拍号、节拍显著度、音高组织、调式、关键音程、和声语法、终止策略与和声节奏，不机械追随每个剪辑点。
- 配器从故事、时代、空间、对白密度和情绪推导。为音色说明音区、角色和演奏方式，避免只写空泛的品质词。
- 高潮不等于预告片撞击、英雄铜管、凯旋节奏、浪漫弦乐膨胀或俗套终止；除非剧情明确支持，应主动排除。
- BGM 不替代环境声、拟音、对白或同步音效。不要把画面动作逐个字面配成音乐 hit。

## 返回音频生成批次

- 为视频创作任何模式的配乐时，用机器 Schema 允许的 `score_timeline` context 引用记录精确成片版本。音乐 ready 后，通过现有 `merge_videos` 对该单个视频使用 `audioMode: "preserve"`，每个 `musicCues` 项显式提交精确音乐版本及 `startMs`、`durationMs`、`fadeInMs`、`fadeOutMs`、`gainDb`；Prompt 与 Composition Plan 使用同一合成契约。按 ready 媒体的实测时长确定可用窗口，不能越过音乐或视频边界。不省略参数，也不假定生成参数会自动决定最终位置。

- 唯一专业结果是运行时注入 Schema 约束的一份 `outputKind: "audio_generation_batch"` 严格对象。机器 Schema 是字段、必填项、层级与枚举的唯一权威；本 Skill 不复制 JSON 模板。
- `decision: "produce"` 时，每个 item 使用其目标对应的 `audioKind` 和严格 variant。音乐 cue 使用 `audioKind: "music"`，按当前 `generationMode` 输出字段；环境音与人物音色按下方各自规则提交。
- `decision: "no_audio"` 时 `items` 必须为空，并在 Schema 允许的说明字段中写清叙事理由。
- 输出前逐字段对照注入 Schema：包含全部 required 字段、不含 unknown 字段、`itemId` 唯一、展开后的 count 不超过批次限制。不要从本 Skill 的 prose 猜字段。

## 边界

主 Agent 使用本 Skill 写出唯一音频专业结果，包括音乐 Caption、歌词、Composition Plan、cue 窗口、混音意图，以及人物声音描述和试听台词。模型选择、能力校验、Operation Plan、Task、durable provider invocation、日志错误码、Resource 终态和最终合成全部由系统既有统一链路负责；不得另建 prompt rewrite 服务，不得调用 Provider 的自动 plan/video-to-music 能力制造第二个创作者。

## 环境音效模式

环境音效不是 `productionCapabilities.music.generationMode` 的第三种音乐模式。目标为环境音效时仍使用同一 `audio_generation_batch`，但每个 item 按注入 Schema 使用 `audioKind: "sound"` 与声音 Resource schema。`prompt` 是最终可执行的环境声指令，只描述一个可独立听见的事件或连续声场：地点、声源、距离、空间反射、强弱变化和需要保留的自然底噪；不要写旋律、和声、节拍、歌词或配器。

- 只读取非空的 `productionCapabilities.sound`；能力为空时停止提交，不猜测模型、时长或格式。
- `durationSeconds` 必须落在注入范围内，默认选择能完整听出事件起承转合的最短时长；每个 item 只生成一个 sound cue，不把无关事件拼进同一条指令。
- 环境音效不接受 `references`；需要多个事件时拆成多个独立 item。不要输出机器 Schema 未声明的格式字段。
- `negativePrompt` 只用于排除音乐、人声、对白、歌唱、节拍循环、合成器铺底、爆音削波和不需要的机械噪声，不用它补充正向事件描述。

## 人物音色设计

- 在用户已授权的声音设计、候选比较，或明确包含人物音色的完整制作范围内生成试听。普通视频请求和缺少音色本身不授权新增声音生产；可以说明缺口并建议设计。先读取非空的 `productionCapabilities.voice`，确认 `useCase=voice_design`。
- **先人物、后音色。** 通过 `list_resources` / `get_resource` 读取用户指定的 ready `project.character_image` 精确版本，以及该人物已确认的设定、剧本和创作方向。新生成的人物资产先完成既有视觉资产验收，再设计依赖它的声音；已有已确认人物直接复用。人物目标不明确时先消除指代歧义，不从文件名、画布邻近或最近记录猜身份。
- **声音描述由你写。** 把已确认的人物设定和用户声音偏好转成最终 `prompt`，具体描述年龄感、音区、质感、口音、语速与表达习惯；不要求用户填写专业参数。用户明确给出的最终声音描述逐字保留，直到用户要求修改。资料未支持的音色细节作为可修改的创作选择说明，不伪装成人物原有事实。多个方向分别写出可听辨的差异，数量遵循本次请求。
- **试听台词默认由你写。** `previewText` 只包含将被逐字朗读的内容。用户给过试听台词时原样使用；没有提供时，从该人物已有对白中选择完整、自然的短句，没有适合的对白则代拟能展示声音特点的短句并说明。不要把“先提供试听台词”设为生成前提，也不要把人物说明、说话指令或舞台动作混入台词。比较候选时共用同一台词与语言；`language` 从注入能力中选择并与台词语言一致。
- 以自然、能听清音色且适合后续 H3 参考的短样本为创作目标，兼顾当前视频能力声明的单段最低时长与总参考音频预算；多人声音将同时使用时，为全部样本留出预算。文字长度遵守注入能力，不靠字数承诺实际秒数，也不擅自删改用户提供的台词来凑时长。只有目标人物、关键声音方向或逐字内容存在实质歧义时才补充询问；其余创作细节直接完成并说明，用户要求先确认时才先呈现“声音描述 / 试听台词”两栏等待修改。
- 每个 item 使用 `audioKind=voice`、`schemaId=project.voice_reference`，并携带恰好一个 `channel=context, role=voice_character` reference，指向该 ready 人物图片的精确 `resourceId + contentVersion`。它记录人物来源，不把人物图片传给声音 Provider。其余字段严格服从注入 Schema；不附加媒体通道引用、配乐参数、时间线、`durationSeconds` 或模型标识。
- 生成完成后交付每个 ready 候选的可试听音频，并同时呈现该 Resource 的声音描述、试听台词和语言，让用户能比较和修改。显示内容读取 `voiceDesign` View，不从聊天草稿重建，也不把名称当作人物归属。
- 生成候选不等于采用。用户明确采用某个候选时，读取所属人物当前 `characterVoiceSelection.revision`，通过 `select_character_voice` 提交人物 ID、候选音频 ID、精确 `voiceContentVersion` 与该 `expectedSelectionRevision`；界面已经完成采用时直接读取正式 View，不重复提交。冲突时读取实际选择并说明，不用旧 revision 覆盖新选择。成功后以后续读取的 `characterVoiceSelection.selectedVoice` 为准，不用聊天承诺、候选顺序或 `voiceDesign.isSelected` 另建选择事实。
- 用户修改声音描述、试听台词或语言时，以修改后的完整输入生成新候选，保留同一精确人物来源；原候选和当前已选版本不变，新候选仍需用户明确采用。试听台词用于展示声音，不是剧本修改，也不能成为后续视频的正式对白。
- 后续 H3 按视频 Skill 从每段实际说话人的 `characterVoiceSelection.selectedVoice` 读取已采用的精确版本；音色采用本身不授权视频制作。使用前检查 `available`、真实时长和当前视频能力；不合要求时说明原因，不自动替换、裁剪、补静音或声称音色已锁定。
