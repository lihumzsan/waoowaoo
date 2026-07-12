# 首尾帧智能推荐时长设计

## 目标

为小说推文视频阶段的首尾帧生成模式增加可解释的智能推荐时长：

- 仅对 `videoGenerationMode === 'firstlastframe'` 生效。
- 推荐结果直接成为首尾帧“时长”下拉框的默认值。
- 用户手动选择后，手动值永久优先，后续重新分析不得覆盖。
- 复用现有首尾帧提示词视觉分析，不增加正常路径上的 AI 请求。
- 将 Goon 首尾帧工作流的应用层时长范围调整为 4–15 秒、整数步长 1 秒。
- 分清分镜规划时长、首尾帧生成目标时长和实际媒体时长，避免继续混用。

## 非目标

- 不修改普通单图视频、批量普通视频或其他非首尾帧工作流的默认时长逻辑。
- 不根据简单图片相似度直接推导秒数。
- 不让 AI 直接、不受约束地决定最终时长。
- 不在本次功能中训练新的时长预测模型。
- 不要求新增数据库列；优先扩展现有结构化 JSON 字段。
- 不在智能分析失败时阻断视频生成。

## 行业依据

主流首尾帧和关键帧视频产品通常把时长作为显式镜头或时间线参数，而不是从两张图片差异中隐式推导：

- Google Veo 首尾帧生成接受模型限定的显式时长值。
- Luma Ray2 使用 5/10 秒生成，并通过 Extend 处理更长内容。
- Runway 和 Adobe Firefly 由用户明确选择生成时长。
- Kling 支持逐镜头设置最长 15 秒。
- LTX 底层以 `num_frames` 和关键帧目标位置精确控制时间，帧数遵循 `8n+1`。

本设计因此把“智能”定义为可解释推荐，并保留明确的用户控制权。

参考资料：

- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-first-and-last-frames
- https://lumalabs.ai/learning-hub/dream-machine-guide-ray2
- https://docs.dev.runwayml.com/guides/using-the-api/
- https://helpx.adobe.com/uk/firefly/web/work-with-audio-and-video/work-with-video/generate-videos-using-non-adobe-models.html
- https://github.com/Lightricks/LTX-Video

## 当前问题

系统当前混用了三类时长：

1. `panel.duration`：分镜规划阶段保存的规划值，可能来自 AI 或对话时长估算。
2. `generationOptions.duration` / `videoDurationBinding.targetDurationSeconds`：实际提交给生成路由的目标值。
3. MP4 实际时长：由工作流输出帧数和帧率决定，目前未作为卡片显示值持久化。

Goon 接入层目前只接受 `[4, 5, 6, 8, 10, 12]`，未命中的值回退 10 秒；工作流本身按 24fps 和 `8n+1` 帧规则可支持已验证的 4–15 秒整数时长。

## 总体架构

采用“复用 AI 提取结构、本地确定性计算、用户手动优先”的混合方案：

```text
连接首尾帧
  -> 现有首尾帧提示词视觉分析
  -> 同时返回提示词和结构化运动分析
  -> 本地确定性时长计算器
  -> 推荐值成为该首尾帧下拉框默认值
  -> 用户可手动覆盖
```

AI 只负责识别动作、并行关系、运镜、节奏和连续性。最终秒数由可测试的本地规则计算并受工作流能力约束。

## 结构化分析契约

首尾帧提示词任务在现有结果上增加运动分析：

```ts
type FirstLastFrameMotionBeatType =
  | 'micro_motion'
  | 'gesture'
  | 'body_action'
  | 'locomotion'
  | 'environment_change'
  | 'transformation'
  | 'camera_standard'
  | 'camera_large'

type FirstLastFrameMotionBeat = {
  type: FirstLastFrameMotionBeatType
  order: number
  parallelGroup?: string
}

type FirstLastFrameDurationAnalysis = {
  motionBeats: FirstLastFrameMotionBeat[]
  pacing: 'fast' | 'normal' | 'slow'
  continuity: 'good' | 'challenging' | 'discontinuous'
  confidence: number
  reason: string
}
```

约束：

- `order` 表示串行阶段顺序。
- 相同 `parallelGroup` 的动作视为并行，只取该组最长基础时间。
- `confidence` 必须在 0–1。
- `reason` 是面向用户的简短中文说明，不包含内部评分细节。
- 解析器必须拒绝未知枚举、非有限数值、过多动作和超长说明。

## 确定性时长计算

### 基础时间表

| 动作类型 | 基础秒数 |
| --- | ---: |
| `micro_motion` | 1 |
| `gesture` | 2 |
| `body_action` | 3 |
| `locomotion` | 4 |
| `environment_change` | 3 |
| `transformation` | 4 |
| `camera_standard` | 2 |
| `camera_large` | 3 |

### 计算步骤

1. 将动作按 `order` 分成串行阶段。
2. 同一阶段中的并行动作只取最大基础秒数。
3. 各串行阶段耗时相加。
4. 加入 0.5 秒开场稳定和 0.75 秒尾帧停留。
5. 应用节奏系数：快速 0.85、正常 1.0、缓慢 1.15。
6. 若有有效音频硬约束，结果不得短于音频目标时长。
7. 四舍五入到整数秒，并限制在 4–15 秒。
8. 根据 24fps 和 `8n+1` 生成合法帧数。

示例：

```text
转身 body_action = 3 秒
行走 locomotion = 4 秒
光芒扩散 environment_change = 3 秒，与行走并行
缓推 camera_standard = 2 秒，与行走并行

动作时间 = 3 + max(4, 3, 2) = 7 秒
加入首尾稳定 = 8.25 秒
正常节奏 = 8.25 秒
整数推荐 = 8 秒
```

### 低置信度和不连续画面

- `confidence` 低于可信阈值或分析结构无效：使用降级链，不采用新推荐。
- `continuity === 'challenging'`：允许推荐，同时显示谨慎提示。
- `continuity === 'discontinuous'`：回退 10 秒并提示“建议增加中间关键帧”，不通过延长时长掩盖连续性问题。

可信阈值应作为具名常量集中管理，初始值为 0.6，后续可根据实际保留率校准。

## 状态模型与优先级

扩展现有 `videoDurationBinding` JSON，保留原有 `mode` 语义并增加来源元数据：

```ts
type VideoDurationSource = 'smart' | 'manual'

type VideoDurationBinding = {
  mode?: 'manual' | 'match_audio'
  voiceLineIds?: string[]
  targetDurationSeconds?: number
  durationSource?: VideoDurationSource
  recommendationConfidence?: number
  recommendationReason?: string
  recommendationFingerprint?: string
}
```

状态优先级：

```text
有效手动值
  > 有效音频硬约束
  > 当前输入指纹对应的智能推荐
  > 最近一次有效智能推荐
  > 现有已保存目标值
  > 工作流默认 10 秒
```

规则：

- 用户选择下拉框值后，立即保存 `durationSource: 'manual'`。
- 只要来源是 `manual`，任何后台重算都不得覆盖 `targetDurationSeconds`。
- 用户点击“恢复智能推荐”后清除手动来源，优先使用当前缓存推荐；没有缓存时重新分析。
- 旧的 `mode: 'manual'` 且存在有效目标值但没有 `durationSource` 的记录，按手动值处理。
- `mode: 'manual'` 但没有有效目标值的旧记录，视为没有有效选择。
- `match_audio` 保持现有音频约束行为；智能推荐不得短于有效音频目标。

## 输入指纹与重算

推荐结果按以下输入生成稳定指纹：

- 首帧媒体稳定标识；
- 尾帧媒体稳定标识；
- 两个分镜的描述、景别、运镜、场景类型和相关文本；
- 首尾帧提示词来源版本；
- 关联音频选择及其时长；
- 工作流键和智能推荐算法版本。

触发重算：

- 第一次建立首尾帧连接；
- 首帧或尾帧变化；
- 首尾帧提示词重新生成；
- 分镜描述、景别或运镜变化；
- 关联音频变化；
- 工作流或算法版本变化。

不触发重算：

- 展开或关闭下拉框；
- 页面刷新；
- 视频播放、下载或预览；
- 用户只修改时长。

相同指纹直接复用缓存结果。手动模式下可以更新后台缓存，但不得改变当前选择。

## 界面设计

仅首尾帧模式显示智能推荐状态。

默认状态：

```text
时长
8 秒（智能推荐）
推荐依据：包含转身和位置移动，镜头缓慢推进
```

下拉框提供 4–15 秒整数选项，推荐值带“智能推荐”标签。

用户手动选择后：

```text
时长来源：手动
恢复智能推荐
```

分析期间：

```text
时长：分析中…
```

由于视频生成已经依赖首尾帧提示词就绪，推荐分析复用同一任务，不增加新的阻塞阶段。

不连续画面：

```text
当前使用 10 秒
首尾画面变化较大，建议增加中间关键帧
```

## 失败降级

智能分析失败不得阻止视频生成。降级顺序为：

```text
有效手动值
  -> 最近一次有效智能推荐
  -> 现有已保存目标值
  -> 工作流默认 10 秒
```

以下情况进入降级：

- AI 输出缺字段或 JSON 解析失败；
- 枚举、动作数量、置信度或数值非法；
- 推荐结果越界；
- 首尾帧提示词任务使用回退提示词；
- 缓存版本或指纹不匹配。

面向用户统一显示可理解信息，不暴露内部错误：

```text
智能分析未完成，当前使用默认 10 秒
```

后台日志记录具体失败阶段、输入指纹、算法版本和降级来源。

## 工作流能力与帧数

Goon 首尾帧工作流能力改为：

```text
最短时长：4 秒
最长时长：15 秒
步长：1 秒
默认时长：10 秒
帧率：24fps
帧数规则：1 + 8 * round(duration * 24 / 8)
```

4–15 秒的整数输入均生成合法的 `8n+1` 帧。非法、非整数或越界输入由边界校验明确拒绝或按既定降级链处理，不再静默将所有未命中离散白名单的值改成 10 秒。

## 性能设计

正常路径不新增 AI 请求：

```text
首尾帧提示词视觉调用
  = 提示词生成
  + 结构化运动分析
```

性能目标：

- 本地时长计算小于 5ms。
- 相同输入指纹命中缓存，不重复分析。
- 页面渲染不等待额外网络请求。
- 智能分析失败不阻塞视频任务。
- 手动时长保存不触发 AI 分析。

第一版不增加独立图片相似度、目标检测、姿态识别或额外视觉模型调用。

## 测试设计

### 单元测试

- 串行动作耗时相加。
- 并行动作取最大值。
- 节奏系数正确应用。
- 音频硬约束不会被推荐值缩短。
- 结果被限制在 4–15 秒。
- 4–15 秒均生成正确的 24fps、`8n+1` 帧数。
- 无效、低置信度和不连续分析正确降级。
- 普通视频模式完全不启用智能推荐。

### 状态测试

- 第一次连接后推荐值成为默认值。
- 图片或上下文变化时智能值更新。
- 手动选择后任何重算都不覆盖。
- “恢复智能推荐”采用当前缓存或重新分析。
- 页面刷新后来源状态保持。
- 旧 manual 数据按手动值兼容。
- 旧无目标 manual 数据允许智能推荐。
- `match_audio` 不得到短于音频要求的目标。

### 接口与 Worker 测试

- 结构化分析从提示词任务正确保存和返回。
- 推荐值进入 `generationOptions.duration`。
- 4–15 秒不会被错误回退为 10 秒。
- Goon 工作流正确注入秒数、24fps和帧数。
- 非首尾帧路由保持原行为。
- 分析失败不影响视频任务入队。

### 性能与回归测试

- 正常路径 AI 调用次数不增加。
- 相同指纹不重复分析。
- 手动选择不触发分析。
- 现有首尾帧提示词缓存、恢复、重试和编辑流程保持正常。

### 真实验证

- 在运行栈中分别生成推荐 4、8、10、15 秒的首尾帧视频。
- 验证任务载荷、ComfyUI 节点秒数、帧数和最终 MP4 实际时长。
- 验证手动覆盖、刷新、图片变更和恢复智能推荐的完整交互。

## 分支与实施约束

- 设计和实现位于从 `codex/codex-image-generation` 创建的 `codex/first-last-smart-duration` 分支。
- 实施必须使用测试驱动方式：先增加失败测试，再写最小实现。
- 不提交或覆盖用户的无关改动。
- 完成前必须运行相关单元、接口、Worker 和真实运行验证。
