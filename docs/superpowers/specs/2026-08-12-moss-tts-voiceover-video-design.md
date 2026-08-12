# MOSS TTS 单人旁白与自动混音设计

## 状态

- 设计日期：2026-08-12
- 用户批准范围：单人正式配音，并以旁白/画外音方式自动混入一个已经成片的视频
- 不包含：人物口型同步、多说话人对话、视频片段拼接、自动改写台词
- 本文是实现前设计，不表示 Wao 端链路已经交付

## 目标

给定一个当前项目内已就绪的视频、一个 3–10 秒的精确参考音频版本、多条带明确开始时间的旁白文本，以及可选 BGM，系统应：

1. 使用 MOSS TTS Local 1.7B 对每条文本做零样本单人声音克隆；
2. 将每条正式旁白保存为独立、可见、可重试的音频 `WorkspaceResource`；
3. 只有在全部旁白成功后，按真实音频时长验证时间轴；
4. 自动提交唯一混音 Task，把旁白按 `startSeconds` 铺入原视频，并对原声及可选 BGM 做 ducking；
5. 生成新的成片视频 `WorkspaceResource`，不覆盖输入视频。

成功标准不是“ComfyUI 节点已注册”，而是从 Wao 的公开 Operation 到真实 ComfyUI、Task 终态物化、依赖放行、FFmpeg 混音和最终 Resource 的完整链路成立。

## 非目标与禁止范围

- 不实现唇形驱动或口型同步。
- 不在首阶段接入 `MossTTSDialogue`，也不接受两名说话人标签。
- 不让同一 Operation 同时拼接多个视频；多个片段必须先经现有 `merge_videos` 成为一个视频。
- 不把正式旁白伪装成现有 `generate_voice` 的音色试听。
- 不把正式旁白伪装成 `music`、`sound`、视频 `reference_audio` 或视频模型的 `generateAudio`。
- 不按字数猜旁白终止时间，不自动裁剪参考音频，不自动移动旁白时间点。
- 不在 Provider adapter 内拆分台词、改写文本或追加创作文案。
- 不依赖浏览器轮询、SSE 到达、Agent 后续回合或 timer 触发混音。
- 不在失败时更换模型、回退默认音色或重复提交 outcome unknown 的 ComfyUI prompt。
- 不执行数据库 migration；如实现需要 schema migration，只创建 migration 文件，执行另需明确授权。

## 已确认的工作流与运行事实

源工作流：`D:\workspace\comfui\workflows\Moss+TTS语音克隆+.json`

- SHA-256：`7FAFC9607452864E45EE7F0D48F7FFB4562BBCE6E3A3ABC50143420FF37F5897`
- 它是 6 节点、4 连线的 ComfyUI UI-canvas workflow，不可原样发送给 `/prompt`。
- 可执行拓扑为：`LoadAudio -> MossTTSGenerate -> SaveAudioMP3`，同时 `MossTTSModelLoader -> MossTTSGenerate`，文本由 `Text -> MossTTSGenerate`。
- 模型变体是 `MOSS-TTS (Local 1.7B)`；本地模型和 codec 路径均存在。
- `MossTTSGenerate` 的 `reference_audio` 是可选输入；提供后做零样本声音克隆，不需要参考音频转写。
- 当前 8878 实例的 `/object_info` 已确认 `MossTTSModelLoader`、`MossTTSGenerate`、`LoadAudio`、`SaveAudioMP3` 和 `MossTTSDialogue` 已注册。
- 单人节点支持 `auto`、`zh`、`en`、`ja`、`ko`；输出为 24 kHz 单声道；时长控制是提示而非硬保证。
- 插件文档建议参考音频为 3–10 秒。
- 2026-08-12 刷新到真实成功历史 `prompt_id=3b3786e9-e23c-4841-a260-94a6dbdda719`：输出 `audio/ComfyUI_00200.mp3`，HTTP MIME 为 `audio/mpeg`，185,784 bytes，24 kHz 单声道，15.120 秒。
- 该成功记录来自 ComfyUI 前端，不是 Wao 提交，因此仍不能证明 Wao 端上传、submission fence、轮询和 Resource 物化。

源工作流当前引用的 `陈迹.flac` 实测为 66 秒，超出本产品设计的 3–10 秒输入契约。接入不能照搬该文件名或样例路径；Wao 必须从冻结的项目 Resource 读取并上传精确字节。

## 方案比较

### 方案 A：一个 Worker Task 内生成所有旁白并立即混音

优点是 Task 数量少。缺点是部分成功无法独立保存或重试，混音失败会迫使重新生成语音，外部提交身份与本地 FFmpeg 故障混在一个生命周期中。拒绝。

### 方案 B：两个公开 Operation，由 Agent 或 UI 串联

先调用正式配音，再调用混音。实现增量较小，但“自动”依赖 Agent 后续回合、通知或前端状态；断线和晚到事件会造成交接空窗。拒绝作为产品正确性路径。

### 方案 C：一个公开生产 Operation，内部持久依赖 DAG

采用此方案。公开入口 `produce_voiceover_video` 一次冻结全部输入，原子预留旁白与最终视频 Resource，并创建多条旁白 Task 与一条稳定身份的混音 Task。混音 Task 由持久依赖事实控制，只有全部旁白成功物化后才可调度。

该方案保留一个用户动作入口，又让每条旁白有独立终态、独立 Resource 和独立重试边界。混音失败只重试混音。

## 架构治理分析

### 目标、并行边界与所有权

- 公开业务动作 owner：`produce_voiceover_video` Operation。
- 正式旁白生成 owner：Operation 计划内的 `workspace_resource_voiceover` Task handler。
- Provider 选择与 capability owner：`ai-registry`。
- MOSS wire 协议 owner：`ai-providers/comfyui` 的 TTS profile/adapter。
- Task 终态和 Resource 物化 owner：现有 Task Terminal Service 与 WorkspaceResource materializer。
- 下游放行 owner：OperationExecution 内部 Task dependency resolver；不是 Agent follow-up batch。
- 混音 owner：独立 `workspace_resource_voiceover_mix` Task handler，复用 `video-compose` 原语。
- 本任务不与其他 Agent 共享核心入口文件；实现时同一时刻只有一个 owner 修改 Operation 计划、Task dependency 与 terminal 放行代码。

### 事实、identity、scope、writer、消费者

| 事实 | Canonical identity / scope | 唯一 writer | 消费者 |
|---|---|---|---|
| 用户生产意图 | OperationExecution ID / project | Operation invocation | Plan、Task DAG、最终 View |
| 参考音频 | `resourceId + contentVersion` / project | WorkspaceResource persistence | voiceover planner、handler |
| 输入视频与 BGM | `resourceId + contentVersion` / project | WorkspaceResource persistence | mix planner、handler |
| 单条旁白 | 稳定 member index + 预留 resourceId / project | voiceover terminal materializer | Canvas、dependency resolver、mix handler |
| 旁白开始时间 | 冻结 Task/Plan payload | Operation planner | timeline validator、mix handler |
| 旁白结束时间 | `startSeconds +` 已物化音频真实 duration | media metadata writer | dependency release transaction |
| 混音任务可运行性 | 持久 Task dependency 状态 | Task terminal/dependency owner | Temporal scheduler |
| 最终视频 | 预留 resourceId / project | mix terminal materializer | Canvas、MCP、Agent |
| ComfyUI 调用 | invocation key + prompt_id | provider submission fence | poll/cancel/recovery |

### writer、入口和竞争解释源数量

| 项目 | 修改前 | 修改后 |
|---|---:|---:|
| 正式旁白视频公开执行入口 | 0 | 1 (`produce_voiceover_video`) |
| 正式旁白 Resource writer | 0 | 1（Task terminal materializer） |
| 最终混音视频 writer | 现有 merge terminal writer | 同一持久化 owner，新增 mix Task 类型 |
| 下游混音放行解释者 | 0 | 1（持久 dependency resolver） |
| ComfyUI TTS adapter | 0 | 1（窄 profile） |

新增的是新业务事实的唯一 owner，不引入旧/新双轨。现有 `generate_voice` 不改变语义，现有 `create_audio` 不获得第二套正式配音解释，现有 `merge_videos` 不承担旁白编排。

### 要删除或禁止出现的旁路

当前没有正式配音旧入口可删除。实现中必须避免并在审查中拒绝：

- `generate_voice` 根据是否有 reference 决定“试听/正式配音”的双义分支；
- `create_audio(audioKind=voiceover)` 与 `produce_voiceover_video` 同时成为同义正式配音入口；
- UI 在旁白完成后直接调用 mix route；
- follow-up Agent 收到任务通知后再决定是否提交混音；
- mix handler 按 workspace path、最近音频或最新版本寻找旁白；
- ComfyUI adapter 读取固定本机文件名或绝对模型样例路径作为业务输入。

## 公开契约

`produce_voiceover_video` 是 Planned Operation。其输入表达用户意图，不暴露 provider/model：

```ts
type ProduceVoiceoverVideoInput = {
  folderPath?: string | null
  name: string
  video: { resourceId: string; contentVersion: number }
  referenceAudio: { resourceId: string; contentVersion: number }
  voiceovers: Array<{
    name: string
    text: string
    language: 'auto' | 'zh' | 'en' | 'ja' | 'ko'
    startSeconds: number
  }>
  music?: {
    resourceId: string
    contentVersion: number
  }
}
```

约束：

- `voiceovers` 至少一条，保持调用顺序作为稳定 member order。
- 每条 `text` 是最终原文，Planner/handler/adapter 均不得改写。
- `startSeconds` 为非负有限数；相同时间点不是自动排序授权。
- 所有旁白共用一条精确参考音频，这是首阶段“单人”的定义。
- 所有输出路径由服务端 Placement 派生；调用方不传 storage key、扩展名、provider 或 model。
- 输出包含旁白 Resource 列表、最终视频 Resource 和 Task identities，公开 View 不暴露内部 model key。

## Registry 与能力契约

### 模态与模型

正式旁白使用 registry 既有 `voice` 模态，但必须把当前仅服务“音色设计”的窄能力扩展为可穷尽的 voice use case，而不是从 model id 猜用途。推荐在 `VoiceCapabilities` 中显式声明：

- `useCases` 至少包含 `voice_design` 或 `voiceover_clone`；
- `languageOptions`；
- `requiresReferenceAudio`；
- `referenceAudioDurationMsRange`；
- `outputFormatOptions`；
- `outputSampleRateHz` 与输出声道事实（如果业务预检需要）；
- `textMaxChars`；
- 允许的 canonical generation options。

MOSS Local 1.7B 注册为独立 `voice` model，例如 `comfyui::moss-tts-local-1.7b`，能力包含 `voiceover_clone`。FAL Qwen voice-design 只声明 `voice_design`。Planner 按 use case 解析精确模型，绝不按 provider/model 字符串分支。

系统配置需要一个明确的正式配音 model owner，例如 `voiceoverModel`。不得复用硬编码的 `PLATFORM_VOICE_DESIGN_MODEL_KEY`，也不得在缺失时静默选择 MOSS。

### Canonical option

首阶段服务端为 MOSS profile 冻结经 registry schema 校验的默认采样参数：Local 1.7B 推荐 temperature/top-p/top-k/repetition penalty、seed、max tokens、head/tail handle。产品公开输入暂不暴露这些参数，避免 UI/Agent 复制 Provider 细节。

默认不启用 duration control。其 token 数只是提示且实际时长会变化，不能承担时间轴正确性。若未来开放，仍必须用实际输出 duration 做最终校验。

## Plan、持久化与依赖 DAG

### Plan 前验证

在任何 Resource/Task 副作用前：

1. 解析当前 Project 的正式配音模型，并校验 `voiceover_clone` capability 与 ComfyUI 连接配置。
2. 解析并冻结输入视频、参考音频、可选 BGM 的精确版本。
3. 校验媒体类型、schema、所有权、ready 状态和 storage object。
4. 用权威媒体 metadata 校验参考音频真实时长为 3,000–10,000 ms；未知时长原地失败，不临时猜测。
5. 读取输入视频真实时长，校验每个 `startSeconds < videoDuration`。
6. 严格校验语言和文本长度；不在此时猜旁白结束时间。
7. 派生所有旁白与最终视频的稳定 resourceId、路径、Task id、dedupe key 和依赖边。

### 原子提交

Operation commit 在一个事务中：

- 创建所需输出目录；
- 预留 N 个旁白音频 Resource；
- 预留 1 个最终视频 Resource；
- 创建 N 个 runnable voiceover Task；
- 创建 1 个 blocked mix Task；
- 为 mix Task 写入对全部 voiceover Task 的 required-success dependencies；
- 绑定同一 OperationExecution 和 Lineage；
- 提交后只调度 N 个 voiceover Task。

不能先生成旁白、等终态后再临时创建混音身份；否则崩溃会产生“旁白完成但混音不存在”的交接空窗。

### 依赖放行

现有 `taskDependencies` 只表达当前 Plan 对既有活跃 Task 的外部依赖，现有 follow-up batch 只负责终态后继续 Agent 回合；两者都不是本功能需要的内部 DAG。

实现应补全 OperationExecution 内部 Task dependency 契约：

- dependency 是持久关系，目标是稳定 mix Task；
- 每个依赖要求 source Task `completed` 且对应 ResourceVersion 已在同一终态事务物化；
- 最后一条依赖成功的终态事务将 mix Task 从 blocked 原子转换为 schedulable，并发出唯一 scheduler receipt；
- 任一依赖 failed/canceled，mix Task 进入明确 canceled/failed-by-dependency 终态，不调度 handler；
- 重复、乱序、replay 和晚到终态不会产生第二次调度；
- mix Task 取消或最终终态后，后到的 dependency 不能复活它。

这是本设计唯一需要新增的跨 Task 生命周期语义。实现前必须按架构完整级要求更新影响分析；只有确实新增可强制的不变量时才更新正式模块文档。

## ComfyUI TTS profile 与传输

### API prompt graph

仓库保存窄、可审查的 API-format graph，不保存 UI canvas 元数据：

- `LoadAudio`：`audio` 注入本次上传返回的随机隔离文件名；
- `MossTTSModelLoader`：使用部署配置或 profile 声明的 Local 1.7B 与 codec 路径；绝不把源 workflow 的 `D:\...` 路径暴露到公共契约；
- `MossTTSGenerate`：注入冻结文本、语言、seed 和 canonical options；`reference_audio` 连接 LoadAudio；
- `SaveAudioMP3`：固定隔离前缀和 MP3 质量。

Text 节点不是执行必需；API graph 可直接把文本字符串注入 `MossTTSGenerate.text`。profile 必须声明 loader、generator、input 和 output node IDs 及 required node classes，避免 transport 猜输出节点。

### 参考音频上传

Worker 经现有 owner-aware media 入口读取冻结 Resource 的对象字节，限制 MIME、大小和检测结果。ComfyUI 本地上传使用受控 multipart：

- 调用 `/upload/image` 的通用文件接收协议时字段仍为 `image`，因为当前 ComfyUI server 没有独立 `/upload/audio`；这是 Provider 私有 wire 事实，不泄露到业务层；
- `type=input`，subfolder 使用任务隔离 identity，文件名由内容 hash/Task identity 派生，不使用用户文件名；
- 禁止 overwrite；校验响应 name/subfolder/type 与请求隔离范围；
- graph 的 `LoadAudio.audio` 使用 ComfyUI 能识别的 annotated input path；
- 上传完成不是业务持久事实，ComfyUI input 文件是可清理 scratch；Task 的冻结 Resource 才是恢复来源。

若上传成功而 `/prompt` 失败，允许同一 attempt 清理 scratch；清理失败只记诊断，不改变 Task 终态。不得清理用户已有 ComfyUI 文件。

### Preflight、提交和恢复

preflight 在 submission fence 外验证：

- base URL；
- required node class 与字段；
- Local 1.7B model variant；
- 配置的本地 model/codec 路径存在性应由 runtime 诊断或一次 loader smoke 证明，不能仅看客户端路径字符串；
- `SaveAudioMP3` 输出协议。

上传属于可能产生外部 scratch 的 prepare 阶段，但 `/prompt` 是唯一生成提交。每个 Task 使用稳定 `prompt_id`。4xx prompt validation 是明确 rejected；网络超时后先按同一 prompt_id 查询 job/history，无法证明是否受理则记录 outcome unknown，禁止新 prompt_id 自动重提。

轮询复用现有 ComfyUI async provider 协议，严格读取 profile 声明的 output node，下载 `/view`，要求 `audio/mpeg`、有界大小、可探测时长。原生 failure 和 execution_error 进入 FailureRecord。

## 正式旁白 Resource

正式旁白应使用独立 schema，例如 `project.voiceover_audio`；它不是 `project.voice_reference`。

每个版本至少保留：

- 冻结文本与语言；
- 参考音频的精确 Lineage；
- model/provider route；
- 真实 `durationMs`、MIME、size、sample rate/channel（若 MediaObject 已拥有这些字段则不重复存）；
- `startSeconds` 作为本次生产计划的冻结时间轴输入。

单条失败不回滚已经成功物化的兄弟旁白。retry 使用原 resourceId 和冻结 payload，不能改变文本、参考版本、模型或开始时间。若要改变内容，必须发起新的生产意图。

## 混音契约

### 输入

Mix Task 只消费：

- 一个冻结的 ready 视频版本；
- 按 member order 排列的 N 个旁白 Resource 精确版本与 `startSeconds`；
- 可选一个 BGM 精确版本；
- 冻结的增益、ducking、淡入淡出和输出参数。

依赖放行时从每个已物化旁白版本读取真实 `durationMs`，计算 `[start, end)`：

- 区间按 start 排序后不得重叠；相邻 `end == next.start` 合法；
- 每个 `end <= videoDuration`；
- 未知/零/非有限 duration 明确失败；
- 失败发生在 mix handler 调度前，不修改时间点或裁剪旁白。

### FFmpeg 行为

复用现有 `video-compose` 的 ffmpeg binary resolver、command runner、媒体探测、响度测量、限幅、BGM fade/ducking 和临时目录清理。新增职责保持在可独立定位的 voiceover timeline/mix 模块中。

- 输入视频流复制或仅做必要 remux，不重新生成画面。
- 每条旁白归一到统一采样率、float/stereo layout 和旁白响度目标，再用精确毫秒 `adelay` 放置。
- 多条旁白先组成一条 narration bus；已通过预检保证不重叠。
- 原视频有音轨时保留；无音轨时生成与视频同长的静音底轨。
- narration 活跃区间对原声做 sidechain/明确 envelope ducking。
- 可选 BGM 继续使用现有规范化、循环/裁切、淡入淡出与限幅；narration 活跃时进一步 ducking。
- 最终 mix 限幅并严格裁切到视频真实时长。
- 输出为新的 `video/mp4` Resource，输入视频和音频均保持不变。

具体 dB、fade、attack/release 和 loudness 数值属于实现配置，不写入架构文档；实现中必须在 Task payload 冻结，重试不得随部署默认漂移。

## 生命周期、失败、取消与时序

| 场景 | 必须结果 |
|---|---|
| 正常 | 全部旁白完成并物化 -> 原子放行一次 mix -> 最终视频完成 |
| 单条旁白失败 | 其他成功旁白保留；mix 不运行；失败成员可原位 retry |
| 旁白全部成功但时间轴非法 | mix 在放行校验中失败；旁白保留；不运行 FFmpeg |
| mix 失败 | 旁白不重生成；只 retry 同一 mix Task/Resource |
| 用户取消单条旁白 | mix 不运行并进入 dependency-canceled 终态 |
| 用户取消整个 Operation | 未提交 Provider 的 Task 不提交；已提交的按现有取消协议；mix 不被后到成功复活 |
| `/prompt` 明确拒绝 | 当前旁白 Task 失败，保留原生错误，不重提 |
| `/prompt` outcome unknown | 查询同一 prompt_id 恢复；不能生成第二 prompt_id |
| poll 网络失败 | 恢复同一 external id，不改变业务终态 |
| ComfyUI 输出缺失/MIME 错误 | 旁白 Task 失败，不伪造 Resource ready |
| terminal replay | 返回同一 ResourceVersion/Lineage，不重复放行 mix |
| 两个依赖近同时完成 | 锁定同一 mix dependency aggregate，只有一个事务取得放行权 |
| Task 完成通知晚到/丢失 | 依赖正确性来自持久终态事务，不依赖通知 |
| Worker/Temporal 重启 | 从持久 Task、dependency、fence 与 external id 恢复 |
| 部分成功后刷新/断线 | Canvas/View 从 Resource 与 Task 权威事实恢复，不丢失阶段结果 |

## 权限、隐私与安全

- 所有输入在 Plan 和 commit 时校验 `userId + projectId + contentVersion`，Worker 只消费冻结引用。
- 参考音频可能包含生物识别/人格特征；日志、错误、ComfyUI 文件名和 prompt metadata 不记录用户原文件名、storage key 或签名 URL。
- 公开 contract 不允许任意本机路径或 ComfyUI 文件名。
- 上传大小必须低于 ComfyUI server 上限，并使用更窄的产品音频上限。
- 输出下载复用现有有界读取；不接受任意 `/view` 路径或未声明 output node。
- 产品应在用户可见文案中明确：只克隆用户有权使用的声音。具体合规/同意 UI 不在首阶段实现范围，除非现有产品政策要求阻断确认。

## UI、投影与 i18n

- 公开操作中文名建议为“生成旁白并混入视频”，英文为 “Produce voiceover video”。
- 旁白 Resource 展示为正式旁白，不能显示为“角色音色”。
- 进度阶段至少区分：校验参考音频、上传参考音频、生成旁白、等待其他旁白、校验时间轴、混合音轨、保存成片。
- 所有用户可见错误和阶段使用 translation key，不硬编码固定语言。
- Canvas 继续消费 WorkspaceResource View；不增加配音专用 Canvas 状态机。
- 中间旁白 Resource 可播放、查看真实时长和单独重试；最终视频作为新的普通视频 Resource 展示。

## Reference implementation 对齐

本功能是三个既有实例的组合扩展：

- Provider 参照：`comfyui::moss-soundeffect-v2`，因为它已经实现窄 API graph、preflight、prompt_id、async poll、声明 output node 和 MP3 下载。
- 语音参照：FAL `generate_voice`，因为它已贯通 `voice` registry、provider adapter、独立 audio Resource、duration probe 和 retry；但其产品语义仅是 voice reference，不复用公开入口/schema。
- 混音参照：`merge_videos` + `video-merge-audio`，因为它已经冻结精确媒体版本、处理有/无原声、BGM normalization/ducking/limit 和视频终态物化。

| 参照物触点 | 新实例覆盖 / 不适用原因 | 验证 |
|---|---|---|
| identity | OperationExecution + 稳定 member resource/task IDs；mix 预先拥有稳定 ID | 重放与并发集成验证 |
| scope/permission | 精确 project ResourceVersion 所有权 | 跨项目拒绝验证 |
| registry identity | 独立 ComfyUI voice model + `voiceover_clone` use case | registry conformance |
| public operation | 单一 `produce_voiceover_video`；不复用语义不同的 `generate_voice` | operation registry 检查 |
| placement | 服务端派生旁白与最终视频路径 | path/冲突验证 |
| persistence | 预留 Resource，terminal materializer 唯一写版本 | 真实数据库事务验证 |
| execution | 每条旁白独立 Task，mix 独立 Task | Task handler 实际执行 |
| lifecycle | submission fence + prompt_id poll；mix 持久 dependency gate | Temporal fault/replay 验证 |
| failure | 原生 ComfyUI failure；部分成功保留；mix 不误放行 | failure injection |
| recovery | 同一 prompt_id、同一 Resource、同一 mix Task 重试 | restart/replay 验证 |
| projection | 普通 audio/video WorkspaceResource View | Canvas/API View 验证 |
| i18n | operation、progress、error translation keys | locale 静态检查与手工复验 |
| audio upload | 新增任务隔离 multipart input；MOSS sound 无输入故不适用 | 真实 8878 上传与生成 |
| prompt graph | 窄 TTS profile，声明 node IDs/classes | `/object_info` + `/prompt` |
| output retrieval | 声明 SaveAudioMP3 node，`audio/mpeg` 有界读取 | 真实 MP3 MIME/bytes/probe |
| mix | narration bus + source/BGM ducking；不拼接视频 | 真实 FFmpeg 组合矩阵 |
| billing | 当前产品为 free hard cutover，不新增额度/授权链 | free-product conformance |

## 实施阶段

### 阶段一：正式配音领域与 registry

- 增加 `voiceover_clone` capability/use-case、MOSS voice model、正式配音 system model owner。
- 增加 `project.voiceover_audio` schema 和公开 Operation input/output contract。
- 不改现有 `generate_voice` 与 `project.voice_reference` 语义。

准入：registry、schema、Plan 的静态和类型验证通过；未提交真实任务。

### 阶段二：ComfyUI TTS adapter

- 萃取 API-format workflow profile。
- 增加 owner-aware 音频字节读取与任务隔离上传。
- 接入 voice describe/execute/poll/cancel 与 output parser。
- 通过真实 8878 的 reference upload -> `/prompt` -> job/history -> `/view`。

准入：真实中文克隆输出通过 MIME、24 kHz/声道、时长和大小探测；Wao provider 层可恢复同一 prompt_id。

### 阶段三：Operation 内部 Task dependency

- 扩展 Plan/OperationExecution/Task 持久协议表达内部 required-success edges。
- 原子创建 runnable voiceover Tasks 与 blocked mix Task。
- terminal transaction 唯一放行/阻断下游，覆盖并发、replay、cancel 和 restart。

准入：真实数据库 + Temporal 故障注入证明不会漏放行、重复放行或失败后复活。

### 阶段四：旁白时间轴混音

- 新增 voiceover mix contract/handler 和独立 video-compose 模块。
- 复用现有 ffmpeg runner、probe、source audio、BGM 与 terminal materializer。
- 支持有/无原声、可选 BGM、多条不重叠旁白。

准入：真实 FFmpeg 媒体矩阵通过，非法时间轴在 FFmpeg 前失败。

### 阶段五：端到端与收敛

- 从公开 `produce_voiceover_video` 完成成片视频 -> 多条旁白 -> 自动放行 mix -> 新视频 Resource。
- 核对没有第二公开配音入口、UI 触发交接、固定本机路径或 fallback。
- 只在确实新增/改变可强制架构不变量时更新模块文档和模块映射。

## 验证策略

自动化测试只在有独立 oracle 的边界增加，不为调用次数或实现映射写 mock 自证。

1. 静态/类型：typecheck、目标文件 lint、registry/operation/schema conformance。
2. Provider 真实边界：8878 `/object_info`、multipart upload、API graph `/prompt`、同 prompt_id job/history、MP3 `/view`、ffprobe。
3. 持久事务：MySQL 中一次提交生成全部 Resource/Task/dependency；并发终态只有一次 mix 放行。
4. Temporal：Worker 重启、Activity retry、notification loss、terminal replay、cancel race。
5. FFmpeg 独立 oracle：输出 duration、音轨存在、时间位置、无削波、视频帧/时长保持；有原声、无原声、有 BGM、多旁白。
6. 拒绝场景：参考音频短于 3 秒或长于 10 秒、未知 duration、跨项目、错误 MIME、重叠、越界、missing node/model、unknown provider status。
7. 端到端：当前项目真实 Resource 经 Wao Operation/Temporal/ComfyUI/FFmpeg 产生旁白音频与最终视频 View。

## 完成定义与残余盲区

### 实现完成

代码、类型和聚焦验证完成；真实环境组合可能仍有盲区。只能称“实现完成”。

### 阶段完成

每阶段唯一入口、writer、删除/禁止旁路与对应真实边界证据齐备，无未声明双轨。

### 架构完成

只有满足以下全部条件才可称“正式配音与自动混音架构完成”：

- 唯一公开入口和唯一 Resource writer 已确认；
- 内部 dependency DAG 在 crash/replay/concurrency/cancel 下有真实持久证据；
- Wao 真实提交 MOSS TTS 并物化旁白 Resource；
- FFmpeg 真实组合矩阵与完整端到端通过；
- 无 Agent/UI/timer 交接旁路，无固定本机文件输入，无旧/新双轨；
- 不存在关键未验证环境盲区。

本文写作时仍有的盲区：Wao 尚未提交过该 TTS graph；当前成功记录的参考音频为 66 秒，不符合产品 3–10 秒契约；OperationExecution 尚不支持本文所需的内部 blocked Task DAG；最终 ducking 参数尚未以真实成片听感校准。这些都必须在实施阶段如实关闭或继续声明。
