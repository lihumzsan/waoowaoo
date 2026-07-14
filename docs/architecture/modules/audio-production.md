<!-- architecture-module: audio-production -->

# 声音设计、生成与最终混音

## 设计理念

声音阶段先把锁定脚本和渲染时间线转换成一份整集 `AudioDesign`，再由配乐、环境音和最终混音消费同一冻结事实。规划只描述叙事选择、声场身份、生成契约和自动化；生成候选的技术 PCM 质量检查只裁决可用性，不得升级为对最终视频、原生音轨或最终混音的语义“观看/听取”。

## 不变量

- **AP-01 — 一个规划事实、一个 writer。** 每集只有一个 `ProjectEditAudioDesign`，唯一写入入口是 `AUDIO_DESIGN_PLAN` worker。BGM 与 Ambient Sound 资源表不保存第二份 plan，也不解释规划状态；两个生成 Operation 只能消费已持久化且签名匹配的 `AudioDesign`。
- **AP-02 — 输入边界不含媒体语义分析。** 规划输入只允许 ready EditScript 事实和 canonical chapter output 的 identity、顺序、时长与镜头映射。不得读取视频帧、原生波形、最终视频或最终混音来推导 SoundWorld、SoundPresence、配乐情绪或环境声语义；原生对白/同步动作声始终保留，不由 SoundPresence 静音。
- **AP-03 — 统一时间轴。** `AudioDesign.clock` 固定为 24 fps / 48 kHz；SoundWorld 与 SoundPresence 都必须连续、无重叠地覆盖整集。SoundWorld 只能从脚本确认的场景/章节边界开始，镜头切换本身没有声场解释权。
- **AP-04 — 声场身份连续。** 持续物理声源以 `sourceContinuityId` 为 canonical identity；空间距离、封闭度和遮挡变化只改变同一播放相位的 DSP。`AcousticTransition.preservePlaybackPhase` 必须为 true；禁止在转场 automation 中重复解释同一增益变化。
- **AP-05 — 生成层显式存在。** `SoundPresence` 只裁决 ambience/score 两个生成 bus，模式穷尽为 `native_only`、`ambience_only`、`score_only`、`ambience_and_score`、`intentional_silence`。唯一 compiler 生成两个确定性 automation lane；不存在 native bus lane，`intentional_silence` 也不静音原生声音。
- **AP-06 — 环境音分层与两候选。** 每个使用 ambience 的 SoundWorld 必须有覆盖全 world 的低显著性 bed；detail 与 ambient event 不能冒充同步动作拟音。每个 source 必须声明并生成恰好两个候选，同 Task 逐候选 checkpoint，只能从通过技术音量、瞬态和 loop boundary 质量的候选中选一个。
- **AP-07 — 配乐是一条整集连续 cue。** AudioDesign 只能有零或一条配乐 cue；存在时覆盖全时间线，并显式声明曲式、音高集合、和声、织体、配器、动态、阶段和禁止项。生成 prompt 由该 music-theory contract 确定性编译，禁止把剧情动作、角色、对白、暴力词或环境录音语义泄漏给音乐模型。
- **AP-08 — 音乐时长能力只有 registry 解释。** FAL Lyria 的连续时长能力由 model capability registry 唯一声明为 120–180 秒，不维护离散时长清单或调用方副本。目标短于 120 秒时请求 120 秒并按 canonical timeline 精确裁切；120–180 秒请求精确连续值；超过 180 秒原地失败。模型短回包只允许在比例不低于 0.95 时做有界 tempo conform。
- **AP-09 — 生成资源绑定冻结设计。** MusicScore 与 AmbientSound 的 `taskId + designSignature + timelineSignature + active status` 是候选 checkpoint、成功和终态 projector 的 owner fence。最终渲染必须同时验证 AudioDesign、生成资源的设计签名和当前时间线签名；旧候选、旧 mix 与未规划 mix 不得进入成片。
- **AP-10 — 最终混音时长唯一。** 原生声音、自动化后的 score、已自动化 ambience 和 master automation 都以 stitched video duration 为权威，统一 48 kHz、pad/trim/reset PTS 并显式 `-t`。FFmpeg 技术分析只用于 loudness、时长、loop/边界连续性；不得从内容猜测业务状态。

## 权威入口

- 严格契约与签名：`src/lib/audio-design/types.ts`、`contract.ts`。
- 规划输入与 prompt：`src/lib/audio-design/planning-input.ts`、`prompt.ts`；唯一 worker：`generate.ts`；唯一持久入口：`project-data.ts`。
- SoundPresence 与 automation：`src/lib/audio-design/automation.ts`。
- 配乐能力、prompt 与候选质量：`score-duration.ts`、`lyria-prompt.ts`、`score-quality.ts`；模型能力声明：`src/lib/ai-providers/fal/models.ts`。
- 环境音 prompt policy、候选与连续性：`ambience-prompt-policy.ts`、`ambience-loop.ts`、`ambience-continuity-quality.ts`；声场 renderer：`src/lib/ambient-sound/mixer.ts`。
- 收费生成入口：`src/lib/operations/domains/music/generation/music-generation-ops.ts`；生成 worker：`src/lib/bgm-score/generate.ts`、`src/lib/ambient-sound/generate.ts`。
- 最终混音：`src/lib/workers/final-video-render.ts`、`src/lib/video-compose/final-render-audio.ts`。

写入者/入口变化：声音规划 writer 从 MusicScore plan 与 AmbientSound plan 两个降为 AudioDesign 一个；规划 Operation/Task 从两个降为一个；竞争 plan 解释器从 MusicScore、AmbientSound、Canvas 三处降为 AudioDesign strict parser 一个。BGM 与 Ambient Sound 两个收费生成入口保留，因为它们是不同 provider capability 和不同持久产物，但都没有规划解释权。

## 验证

- `scripts/guards/no-hardcoded-model-capabilities.mjs` 拒绝在业务调用方复制模型能力清单；音乐连续时长范围仍以生产 registry 与 provider contract 为权威证据。

- `tests/unit/audio-design/audio-design-acceptance.test.ts` 验证 strict timeline、SoundPresence、相位连续、music-theory prompt 和 120–180 秒能力消费。
- `tests/unit/audio-design/audio-candidate-quality.test.ts` 验证恰好两候选、loop boundary 与 SoundWorld 连续性技术 oracle；该测试没有视频/原生/最终媒体语义输入。
- `tests/integration/provider/fal-music-capability.contract.test.ts` 验证 registry 的连续范围、fractional option 和 provider `negative_prompt` wire contract。
- `tests/integration/task/audio-design-owner-fence.integration.test.ts`、`task-target-terminal-projectors.integration.test.ts` 验证真实 DB 当前 owner、late completion、失败和取消。
- `tests/integration/task/final-render-ffmpeg.integration.test.ts` 使用真实 FFmpeg 验证短原声、BGM、环境音与 canonical duration 的组合。
- `tests/golden-journey/journeys/mainline-complete.spec.ts` 从真实 UI/API/Task/DB 主线断言一个 AudioDesign Task、两个付费生成 Task、每源两个候选、签名一致和最终输出。

## 历史回归

- BGM 和 Ambient Sound 曾分别持久规划、分别拥有 plan Task，并在资源表以 `planTaskId/taskId` 双 owner 交接。第一次修正只给两个资源各加规划 owner，解决了单个 stream 空窗，却保留了两个规划 writer、两个状态解释器和跨计划不一致；旧测试分别验证每条 Task，没有证明同一整集声场、SoundPresence 和最终 mix。当前删除两个旧 plan route、Operation、TaskType、schema、parser 和 `planTaskId/planJson`，只保留一个 AudioDesign writer；Golden 以同一设计签名对齐两类候选和最终产物。
- 音乐模型时长曾以少量固定 options 声明，调用方又自行选择时长，连续 120–180 秒值会在模型能力校验前被拒绝。当前 range 只在 registry 声明，调用方读取 registry；Critical provider contract 同时反证范围漂移、整数限制和 wire 丢失。
- 环境声曾按剪辑段重新开始播放，空间变化容易表现为换声源；BGM/环境音也只生成一个结果，失败时没有质量选择。当前持续声源以 continuity identity 保持相位，转场只做 DSP/crossfade；每源两个候选由技术 PCM oracle 选择。该质量控制明确不分析最终视频或原生音轨内容。
- 最终三路音频曾因 AAC priming、不同 EOF 和 `-shortest` 在真实组合中挂起或截短。当前所有输入服从 stitched duration、显式 `-t` 和 bounded FFmpeg；真实 FFmpeg Critical 场景继续承担该历史反例。

## 修改检查表

1. 本次变化是否仍只有一个 AudioDesign writer 和一个 strict parser？
2. 规划输入是否意外引入视频帧、原生/最终波形或语义分析？
3. SoundWorld、SoundPresence、source continuity、候选数量和设计签名是否完整传到生成与最终混音？
4. 音乐时长是否只读取 registry 的连续 range，且 >180 秒显式失败？
5. 适用 Logic、Critical、Conformance 与主 Golden 是否实际执行，未执行范围是否明确报告？
