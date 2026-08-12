---
name: video-direction
description: Direct screenplay-based video generation with explicit state continuity, physical performance, minimal segment count, structured shot timing, reference identity, sound relationships, and executable final prompts.
---

# 视频导演与生成设计

## 作用

把已经成立的剧情事实组织成可执行导演设计，并为每个独立生成分段写一份结构化最终提示词。本 Skill 是 `outputKind=video_generation_batch` 的唯一专业 Skill：镜头、表演、构图、声音、连续性、装段与接缝判断全部内化进每段唯一 `prompt`，最终只返回 strict `video_generation_batch`，不输出平行导演表、时间线或解释文件。

## 事实与时长权威

- 剧本、用户明确要求、已确认资产、入段状态和已采纳 Creative Direction 是唯一事实。不得新增剧本没有的人物、对白、地点、道具、动作、动机、停顿或结局；对白逐字保留。
- 精确剧本存在时，它独占事件顺序和 `mode=derive` 演出时间线。Creative Direction、题材、画幅、3D/写实风格、镜头数量、声音与转场只决定怎样呈现，不能创造额外剧情时间。
- 严格按“整片时间线 → 导演设计 → 生成装段”工作。不要先给每个镜头或节拍分配一段 Provider 时长再相加。
- `durationIntent.mode=fixed` 时，全部 Segment 时长之和必须准确等于用户总秒数。`mode=derive` 时，只按自然对白、不能并行的来源动作和来源明确要求的停顿估算最短清楚时长；并行动作不重复累加。
- 禁止用重复动作、无信息空镜、拖慢转头、额外反应、题材留白或装饰性转场填充时长。
- H3 当前合法生成时长是 4–15 秒；4 秒是合法最短 Segment，不为满足时长而添加剧本外动作。
- 系统注入的 `productionDefaults.video.vocalPerformanceMode` 是项目默认口型/声音意图；item 明确提供 `vocalPerformanceMode` 时，以 item 覆盖为准。每个新视频 item 都必须显式写出最终模式。

## 内部状态表

写提示词前，在内部为每个镜头记录入口与出口，不把状态表作为输出字段。至少检查：

- 人物：身份、服装、身体状态、情绪强度、所在位置、身体朝向、视线目标。
- 道具：持有者、位置、开合/亮灭/损坏等状态。
- 场景：时间、光线、天气、关键结构和不可突然复制的主体。
- 信息：人物与观众已经知道什么，揭示是否已经发生。
- 声音：正在持续、刚停止、需要跨镜延续或尚未出现的声音。

后一镜头入口必须等于前一镜头出口再加上本镜头的新变化。人物已经完成拿取、转身、起身、到达、开门或说完一句话后，下一镜头直接从完成状态继续，不能换景别重演。

## 导演设计

- 每个镜头承担一个明确叙事任务：建立空间、推进动作、呈现反应、揭示信息、改变关系或完成落点。
- 每个时间块围绕一个核心节拍，可以包含完成该节拍所需的因果微动作，但必须有可见入口、变化和落点。动作使用物理动词，不解释人物内心。
- 有人物的普通镜头必须写清景别、机位关系、主体落位、身体朝向、视线目标和一种主要运镜。参考图只锁定身份与设计，不继承资产板的正面居中、姿态或直视镜头。
- 相邻镜头改变信息尺度与构图；居中、对称或直视只在剧情明确需要时使用。默认把人物放在三分线或前中后景关系中，把负空间留给其视线或运动方向。
- 镜头只向前推进。后一镜头第一帧必须晚于前一镜头最后一帧；改变角度、加特写或换景别名称都不能把同一动作再展示一次。
- 同一 Segment 内可在动作进行中切镜：前镜承载动作前半，后镜从动作后半继续。不同 Segment 之间必须落在已完成节拍上，后段从下一个新节拍开始。
- 一个时间段需要多个亚秒镜头时，写成一个“快切组”：整组共享一个动作链或视觉母题、一个时间段与一条银幕方向，不逐 cut 标秒；结束后回到明确落点。快切组不得跨 Segment。
- 先判断转场是否必要。同一时空通常直接切换；只有时空跳跃、时间压缩、情绪转折或视觉母题确有收益时使用一个清楚的物理转场，并写明前镜终点和后镜起点。不得依赖叠化或主体变形。

## 可行性、连续性与因果机制

- 每个新动作、镜头和对白都必须在 Segment 终点前完成，并留下可读落点；不能在最后时刻才建立新的镜头或信息。
- 时间不够时，先删除镜头、伴随手势、装饰动作或停顿；不把对白压成不自然语速，也不重复已经完成的动作。
- 需要证明主体确实处于空间中时，加入与当前事实相符的前景遮挡、视差、脚部接触、移动光影或连续环境声；不要堆砌无关细节。
- 摄影机遵循人物位置、银幕方向和动作路线；一个镜头只保留一种主要运镜，摄影机不因追求刺激而失去地理关系。
- 先建立来源已有的正常基线，再显示原因或证据，最后呈现人物反应；反应必须由当前或前一可见事件触发，并在反应后保留可读落点。
- 主要人物固定 2–3 个区分度高、互不冲突的身份锚点；减少相近或矛盾的审美形容词，避免模型重新设计人物。
- 常见故障的最小修复是：对白拥挤则删镜头/手势/停顿；第二镜来不及则提前切点或删除；主体漂浮则补空间证明；手部穿插则明确接触几何或改成简单动作；身份漂移则减少形容词并强化稳定锚点。
- 借鉴外部案例时只复用叙事机制，必须改变人物关系、地点、路线几何、服装、对白目的、摄影、光线、道具接触和结尾中的多个表面要素，不复制案例表面。

## 表演设计

- 表演只写可见物理事实，禁止情绪形容词与内心解释（“愤怒地”“她很紧张”“想起了往事”）。把情绪翻译成呼吸、手部、下颌、肩颈、步态和视线停留时长的具体变化：写“呼吸变浅，指节抵住桌沿”，不写“她很紧张”。
- 优先低幅度描述。视频模型倾向把情绪词演成过火的表情和夸张手势；“下颌收紧、语速放慢、目光在对方脸上多停了一拍”这类小幅物理动作比高强度情绪词更稳定可控。需要强表演时，把强度写进动作本身（摔门、掀翻椅子），不写进情绪副词。
- 反应有层级。重大信息的反应按“僵住 → 确认（回看、靠近、再读一遍）→ 释放（行动、崩溃或压下去）”推进，每个镜头只承载其中一层；不许一步到位地大哭大叫，除非剧本明确写了。
- 潜台词用身体与台词的反差呈现：嘴上说“我没事”，手指在袖口里收紧。反差只能建立在剧本已有的情绪事实上，不得借此发明剧情。
- 一个镜头内最多一次情绪变化，且必须由本镜头内可见事件触发。持续情绪写成持续的身体状态（肩线一直绷着），不逐镜头重新表演一遍。
- 表演幅度按题材校准并全片保持同一基准：短剧外放但不失真，电影克制，喜剧靠节奏与停顿而非鬼脸。

## 装段与接缝

- Segment 是执行容器，不是剧情节拍。分段数最少优先：除尾部余量组合外，使用系统注入的 `productionCapabilities.video.allowedSegmentDurationsSeconds` 中的最大允许时长；尾部用最少数量的允许时长精确补齐。
- 时空切换不是缩短 Segment 的理由，应写为同一提示词内部的镜头切换。不得把未完成动作切到两次独立生成。
- 多段结果中，在内部逐项维护每段入口与出口事实：人物落位、朝向、视线、道具、环境、已完成节拍和持续声音。最终 Prompt 如何承载这些事实只由所选 Profile 决定，不在公共规则中规定字面标签。
- 逐对检查相邻 Segment：前段末镜头与后段首镜头必须有真实可见的景别变化，而且时间继续前进。只换角度、只改景别名称或重拍前段落点都不合格。
- 跨段不宣称帧级无缝插值。保持身份、服装、道具状态、空间锚点、光线与声音相容，同时让两个独立画面自然可剪。

## 参考素材

- 先从系统注入的 `productionCapabilities.video.supportedInputModes` 选择本段唯一输入模式：`text_to_video`、`first_frame`、`first_last_frame` 或 `reference`。不支持的模式不得提交，也不得自动降级。
- `text_to_video` 不传媒体参考；`first_frame` 恰好传一张 `role=first_frame` 图片；`first_last_frame` 恰好传一张 `role=first_frame` 和一张 `role=last_frame` 图片；`reference` 使用 `role=reference_image`、`reference_audio`、`reference_video`，并遵守注入的各通道数量与总文件数上限。
- 帧模式与参考模式互斥。普通参考图永远不是首帧；只有创意明确要求画面从该图开始运动时才使用 `first_frame`。末帧不能单独存在。
- Prompt 中的媒体引用语法和编号方式只由所选 Profile 决定，不得把一个 Profile 的引用标记混入另一个 Profile。
- 每个 item 的 `references` 只列当前 Segment 实际使用的 ready Resource，精确复制 `resourceId`、`contentVersion`、`role` 与 `channel`，并按所选 Profile 在 Prompt 中引用媒体的顺序排列。内部位置由服务端生成；路径不是 Resource 身份，不得提交。
- 不传无关素材，不从文件名、近似名称或描述猜身份，不让参考图的偶然构图、姿态、光线或噪点代替本段导演判断。
- `reference_audio` 是视频模型的内容条件，不是 `generateAudio` 开关，也不是后期背景音乐；当 `referenceAudioRequiresVisual=true` 时，必须同时提供至少一个 `reference_image` 或 `reference_video`。`reference_video` 是运动/内容条件，只在 `maxReferenceVideos > 0` 时使用。

## 最终 Prompt Profile

- 从系统注入的 `productionCapabilities.video.promptProfile` 选择本批次唯一最终表达方言。
- `generic_v1` 使用下方 generic_v1 最终提示词格式。
- `minimax_h3_v1` 使用下方 H3 最终 Prompt；不得同时输出通用标签格式。
- 缺失或未知 profile 时停止构造可执行 items，不得根据 `modelKey`、Provider 名称或输入模式猜测，也不得回落到 `generic_v1`。
- Profile 只改变同一导演事实的最终表达，不改变剧本、整片时间线、装段、Resource identity 或能力判定。

## minimax_h3_v1 最终 Prompt

H3 只支持当前项目声明的 `first_frame` 与 `first_last_frame`。不增加 T2VA、L2VA 或普通参考模式；不支持的输入必须停止，不得降级。

- 除对白原文和画面内文字外，Prompt 全部使用英文。
- 每个 Prompt 只有一个 `integrated_multimodal_description`、一个 `overall_soundscape` 和一个 `non_diegetic_music`。
- `non_diegetic_music: N/A` 始终固定；不得写乐器、旋律、节拍、BPM 或配乐动态，背景配乐由独立音乐链路负责。
- 不发送 `[风格]`、`[时长]`、`[参考]`、`[入口状态]`、`[出口状态]`、`[整体声音]` 或 `[约束]` 标签；其中适用事实自然写入 H3 三字段。
- 每个 Shot 首句按“景别与机位关系 → 唯一主运镜及幅度/速度 → 主体落位 → 当前动作”表达。
- 每个 Shot 都有可见入口、一个向前的新变化和可见落点；后续 Shot 不重演已完成动作。
- 后续 Shot 使用严格递增的 `At 00:SS.mmm` 时间戳；最后一个 Shot 明确落到 Segment 结束时间。
- 把抽象情绪转换成低幅度、可观察的呼吸、眉眼、嘴唇、下颌、肩颈、手部、步幅、身体朝向和世内视线变化。
- 默认使用硬切；禁止叠化、交叉溶解、淡入淡出、透明重叠、瞬移和主体变形。
- 有人物时，视线落在场景内明确对象上，不与镜头交汇；剧情明确打破第四面墙时除外。
- 固定写入不生成字幕、标题、水印、拼贴、分屏或额外人物。

### H3 vocalPerformanceMode

每个 item 必须有一个 `vocalPerformanceMode`，只能使用以下值：

- `native_dialogue`：来源有对白时逐字使用 `<d>[Language]...</d>`，让出镜说话人产生与原文对应的自然口型；没有来源对白时不得凭空增加对白。
- `lip_sync_for_replacement`：只有已有最终替换配音逐字稿时才能使用；`<d>` 中的文字必须与该逐字稿完全一致，不得近义改写、临时占位或自行补台词。最终合成必须由用户显式选择 `audioMode=replace`，不能由本 Skill 自动替换音频。
- `voiceover`：把来源文本写成明确的 off-screen voiceover `<d>`；相关时间块内所有可见人物的嘴唇保持完全闭合，不做说话、哼唱、耳语或跟读动作。
- `silent_no_lip`：禁止 `<d>`、`<cutoff>` 和任何可听对白描述；所有可见人物嘴唇保持闭合，`overall_soundscape: N/A`，`non_diegetic_music: N/A`。即使来源有对白，也不得静默删掉事实，必须在 batch `warnings` 说明对白因用户选择没有交给视频模型执行。

`vocalPerformanceMode` 是导演意图，不是 Provider generation option；不得把它写进 `generationOptions`，也不得根据后期 `audioMode` 反推。H3 当前节点仍需 `generateAudio=true`，`silent_no_lip` 的最终无声由后期 `mute` 完成；Prompt 负责避免对白和口型。

### 多 Segment 连续性

- 入口与出口状态只作为内部导演事实维护，不输出 `[入口状态]`、`[出口状态]` 或其他通用标签。
- 非首 Segment 把上一段出口事实自然写入 Shot 1 的景别、落位、朝向、视线、道具、环境和持续声音，从上一段完成后的下一个新节拍开始，不重述或重演上一段落点。
- 非末 Segment 把可继承的出口事实自然落入最后一个 Shot 的可见落点，并把仍在持续的声音关系写入 `overall_soundscape`；后一段从该可见落点完成后的下一个新节拍开始。
- 跨 Segment 只保证身份、服装、道具状态、空间锚点、光线和声音相容，以及两个独立画面自然可剪；不得宣称或暗示帧级无缝插值。

### 混合媒介稳定

当画面同时包含 2D、3D、写实或其他不同媒介时，Shot 1 必须声明主体的渲染媒介、轮廓/材质、颜色、比例、地面接触和场景光照保持一致。示例方法句：

```text
The girl remains consistently rendered as clean 2D cartoon line art within the photorealistic park, with stable outlines, flat colors, scale, ground contact, and scene lighting throughout the video.
```

实际内容必须来自当前镜头事实，不要机械复制示例。

### `first_frame`：I2VA

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] ...
overall_soundscape: ...
non_diegetic_music: N/A
```

- `references` 恰好有一张 `channel=image, role=first_frame` 图片，没有 `last_frame` 或普通 reference 媒体。
- `<Picture 1>` 唯一对应该首帧；Shot 1 明确保持 Picture 1 中人物身份、外貌、服装、道具状态、主体位置和场景结构。
- 动作按“首帧锚定 → 动作开始 → 连续发展 → 结果或反应”推进；同一 Segment 可以有多个向前推进的 Shot。
- 参考图只锁定身份与设计，不继承资产板的正面居中、僵硬姿态或直视镜头。

### `first_last_frame`：FL2VA

```text
How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 0.00-second mark of the target video; <Picture 2> (from [Shot 1]) aligns with the N.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] ...
overall_soundscape: ...
non_diegetic_music: N/A
```

`N.00` 使用该 item 的整数 `durationSeconds` 并保留两位小数。`references` 恰好有一张 `first_frame` 和一张 `last_frame`，顺序分别对应 `<Picture 1>` 与 `<Picture 2>`，没有其他 reference 媒体。FL2VA 使用一个连续 Shot，动作按“首帧状态 → 可观察的连续物理动作链 → 差异逐步缩小 → 尾帧着陆”展开；最后一句明确落入 Picture 2 的姿态、道具状态、空间关系、镜头角度、光线和构图。没有合理物理路径时停止，不用变形、叠化或瞬移强行连接。

### 对白与声音

- 同一人物在整个生成批次中保持同一 `(S1)`、`(S2)` 编号；每个独立 Segment 首次出现该说话人时重新描述年龄、性别、音高、音色、语速和必要口音。
- 对白逐字保留来源，不能翻译、润色、缩写或补写；说话人必须出镜或明确为画外来源，并在时间块结束前自然说完。
- 对白示例：

```text
The young man with a low, restrained voice (S1) says: <d>[Chinese] 该走了。</d>
```

- 旁白示例：

```text
The man (S1) says in an off-screen voiceover: <d>[Chinese] ...</d>, while every visible character keeps their lips completely closed.
```

- `overall_soundscape` 使用一至四句英文写环境声、动作声和非语言人声，并跟随动作变化；不重复对白或歌唱，不写 BGM。只有来源明确要求完全静音时才写 `N/A`。
- 对白跨 Shot 持续时，整句只写一次且只使用一个 `<d>...</d>`；在其中实际切镜位置插入 `<scenetrans>`。标签前的原文属于前一 Shot，标签后的原文属于后一 Shot；后一 Shot 只声明同一说话人、同一声音编号和同一声线不间断继续，不得再次写出台词或把后半句当作一次新发声。完整示例：

```text
[Shot 1] Medium side shot, static camera. The young man with a low, restrained voice (S1) begins one uninterrupted line that crosses the hard cut at 00:03.000: <d>[Chinese] 我一直以为<scenetrans>你不会回来。</d> [Shot 2] At 00:03.000, hard cut to a medium close-up. The words after the transition marker belong to this shot and continue in the same (S1) voice without restarting or repeating any part of the line.
```

- `<cutoff>` 仅用于来源明确要求对白在 Segment 结尾被截断的情况；不得用它修复错误装段、时长不足或本应自然说完的台词。

### H3 停止条件

profile 缺失/未知、输入模式不受支持、帧数量/角色/顺序错误、多出 reference、FL2VA 无连续物理路径、对白无法在合法装段后说完、无法同时满足英文主体/原文对白/`N/A` 配乐或生产能力为空时，停止构造 H3 item。不得改用 `generic_v1`、改变输入模式或静默删除事实。

## generic_v1 最终 Prompt

以下语法只属于 `generic_v1`，不得出现在 `minimax_h3_v1` Prompt 中。

### 对白与声音

- 台词格式为 `角色名（≤3 个声音质感词）：{逐字台词}`。说话人必须出镜或被明确设置为画外来源，口型与自然语速匹配，句子必须在所在时间块结束前说完。
- 绑定音色只定义固有声音身份，忽略试听文字。台词指令同时引用角色图片和其声音编号，不同角色不得串音。
- 每个时间块只写当前可听到的对白、动作声与环境声，使用具体质感词；不写 BGM，不把同一声音在每个镜头重新触发。
- 主动判断声音关系：同期发生、先于来源画面出现、跨镜持续、画外说话者后续揭示，或无需特殊关系。需要时写清开始、持续、减弱或停止的时刻与来源。

### 参考素材语法

- 图片、声音和视频各自按传入顺序独立编号。中文提示词使用 `@图片N` / `@音频N` / `@视频N`，英文使用 `@Image N` / `@Audio N` / `@Video N`；不要混写双重编号。
- `[参考]` 中每个引用用一句话声明唯一主要用途，例如角色身份、场景结构、关键道具、锁定音色或参考运动；顺序必须与 item 的 `references` 一致。

### 最终提示词格式

每个 Segment 使用以下顺序。省略不适用行，但不得省略适用事实：

```text
[风格] 题材 + 已确认视觉政策 + 2–3 个材质/光线关键词
[时长] N 秒
[参考] @图片1——明确用途；@音频1——明确用途；@视频1——明确用途
[入口状态] 非首段必写：承接上段出口，并说明已完成节拍
[场景] 地点、时间、光线、空气与关键空间锚点
[00:00–00:0X] 镜头1：景别 + 机位 + 主体落位 ｜ 一种主要运镜
画面：入口状态 → 一个核心节拍 → 可见落点
表演：可见表情、身体反应、朝向与世内视线目标
台词：角色名（质感词）：{逐字台词}
声音：<同步声音与必要的跨镜关系>
[00:0X–00:0Y] 镜头2：……
[出口状态] 非末段必写：最后一帧人物/道具/环境/声音的可继承状态
[收尾] 末段必写：最终可见结局，不增加剧本外尾声
[整体声音] 只写贯穿或跨镜变化，不重复逐拍声音
[约束] 固定约束句
```

格式纪律：

- 重要信息前置；每个时间块最多数句，短而具体。
- 一镜一种主要运镜，一个时间块一个核心节拍；复杂动作拆成向前推进的连续节拍。
- 非首段从“下一个节拍”开始，不重述或重演 `[入口状态]` 中已经完成的内容。
- `[收尾]` 是剧本结局的最后可见状态，不是额外定格动作；少量尾部执行余量只能停驻在这个既有落点。
- 含人物的提示词固定写入：`人物视线落在场景内明确对象上，不与镜头交汇。` 明确打破第四面墙的内容除外。
- 含两个以上镜头的提示词固定写入：`镜头之间禁止叠化、交叉溶解、淡入和淡出；前后画面不得透明重叠。`
- 固定写入：`不生成字幕、标题、水印、拼贴、分屏或额外人物。`

## 输出前检查

- 剧情、对白和结局是否完全来自来源，固定总时长是否精确？
- 是否先建立整片时间线，再设计镜头，最后装段？
- 每个镜头是否有新节拍、可见入口和落点，时间是否从不回退？
- 人物镜头是否写清景别、机位、落位、朝向、视线与一种主要运镜？
- 表演是否全部为可见物理事实、无情绪形容词与内心解释？重大反应是否分层推进、每镜头一层？
- 每对跨段接缝是否同时满足景别变化、时间前进和状态对齐？
- 图片/声音编号、用途和 `references` 是否精确且只包含实际使用素材？
- 对白是否逐字、自然说完、音色不串；声音是否只触发一次并按需要延续？
- 创意转场是否真的必要，且没有叠化、透明混合或主体变形？
- 最终 Prompt 是否只含视频模型需要执行的画面与声音，没有内部分析或平行过程字段？

## 边界

本 Skill 只负责视频导演方法与最终提示词。能力事实只读取系统直接注入的 `productionCapabilities.video`；项目画幅由服务端项目配置唯一决定，不作为生成 item 或 Prompt 参数重复提交。固定 `video_generation_batch` 字段由运行时注入的机器 Schema 定义，Resource 身份校验、Provider 执行、计费、Task 与合成由系统负责。
