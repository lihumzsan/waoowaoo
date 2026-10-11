---
name: video-direction
description: Use when directing screenplay-based video generation that requires continuity, physical performance, reference identity, structured timing, sound relationships, or executable final prompts.
---

# 视频导演与生成设计

本 Skill 是 `outputKind=video_generation_batch` 的唯一视频导演 Skill。主 Agent 用本 Skill 把客户想要的效果转成导演设计，再按 capability 声明的 Prompt profile 构造每段唯一 Prompt 与 references。服务端负责校验、冻结和执行；不输出平行导演表，不交给第二个 writer 改写。

## 从客户要求构造视频

聊天框内容默认是效果要求和约束，不是给 H3 的成品提示词。忠实的是客户的目标、已确定事实和明确约束，不是普通要求的措辞、句序或强调次数。只有来源明确给出的台词、歌词和允许出现的画面文字需要逐字保留；“开心一点”“敲三下再打开”等要求由导演转成可见、可听的实现。

在当前 Turn 的同一专业结果中完成以下推导；这些是构造方法，不新增意图表、持久状态或输出 schema 字段：

1. **理解目标。** 分清客户要改变的效果、必须保留的事实、明确的限制和逐字内容。结合准确剧本版本、已采纳方向和当前修改要求解决指代；普通效果描述可以重组。目标或剧情有实质歧义时才询问，不让客户代写 H3 提示词。
2. **核对来源与状态。** 读取实际使用的 Resource 精确版本，区分参考图里有什么、入段时已经发生什么、这一段结束时才会发生什么。已采纳的前段状态是接力依据；聊天承诺和任务 ready 不能证明画面达到了目标。图片描述不把未来变化预先写成当前事实。
3. **做导演选择。** 在既定剧情与目标内自主决定构图、机位、主体落位、视线、接触、运动路径和微表演。例如把开心表现为放松肩颈、眼神和有来源依据的笑容；不因此新增人物、道具、台词或剧情事件。缺少这些执行细节时，主动完成设计。
4. **建立动作因果。** 每镜先确定入口状态，再安排触发、动作过程和可见落点。需要计数时，将每次接触、离开、复位与随后发生的变化分开表达，让主体、工具和受力对象明确；时间标记帮助布局，不保证模型一定执行精确计数。不靠重复 exactly/never 代替动作设计，也不把同一动作的阶段机械拆成多个镜头。
5. **选择模式、时长与引用。** 依据下方能力边界选择，并按当前段实际用途形成唯一 references。为每个来源明确保留什么、改变什么以及在哪里应用；人物声音按实际台词选择。安排自然能完成的表演节拍，能力无法承载时明确报告。
6. **生成最终表达。** 按六段职责写英文协议正文，逐字内容放入对应槽位。严格结构使用本 Skill 随附的 H3 structural syntax reference；它由程序与校验共用的语法声明装配，不是另一份项目 Prompt。最后将同一个专业 item 原样交给 create_video。

## 修改已有片段

先定位客户指定的片段和准确版本，读取它的生成输入、当前素材与来源事实，再决定修改范围。已经成功且未被要求改变的片段保留。输入修订与运行失败的原参数重试不同：前者重新构造当前 item，后者沿用现有重试入口和冻结输入。

对当前片段先分清本轮改变、仍有效的事实、已被本轮撤销的旧假设。以新目标重写受影响的六段和 references，清除旧目标、旧因果顺序、互相矛盾的状态和重复禁令；未改变的来源事实保留。删掉参考图某个属性时，保留项应说明保留的属性和本轮变化，不能一面要求改变，一面声称所有属性完全保留。目标变化涉及声音时同时核对人物音频选择、Audio 定义、保留关系与实际发声事件。

数量要求先确定计数范围，再给每个实际实例安排位置；同一设计素材不等于只有一个实例。“画面中只保留三个坐垫”要覆盖座位、地面、手中和背景中实际存在的坐垫，不能保留另一个备用实例。移除背景物体时，依据仍有效的来源与目标描述该处应呈现的空间、地面、植被或光线，同时保留未要求改变的道具图案；不凭空补造替代物，也不把反复列举被移除物体当作画面设计。

例如“保持四瓣完整但熄灭发光”，先核实入段是否已经是完整四瓣，再保留数量和形态、设计亮度变化；不把目标状态反写成尚未发生的来源事实。又如“第三次敲击后才打开”，先安排闭合入口、三次明确接触与回弹、第三次之后的开启动作；不把客户原句翻译后叠加更多禁止句作为整段设计。

工具返回 corrections 时，按 item/resource identity、section、issueCode 和具体绑定修复当前结果。先区分结构未被识别、来源引用选错、实际内容缺失；不能一看到“缺少对白”就补造台词，也不能删掉必需图片或音频来过校验。程序校验通过只代表可以提交，任务 ready 只代表媒体已交付，效果是否达到必须观察该版本成片。

## 不变规则

- 剧本、用户明确要求、已确认资产、入段状态和已采纳 Creative Direction 提供事实依据。导演可补全实现既定动作所需的机位、动作分解和微表演，不得擅自新增剧情事件、人物、对白、地点、道具、动机或结局；来源明确提供的逐字内容保持原文。
- 时长意图先区分近似目标（target）、明确严格约束（fixed）与未指定时长的自主推导（derive）；这些是规划语义，不在输出 schema 外新增字段。普通“十秒视频”“一分钟”“一分钟左右”属于近似目标，只有用户明确要求精确时长或给出上下限时才属于严格约束。用户已选定的合法单段生成参数仍优先于自主规划启发式，不因“常规时长”偏好改掉它，也不把选定整数参数解释为成片精确时长承诺。
- 近似目标下先联合设计自然 Segment 边界和合法请求时长，使用各段匹配模式的 `expectedOutputDurationSeconds` 估计总时长，不要求请求参数精确求和。选择能完整承载来源内容且接近目标的组合；模型帧网格造成的小幅偏差正常，明显偏离目标或无法自然承载内容时报告冲突，不借“近似”任意拉长或缩短。生成后以 Resource 实测时长规划后续段起点和合成，不以预计值覆盖实测事实。
- 严格约束下，生成参数求和或预计输出吻合都不能证明实际成片满足要求。先核对当前生成与合成能力是否能满足约束并验证实际成片；当前 H3 原样交付与合成不提供任意精确裁时保证，无法保证时在提交前报告能力限制，不擅自裁切对白、变速、补静帧或放宽用户约束。内容与时长冲突同样明确报告，不用空镜、停顿或保持画面凑数。
- `durationIntent.mode=derive` 时只从来源内容计算完整表演节拍：来源要求的最短必要建立、自然对白或动作，以及来源明确要求的后续动作或反应；同时发生的内容仍按 `creative-core` 取最长项。先按输入控制规则确定 `inputMode`，再按来源动作、说话轮次和语义边界组合节拍，并只从 `segmentDurationPlans` 中与该 `inputMode` 匹配的条目选择能完整承载每个节拍的最短请求值，不以减少 Segment 数或用满时长上限为目标。若剩余来源内容短于该模式合法最小时长且无法与相邻来源节拍合并，或长于该模式合法最大时长且没有合法切点，停止并明确报告能力与内容冲突，不得补写或拉长内容。
- H3 各输入模式的合法整数时长由注入的 `segmentDurationPlans` 分别声明；`reference` 是核心生成模式。Agent 按用户指定时长、整体目标、来源内容和自然节奏，从所选模式的条目中直接选择；缺少对应档位时停止，不得静默改时长或换模式。每镜仍必须有入口、一个向前变化和可见落点。
- 完整节拍超过所选 H3 模式的最大合法时长且没有合法切点时，停止构造可执行 items 并报告输入内容与能力策略冲突。合法纠正只能是修改来源内容或形成真实语义切点。这里只报告失败事实和合法纠正条件，不调用 `wao.request_user_decision`、不创建新的 alignment checkpoint，也不替用户选择或提交超长 Segment。
- 单段包含对白且来源顺序与完整节拍允许时，以对白的主要表演位于视频中段为正向布局目标：开头只使用来源已有或理解当前动作所必需的最短建立；对白后存在来源明确的动作或反应时用它形成结尾落点。来源没有后续动作或反应时，以最后音节和同步口型在当前姿态中的自然完成作为落点，不新增事件、反应、动作或额外停顿；若来源事实迫使对白抵达片尾，保留来源顺序与完整性，不为形式上的居中编造内容。
- 相邻 Segment 承接已完成状态，不重演转身、拿取、到达、对白或上一段落点。默认跨段只保证身份、服装、道具、空间、光线与声音相容；当相邻独立 Segment 明确要求从前段结束画面连续开始时，按“多帧运动续接”规则锁定后段的精确起点，但仍不得宣称模型生成的整条接缝天然无缝。
- 表演写可见物理事实：呼吸、视线、下颌、肩颈、手部、步态与接触几何；不写内心解释或空泛情绪副词。每镜选择静止或一种主要运镜，切镜默认硬切。需要切镜时，新镜头必须增加主体、空间、状态、视点或时间信息；只有景别或轻微角度变化时继续当前镜头并使用运镜。
- 需要细化来源已有接触事件的音效时，依据已知材质、动作方式与力度描述必要听感，并对应接触发生的时刻。遵守明确的静默、风格化及原音保留要求；不猜定未知材质、不为音效新增事件，也不要求逐动作配声。
- 先建立来源已有的正常基线，再显示原因或证据，最后呈现人物反应；反应必须由当前或前一可见事件触发。
- 从系统注入的 `productionCapabilities.video.supportedInputModes` 和 `promptProfile` 选择输入与表达；未知或不支持时停止，不按 modelKey 猜测、静默降级或换 Provider。
- H3 的主生成模式是 `reference`：只要存在至少一张合法 `reference_image`，且来源没有明确要求继承前段退出运动、指定首帧或指定首尾帧，就使用 T8 Ref 工作流，无论是否包含对白。只有明确要求相应画面控制时才使用 `continuation`、`first_frame` 或 `first_last_frame`；相互不兼容的控制要求按模式冲突处理。其他模式的时长、拆分和画面规则不得限制或替代 Ref，Ref 执行失败时也不得自动回退到其他模式。
- `durationSeconds` 必须从 `productionCapabilities.video.segmentDurationPlans` 中与已选 `inputMode` 匹配的条目直接选定；`allowedSegmentDurationsSeconds` 只是跨模式能力概览，不得据此给当前模式套用其他模式的时长。匹配条目的 `promptStartSeconds` 是新内容的内部起点，`promptEndSeconds` 是内部终点，`expectedOutputDurationSeconds` 是去掉引导后的预计交付时长。缺匹配条目时停止，不套用其他模式的条目。用户不需要计算、提供或确认小数时间，预计值也不替代生成后的实测时长。
- `vocalPerformanceMode` 每个 item 必须显式填写且不放进 `generationOptions`；对白逐字、自然说完，`silent_no_lip` 时在 warnings 说明用户选择导致的对白不执行。

## 镜头选择与注意力

这些方法用于形成同一个最终 Prompt，服从既有来源、时长、输入模式和 Prompt profile，不另输出镜头分析表或新增字段。

- 先确定本镜呈现的来源事件与观众应注意的对象，再选最少必要的摄影手段。表演和现有构图已能清楚传达时，静止就是有效选择；注意力无需每镜转移。变化由来源事件或已采纳呈现方向驱动，不以运镜数量、复杂度或“每镜不同”衡量电影感。
- 按信息需要选择：推近可突出已有表演细节，拉远或横移可揭示已有空间关系，跟拍可维持行动主体的可读性。同框中已有不同深度的目标需要交接注意力时，可保持机位并转移焦点；写清从哪个目标到哪个目标、由哪个已有节拍触发，不把转焦写成人物移动或新增切镜。
- 对白需要同时观察双方关系时可用双人同框，需要强调一方看另一方的相对视点时可用过肩，需要突出来源已有的反应或信息变化时再考虑正反打；不按每句台词机械切镜，也不为反打补写反应。常规连续性对白默认保持已建立的关系轴同侧，让视线与运动方向相容；来源走位、连续可见机位运动或明确呈现要求改变关系时，描述改变后的空间关系，不机械固定人物的绝对画面坐标。
- 为所选运动描述起始构图、相对主体的路径和终止构图，以及途中确有必要显露的已有信息；仅写影响这次表达的细节。利用前景、门框或遮挡时须有来源依据，不为“空间感”新增实体、发现动作或建立镜头；镜头运动装入已有动作与对白时间，不额外延长表演来完成轨迹。
- 区分机位角度、构图、摄影机位移、变焦、对焦与剪辑，只组合当前镜头需要的维度。仰拍不自动等于强大，俯拍不自动等于弱小；慢速运镜不等于人物慢动作，连续推进不等于多次切镜。明确要求的复合效果应描述协调关系，而非堆叠互相冲突的指令；技法名称只表达创作意图，不证明模型能准确执行，效果以实际成片为准。

## 参考素材

- `reference` 的素材角色和数量必须完全遵守能力声明。普通参考图不是首帧；只有 capability 明确支持且剧情要求从该画面开始时才使用 `first_frame`。
- 每个 item 只列实际使用的 ready Resource，精确复制 `resourceId`、`contentVersion`、`role`、`channel`，顺序与 Prompt 中的媒体编号一致；不得从文件名或近似描述猜身份。
- H3 multimodal v3 同时支持四个互斥模式：`reference` 接受 1–9 张有序 `channel=image, role=reference_image`，并可搭配 1–3 段有序 `channel=audio, role=reference_audio`；图片与音频合计最多 12 个文件。每段参考音频至少 2,000 ms，全部参考音频合计最多 15,000 ms，且音频必须搭配至少一张参考图。`first_frame` 精确接受一张 `role=first_frame`；`first_last_frame` 精确接受一张首帧和一张尾帧；`continuation` 精确接受一个 `channel=video, role=continuation_video` 的前段 ready 视频。`reference_video` 仍不支持，参考音频不得与帧或 continuation 模式混合。缺首帧、仅尾帧、重复帧、重复 continuation、空引用、超过上限或错误角色时停止。

### 按片段选择人物参考音频

在写每个 `reference` item 的最终 Prompt 前，先完成该 item 的人物声音素材选择；引入人物图片不会自动携带其参考音频。

1. 从本段来源台词和实际 `vocalPerformanceMode` 确定本段需要生成话语的说话人，包括出镜对白、画外音和来源要求的演唱；人物出镜、在别段说话或项目默认 `native_dialogue` 都不等于本段有台词。`silent_no_lip` 不选择人物音色参考。
2. 对每个本段说话人，检查用户明确提供的对应关系与已确认的项目来源，并通过 `list_resources` / `get_resource` 读取对应音频的实际状态、精确版本和时长。只使用已明确属于该说话人的音频；文件名、目录、列表顺序或人物与音频在画布上相邻不能证明对应关系。已有音频但归属或所选版本不明确时，先消除该歧义，不猜配、不静默省略。
3. 本段说话人已有明确对应的可用音频时，必须把它作为 `channel=audio, role=reference_audio` 写入本段 `references`，填写真实 `resourceId + contentVersion`，并按下方 H3 规则把其 `<Audio N>` 绑定到对应 Speaker 和本段实际 `<d>` 发声事件。只写音色描述、只在 Prompt 提到音频或只传 `channel=context` 都没有传入参考音频。相同说话人在本段多次发声只引用同一音频版本一次；同一声音跨段复用相同已确认版本，但每段独立选择和编号，不能沿用前段的 Audio 编号。
4. 只出镜、没有台词的人物保留本段需要的图片，不附带其人物音频；多人同框只带本段实际说话者的音频。独立环境声、物理音效和原音复用仍按各自实际用途选择，不受“可见人物有台词”这一人物音色条件限制。
5. 没有对应参考音频时，沿用来源支持的声音描述，不虚构音频、不为补齐人物素材擅自生成音频，也不声称音色已锁定。已指定音频未 ready、版本不可用、时长不合规或本段必需音频超过能力上限时，明确报告阻塞，不静默丢弃、替换、裁切音频或改换输入模式。

例如甲、乙同框且各有已确认音频：第一段仅甲说话，引用两人的图片和甲的音频；第二段仅乙说话，引用本段需要的图片和乙的音频；两人都无台词的片段不带这两份人物音频。选定素材后一次性形成完整 Prompt 与 `references`，提交 `create_video` 时原样使用同一 item。

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

本节定义导演职责；六段名称与顺序、时间和切镜格式、播放主体定义、说话人及跨镜声音的结构见程序装配的语法附录。附录中的占位符必须换成真实来源事实，不能复制示例编号或凭空添加对白。区分 H3 表达方式、应用为绑定与校验采用的严格写法、导演建议；通过本地语法校验不等于模型画面已满足要求。

| 段落 | 要表达的事实 | 边界 |
| --- | --- | --- |
| subject_definitions | 来源主体的稳定身份、实际图片来源、声音身份与 Audio 用途 | 不把目标未来状态写成来源现状；每个独立主体和 Audio 各定义一次 |
| summary | 本段核心变化和实际参考方式 | 简明概括，不复制台词、细节时间线或反复强调的禁令 |
| retention_analysis | 每个引用保留哪些属性、哪些属性按本轮目标改变 | 关系必须与实际修改一致；不把发生变化的属性声明为完全保留 |
| detailed_description | 按时间发生的状态变化、接触、构图、表演、对白和世内同步声音 | 每镜有入口、过程和落点；引用在真正生效的事件中出现 |
| overall_soundscape | 实际环境声、物理动作声和非语言人声 | 一个连续英文段落，不复制对白、歌词或逐镜时间线 |
| non_diegetic_music | 固定 N/A | 观众侧配乐走独立音乐工作流；不影响画面内实体真实播放音乐 |

除对白原文和明确要求的画面内文字外，协议正文使用英文，不混入 generic_v1 标签。

- 视觉身份用 Subject，独立构图/分镜参考用 Picture；冻结媒体按图片通道和音频通道各自顺序编号，context 不占号。场景、服装、道具可作为有真实来源的 Subject 或主体描述，不另造 Scene/Prop 标签；当前能力不接受 reference_video，因此不用 Video 标签。
- 除 continuation 外，从图中引用的主体均绑定实际 Picture。每个 Audio 独占定义：可见参考主体的声音绑定其 Subject 和 Speaker；无对应 Subject 的声音用稳定描述和 Speaker；环境声、物理音效或独立原音复用不虚构 Speaker。一个 Audio 定义只能绑定一个说话人。continuation 使用冻结前段事实，不发明 Picture 或 Audio。
- reference 的 summary 以前缀 [reference generation] 开始；音频保留关系 fully_copy/partially_copy 添加 audio reuse，reference/weak_reference 添加 audio reference；两类并存时都加入，同一方括号内用加号连接且不重复。只概括实际动作和用途。
- reference 的 retention_analysis 每个独立引用一行，以该标签为首，随后为冒号、关系名、短横线和说明。视觉关系是 fully_preserved、partially_preserved、attribute_transfer、weak_reference；音频关系是 fully_copy、partially_copy、reference、weak_reference。Audio 项可重复同一个 Audio 和相应 Subject，不混入其他 Audio 或 Speaker 标记。continuation 写清继承进入点的姿态、运动、接触和镜头趋势。
- 有参考音频的发声事件必须在同一镜头或语义阶段内显式关联对应 Speaker、Audio 和 d 台词块。推荐使用附录中带明确 voice timbre 用途的单人或齐声形式；多人齐声逐人映射，各段独立编号。同一个 Speaker 可以有多个实际音频；已有合法的前置音频、反向绑定和明确回指仍可用，但不能隔着新镜头、时间阶段、分号或另一发声事件借用标记。无参考图的来源声音不强加 Subject；无参考音频的对白不强加 Audio。
- 音色、节奏、情绪和表达方式的参考不授权复制音频中的原台词。仅复制来源明确要求复用的原话；目标对白仍来自当前剧本或明确逐字要求。
- 无独立说话人绑定的 Audio 也要实际发声：同步声音写入 detailed_description，环境声与物理音效写入 overall_soundscape。自然环境声可写 wind ambience from <Audio N> fills the room；裸标签、否定关系和视觉波形都不能证明可听应用。可见实体播放音乐时使用下方播放规则。

Ref 视觉引用按“来源 → 定义 → 保留 → 应用”闭合：每张实际提交的图片都在来源 Subject 的定义中说明用途，或独立定义为构图/分镜参考 Picture；编号按图片通道的冻结顺序，不受穿插的 Audio/context 影响。同一个 Subject 可以来自多张图片，一张图片也可以提供多个 Subject。仅作为 Subject 来源的 Picture 不另建定义和保留项；独立承担构图/分镜用途的 Picture 才有自己的定义与保留项。

每个独立来源 Subject/Picture 各占一条定义和一条保留项，并在 `detailed_description` 的实际生效位置使用同一标签；整体风格可在首镜前的风格句中应用。保留项中的 Shot 必须真实存在；不用每句或每镜重复所有标签。按实际用途选择保留关系，不把换装、属性迁移或新增动作一律改为 `fully_preserved`。目标新增的内容不虚构图片来源，已有 target-visible 播放实体不要求来源保留项。未使用的图片应在提交前由主 Agent 修正素材选择，不交给服务器静默删除或重排。

剧本已有但没有参考图的临时人物或群演，用稳定的普通英文描述参与镜头，发声时配稳定 `(Sx)`，不要声明无图片来源的 `<Subject N>`。`target-visible in-scene playback entity` 只用于实际画面内播放实体，不能套给普通人物来绕过来源校验。已确认主要角色有图片资产时仍必须使用真实图片和 Subject 绑定，不能改成普通描述来省略角色参考。

提交前校验失败时，逐条读取工具返回的 `corrections`，按分段 identity、section、issueCode 和具体编号修改当前专业结果；修复人物来源、切镜或音色应用不能删除对白、缩短剧情或丢弃必需资产。无对白样例若同时删除了人物定义，只能证明该样例通过，不能据此断言 `<d>` 校验有问题。完整句末标点、语言前缀和标签边界可以修正，来源台词与自然表演节奏必须保留；遇到需要修改来源内容的冲突先报告。

画面内实体实际播放的参考音乐是世内同步声音，写入 detailed_description。按真实来源选择附录中完整的 source-backed 或 target-visible 定义，再用其中的物理播放结构关联同一 Subject 与 Audio。来自参考图的定义在 Picture 后接冒号；目标新增实体必须已获来源或用户授权，不能伪称来自 Picture。自然描述实体和输出部件，不把未知物体、画外观众或自由文本目的地充当已定义的物理输出；这种声音不能因独立配乐策略被删除。

### H3 镜头、运镜与声音语法

- reference 的 detailed_description 先用一至两句英文建立整体画面风格，再开始首镜；其他模式直接开始首镜。首镜不带时间戳，帧模式的首句绑定实际首帧时间。真实切镜才增加连续镜号，用附录的完整切镜结构；上一镜不预告切镜，也不出现未编号的切镜。切点在注入的有效时间内严格递增，默认硬切，其他转场只用于明确来源要求。
- 时间阶段不是镜头边界：同一连续物理动作或同一主要运镜能够承载的内容只使用一个 `[Shot 1]`，可在镜内用 `At MM:SS.mmm` 描述动作阶段。用户明确要求单镜头时不得切镜；`first_last_frame` 默认用单镜连续插值，只有来源明确规定多镜时才增加镜头。
- 运镜作为当前镜头中的自然英文动词句，不堆标签。H3 类型为 `Zoom In/Out`、`Push In/Pull Out`、`Pan Left/Right`、`Truck Left/Right`、`Tilt Up/Down`、`Pedestal Up/Down`、`Arc Shot`、`Tracking Shot`、`Static Shot`、`POV`、`Roll Clockwise/Counterclockwise` 或 `Shake Slightly/Strongly`，但正文统一使用 `The camera + 小写动词`：`zooms`、`pushes`、`pulls`、`pans`、`trucks`、`tilts`、`pedestals`、`arcs`、`tracks`、`holds a static shot`、`uses a POV shot`、`rolls` 或 `shakes`。默认中等幅度和正常速度不写；来源要求小幅、大幅、慢速或快速时分别写 `with small/large amplitude` 与 `at slow/fast speed`。例如 `The camera pulls out with small amplitude at slow speed.`；默认值时直接写 `The camera tracks the woman.`，不写 `natural/normal speed`、`medium amplitude`、`performs a Pull Out` 或 `a slow Push In`。
- 实际说话或歌唱的声音源按首次发声顺序获得稳定 `(S1)`、`(S2)`；跨镜复用同一 ID，从不发声的角色不分配 ID。把身份、ID、动作与发声写成一个句子。多人同声说同一句来源原文时，使用一个复合 ID 和一个 `<d>`；多人同时说不同来源原文时，每条台词分别保留自己的稳定 ID 与独立 `<d>`，并在块外说明二者重叠。首次发声时只用来源已有的身份与声音事实建立说话人，身份短语、ID、动作和语气放在 `<d>` 外；不在同一事件里重复声明说话人或添加 `says exactly:`、`the first speaker is`。
- `<d>` 内只放 `[Language]` 与用户或来源逐字提供的对白、歌词，不加反引号、说话人说明、voiceover 字样或翻译。每个完整陈述、问句或感叹句的 `.?!`（中文可用 `。！？`）必须放在 `</d>` 前；只有以 `<cutoff>` 结束的明确截断话语，或以成对 `<scenetrans>` 连接到下一镜的未完成前半句，不要求在当前块补句末标点。可见文字是条件槽：字幕、caption、逐字歌词和对白翻译永远不得作为可见文字；把同步台词改称 bottom text、translation 或 karaoke 也不构成例外。其他文字只有用户或来源明确要求画面中出现逐字内容时，才用 ASCII 英文双引号保留；生成出的 detailed_description 不能给自己授权。保留用户要求的招牌、包装文字和非字幕标题，不因它们出现在画面底部或恰逢人物说话就当成字幕。官方列出的 banner、sign、label、neon text 等明确文字载体在句首或镜头子句起始处可直接写成 `{明确载体} reading "逐字文字"`；其他任意载体及嵌入人物动作的载体统一写成 `{实际载体} bears visible text reading "逐字文字"`，不靠名词清单猜测其是否可见。`reading` 必须修饰载体或 `visible text`，不得描述人物朗读。逐字文字自身含 ASCII 双引号时，用反斜线转义内层双引号，例如 `A sign reading "He said \"Hello\"."`；转义符只承担边界语法，不改变文字内容。`detailed_description` 中其他内容不得使用双引号代替 `<d>`。对白只是音轨内容，绝不能因为来源提供了逐字台词而被解释为需要显示的文字。执行层只校验并拒绝错误，不改写台词、删图或另发一次 LLM 润色请求。
- 无字幕是本 Skill 对导演的要求，不是要复制给视频模型的场景内容。最终 `reference` Prompt 不写字幕或 caption 的正向、否定或反复强调指令；不再要求固定禁令句，也不把本段规则翻译后塞入 `summary`。把画面写成来源中的主体、物理动作、光线、材质和空间关系；来源没有要求图形元素时可写 `The entire image depicts only the physical scene described below.`，这是表达示例而非必填口令。来源明确要求的非字幕标题、招牌等仍按上述文字槽保留。
- 声音和表演只按实际 `vocalPerformanceMode` 描述：出镜对白可用 `Spoken dialogue is heard through natural voices synchronized with the visible speakers.`；画外音、原音复用和静默模式不套用出镜口型句。口型与节奏使用实际需要的 `natural lip movement`、`relaxed jaw motion`、`separated beats` 等物理描述，不为去字幕删改对白、添加停顿或改变发声模式。`overall_soundscape` 只写环境声、衣物声、脚步声、呼吸等非语言声音，不再写 `clean speech`、`clear speech` 或 `spoken line`。
- 风格从已确认方向与参考素材落实为具体摄影、照明、色彩和材质，不自行添加影视作品、年代电视剧或播出版式的概括标签；若用户明确指定这类风格，保留其视觉目标并具体描述。来源没有要求逐字道具文字时，只描述道具外观与动作，不补写可读性、转写或解读文字的说明。这里不禁用通用英文单词；来源事实、合法画面文字和逐字对白优先。
- `voiceover` 必须在同一句中把来源人物、稳定 ID、`<d>` 和“所有可见人物均不做口型”绑定；不能只约束发声者本人。对白跨切镜时，把 `<scenetrans>` 放在前后两个 `<d>` 内的连接点并明确声音连续跨切。`reference` 只有在来源或用户明确要求话语被视频结尾截断时，才在最后一个 `<d>` 内使用一次 `<cutoff>`，将它放在对白末尾、紧邻 `</d>`，并让该 `</d>` 成为 `detailed_description` 的最后实质内容（其后只可有终止标点）；其余情况及其他输入模式仍按时长—内容冲突停止构造可执行 item。跨镜结构使用语法附录，不照搬占位内容；同一台词的跨镜拆块不得改变原话，Audio 映射只用于实际有参考音频的说话人。

- 完整对白、歌词和对应 `<d>` 只出现在 `detailed_description`。除 `silent_no_lip` 固定使用 `overall_soundscape: N/A` 外，`overall_soundscape` 用 1–4 句概括环境声、物理动作声和非语言人声，不包含 `<d>`，不复述对白或歌唱，也不写非世内音乐。

图片时序语义只由当前显式输入模式决定：

- `reference`：每个 `<Picture N>` 只锁定身份、风格、内容与场景结构，不是首帧或尾帧，不得写成时间锚点。每个 `<Audio N>` 按当前冻结音频的实际角色写明复制、局部复制、参考或弱参考关系。只参考音色、节奏、情绪或表达方式时，不复制原台词，仍使用当前任务的新台词；只有直接复用或用户明确要求重演时才保留来源原文。
- `first_frame`：`detailed_description` 的 `[Shot 1]` 后第一句必须把 `<Picture 1>` 明确对齐 `0.00 seconds`，再描述从该状态连续发展的动作。
- `first_last_frame`：除首帧规则外，必须在同一句中把 `<Picture 2>` 明确对齐匹配 `first_last_frame + requestedDurationSeconds` 条目的 `promptEndSeconds`，并描述从首帧状态连续收敛到尾帧状态的运动路径。来源明确要求多镜时，`<Picture 2>` 只属于最后一个 `[Shot N]`，在该镜结尾成为 Segment 的最终视觉状态，其后不得再有镜头、动作或状态变化。
- `continuation`：不写 `<Picture N>` 时间锚点；`detailed_description` 直接延续运动上下文的退出姿态、速度、方向、接触关系和运镜趋势。时间换算与范围完全遵守上方“多帧运动续接”的匹配条目，不复述或重新表演上下文。

不得调用或描述 ComfyUI AI 节点、下游 Prompt 改写或第二套 Prompt；主 Agent 是唯一 Prompt writer。

## H3 vocalPerformanceMode

- `native_dialogue`：来源有对白时逐字使用 `<d>[Language]...</d>`，由出镜说话人自然口型执行；无来源对白不得补写。
- `lip_sync_for_replacement`：仅在已有最终替换配音逐字稿时使用，文字必须完全一致；音频替换必须由用户显式选择，Skill 不自动替换。
- `voiceover`：明确写画外 `<d>`，时间块内所有可见人物嘴唇闭合。
- `silent_no_lip`：禁止 `<d>`、`<cutoff>` 和可听对白描述，`overall_soundscape: N/A`；即使来源有对白，也在 batch warnings 说明事实未交给视频模型。

## 输出前检查

- 仅对 `reference` item，是否按“按片段选择人物参考音频”核对本段实际发声需求：实际执行台词且有可用对应音频的没有漏传，只出镜无台词或 `silent_no_lip` 时没有夹带人物音色参考；所选音频是否以精确 ready 版本进入 `channel=audio, role=reference_audio`，并与本段 Prompt 的 Speaker/Audio 编号一致？`first_frame`、`first_last_frame` 和 `continuation` 不适用此音频补齐检查，仍遵守各自输入模式的互斥约束。
- 是否区分近似目标、明确严格约束与自主推导；每段请求是否合法、没有填充内容，近似目标是否使用预计输出而不是请求参数求和，后续时间线是否以实测媒体为准；严格约束是否有真实可执行的满足与验证方式，无法满足时是否提交前报告能力或内容冲突？
- 对 H3 中所有由 Agent 选择的单段时长（包括 `fixed` 总时长下的分配与 `derive`），是否先确定模式并只使用该模式的 `segmentDurationPlans`；是否按用户目标与内容节奏选择已有档位且不静默改时长或换模式；其他 Prompt profile 是否只服从注入的合法时长集合？
- 每镜的景别、机位、主体落位、朝向、世内视线，以及静止或主要运镜，是否服务于当前注意对象；来源动作是否有向前变化和可见落点，有运镜时起止构图、呈现对白时空间关系是否清楚，且未为镜头效果新增事件或加时？
- `reference` 的 `detailed_description` 是否先用一至两句英文建立整体画面风格再开始 `[Shot 1]`，且没有把换行当成句数要求；其他模式是否直接以 `[Shot 1]` 开始；每次真实切镜是否都用递增的 `[Shot N] At MM:SS.mmm`、连续动作没有被时间块机械拆镜、单镜要求与 `first_last_frame` 默认单镜是否保留？
- 运镜是否写成自然英文动词句并在来源要求时明确幅度与速度；除对白原文和画面文字外是否没有中文或混合语言残留？
- `reference` 是否只使用当前 capability 冻结的 `<Subject N>`、`<Picture N>`、`<Audio N>` 标签且没有 `<Video N>`；是否只使用 capability 允许的参考角色与数量，四种模式互斥，且 Picture 时间锚点与当前模式及 Segment 时长一致；每个 Audio 是否在 `subject_definitions` 恰好定义一次，并按实际角色选择一个 Subject/Speaker、稳定声音描述加 Speaker，或不绑定独立说话人；是否在自己的 `retention_analysis` 项中使用官方音频关系且不写 `(Sx)`；每个音色生效的 `detailed_description` 发声事件是否在同一分镜或时间阶段内明确对应 Speaker、Audio 与 `<d>`，同时允许前置 Audio 引用、复合 Speaker、英文缩写、小数和有无歧义回指的自然句子标点，且没有跨分镜、新 `At MM:SS.mmm` 阶段、分号或另一发声事件借用标记？
- 是否在存在合法参考图且没有明确运动续接或帧控制时使用主模式 T8 Ref，并只在来源明确要求相应控制时选择其他模式？`durationSeconds` 是否仍为该模式的合法整数，时间条目是否同时匹配输入模式和请求时长，所有锚点是否使用该条目的内部时钟？
- 要求前段运动连续续接时，是否把前段精确 ready 视频版本作为后段唯一 `continuation_video`，且失败时没有单尾帧、参考图、reference video 或时间偏移 fallback？
- H3 是否严格六段、固定 `non_diegetic_music: N/A`、无 AI 节点和无 Prompt 改写？
- 对白是否逐字、自然说完，且 `<cutoff>` 只用于 `reference` 中明确要求被结尾截断的最后一段话语，并让对应 `</d>` 成为详细描述最后实质内容；每个声音源是否有稳定 `(Sx)`，同句齐声是否使用复合 ID、不同台词重叠是否分别保留 ID 与 `<d>`，`<d>` 是否只在 `detailed_description`，跨切 `<scenetrans>` 是否在两个 `<d>` 内，voiceover 是否明确所有可见人物均不做口型？对白后的落点是否只使用来源已有动作或反应，不存在时是否以说话表演自然完成而没有新增内容？可见文字是否只在用户或来源明确要求时按句首官方载体 `{载体} reading "原文"` 或嵌入式 `{载体} bears visible text reading "原文"` 写入双引号，内层 ASCII 双引号是否用 `\"` 保持边界；最终 Prompt 是否用正向场景描述、没有复制字幕禁令或自行添加文字元素，且对白存在没有被误判为需要字幕？

## 边界

本 Skill 只负责导演事实与最终 Prompt。能力、画幅、Resource 身份、Provider 执行、Task 生命周期和合成均由系统契约负责；Skill 不创建第二条执行链。
