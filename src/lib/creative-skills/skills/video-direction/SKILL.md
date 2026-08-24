---
name: video-direction
description: Direct screenplay-based video generation with explicit continuity, physical performance, reference identity, structured timing, sound relationships, and executable final prompts.
---

# 视频导演与生成设计

本 Skill 是 `outputKind=video_generation_batch` 的唯一视频导演 Skill。先建立整片时间线，再设计最少镜头与 Segment，最后按 capability 声明的 Prompt profile 生成每段唯一 Prompt；不输出平行导演表或解释文件。

## 不变规则

- 剧本、用户明确要求、已确认资产、入段状态和已采纳 Creative Direction 是唯一事实；不得新增人物、对白、地点、道具、动作、动机或结局。对白逐字保留。
- `durationIntent.mode=fixed` 时 Segment 总时长必须精确相等；`derive` 只按自然对白、必要来源动作和明确停顿估算，不用重复动作或空镜填时长。
- H3 合法 Segment 时长是 4–13 秒。优先最大允许时长，尾部用最少 Segment 精确补齐；每镜必须有入口、一个向前变化和可见落点。
- 相邻 Segment 承接已完成状态，不重演转身、拿取、到达、对白或上一段落点；跨段只保证身份、服装、道具、空间、光线与声音相容，不宣称帧级无缝。
- 表演写可见物理事实：呼吸、视线、下颌、肩颈、手部、步态与接触几何；不写内心解释或空泛情绪副词。一镜一种主要运镜，默认硬切。
- 先建立来源已有的正常基线，再显示原因或证据，最后呈现人物反应；反应必须由当前或前一可见事件触发。
- 从系统注入的 `productionCapabilities.video.supportedInputModes` 和 `promptProfile` 选择输入与表达；未知或不支持时停止，不按 modelKey 猜测、静默降级或换 Provider。
- `vocalPerformanceMode` 每个 item 必须显式填写且不放进 `generationOptions`；对白逐字、自然说完，`silent_no_lip` 时在 warnings 说明用户选择导致的对白不执行。

## 参考素材

- `reference` 的素材角色和数量必须完全遵守能力声明。普通参考图不是首帧；只有 capability 明确支持且剧情要求从该画面开始时才使用 `first_frame`。
- 每个 item 只列实际使用的 ready Resource，精确复制 `resourceId`、`contentVersion`、`role`、`channel`，顺序与 Prompt 中的媒体编号一致；不得从文件名或近似描述猜身份。
- H3 reference v2 接受 1–8 张 `channel=image, role=reference_image`，按 `references` 的顺序编号；没有 `first_frame`、`last_frame`、`reference_audio` 或 `reference_video`。缺图、超过能力上限或错误角色时停止。

## Prompt profile 选择

- 从系统注入的 `productionCapabilities.video.promptProfile` 选择本批次唯一最终表达方言。
- `generic_v1` 使用下方 generic_v1 最终提示词格式。
- `minimax_h3_reference_v2` 使用下方 H3 最终 Prompt；不得同时输出通用标签格式。
- 缺失或未知 profile 时停止构造可执行 items，不得根据 `modelKey`、Provider 名称或输入模式猜测，也不得回落到 `generic_v1`。
- Profile 只改变同一导演事实的最终表达，不改变剧本、整片时间线、装段、Resource identity 或能力判定。

## minimax_h3_reference_v2 最终 Prompt

- `generic_v1` 使用 generic 的标签格式；不要把其标签混进 H3。
- `minimax_h3_reference_v2` 严格使用下列六段，顺序固定、每段只出现一次，段名在行首：

```text
subject_definitions:
summary:
retention_analysis:
detailed_description:
overall_soundscape:
non_diegetic_music:
```

除对白原文和画面内文字外正文使用英文。`subject_definitions` 必须把每个实际使用的主体、服装、场景或道具绑定到对应的 `<Picture 1>` 至 `<Picture N>`，不得引用不存在的编号；`summary` 是动作摘要；`retention_analysis` 写身份、服装、比例、风格、场景和道具关系；`detailed_description` 从 0.00 秒写连续可见动作、机位、落位、视线与落点；`overall_soundscape` 只写对白、环境声、动作声和非语言人声。

每个 `<Picture N>` 都只锁定其绑定的身份、风格、内容与场景结构，不是首帧，不得写成第一帧锚点。不得调用或描述 ComfyUI AI 节点、下游 Prompt 改写或第二套 Prompt；主 Agent 是唯一 Prompt writer。

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

- 是否先有整片时间线，再有最少 Segment 与镜头；总时长、4–13 秒范围和时序是否准确？
- 每镜是否有景别、机位、主体落位、朝向、世内视线、一个主要运镜、向前变化和可见落点？
- 是否只使用 capability 允许的参考角色与数量，且每个 `<Picture N>` 未被当作首帧？
- H3 是否严格六段、固定 `non_diegetic_music: N/A`、无 AI 节点和无 Prompt 改写？
- 对白是否逐字、自然说完、声音关系清楚；是否固定写入不生成字幕、标题、水印、拼贴、分屏或额外人物？

## 边界

本 Skill 只负责导演事实与最终 Prompt。能力、画幅、Resource 身份、Provider 执行、Task 生命周期和合成均由系统契约负责；Skill 不创建第二条执行链。
