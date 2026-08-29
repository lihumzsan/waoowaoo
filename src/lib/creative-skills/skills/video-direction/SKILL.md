---
name: video-direction
description: Direct screenplay-based video generation with explicit continuity, physical performance, reference identity, structured timing, sound relationships, and executable final prompts.
---

# 视频导演与生成设计

本 Skill 是 `outputKind=video_generation_batch` 的唯一视频导演 Skill。先建立整片时间线，再按内容边界设计镜头与 Segment，最后按 capability 声明的 Prompt profile 生成每段唯一 Prompt；不输出平行导演表或解释文件。

## 不变规则

- 剧本、用户明确要求、已确认资产、入段状态和已采纳 Creative Direction 是唯一事实；不得新增人物、对白、地点、道具、动作、动机或结局。对白逐字保留。
- 时长决策先区分用户固定目标与 Agent 自主推导。用户明确固定的合法单段时长优先于自主规划启发式，只要它属于 `allowedSegmentDurationsSeconds` 就原样执行；不得用“常规时长”覆盖用户已经锁定的合法单段。
- `durationIntent.mode=fixed` 时先联合求解 Segment 边界与时长：每段时长都必须来自 `allowedSegmentDurationsSeconds`，且总和精确等于用户目标；没有这种组合时，在验证内容之前停止构造可执行 items，并明确报告目标时长与能力集合冲突。存在合法组合后，再验证来源内容能否在各段内自然完成；若不新增、重复、延长、截断内容或压缩表演仍无法满足，明确报告时长与内容冲突。两类失败都不得静默改变用户目标或用空镜、停顿和保持画面填满。
- `durationIntent.mode=derive` 时只从来源内容计算完整表演节拍：来源要求的最短必要建立、自然对白或动作，以及来源明确要求的后续动作或反应；同时发生的内容仍按 `creative-core` 取最长项。先按来源动作、说话轮次和语义边界组合节拍，再从 `allowedSegmentDurationsSeconds` 选择能完整承载每个节拍的最短值，不以减少 Segment 数或用满时长上限为目标。若剩余来源内容短于合法最小时长且无法与相邻来源节拍合并，或长于合法最大时长且没有合法切点，停止并明确报告能力与内容冲突，不得补写或拉长内容。
- H3 合法 Segment 时长是 4–13 秒。凡单段时长由 Agent 选择（包括 `fixed` 总时长下的分配与 `derive`），能在 4–6 秒完成的简单节拍直接使用 4–6 秒，常规 Segment 不超过 10 秒；无对白节拍超过 10 秒时按来源真实动作边界拆分，找不到合法边界则按下一条的溢出失败规则处理。每镜仍必须有入口、一个向前变化和可见落点。
- H3 中只有“完整对白节拍”在 10 秒内放不下时，才逐级使用最短充分的 11–13 秒；判断对象是来源要求的最短必要建立、自然对白和来源已有结尾落点的总时长，不是对白文字单独的说话时间。完整节拍超过 13 秒时只在完整句、说话轮次或真实语义边界拆分，逐字内容和顺序不变；没有合法切点时按下一条的溢出失败规则处理，禁止强拆、加速和截断。
- H3 中完整节拍超过 13 秒且没有合法切点时，停止构造可执行 items 并报告输入内容与能力策略冲突；合法纠正只能是修改来源内容或形成真实语义切点。这里只报告失败事实和合法纠正条件，不调用 `wao.request_user_decision`、不创建新的 alignment checkpoint，也不替用户选择或提交超长 Segment。
- 单段包含对白且来源顺序与完整节拍允许时，以对白的主要表演位于视频中段为正向布局目标：开头只使用来源已有或理解当前动作所必需的最短建立；对白后存在来源明确的动作或反应时用它形成结尾落点。来源没有后续动作或反应时，以最后音节和同步口型在当前姿态中的自然完成作为落点，不新增事件、反应、动作或额外停顿；若来源事实迫使对白抵达片尾，保留来源顺序与完整性，不为形式上的居中编造内容。
- 相邻 Segment 承接已完成状态，不重演转身、拿取、到达、对白或上一段落点。默认跨段只保证身份、服装、道具、空间、光线与声音相容；当相邻独立 Segment 明确要求从前段结束画面连续开始时，按“末帧派生续接”规则锁定后段的精确起点，但仍不得宣称模型生成的整条接缝天然无缝。
- 表演写可见物理事实：呼吸、视线、下颌、肩颈、手部、步态与接触几何；不写内心解释或空泛情绪副词。一镜一种主要运镜，默认硬切。
- 先建立来源已有的正常基线，再显示原因或证据，最后呈现人物反应；反应必须由当前或前一可见事件触发。
- 从系统注入的 `productionCapabilities.video.supportedInputModes` 和 `promptProfile` 选择输入与表达；未知或不支持时停止，不按 modelKey 猜测、静默降级或换 Provider。
- `vocalPerformanceMode` 每个 item 必须显式填写且不放进 `generationOptions`；对白逐字、自然说完，`silent_no_lip` 时在 warnings 说明用户选择导致的对白不执行。

## 参考素材

- `reference` 的素材角色和数量必须完全遵守能力声明。普通参考图不是首帧；只有 capability 明确支持且剧情要求从该画面开始时才使用 `first_frame`。
- 每个 item 只列实际使用的 ready Resource，精确复制 `resourceId`、`contentVersion`、`role`、`channel`，顺序与 Prompt 中的媒体编号一致；不得从文件名或近似描述猜身份。
- H3 multimodal v3 同时支持三个互斥模式：`reference` 接受 1–8 张有序 `channel=image, role=reference_image`；`first_frame` 精确接受一张 `role=first_frame`；`first_last_frame` 精确接受一张首帧和一张尾帧。三种模式都不接受 `reference_audio`、`reference_video`，也不得混合普通参考图和帧图。缺首帧、仅尾帧、重复帧、空引用、超过上限或错误角色时停止。

### 末帧派生续接

当相邻独立 Segment 必须从前段结束画面连续开始，且前段视频 Resource 已为 `ready` 时，执行顺序固定为：

1. 对前段的精确 `resourceId + contentVersion` 调用 `extract_video_frame`，显式传入 `selector=last_decodable`；
2. 等派生图片 Resource 到达 `ready`，不得用视频 URL、临时截图或上一轮普通参考图代替；
3. 后段只把该图片的精确版本作为 `channel=image, role=first_frame` 提交；只有另有独立目标结束图片时，才与它组成 `first_last_frame`；
4. 抽帧失败、取消或没有 ready 图片终态时停止后段提交并报告失败，不得降级为 `reference_image` 或改用近尾时间帧。

该流程只派生可复用首帧输入，不改变来源对白、动作边界、Segment 时长或 Prompt writer。

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

除对白原文和画面内文字外正文使用英文。`subject_definitions` 必须把每个实际使用的主体、服装、场景或道具绑定到对应的 `<Picture 1>` 至 `<Picture N>`，不得引用不存在的编号；`summary` 是动作摘要；`retention_analysis` 写身份、服装、比例、风格、场景和道具关系；`detailed_description` 从 0.00 秒写连续可见动作、机位、落位、视线与落点；`overall_soundscape` 只写对白、环境声、动作声和非语言人声。

图片时序语义只由当前显式输入模式决定：

- `reference`：每个 `<Picture N>` 只锁定身份、风格、内容与场景结构，不是首帧或尾帧，不得写成时间锚点。
- `first_frame`：`detailed_description` 开头必须在同一句中把 `<Picture 1>` 明确对齐 `0.00 seconds`，再描述从该状态连续发展的动作。
- `first_last_frame`：除首帧规则外，必须在同一句中把 `<Picture 2>` 明确对齐当前 Segment 的精确结束秒数，并描述从首帧状态连续收敛到尾帧状态的运动路径。

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

- 时长意图是否先正确区分用户固定目标与 Agent 自主推导；固定目标是否能由 `allowedSegmentDurationsSeconds` 中的时长精确组成、每段是否合法且没有填充内容，`derive` 是否按完整来源节拍选择最短充分值，无法满足时是否按目标—能力或时长—内容冲突原地停止？
- 对 H3 中所有由 Agent 选择的单段时长（包括 `fixed` 总时长下的分配与 `derive`），简单内容是否真实使用 4–6 秒、常规段是否保持在 10 秒内、11–13 秒是否只用于完整长对白节拍、每段是否都在 4–13 秒硬边界内；溢出失败是否只列出合法纠正条件且没有新增 decision checkpoint，其他 Prompt profile 是否只服从注入的合法时长集合？
- 每镜是否有景别、机位、主体落位、朝向、世内视线、一个主要运镜、向前变化和可见落点？
- 是否只使用 capability 允许的参考角色与数量，三种模式互斥，且 Picture 时间锚点与当前模式及 Segment 时长一致？
- 要求前段末画面续接时，是否先从前段精确 ready 版本派生 `last_decodable` 图片，再把其精确 ready 版本作为后段唯一 `first_frame`，且失败时没有参考图或时间偏移 fallback？
- H3 是否严格六段、固定 `non_diegetic_music: N/A`、无 AI 节点和无 Prompt 改写？
- 对白是否逐字、自然说完并在来源允许时主要位于中段；对白后的落点是否只使用来源已有动作或反应，不存在时是否以说话表演自然完成而没有新增内容？声音关系是否清楚，是否固定写入不生成字幕、标题、水印、拼贴、分屏或额外人物？

## 边界

本 Skill 只负责导演事实与最终 Prompt。能力、画幅、Resource 身份、Provider 执行、Task 生命周期和合成均由系统契约负责；Skill 不创建第二条执行链。
