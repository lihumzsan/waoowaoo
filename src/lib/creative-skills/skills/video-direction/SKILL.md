---
name: video-direction
description: Use when directing screenplay-based video generation that requires continuity, physical performance, reference identity, structured timing, sound relationships, or executable final prompts.
---

# 视频导演与生成设计

本 Skill 是 `outputKind=video_generation_batch` 的唯一视频导演 Skill。先建立整片时间线，再按内容边界设计镜头与 Segment，最后按 capability 声明的 Prompt profile 生成每段唯一 Prompt；不输出平行导演表或解释文件。

## 不变规则

- 剧本、用户明确要求、已确认资产、入段状态和已采纳 Creative Direction 是唯一事实；不得新增人物、对白、地点、道具、动作、动机或结局。对白逐字保留。
- 时长意图先区分近似目标（target）、明确严格约束（fixed）与未指定时长的自主推导（derive）；这些是规划语义，不在输出 schema 外新增字段。普通“十秒视频”“一分钟”“一分钟左右”属于近似目标，只有用户明确要求精确时长或给出上下限时才属于严格约束。用户已选定的合法单段生成参数仍优先于自主规划启发式，不因“常规时长”偏好改掉它，也不把选定整数参数解释为成片精确时长承诺。
- 近似目标下先联合设计自然 Segment 边界和合法请求时长，使用各段匹配模式的 `expectedOutputDurationSeconds` 估计总时长，不要求请求参数精确求和。选择能完整承载来源内容且接近目标的组合；模型帧网格造成的小幅偏差正常，明显偏离目标或无法自然承载内容时报告冲突，不借“近似”任意拉长或缩短。生成后以 Resource 实测时长规划后续段起点和合成，不以预计值覆盖实测事实。
- 严格约束下，生成参数求和或预计输出吻合都不能证明实际成片满足要求。先核对当前生成与合成能力是否能满足约束并验证实际成片；当前 H3 原样交付与合成不提供任意精确裁时保证，无法保证时在提交前报告能力限制，不擅自裁切对白、变速、补静帧或放宽用户约束。内容与时长冲突同样明确报告，不用空镜、停顿或保持画面凑数。
- `durationIntent.mode=derive` 时只从来源内容计算完整表演节拍：来源要求的最短必要建立、自然对白或动作，以及来源明确要求的后续动作或反应；同时发生的内容仍按 `creative-core` 取最长项。先按输入控制规则确定 `inputMode`，再按来源动作、说话轮次和语义边界组合节拍，并只从 `segmentDurationPlans` 中与该 `inputMode` 匹配的条目选择能完整承载每个节拍的最短请求值，不以减少 Segment 数或用满时长上限为目标。若剩余来源内容短于该模式合法最小时长且无法与相邻来源节拍合并，或长于该模式合法最大时长且没有合法切点，停止并明确报告能力与内容冲突，不得补写或拉长内容。
- H3 的四种输入模式都支持 4–15 秒整数档；`reference` 是核心生成模式。Agent 按用户指定时长、整体目标、来源内容和自然节奏直接选择；超出所选模式的时长范围时停止，不得静默改时长或换模式。每镜仍必须有入口、一个向前变化和可见落点。
- 完整节拍超过所选 H3 模式的最大合法时长且没有合法切点时，停止构造可执行 items 并报告输入内容与能力策略冲突。合法纠正只能是修改来源内容或形成真实语义切点。这里只报告失败事实和合法纠正条件，不调用 `wao.request_user_decision`、不创建新的 alignment checkpoint，也不替用户选择或提交超长 Segment。
- 单段包含对白且来源顺序与完整节拍允许时，以对白的主要表演位于视频中段为正向布局目标：开头只使用来源已有或理解当前动作所必需的最短建立；对白后存在来源明确的动作或反应时用它形成结尾落点。来源没有后续动作或反应时，以最后音节和同步口型在当前姿态中的自然完成作为落点，不新增事件、反应、动作或额外停顿；若来源事实迫使对白抵达片尾，保留来源顺序与完整性，不为形式上的居中编造内容。
- 相邻 Segment 承接已完成状态，不重演转身、拿取、到达、对白或上一段落点。默认跨段只保证身份、服装、道具、空间、光线与声音相容；当相邻独立 Segment 明确要求从前段结束画面连续开始时，按“多帧运动续接”规则锁定后段的精确起点，但仍不得宣称模型生成的整条接缝天然无缝。
- 表演写可见物理事实：呼吸、视线、下颌、肩颈、手部、步态与接触几何；不写内心解释或空泛情绪副词。一镜一种主要运镜，默认硬切。需要切镜时，新镜头必须增加主体、空间、状态、视点或时间信息；只有景别或轻微角度变化时继续当前镜头并使用运镜。
- 先建立来源已有的正常基线，再显示原因或证据，最后呈现人物反应；反应必须由当前或前一可见事件触发。
- 从系统注入的 `productionCapabilities.video.supportedInputModes` 和 `promptProfile` 选择输入与表达；未知或不支持时停止，不按 modelKey 猜测、静默降级或换 Provider。
- H3 的主生成模式是 `reference`：只要存在至少一张合法 `reference_image`，且来源没有明确要求继承前段退出运动、指定首帧或指定首尾帧，就使用 T8 Ref 工作流，无论是否包含对白。只有明确要求相应画面控制时才使用 `continuation`、`first_frame` 或 `first_last_frame`；相互不兼容的控制要求按模式冲突处理。其他模式的时长、拆分和画面规则不得限制或替代 Ref，Ref 执行失败时也不得自动回退到其他模式。
- `durationSeconds` 必须从 `productionCapabilities.video.segmentDurationPlans` 中与已选 `inputMode` 匹配的条目直接选定；`allowedSegmentDurationsSeconds` 只是跨模式能力概览，不得据此给当前模式套用其他模式的时长。匹配条目的 `promptStartSeconds` 是新内容的内部起点，`promptEndSeconds` 是内部终点，`expectedOutputDurationSeconds` 是去掉引导后的预计交付时长。缺匹配条目时停止，不套用其他模式的条目。用户不需要计算、提供或确认小数时间，预计值也不替代生成后的实测时长。
- `vocalPerformanceMode` 每个 item 必须显式填写且不放进 `generationOptions`；对白逐字、自然说完，`silent_no_lip` 时在 warnings 说明用户选择导致的对白不执行。

## 参考素材

- `reference` 的素材角色和数量必须完全遵守能力声明。普通参考图不是首帧；只有 capability 明确支持且剧情要求从该画面开始时才使用 `first_frame`。
- 每个 item 只列实际使用的 ready Resource，精确复制 `resourceId`、`contentVersion`、`role`、`channel`，顺序与 Prompt 中的媒体编号一致；不得从文件名或近似描述猜身份。
- H3 multimodal v3 同时支持四个互斥模式：`reference` 接受 1–9 张有序 `channel=image, role=reference_image`，并可搭配 1–3 段有序 `channel=audio, role=reference_audio`；图片与音频合计最多 12 个文件。每段参考音频至少 2,000 ms，全部参考音频合计最多 15,000 ms，且音频必须搭配至少一张参考图。`first_frame` 精确接受一张 `role=first_frame`；`first_last_frame` 精确接受一张首帧和一张尾帧；`continuation` 精确接受一个 `channel=video, role=continuation_video` 的前段 ready 视频。`reference_video` 仍不支持，参考音频不得与帧或 continuation 模式混合。缺首帧、仅尾帧、重复帧、重复 continuation、空引用、超过上限或错误角色时停止。

### 多帧运动续接

当相邻独立 Segment 必须从前段结束画面连续开始，且前段视频 Resource 已为 `ready` 时，执行顺序固定为：

1. 按注入的 `continuationInput` 核对前段精确 ready 版本的实测时长与画幅：时长位于 `minSourceDurationMs` 至 `maxSourceDurationMs`，宽高比匹配 `sourceAspectRatiosByTarget` 中项目目标画幅对应的任一比例（不是要求绝对像素相同）。信息缺失或不满足时停止；后段只把该版本的 `resourceId + contentVersion` 作为 `channel=video, role=continuation_video` 提交，不派生单张尾帧，不使用视频 URL、临时截图或普通参考图代替；
2. 前段末尾多帧是不可改写的运动上下文，后段 Prompt 从其退出姿态、运动方向和镜头趋势继续，不重演上下文。事件与切镜时间使用匹配 continuation 条目的内部时钟：用户所见新内容时间加 `promptStartSeconds`，时间不得早于该起点，且严格小于 `promptEndSeconds`；不再用请求时长加固定偏移推算终点；
3. 用户指定独立目标结束图片时，continuation 与 `last_frame` 仍不可混用；应拆成另一个有明确创作边界的 Segment，或报告当前 H3 输入模式冲突；
4. 前段不是 ready、精确版本不可用、续接输入失败或运行时不支持多帧 guide 时停止后段提交并报告失败，不得降级为 `first_frame`、`reference_image` 或 `reference_video`。

该流程只把前段运动历史作为显式生成条件，不改变来源对白、动作边界或 Prompt writer。引导帧在交付时移除，剩余视频按实际生成长度保留，不承诺用户所见时长精确等于整数请求值。

## Prompt profile 选择

- 从系统注入的 `productionCapabilities.video.promptProfile` 选择本批次唯一最终表达方言。
- `generic_v1` 使用下方 generic_v1 最终提示词格式。
- `minimax_h3_multimodal_v3` 使用下方 H3 最终 Prompt；不得同时输出通用标签格式。
- 缺失或未知 profile 时停止构造可执行 items，不得根据 `modelKey`、Provider 名称或输入模式猜测，也不得回落到 `generic_v1`。
- Profile 只改变同一导演事实的最终表达，不改变剧本、整片时间线、装段、Resource identity 或能力判定。

## minimax_h3_multimodal_v3 最终 Prompt

- `generic_v1` 使用 generic 的标签格式；不要把其标签混进 H3。
- `minimax_h3_multimodal_v3` 严格使用下列六段，顺序固定、每段只出现一次，段名在行首：

```text
subject_definitions:
summary:
retention_analysis:
detailed_description:
overall_soundscape:
non_diegetic_music:
```

除对白原文和画面内文字外正文使用英文。`reference` 的可复用视觉内容使用 `<Subject N>`，独立构图/分镜参考使用 `<Picture N>`，冻结来源使用 `<Picture N>` 或 `<Audio N>`；当前能力不接受 `reference_video`，因此不得写 `<Video N>`；场景、道具和服装仍可完整定义为 Subject 或写入对应 Subject 描述，但不得自创 `<Scene N>`、`<Prop N>` 等标签。除 `continuation` 外，`subject_definitions` 必须把每个实际从图片引用的主体、服装、场景或道具绑定到对应的 `<Picture 1>` 至 `<Picture N>`，不得引用不存在的编号；每个 `<Audio N>` 必须恰好定义一次且编号顺序与冻结顺序一致。音频对应可见 Subject 的说话人时，定义使用 `<Subject M> (Sx)`；说话人不对应已定义 Subject 时，使用稳定声音描述后跟 `(Sx)`；不与独立目标说话人绑定的同步音效、环境声或独立复用的话语/歌词片段不虚构 Subject 或 Speaker 绑定。一条 Audio 定义不得声明多个说话人。`continuation` 不使用不存在的 Picture 或 Audio 标签，而是用已冻结的前段事实定义继续出现的主体与场景。`reference` 的 `summary` 必须包含 `[reference generation]`；若音频保留关系为 `fully_copy` 或 `partially_copy`，再组合 `audio reuse`；若为 `reference` 或 `weak_reference`，再组合 `audio reference`；同时存在时两者都写且不重复。后文只概括动作与参考关系，不引用原句、不放 `<d>`。`reference` 的 `retention_analysis` 每个引用项一行：可见项只使用 `fully_preserved`、`partially_preserved`、`attribute_transfer` 或 `weak_reference`，音频只使用 `fully_copy`、`partially_copy`、`reference` 或 `weak_reference`；每个 `<Audio N>` 必须有自己的音频保留项，允许在该项说明中按官方写法再次引用同一个 `<Audio N>`，但不得混入另一个 `<Audio M>`；这里可引用 `<Subject M>`，但不写 `(Sx)`。其他模式仍按各自注入契约描述保留关系，`continuation` 还必须写明继承进入点的姿态、运动方向、接触关系和镜头运动。`detailed_description` 按播放顺序写连续可见动作、机位、落位、视线、对白与逐镜同步声音；只有实际使用某个说话人绑定参考音频的发声事件才引用对应 `<Audio N>`。说话人可以是 `<Subject M> (Sx)`，也可以是稳定声音描述加 `(Sx)`；多人同声使用复合 ID，并为复合 ID 内每个使用参考音频的 Speaker 分别明确 `Sx` 与其 `<Audio N>` 的对应关系。引用音色时，在同一镜头或语义阶段内明确对应 Speaker、`<Audio N>` 与 `<d>`，不从另一发声事件、分镜或时间阶段借用标记。不绑定独立说话人的 `<Audio N>` 仍必须在实际生效的声音层引用：逐镜同步的话语、歌词或音效写入 `detailed_description`，环境声与物理音效归入 `overall_soundscape`；使用明确的正向句式，例如 `When <Audio N> reaches the phrase <d>[Language]...</d>, ...` 或 `wind ambience from <Audio N> fills the room`，不得用否定句、纯视觉波形或标签出现本身冒充声音应用。观众侧配乐不通过 H3 Ref Prompt 注入，`non_diegetic_music` 固定写 `N/A`，配乐只走项目独立音乐工作流。只使用音色、节奏、情绪或表达方式时，不把参考音频原台词带入目标视频。对白原文只能出现在这里的 `<d>` 内；`overall_soundscape` 用一个连续英文段落归纳全片环境声、动作声和非语言人声，不复述对白、歌唱或逐镜时间线。

`reference` 的音色引用要在对应发声的镜头或语义阶段内明确对应 Speaker、`<Audio N>` 与 `<d>`。复合 Speaker 优先写成 `S1 using <Audio 1> and S2 using <Audio 2>`；同一 Speaker 使用多个音频时，可在该 Speaker 的同一对应短语中列出多个 `<Audio N>`。前置 Audio 修饰语后必须立即出现对应的 `<Subject N> (Sx)` 或 `(Sx)`，中间不得插入另一个主体、物体或动作；稳定声音描述的 Speaker 优先把 Audio 对应短语写在 `(Sx)` 后。不得用否定关系或仅靠标签相邻暗示对应。英文缩写、小数和自然句子标点本身不打断已有的明确对应；若跨完整句子，必须用 `uses that timbre` 等无歧义回指继续该对应。分镜、新的 `At MM:SS.mmm` 时间阶段、分号或另一个发声事件始终构成边界。

Ref 视觉引用按“来源 → 定义 → 保留 → 应用”闭合：每张实际提交的图片都在来源 Subject 的定义中说明用途，或独立定义为构图/分镜参考 Picture；编号按图片通道的冻结顺序，不受穿插的 Audio/context 影响。同一个 Subject 可以来自多张图片，一张图片也可以提供多个 Subject。仅作为 Subject 来源的 Picture 不另建定义和保留项；独立承担构图/分镜用途的 Picture 才有自己的定义与保留项。

每个独立来源 Subject/Picture 各占一条定义和一条保留项，并在 `detailed_description` 的实际生效位置使用同一标签；整体风格可在首镜前的风格句中应用。保留项中的 Shot 必须真实存在；不用每句或每镜重复所有标签。按实际用途选择保留关系，不把换装、属性迁移或新增动作一律改为 `fully_preserved`。目标新增的内容不虚构图片来源，已有 target-visible 播放实体不要求来源保留项。未使用的图片应在提交前由主 Agent 修正素材选择，不交给服务器静默删除或重排。

参考音色的标准结构如下，实际主体、编号和台词必须来自当前冻结输入与来源事实：

```text
subject_definitions:
<Subject 1> (S1) is the person shown in <Picture 1>.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).

summary:
[reference generation + audio reference] <Subject 1> speaks one new line using <Audio 1> as a voice-timbre reference.
Spoken dialogue is audio only and must never appear as visible text. Do not add subtitles or captions under any circumstances. Do not add title cards, watermarks, or interface overlays unless detailed_description explicitly requests that exact visible text.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - The person's identity and appearance from <Picture 1> are retained.
<Audio 1>: reference - The target speaker follows <Audio 1>'s vocal timbre and measured delivery without copying the original signal.

detailed_description:
The target video uses a realistic cinematic portrait style with natural indoor lighting.
[Shot 1] <Subject 1> (S1) faces camera and, using the voice timbre referenced from <Audio 1>, says <d>[Chinese]这是新台词。</d>

overall_soundscape:
Clean speech with quiet room tone.

non_diegetic_music:
N/A
```

任何画面内实体实际播放的参考音乐都是世内同步声音，写入 `detailed_description`。播放实体先独占一行定义为 `<Subject M> is a source-backed in-scene playback entity ... <Picture N> ...`；若它是目标视频新增、并非参考图内容，则定义为 `<Subject M> is a target-visible in-scene playback entity: {target description}.`，不得伪称来自 Picture。随后用 `The visible in-scene <Subject M> plays <Audio N> audibly through its physical output` 明确复用这个可见实体身份。实体种类与具体输出部件不受名词清单限制，可在 Subject 定义和镜头描述中自然说明；不得把任意未定义的自然语言名词冒充实体，不得用自由文本目标替换物理输出槽，也不得把播放写成 `for ... audience/viewer/listener` 的观众侧用途。这类声音不属于观众侧配乐，不得因 `non_diegetic_music: N/A` 或独立配乐工作流而删除、降级或拒绝。

### H3 镜头、运镜与声音语法

- `reference` 的 `detailed_description` 先用一至两句英文建立整体画面风格，再开始 `[Shot 1]`；这两句可在同一行或分行。其他输入模式直接以 `[Shot 1]` 开始。首镜标记永远不带时间戳，帧模式形如 `[Shot 1] <Picture 1> aligns with 0.00 seconds and shows ...`。每次真实切镜都在切点处直接开始新标记 `[Shot N] At MM:SS.mmm, the camera cuts to ...`，切镜结构只写成 `[Shot 1] ... [Shot 2] At 00:04.000, the camera cuts to ...`；上一镜结尾不预告 cut，也不得写 cut 而不递增镜号。错误形态 `[Shot 1] ... At 00:04.000, the camera cuts ... [Shot 2] ...` 必须改写为 `[Shot 1] ... [Shot 2] At 00:04.000, the camera cuts ...`。切点必须在 Segment 时长内严格递增；只有来源明确要求时才把 `cuts` 换成 dissolve、fade 或 wipe。
- 时间阶段不是镜头边界：同一连续物理动作或同一主要运镜能够承载的内容只使用一个 `[Shot 1]`，可在镜内用 `At MM:SS.mmm` 描述动作阶段。用户明确要求单镜头时不得切镜；`first_last_frame` 默认用单镜连续插值，只有来源明确规定多镜时才增加镜头。
- 运镜作为当前镜头中的自然英文动词句，不堆标签。H3 类型为 `Zoom In/Out`、`Push In/Pull Out`、`Pan Left/Right`、`Truck Left/Right`、`Tilt Up/Down`、`Pedestal Up/Down`、`Arc Shot`、`Tracking Shot`、`Static Shot`、`POV`、`Roll Clockwise/Counterclockwise` 或 `Shake Slightly/Strongly`，但正文统一使用 `The camera + 小写动词`：`zooms`、`pushes`、`pulls`、`pans`、`trucks`、`tilts`、`pedestals`、`arcs`、`tracks`、`holds a static shot`、`uses a POV shot`、`rolls` 或 `shakes`。默认中等幅度和正常速度不写；来源要求小幅、大幅、慢速或快速时分别写 `with small/large amplitude` 与 `at slow/fast speed`。例如 `The camera pulls out with small amplitude at slow speed.`；默认值时直接写 `The camera tracks the woman.`，不写 `natural/normal speed`、`medium amplitude`、`performs a Pull Out` 或 `a slow Push In`。
- 实际说话或歌唱的声音源按首次发声顺序获得稳定 `(S1)`、`(S2)`；跨镜复用同一 ID，从不发声的角色不分配 ID。把身份、ID、动作与发声写成一个句子。多人同声说同一句来源原文时，使用一个复合 ID 和一个 `<d>`；多人同时说不同来源原文时，每条台词分别保留自己的稳定 ID 与独立 `<d>`，并在块外说明二者重叠。首次发声时只用来源已有的身份与声音事实建立说话人，身份短语、ID、动作和语气放在 `<d>` 外；不在同一事件里重复声明说话人或添加 `says exactly:`、`the first speaker is`。
- `<d>` 内只放 `[Language]` 与用户或来源逐字提供的对白、歌词，不加反引号、说话人说明、voiceover 字样或翻译。每个完整陈述、问句或感叹句的 `.?!`（中文可用 `。！？`）必须放在 `</d>` 前；只有以 `<cutoff>` 结束的明确截断话语，或以成对 `<scenetrans>` 连接到下一镜的未完成前半句，不要求在当前块补句末标点。可见文字是条件槽：字幕与 caption 永远不得作为可见文字；其他文字只有用户或来源明确要求画面中出现逐字内容时，才用 ASCII 英文双引号保留。官方列出的 banner、sign、label、neon text 等明确文字载体在句首或镜头子句起始处可直接写成 `{明确载体} reading "逐字文字"`；其他任意载体及嵌入人物动作的载体统一写成 `{实际载体} bears visible text reading "逐字文字"`，不靠名词清单猜测其是否可见。`reading` 必须修饰载体或 `visible text`，不得描述人物朗读。逐字文字自身含 ASCII 双引号时，用反斜线转义内层双引号，例如 `A sign reading "He said \"Hello\"."`；转义符只承担边界语法，不改变文字内容。`detailed_description` 中其他内容不得使用双引号代替 `<d>`。每个最终 `reference` Prompt 的 `summary` 都必须把 `Spoken dialogue is audio only and must never appear as visible text. Do not add subtitles or captions under any circumstances. Do not add title cards, watermarks, or interface overlays unless detailed_description explicitly requests that exact visible text.` 原样写成独立一行，不得拼接在剧情摘要后。对白只是音轨内容，绝不能因为来源提供了逐字台词而被解释为需要显示的文字。
- `voiceover` 必须在同一句中把来源人物、稳定 ID、`<d>` 和“所有可见人物均不做口型”绑定；不能只约束发声者本人。对白跨切镜时，把 `<scenetrans>` 放在前后两个 `<d>` 内的连接点并明确声音连续跨切。`reference` 只有在来源或用户明确要求话语被视频结尾截断时，才在最后一个 `<d>` 内使用一次 `<cutoff>`，将它放在对白末尾、紧邻 `</d>`，并让该 `</d>` 成为 `detailed_description` 的最后实质内容（其后只可有终止标点）；其余情况及其他输入模式仍按时长—内容冲突停止构造可执行 item。下列代码块只展示结构，花括号占位符必须由来源事实替换且不得原样输出；不得复制其中的主体、场景、动作或时间：

```text
[Shot 1] {source-backed framing and action}. {source-backed speaker} (S1) says: <d>[Language]{verbatim source line before the cut}<scenetrans></d> The same voice continues seamlessly across the cut.
[Shot 2] At {MM:SS.mmm}, the camera cuts to {source-backed framing}. The same voice carries over as {source-backed speaker} (S1) says: <d>[Language]<scenetrans>{verbatim source line after the cut}</d>
```
- 完整对白、歌词和对应 `<d>` 只出现在 `detailed_description`。除 `silent_no_lip` 固定使用 `overall_soundscape: N/A` 外，`overall_soundscape` 用 1–4 句概括环境声、物理动作声和非语言人声，不包含 `<d>`，不复述对白或歌唱，也不写非世内音乐。

图片时序语义只由当前显式输入模式决定：

- `reference`：每个 `<Picture N>` 只锁定身份、风格、内容与场景结构，不是首帧或尾帧，不得写成时间锚点。每个 `<Audio N>` 按当前冻结音频的实际角色写明复制、局部复制、参考或弱参考关系。只参考音色、节奏、情绪或表达方式时，不复制原台词，仍使用当前任务的新台词；只有直接复用或用户明确要求重演时才保留来源原文。
- `first_frame`：`detailed_description` 的 `[Shot 1]` 后第一句必须把 `<Picture 1>` 明确对齐 `0.00 seconds`，再描述从该状态连续发展的动作。
- `first_last_frame`：除首帧规则外，必须在同一句中把 `<Picture 2>` 明确对齐匹配 `first_last_frame + requestedDurationSeconds` 条目的 `promptEndSeconds`，并描述从首帧状态连续收敛到尾帧状态的运动路径。来源明确要求多镜时，`<Picture 2>` 只属于最后一个 `[Shot N]`，在该镜结尾成为 Segment 的最终视觉状态，其后不得再有镜头、动作或状态变化。
- `continuation`：不写 `<Picture N>` 时间锚点；`detailed_description` 直接延续运动上下文的退出姿态、速度、方向、接触关系和运镜趋势。时间换算与范围完全遵守上方“多帧运动续接”的匹配条目，不复述或重新表演上下文。

不得调用或描述 ComfyUI AI 节点、下游 Prompt 改写或第二套 Prompt；主 Agent 是唯一 Prompt writer。

最后一段必须原样包含：

```text
non_diegetic_music:
N/A
```

不得写乐器、旋律、节拍、BPM、配乐动态或任何替代句。背景音乐由独立音乐工作流负责。

## H3 vocalPerformanceMode

- `native_dialogue`：来源有对白时逐字使用 `<d>[Language]...</d>`，由出镜说话人自然口型执行；无来源对白不得补写。
- `lip_sync_for_replacement`：仅在已有最终替换配音逐字稿时使用，文字必须完全一致；音频替换必须由用户显式选择，Skill 不自动替换。
- `voiceover`：明确写画外 `<d>`，时间块内所有可见人物嘴唇闭合。
- `silent_no_lip`：禁止 `<d>`、`<cutoff>` 和可听对白描述，`overall_soundscape: N/A`；即使来源有对白，也在 batch warnings 说明事实未交给视频模型。

## 输出前检查

- 是否区分近似目标、明确严格约束与自主推导；每段请求是否合法、没有填充内容，近似目标是否使用预计输出而不是请求参数求和，后续时间线是否以实测媒体为准；严格约束是否有真实可执行的满足与验证方式，无法满足时是否提交前报告能力或内容冲突？
- 对 H3 中所有由 Agent 选择的单段时长（包括 `fixed` 总时长下的分配与 `derive`），是否先确定模式并只使用该模式的 `segmentDurationPlans`；四种模式是否都只使用 4–15 秒，并按用户目标与内容节奏选择且不静默改时长或换模式；其他 Prompt profile 是否只服从注入的合法时长集合？
- 每镜是否有景别、机位、主体落位、朝向、世内视线、一个主要运镜、向前变化和可见落点？
- `reference` 的 `detailed_description` 是否先用一至两句英文建立整体画面风格再开始 `[Shot 1]`，且没有把换行当成句数要求；其他模式是否直接以 `[Shot 1]` 开始；每次真实切镜是否都用递增的 `[Shot N] At MM:SS.mmm`、连续动作没有被时间块机械拆镜、单镜要求与 `first_last_frame` 默认单镜是否保留？
- 运镜是否写成自然英文动词句并在来源要求时明确幅度与速度；除对白原文和画面文字外是否没有中文或混合语言残留？
- `reference` 是否只使用当前 capability 冻结的 `<Subject N>`、`<Picture N>`、`<Audio N>` 标签且没有 `<Video N>`；是否只使用 capability 允许的参考角色与数量，四种模式互斥，且 Picture 时间锚点与当前模式及 Segment 时长一致；每个 Audio 是否在 `subject_definitions` 恰好定义一次，并按实际角色选择一个 Subject/Speaker、稳定声音描述加 Speaker，或不绑定独立说话人；是否在自己的 `retention_analysis` 项中使用官方音频关系且不写 `(Sx)`；每个音色生效的 `detailed_description` 发声事件是否在同一分镜或时间阶段内明确对应 Speaker、Audio 与 `<d>`，同时允许前置 Audio 引用、复合 Speaker、英文缩写、小数和有无歧义回指的自然句子标点，且没有跨分镜、新 `At MM:SS.mmm` 阶段、分号或另一发声事件借用标记？
- 是否在存在合法参考图且没有明确运动续接或帧控制时使用主模式 T8 Ref，并只在来源明确要求相应控制时选择其他模式？`durationSeconds` 是否仍为该模式的合法整数，时间条目是否同时匹配输入模式和请求时长，所有锚点是否使用该条目的内部时钟？
- 要求前段运动连续续接时，是否把前段精确 ready 视频版本作为后段唯一 `continuation_video`，且失败时没有单尾帧、参考图、reference video 或时间偏移 fallback？
- H3 是否严格六段、固定 `non_diegetic_music: N/A`、无 AI 节点和无 Prompt 改写？
- 对白是否逐字、自然说完，且 `<cutoff>` 只用于 `reference` 中明确要求被结尾截断的最后一段话语，并让对应 `</d>` 成为详细描述最后实质内容；每个声音源是否有稳定 `(Sx)`，同句齐声是否使用复合 ID、不同台词重叠是否分别保留 ID 与 `<d>`，`<d>` 是否只在 `detailed_description`，跨切 `<scenetrans>` 是否在两个 `<d>` 内，voiceover 是否明确所有可见人物均不做口型？对白后的落点是否只使用来源已有动作或反应，不存在时是否以说话表演自然完成而没有新增内容？可见文字是否只在用户或来源明确要求时按句首官方载体 `{载体} reading "原文"` 或嵌入式 `{载体} bears visible text reading "原文"` 写入双引号，内层 ASCII 双引号是否用 `\"` 保持边界；`summary` 是否原样包含固定的无字幕、标题、水印和界面 overlay 约束，且对白存在没有被误判为需要字幕？

## 边界

本 Skill 只负责导演事实与最终 Prompt。能力、画幅、Resource 身份、Provider 执行、Task 生命周期和合成均由系统契约负责；Skill 不创建第二条执行链。
