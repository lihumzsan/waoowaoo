---
name: music-direction
description: Design narrative score windows and author provider-ready prompt or composition-plan music instructions.
---

# 音乐与配乐设计

## 作用

根据项目中已经锁定的剧情、最终视频提示词、剪辑事实和真实成片时间线，决定哪里需要配乐、哪里不需要配乐，并直接写出最终可执行的音乐指令。你是 cue 选择、音乐结构、Caption 和歌词的唯一创作者；执行层只校验、冻结、映射、生成和合成，不会改写、补全或解析出另一版音乐设计。

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
- `durationSeconds` 只能从非空的 `durationSecondsOptions` 选择，或在注入的 `durationSecondsRange` 内选择整数。时间线配乐使用 Schema 的 `startSeconds`；各 Prompt cue 不得重叠，且已知真实时间线时不能越过其 duration。
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
- 最终 mixer 按 `startMs` 放置、按 plan 总时长裁掉编码 padding、在 cue 间保留静音，并对完成的 BGM 总线进行对白 ducking。不要在 Composition Plan 中补偿这些机械行为。
- 不要输出 Composition Plan variant 不接受的 `prompt`、`durationSeconds`、`vocalMode`、`lyrics`、`genre`、`mood`、`bpm`、`keyScale`、`timeSignature`、`startSeconds`、`purpose`、`musicalDirection` 或 `dialogueSafety`。

## 音乐理论与叙事

- 区分画面表面情绪与音乐应承载的深层立场：冷静旁观、主观压力、共情支持、程序性控制或最低存在感。
- 根据叙事决定速度、拍号、节拍显著度、音高组织、调式、关键音程、和声语法、终止策略与和声节奏，不机械追随每个剪辑点。
- 配器从故事、时代、空间、对白密度和情绪推导。为音色说明音区、角色和演奏方式，避免只写空泛的品质词。
- 高潮不等于预告片撞击、英雄铜管、凯旋节奏、浪漫弦乐膨胀或俗套终止；除非剧情明确支持，应主动排除。
- BGM 不替代环境声、拟音、对白或同步音效。不要把画面动作逐个字面配成音乐 hit。

## 返回音频生成批次

- 唯一专业结果是运行时注入 Schema 约束的一份 `outputKind: "audio_generation_batch"` 严格对象。机器 Schema 是字段、必填项、层级与枚举的唯一权威；本 Skill 不复制 JSON 模板。
- `decision: "produce"` 时，每个 cue 是一个 `mediaType: "audio"`、`audioKind: "music"` item；按当前 `generationMode` 只输出对应 variant 的字段。BGM 使用机器 Schema 允许的 `schemaId`。
- `decision: "no_audio"` 时 `items` 必须为空，并在 Schema 允许的说明字段中写清叙事理由。
- 输出前逐字段对照注入 Schema：包含全部 required 字段、不含 unknown 字段、`itemId` 唯一、展开后的 count 不超过批次限制。不要从本 Skill 的 prose 猜字段。

## 边界

本 Skill 是音乐 Caption、歌词、Composition Plan、cue 窗口和混音意图的单一 writer。模型选择、能力校验、Operation Plan、Task、durable provider invocation、日志错误码、Resource 终态和最终合成全部由系统既有统一链路负责；不得另建 prompt rewrite 服务，不得调用 Provider 的自动 plan/video-to-music 能力制造第二个创作者。

## 环境音效模式

环境音效不是 `productionCapabilities.music.generationMode` 的第三种音乐模式。目标为环境音效时仍使用同一 `audio_generation_batch`，但每个 item 按注入 Schema 使用 `audioKind: "sound"` 与声音 Resource schema。`prompt` 是最终可执行的环境声指令，只描述一个可独立听见的事件或连续声场：地点、声源、距离、空间反射、强弱变化和需要保留的自然底噪；不要写旋律、和声、节拍、歌词或配器。

- 只读取非空的 `productionCapabilities.sound`；能力为空时停止提交，不猜测模型、时长或格式。
- `durationSeconds` 必须落在注入范围内，默认选择能完整听出事件起承转合的最短时长；每个 item 只生成一个 sound cue，不把无关事件拼进同一条指令。
- 环境音效不接受 `references`；需要多个事件时拆成多个独立 item。不要输出机器 Schema 未声明的格式字段。
- `negativePrompt` 只用于排除音乐、人声、对白、歌唱、节拍循环、合成器铺底、爆音削波和不需要的机械噪声，不用它补充正向事件描述。
