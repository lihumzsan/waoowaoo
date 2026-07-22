# 独立环境音生成设计

## 目标

在现有“视频工具”页面接入 Stable Audio 3 Medium 环境音工作流。用户提供最终拼接视频，系统自动分析声学场景、生成可编辑的环境音方案，再生成一份与视频时长严格对齐的独立 MP3。系统不修改视频、不混入视频原声或配音，也不按每个分镜零散生成。

## 已确认的产品边界

- 必需输入只有最终拼接视频；优先直接复用视频拼接结果的 `videoKey`，同时允许上传已经拼好的本地视频。
- 剧本或当前片段台词为推荐但非必需的文本输入。
- 对应配音为可选输入，只用于估计对白密度与停顿区间，不做语音转文字，也不进入最终音频。
- 不要求整部小说、全部项目文档或逐分镜提示词。
- 分析按连续“声音环境”分区，不按镜头或分镜切碎。
- 分析完成后展示可编辑方案；用户确认后才生成。
- 最终只输出一份独立 MP3，供用户后续自行合成。

## 附件工作流结论

来源工作流：`audio_stable_audio_3_medium.json`，已由用户在 112 的 ComfyUI 上验证可运行。

核心生成链：

1. `CheckpointLoaderSimple` 加载 `stable_audio_3_medium.safetensors`。
2. `CLIPLoader` 加载 `t5gemma_b_b_ul2.safetensors` 作为 Stable Audio 文本编码器。
3. 正负 `CLIPTextEncode` 生成条件。
4. `EmptyLatentAudio` 决定音频秒数，批量固定为 1。
5. `KSampler` 使用 `steps=8`、`cfg=1`、`sampler=lcm`、`scheduler=simple`、`denoise=1`。
6. `VAEDecodeAudio` 解码成立体声 44.1 kHz 音频。
7. `easy cleanGpuUsed` 释放显存后由 `SaveAudioMP3` 以 V0 质量保存 MP3。

原工作流还能通过 `qwen3.5_2b_bf16.safetensors`、`TextGenerate` 和 Music / Instrument / SFX / One-shot 分类模板二次扩写提示词。本项目上游分析已经输出最终英文环境音提示词，因此接入时关闭该二次改写链，避免默认 Music 分类或短 SFX 时长规则改变环境音语义。生成图保留 Stable Audio 核心模型、采样器、解码和 MP3 输出参数。

附件是 ComfyUI 0.22 风格的界面工作流，当前仓库的通用界面图转换器无法可靠恢复其中无输入定义的 Primitive/Combo 节点和部分 widget 参数。因此项目内保存一个由附件核心链整理出的显式 API 图，并用专用节点契约注入正向提示词、负向提示词、时长和种子，不能直接复制附件后依赖通用猜测。

## 用户流程

环境音卡片放在“视频无缝拼接”结果之后：

1. 拼接成功后自动把拼接结果作为环境音视频来源；用户也可以替换为本地成片。
2. 用户可填写剧本/台词，并可选上传配音。
3. 点击“分析环境音”，后台异步分析视频。
4. 页面展示总体判断和声音区间；区间时间只读，场景、环境底声、事件音、避用声音和英文生成提示词可编辑。
5. 点击“生成环境音”，后台按确认后的方案生成各音频块并合成为一个 MP3。
6. 页面提供试听、下载和按当前方案重新生成。

## 分析架构

分析任务运行在现有 BullMQ 视频队列中，使用 transient job，不写入项目历史和业务表。

1. 校验视频/配音对象 key 必须属于当前用户的 `video-tools/<userId>/...` 范围。
2. 通过 FFprobe 读取视频准确时长、流信息和原始音轨存在性。
3. 通过 FFmpeg 检测明显场景变化，并补充均匀采样点；合并后最多抽取 12 张带时间顺序的代表帧。
4. 若提供配音，通过 FFmpeg `silencedetect` 得到对白活动区间摘要；不保存转写文本。
5. 使用用户已配置的分析模型，将代表帧、时间点、视频时长、可选剧本/台词和对白活动摘要组合成一次视觉分析请求。
6. 模型必须返回结构化 JSON；服务端严格验证区间有序、连续、无重叠、覆盖完整视频且提示词为英文。无效结果明确失败，不静默使用通用环境音替代。

分析结果结构：

```ts
type EnvironmentSoundPlan = {
  durationSeconds: number
  summaryZh: string
  zones: Array<{
    id: string
    startSeconds: number
    endSeconds: number
    sceneZh: string
    ambienceZh: string
    eventSoundsZh: string[]
    avoidSoundsZh: string[]
    promptEn: string
    negativePromptEn: string
    transitionToNext: 'smooth' | 'hard'
  }>
}
```

默认负向约束至少包含 `music, melody, speech, dialogue, vocals, narration`。正向提示词必须强调真实连续的影视环境声、空间与远近关系，不生成配乐或人声。

## 生成与合成架构

生成任务同样运行在视频队列中，复用仓库现有 ComfyUI provider 的 `baseUrl`、提交、轮询和音频结果读取能力。

- 工作流 key 固定为 `baseaudio/environment/stable-audio-3-medium`，不暴露到现有配音模型选择器。
- 每个声音区间按 150 秒上限拆成内部生成块；这是工作流的已验证默认时长。内部拆块不会在 UI 变成额外声音区间。
- 每块使用确认后的英文提示词、负向提示词、明确时长和保存的随机种子。
- 同一声音区间的内部块使用 1 秒平滑过渡；声音区间之间根据 `transitionToNext` 使用 1 秒平滑过渡或 0.1 秒硬切保护过渡。
- 每个非末尾块会多生成对应的过渡余量，FFmpeg `acrossfade` 后总时长仍等于视频时长。
- 最终统一编码为 44.1 kHz、立体声、MP3 V0，并在输出前按视频时长裁剪或补静音；FFprobe 复核误差不得超过 100 毫秒。
- 某块生成失败时任务明确失败；重新提交时可复用原方案和种子，不生成看似成功的空音频。
- 输出保存到当前用户的 `video-tools/<userId>/environment-sounds/<id>.mp3`，返回签名 URL。

## API 与任务边界

- 新增一个环境音任务路由，POST 通过 `action=analyze|generate` 提交，GET 读取当前用户对应 transient job 状态。
- 新增一个可选配音上传路由，仅接受常用音频格式和明确 Content-Length，继续使用流式上传。
- 新增任务类型 `environment_sound_analyze` 与 `environment_sound_generate`，均路由到视频队列并单次尝试，避免整段音频任务被队列级自动重复执行。
- API、worker 和 UI 共享同一套计划解析与边界校验；客户端提交的编辑结果在 worker 入口再次校验。

## 错误处理

- 缺少或越权媒体：提交前失败。
- 未配置分析模型：分析任务显示明确配置错误。
- 未配置 ComfyUI `baseUrl`：生成任务显示明确配置错误。
- FFmpeg/FFprobe 不可用、视频无有效时长、抽帧失败、分析 JSON 无效、ComfyUI 无 MP3 输出、合成时长不符：任务失败并保留可定位错误码。
- 不使用默认视频、默认配音、默认提示词或静音 MP3 伪装成功。

## 测试与验收

- 单元测试覆盖媒体所有权、分析/生成请求解析、计划连续性、英文提示词约束、长区间分块、过渡余量和最终时长计算。
- 工作流注册测试验证模型名、核心采样参数、正负提示词、时长、种子及 MP3 V0 输出被精确注入，且不存在 Qwen/TextGenerate 二次改写链。
- worker 单元测试覆盖分析任务的抽帧/LLM调用结果和生成任务的逐块调用、FFmpeg 合成、存储输出。
- API contract 测试覆盖鉴权、越权 key、任务提交、状态读取和配音流式上传。
- 页面状态测试覆盖自动复用拼接结果、分析中、可编辑方案、生成中、试听和下载状态。
- 运行聚焦 Vitest、route/task contract guards、prompt i18n guard、ESLint 和 TypeScript 检查；如全局检查存在仓库既有噪声，必须给出路径过滤后的证据。

## 非目标

- 不做对白、旁白、音乐或口型同步。
- 不自动把环境音混回视频或配音。
- 不做 ASR、全文档知识库或逐分镜环境音入口。
- 不新增数据库表，不进入项目资产历史，不改现有 `audioModel` 的配音语义。
