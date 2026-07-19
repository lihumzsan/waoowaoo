<!-- architecture-module: audio-production -->

# BGM 规划、生成与最终混音

## 设计理念

声音阶段只生成 BGM。锁定脚本和章节成片的 identity、顺序、时长与镜头映射先被转换成一份整集 `BgmDesign`，再由 MusicScore 生成与最终混音消费同一冻结事实。视频模型自己的对白和同步声音属于原生片段音轨并继续保留；系统不再规划、生成、持久化、计费或混合独立环境音层，也不观看/听取最终视频来生成第二份语义判断。

## 不变量

- **AP-01 — 一个规划事实、一个 writer。** 每集只有一个 `ProjectEditBgmDesign`，唯一写入入口是 `BGM_DESIGN_PLAN` worker。MusicScore 不保存第二份 plan，也不解释规划状态；收费生成 Operation 只能消费已持久化且签名匹配的 `BgmDesign`。
- **AP-02 — 输入边界不含媒体语义分析。** 规划输入只允许 ready EditScript 事实和 canonical chapter output 的 identity、顺序、时长与镜头映射。不得读取视频帧、原生波形、最终视频或最终混音来推导 BGM；原生对白与同步声音不由 BGM presence 静音。
- **AP-03 — BGM 时间轴完整。** `BgmDesign.clock` 固定为 24 fps / 48 kHz；`scorePresence` 必须连续、无重叠地覆盖整集，模式只允许 `score_on` 与 `score_off`。唯一 compiler 只生成 score automation lane；不存在环境音或 native bus lane。
- **AP-04 — 配乐是一条整集连续 cue。** `BgmDesign` 必须有且只有一条覆盖全时间线的 `scoreCue`，并显式声明曲式、音高集合、和声、织体、配器、动态、阶段和禁止项。生成 prompt 由该 music-theory contract 确定性编译，禁止把剧情动作、角色、对白、暴力词、现场录音或字面音效语义传给音乐模型。
- **AP-05 — 音乐时长能力只有 registry 解释。** FAL Lyria 的连续时长能力由 model capability registry 唯一声明为 120–180 秒，不维护离散时长清单或调用方副本。目标短于 120 秒时请求 120 秒并按 canonical timeline 精确裁切；120–180 秒请求精确连续值；超过 180 秒原地失败。模型短回包只允许在比例不低于 0.95 时做有界 tempo conform。
- **AP-06 — 生成资源绑定冻结设计。** MusicScore 的 `taskId + designSignature + timelineSignature + active status` 是候选 checkpoint、成功和终态 projector 的 owner fence。最终渲染必须同时验证 BgmDesign、MusicScore 的设计签名和当前时间线签名；旧候选、旧 mix 与未规划 mix 不得进入成片。
- **AP-07 — 两个候选、技术裁决。** 每次 BGM 生成必须产生恰好两个候选，只能从通过时长、音量、削波、静音、瞬态、重复和结构技术检查的候选中选一个。该 QC 只读取新生成候选 PCM，不分析原生音轨、视频帧或最终成片内容。
- **AP-08 — 最终混音只有两类输入。** 最终混音只接受原生片段音轨与自动化后的 BGM，并以 stitched video duration 为权威，统一 48 kHz、pad/trim/reset PTS 和显式 `-t`。FFmpeg 技术分析只用于 loudness 与时长，不得从内容猜测业务状态。
- **AP-09 — 被删除能力不得残留入口。** 生产 registry、provider adapter、模型配置、计费类型、Operation、TaskType、worker、数据库模型、Query、Canvas、文案和最终混音均不得声明环境音或音效生成能力。历史字段只能出现在迁移删除语句或明确的拒绝性测试中。

## 权威入口

- 严格契约与签名：`src/lib/bgm-design/types.ts`、`contract.ts`。
- 规划输入与 prompt：`src/lib/bgm-design/planning-input.ts`、`prompt.ts`；唯一 route：`src/app/api/projects/[projectId]/plan-bgm-design/route.ts`；唯一 worker：`src/lib/bgm-design/generate.ts`；唯一持久入口：`src/lib/bgm-design/project-data.ts`。
- BGM presence 与 automation：`src/lib/bgm-design/automation.ts`。
- BGM 规划流的唯一 presentation adapter：`src/lib/structured-stream/workspace-structured-stream-adapters.ts`；其 TaskEvent 检查点只恢复 Canvas 展示，不是第二个 BgmDesign writer。
- 配乐能力、prompt 与候选质量：`score-duration.ts`、`lyria-prompt.ts`、`score-quality.ts`；模型能力声明：`src/lib/ai-providers/fal/models.ts`。
- 收费生成入口：`src/lib/operations/domains/music/generation/music-generation-ops.ts`；生成 worker：`src/lib/bgm-score/generate.ts`。
- 最终混音：`src/lib/workers/final-video-render.ts`、`src/lib/video-compose/final-render-audio.ts`。

写入者/入口变化：生成声音规划 writer 从历史 BGM plan 与环境音 plan 两个，先收敛为仍含两类生成事实的 AudioDesign 一个，本次再切换为只含 BGM 的 BgmDesign 一个；规划 Operation/Task 保持一个但更名为 BGM 契约；收费声音生成入口从两个降为一个；生成音频持久表从两个降为一个；最终生成音频 bus 从两个降为一个。不存在残余环境音 writer、执行入口或状态解释器。

## 验证

- `tests/unit/bgm-design/bgm-design-acceptance.test.ts` 验证 strict BGM timeline、旧环境音字段 fail-closed、单 score lane、music-theory prompt 与 120–180 秒连续能力。
- `tests/unit/bgm-design/bgm-candidate-quality.test.ts` 验证恰好两个 BGM 候选以及纯技术 PCM oracle。
- `tests/integration/provider/fal-music-capability.contract.test.ts` 验证 registry 连续范围、fractional option 与 provider wire contract。
- `tests/integration/task/bgm-design-owner-fence.integration.test.ts`、`task-target-terminal-projectors.integration.test.ts` 验证真实 DB 当前 owner、late completion、失败和取消。
- `tests/integration/task/final-render-ffmpeg.integration.test.ts` 使用真实 FFmpeg 验证短原生音轨、BGM 与 canonical duration 的两路组合。
- `tests/contracts/task-definition-conformance.test.ts` 从生产 Task registry 穷尽验证没有第二类声音任务/projector。
- `tests/golden-journey/journeys/mainline-complete.spec.ts` 从真实 UI/API/Task/DB 主线断言一个 BgmDesign Task、一个付费 BGM Task、两个候选、签名一致、旧环境音 Task/Operation/Canvas 节点为零和最终输出。

## 历史回归

- BGM 和环境音曾分别持久规划、分别拥有 plan Task，并在资源表以 `planTaskId/taskId` 双 owner 交接。第一次修正只给两个资源各加规划 owner，解决了单个 stream 空窗，却保留两个规划 writer。2026-07-15 的统一 AudioDesign 又只合并了文本规划，环境音 provider、收费 Operation、Task、资源表、Canvas 节点和三路混音仍完整存在；旧 Fast/Critical/Golden 以“两种生成都成功”为 oracle，因此无法反证产品已经决定只保留 BGM。本次删除整条环境音能力链，Golden 改为反证旧 Task、Operation 与节点回流，schema/migration 则删除旧持久事实。
- 音乐模型时长曾以少量固定 options 声明，调用方又自行选择时长，连续值会在模型能力校验前被拒绝。当前 range 只在 registry 声明为 120–180 秒，调用方读取 registry；provider contract 同时反证范围漂移、整数限制和 wire 丢失。
- 最终三路音频曾因 AAC priming、不同 EOF 和 `-shortest` 在真实组合中挂起或截短。当前只有原生音轨与 BGM 两类输入，全部服从 stitched duration、显式 `-t` 和 bounded FFmpeg；真实 FFmpeg Critical 场景承担短原声与较长 M4A BGM 的历史反例。
- 旧声音提案曾加入“观看和听取最终视频”作为语义质量裁决，会制造第二套状态解释和不可重复 oracle。当前规划只消费锁定文本事实与时长/identity 元数据，候选 QC 只消费新生成 PCM 的技术指标；任何最终媒体语义分析都不是声音阶段能力。
- Episode media View 曾要求 FinalOutput 记录先存在，导致已持久化的 BgmDesign/MusicScore 只能依赖 Workflow 占位或短暂 stream 显示；解除顺序控制后，BGM 在规划终态与最终渲染之间消失。当前聚合 View 由 BgmDesign、MusicScore、FinalOutput 任一真实资源建立，三者仍各自保留 canonical identity，缺少 FinalOutput 时绝不伪造最终成片记录或专用卡片。

## 修改检查表

1. 是否仍只有一个 BgmDesign writer、一个 strict parser 和一个收费声音生成入口？
2. 规划输入是否意外引入视频帧、原生/最终波形或最终媒体语义分析？
3. `scorePresence`、唯一 `scoreCue`、两个候选和设计/时间线签名是否完整传到生成与最终混音？
4. 音乐时长是否只读取 registry 的连续 120–180 range，且 >180 秒显式失败？
5. provider/config/billing/Task/DB/Query/Canvas/i18n/mix 中是否仍有环境音能力声明？
6. 适用 Logic、Critical、Conformance 与主 Golden 是否实际执行，未执行范围是否明确报告？
