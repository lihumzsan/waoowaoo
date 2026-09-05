# H3 参考音色接入与 MOSS 退役设计

日期：2026-09-05
状态：待用户书面确认

## 1. 背景与已确认事实

当前本地视频模型是 `comfyui::minimax-h3-dual-stage-2mp`。它的 reference 工作流已经使用
`MiniMaxH3ReferenceToVideo` 和 H3 Ref2VA 权重，也已连接视频 VAE 与音频 VAE，但冻结 API 图只向
`ref_images.ref_image_N` 写入图片。ComfyUI adapter 同时把 `referenceAudios` 列为禁止字段，并在 H3
执行入口再次拒绝参考音频。因此现在的限制来自 Wao 的 capability、冻结图和 adapter，而不是 H3
Ref2VA 模型本身。

MiniMax H3 官方规格与 ComfyUI 核心节点均支持 Ref2VA 的图片、视频和音频参考。官方边界为最多 9 张
图片、3 段视频、3 段音频、全部参考文件合计最多 12 个；每段参考音频为 2–15 秒，全部参考音频总时长
不超过 15 秒，并且音频必须与图片或视频参考共同使用。ComfyUI
`MiniMaxH3ReferenceToVideo` 以 `ref_audios.ref_audio_N` 接收独立音频，并在 Prompt 中使用
`<Audio N>` 标识。

项目当前还注册了两项 MOSS 能力：

- `comfyui::moss-tts-local-1.7b`，用于音色生成及后期克隆配音；
- `comfyui::moss-soundeffect-v2`，用于环境音效生成。

用户已确认两项 MOSS 能力都不再保留，未来的新声音与音效 Provider 另行设计和接入。

## 2. 目标

1. 让现有 `create_video` 原生接受 H3 Ref2VA 参考音频，并把参考音色明确绑定给指定人物。
2. 复用现有 WorkspaceResource 固定版本、视频规划、Task、Provider Gateway、异步 external id 和视频终态
   materializer，不增加第二条视频执行链。
3. 完整删除 MOSS TTS 与 MOSS SoundEffect 的模型注册、执行、轮询、取消、工作流和产品入口。
4. 保留已有媒体 Resource、完成历史和用户上传的参考音频，不执行数据库或对象存储清理。
5. 没有环境音效 Provider 的阶段，系统明确投影 `productionCapabilities.sound = null`，在持久副作用前
   停止音效提交。

## 3. 非目标与禁止范围

- 本次不接入新的 TTS、音效或语音 Provider。
- 本次不恢复后期克隆配音、自动替换原生对白或独立 voiceover 生成。
- 本次不接 H3 `reference_video`，也不改变首帧、首尾帧或 continuation 的现有边界。
- 当前最多 8 张 reference image 的本地产品限制保持不变；不顺带扩展到官方 9 张。
- 不把参考音频转成 Base64、裸 URL、storage key 或客户端可见 ComfyUI 文件名。
- 不由服务端改写、补写或重新编译主 Agent 已完成的 H3 Prompt。
- 不保留 MOSS 隐藏入口、fallback、停用开关、占位模型或第二套兼容执行器。
- 不修改或删除已有 Task、WorkspaceResource、MediaObject 与对象存储文件。

## 4. 方案比较与决策

### 方案 A：H3 原生参考音频一次性切换，并完整删除 MOSS（采用）

在现有 video capability 中声明 H3 的参考音频限制；`create_video` 继续通过统一 reference schema 冻结
音频 Resource；H3 adapter 将已授权音频上传到 H3 专属 ComfyUI Runtime，再把临时文件名写入 Ref2VA
节点。与此同时删除两个 MOSS 模型和全部可执行入口。

该方案只有一个带参考音色的视频入口，H3 输出的画面、口型和音轨仍属于同一个 Provider invocation、
ComfyUI prompt id、Task 和最终视频 Resource。

### 方案 B：先从模型目录隐藏 MOSS，保留其代码和任务入口

该方案可以缩小第一批 diff，但会留下无法从正常产品入口到达的 adapter、Worker、Task 和协议解释器，
也会让未来新 Provider 面对两套语义。它不满足本仓库对单一入口和删除旧旁路的要求。

### 方案 C：继续生成 H3 视频，再用隐藏的 MOSS 后期换声

该方案保留两次生成、两个音轨事实、额外混音和部分成功状态，指定人物与声音的关系也会在 H3 Prompt
和后期时间线中重复表达。它不符合本次“直接使用 H3 Ref2VA、MOSS 全部弃用”的产品目标。

决策：采用方案 A。

## 5. 用户如何传入参考音频

参考音频必须先成为当前 Project 中的 ready WorkspaceResource。用户通过聊天附件上传 MP3 或 WAV 后，
现有 `register_uploaded_media` Operation 将附件登记为 `project.upload_audio` Resource，并返回稳定的
`resourceId` 与 `contentVersion`。已有 ready 的 `project.voice_reference` 或其他合法音频 Resource 也可
直接使用；调用方不能传文件路径、URL 或最近一条音频来猜身份。

`video_generation_batch` 和 `create_video` 已有公开 reference 字段。本次不新增公开协议，只使用现有
`channel=audio, role=reference_audio`：

```json
{
  "itemId": "segment-01",
  "name": "角色对白片段",
  "mediaType": "video",
  "schemaId": "project.video_segment",
  "durationSeconds": 8,
  "vocalPerformanceMode": "native_dialogue",
  "references": [
    {
      "resourceId": "人物参考图的资源 ID",
      "contentVersion": 1,
      "channel": "image",
      "role": "reference_image"
    },
    {
      "resourceId": "参考音频的资源 ID",
      "contentVersion": 1,
      "channel": "audio",
      "role": "reference_audio"
    }
  ],
  "prompt": "完整 H3 六段式 Prompt"
}
```

公开数组顺序是唯一冻结顺序。Provider 投影时按模态保持相对顺序：第一个图片引用成为
`<Picture 1>`，第一个音频引用成为 `<Audio 1>`；第二个音频引用成为 `<Audio 2>`。客户端不提交
`position`，服务端在冻结时生成位置。

## 6. 指定人物与参考音色的绑定

音频与人物的关系由同一份最终 H3 Prompt 表达。它不是另一个数据库绑定，也不由 adapter 猜测。标准
形式为：

```text
subject_definitions:
<Subject 1> is the specified person shown in <Picture 1>, preserving the same identity and appearance.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1), containing a clean spoken vocal layer.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - the identity and defining appearance are retained.
<Audio 1>: reference - <Subject 1> (S1) follows its vocal timbre and measured delivery without copying the original signal.

detailed_description:
[Shot 1] <Subject 1> (S1) performs the specified action and says, <d>[Chinese]这里是本段的新台词。</d>
```

规则如下：

- 每个实际输入的 `<Audio N>` 必须在 `subject_definitions` 中恰好定义一次。
- 音色参考必须绑定到一个明确的 `<Subject M> (Sx)`；同一人物在所有对白事件中复用同一 `(Sx)`。
- `reference` 表示参考音色、节奏和表达，不复制原始音频信号。
- 只有用户要求复演原音频台词时才把原台词写入 `<d>`；普通音色参考使用当前任务的新台词。
- Server validator 接收实际图片/音频计数，校验 `<Picture N>`、`<Audio N>` 编号连续、没有越界或遗漏，
  并校验每个音频存在标准人物绑定语句。validator 不评价音色相似度，也不重写文字。

“指定人物使用指定音色”的 Provider 输入事实因此只有一份：冻结参考顺序决定媒体编号，最终 Prompt
决定编号之间的语义关系。

## 7. H3 capability 契约

现有 `minimax_h3_multimodal_v3` capability 增加：

```text
maxReferenceAudios = 3
referenceAudioRequiresVisual = true
minReferenceAudioDurationMs = 2000
maxTotalReferenceAudioDurationMs = 15000
maxReferenceFiles = 11
```

`maxReferenceFiles=11` 来自当前本地范围：最多 8 张参考图加 3 段参考音频。本次没有 reference video，
所以不声明官方 12 文件的完整组合能力。

现有统一 Planner 已能按 capability 校验音频数量、视觉依赖、单段最小时长与音频总时长。因为总时长
最多 15 秒，任一单段也不可能超过 15 秒。音频时长未知、少于 2 秒、合计超过 15 秒、超过 3 段、没有
参考图片，或与 `first_frame`、`first_last_frame`、`continuation` 混用时，必须在创建 Resource/Task
前明确失败。

## 8. 内部传输与 ComfyUI 图

### 8.1 所有权与字节读取

1. Planner 通过 `resolveWorkspaceResourceInputs` 校验每个 `resourceId + contentVersion` 属于当前
   `userId + projectId`，并冻结当时版本、角色和位置。
2. Video Worker 按冻结位置解析音频 MediaObject，要求 `mediaType=audio` 且 Resource ready。
3. `resolveOwnedAudioUrlForGeneration` 继续作为视频参考音频的唯一出站入口，校验 owner、MP3/WAV MIME、
   大小边界并签发短期绝对 URL。
4. H3 adapter 使用 owner-aware、有界字节读取把已授权引用物化为 bytes；禁止普通 `fetch` 旁路。

### 8.2 上传 H3 Runtime

从即将删除的 MOSS TTS 文件中提取与 Provider 无关的 ComfyUI 音频上传行为，放入 H3 输入上传模块。
每个 prompt id 使用独立目录：

```text
waoowaoo/<promptId>/reference-audio-00.<ext>
waoowaoo/<promptId>/reference-audio-01.<ext>
waoowaoo/<promptId>/reference-audio-02.<ext>
```

adapter 在调用 `/prompt` 前，通过 H3 target 的 `/upload/image` multipart 入口上传音频。ComfyUI 的该
HTTP 入口虽然字段名为 `image`，但 `LoadAudio` 使用返回的 `type + subfolder + name` 读取音频。响应必须
与本次 prompt id、预期文件名和 `input` 类型一致，否则作为明确的本地 pre-accept failure 结束。

上传只是本次 Provider 请求的临时传输，不创建第二个 Wao Resource、Task 或 external id。ComfyUI 临时
文件由其现有运行目录生命周期管理；Wao 不把它当持久业务事实。

### 8.3 冻结图构造

`h3-dual-stage-2mp.json` 增加一个受版本控制的 `LoadAudio` 基础节点，并将其输出接到
`MiniMaxH3ReferenceToVideo.ref_audios.ref_audio_0`。Profile builder 按实际音频数量复制最多三个
`LoadAudio` 节点，写入已上传文件名，并先删除模板中未使用的 `ref_audios.*` 输入。

H3 preflight 除现有模型、VAE、采样和放大节点外，还必须验证：

- `LoadAudio` 节点存在并接受文件名；
- `MiniMaxH3ReferenceToVideo` 有 `audio_vae` 输入；
- Ref2VA 节点支持 `ref_audios.ref_audio_N` autogrow 输入；
- audio VAE 仍连接当前 H3 音频 VAE；
- 最终 `VHS_VideoCombine` 继续使用 H3 第一阶段生成的原生音轨。

图构造完成后仍只发送一次 `/prompt`。音频上传成功但 `/prompt` 未受理时，不会产生已受理的
ComfyUI 生成作业；已存在的 Wao 视频 Task 由现有唯一终态 owner 记录 pre-accept 失败。
`/prompt` 受理后的恢复、轮询、取消和最终 MP4 下载继续使用现有
`COMFYUI:h3-dual-stage-2mp:VIDEO:<promptId>` external id。

## 9. MOSS 退役范围

### 9.1 Provider 与模型目录

删除：

- `moss-soundeffect-v2`、`moss-tts-local-1.7b` 模型 identity、capability、API catalog 条目、平台 preset
  和 runtime target 映射；
- ComfyUI adapter 的 MOSS `sound` 与 `voice` describe/execute；
- ComfyUI async provider 的 `SOUND`、`VOICE` poll/cancel 分支；
- `moss.ts`、`tts.ts`、`moss-tts-reference-policy.ts`；
- `moss-soundeffect-v2.json`、`moss-tts-local-1.7b.json`；
- `.env.example` 中的 MOSS sound 默认模型示例。

`shared` ComfyUI target 仍由 ACE-Step 音乐使用，不能随 MOSS 一起删除。

### 9.2 产品 Operation 与 Task

删除 `produce_voiceover_video` Operation，以及仅由该 Operation 或旧 voice 入口使用的：

- `workspace_resource_voice`；
- `workspace_resource_voiceover`；
- `workspace_resource_voiceover_mix`；
- voiceover task payload、mix payload、handler、materializer 分支、依赖声明、进度估算、Canvas task 映射
  和 i18n 进度键；
- 无调用方的 `generateVoice` 包装函数与 MOSS 专属 voice option；
- `PLATFORM_VOICEOVER_MODEL_KEY` 和 `SystemModelPurpose='voiceover'`。

通用 registry 类型中的 `voice` vocabulary 可以保留为未来 Provider 的可扩展类型，但没有注册实例、
默认模型、执行 adapter 或产品 Operation。若删除 MOSS 后该类型只剩不可达实现代码，实施时一并删除
实现，不能保留空 stub。

### 9.3 环境音效无 Provider 状态

`create_audio`、`audioKind='sound'`、`project.sound_effect_audio` 和共享音频判别式继续保留，因为它们是
Provider 无关的统一产品契约，也是已有环境音效 Resource 的读取身份。平台默认模型契约改为允许
`soundModel` 缺失；模型目录中没有 sound 实例时：

- 平台和自托管配置都投影 `soundModel=null`；
- `productionCapabilities.sound=null`；
- 音乐 Skill 在构造 sound item 前停止；
- 即使调用方直接提交 sound item，`create_audio` 也在 Plan 阶段返回缺失能力，不创建 Task 或 Resource。

数据库里残留的 MOSS model key 不做批量回填或删除。配置解析通过当前 registry 判断该 key 已不可用，
将有效 sound capability 投影为空；UI 不再提供该模型供选择。

### 9.4 历史 Resource

- 已完成的 `project.sound_effect_audio`、`project.voice_reference`、`project.voiceover_audio` 和最终视频继续
  作为普通 WorkspaceResource 读取、播放、移动、软删除或恢复。
- `project.voice_reference` 与 `project.upload_audio` 可作为 H3 `reference_audio` 输入。
- `project.voiceover_audio` 标记为历史只读 schema，不再有 writer。
- 不删除 MediaObject、对象存储内容、Lineage 或已终态 Task。

## 10. 切换与在途任务

MOSS execution handler 与 async parser 删除后，仍在运行的旧任务将无法轮询或完成，因此代码切换前
必须对权威 Task 数据执行只读检查，枚举：

- `workspace_resource_voice`、`workspace_resource_voiceover`、`workspace_resource_voiceover_mix` 的所有
  非终态 Task；
- `workspace_resource_audio` 中冻结模型为 `comfyui::moss-soundeffect-v2` 的所有非终态 Task；
- 带 `COMFYUI:*:SOUND:*` 或 `COMFYUI:*:VOICE:*` external id 的所有非终态 invocation。

准入条件为上述集合全部为空。存在正常运行任务时继续使用旧 Worker 将其排空；不得先部署新代码，
不得让新 Worker 猜测旧 external id，也不得自动重提。任务无法终态时停止切换并报告精确 Task 与
external id，由用户另行决定取消或保留。完成的历史 Task 不参与执行，也不要求兼容 parser。

这是一阶段硬切换，没有临时双轨和第二次清理版本。

## 11. 生命周期与失败行为

| 场景 | 权威行为 |
| --- | --- |
| 正常 | 冻结图片和音频版本，H3 adapter 上传音频，提交一个 Ref2VA prompt id，最终只物化一个带原生音轨的视频 Resource |
| 音频缺视觉参考 | Planner 在任何 Resource、Task、上传或 `/prompt` 前拒绝 |
| 音频时长未知/过短/总时长超限 | Planner 根据冻结 MediaObject 时长明确拒绝，不让 Provider 猜测 |
| 音频 MIME 或大小不合法 | owner-aware 音频出站入口在 Provider 提交前拒绝 |
| ComfyUI 上传失败 | typed pre-accept failure；Wao 视频 Task 明确失败，不 claim Provider 已受理，不自动换模型 |
| Ref2VA 节点或 audio VAE 不兼容 | H3 preflight 明确失败，不忽略音频继续生成 |
| `/prompt` 明确拒绝 | 保存原生失败并映射 typed rejection，不重提 |
| `/prompt` 断连或结果未知 | 按既有 prompt id 探测；无法证明未受理时进入 outcome unknown，不生成第二个 prompt id |
| 排队/生成 | 继续使用现有 H3 external id 和独立排队/生成预算 |
| Provider 失败 | 完整 FailureRecord 进入唯一 Task terminal owner，Resource 终态按现有规则收口 |
| 用户取消 | Wao 本地终态优先；补偿 Activity 按同一 external id 取消 H3 job |
| 重试 | 冻结的 Resource version、顺序、Prompt 和模型保持不变；submission fence 决定是否可提交 |
| 重复/并发 | operation request identity 与 provider invocation fence 继续拒绝重复 writer |
| 晚到/刷新/断线 | UI 只从持久 Task/Resource View 恢复，不从 ComfyUI 页面、通知速度或历史消息推断 |
| 部分成功 | 音频上传不是产品成功；双阶段 H3 中间视频也不是产品成功，只有最终 MP4 构成成功 |
| MOSS 缺失 | 对应 capability 为空并在 Plan 前失败，不回退到 H3、音乐模型或其他 Provider |

## 12. 权威所有权与入口数量

| 事实 | 唯一 owner / writer | 消费者 |
| --- | --- | --- |
| H3 reference modality 与上限 | Built-in capability registry | ProjectProductionContext、Skill、Planner、adapter schema |
| 参考音频身份与顺序 | `create_video` Planner 冻结的 Resource references | Video Task、H3 graph builder |
| 人物与音色语义绑定 | 主 Agent 写出的唯一 H3 Prompt | Prompt validator、H3 Ref2VA |
| 音频 owner、MIME、大小和传输 URL | WorkspaceResource input resolver + outbound audio | H3 adapter |
| ComfyUI 临时文件名 | H3 input uploader | H3 frozen graph builder |
| Provider 接受身份 | provider invocation fence + H3 external id | poll、cancel、recovery |
| 视频业务终态 | Task Terminal Service + WorkspaceResource materializer | UI、后续创作链 |
| 当前可用 sound/voice 实例 | model/capability registry | 配置、Agent context、Planner |

入口与 writer 数量变化：

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| `create_video` 公开入口 | 1 | 1 |
| H3 视频 Provider adapter | 1 | 1 |
| H3 视频 Task/Resource writer | 各 1 | 各 1 |
| 参考音色后期配音入口 | 1（MOSS） | 0 |
| 独立 voice 任务入口 | 1 个历史执行 handler | 0 |
| 环境音效 Provider | 1（MOSS） | 0 |
| 竞争音色解释源 | H3 Prompt + MOSS 后期链 | H3 Prompt 1 个 |
| 自动 fallback | 0 | 0 |

## 13. 历史回归矩阵

| 历史事实/症状 | 根因 | 当时修复 | 本次相关风险 | 当前防线 |
| --- | --- | --- | --- | --- |
| H3 dual-stage 最初只接受一张图片 | 冻结图只实现了一个 Ref2VA 输入 | 扩展为有序多图片节点 | 再次只改 capability 而未接真实音频图 | 图节点、adapter、preflight、Planner 和 Skill 同阶段切换 |
| 音色试听真实时长为 null，短音频到 Provider 才失败 | Resource version 没持久化时长，Planner 只检查数量 | Worker 测量时长，视频 Planner 按 capability 校验 | H3 接音频后绕过冻结时长检查 | 继续复用统一 Resource input resolver 与 Plan 前时长校验 |
| 音频执行曾把所有 audio 推断成编曲音乐 | 多层按字段形状重复解释音频模式 | 建立 `FrozenAudioExecution` resolver | 删除 MOSS sound 时破坏音乐路径 | 保留 provider-neutral `create_audio` 与音频判别式，只移除 sound 实例 |
| MOSS TTS 后期配音新增独立 Task 链 | 需要生成旁白并与视频混音 | voiceover + mix dependency graph | 保留为隐藏 fallback 形成第二声音入口 | 排空任务后删除 Operation、Task、handler、async 分支和工作流 |
| H3 adapter 误把参考音频声明为模型不支持 | 早期本地冻结图只实现图片，产品限制被当作 Provider 事实 | adapter 显式拒绝 | 继续在 Skill、capability 或 adapter 残留旧拒绝 | 从官方 Ref2VA 契约反推全部触点并全仓检索旧规则 |

本次属于“新能力已存在但当前 H3 实例漏接契约”，同时包含旧 MOSS 执行入口退役。上一版 H3
multi-reference 只扩展 `ref_images`，并把 `referenceAudios` 明确排除，没有覆盖 Ref2VA 节点真实的
`ref_audios` 输入。

## 14. 参照物触点对齐

最接近的权威 reference implementation 是 ComfyUI 核心的 `MiniMaxH3ReferenceToVideo`，因为当前冻结
图已经直接使用同一节点和 Ref2VA 权重。Wao 内部最接近的媒体传输实现是现有 H3 continuation 上传，
音频上传的字节与 multipart 细节参考即将删除的 MOSS TTS uploader，但不保留其模型、Prompt 或任务
语义。

| 参照物触点 | 本次覆盖 / 不适用原因 | 验证 |
| --- | --- | --- |
| identity | 每个音频使用稳定 Resource id + contentVersion；Comfy 临时名只属本次 prompt id | 冻结 payload 检查 |
| 输入顺序 | `ref_audio_N` 按冻结音频相对顺序构造 | graph conformance |
| 持久化 | 不新增音频副本 Resource；最终仍只写视频 Resource | Task/Resource View |
| 执行 | 复用唯一 H3 video adapter 与单次 `/prompt` | provider invocation 观察 |
| 生命周期 | 音频上传属于同一视频提交准备，业务终态仍由视频 Task 拥有 | failure-path inspection |
| 失败 | 缺视觉、时长、MIME、上传、节点与 Provider 拒绝均明确失败 | Planner/preflight 验证 |
| 恢复 | `/prompt` 接受后只恢复同一 H3 external id；上传不是可恢复业务任务 | async protocol 验证 |
| 投影 | 最终 MP4 保留 H3 原生音轨并物化到原视频 Resource | 实际输出探测 |
| 权限 | 音频继续走 project owner + frozen version + outbound audio | owner mismatch 验证 |
| Prompt 绑定 | `<Audio N>` 明确绑定 `<Subject M> (Sx)` | Prompt validator + 人工 review |
| i18n | 新错误通过稳定 code 投影用户 locale，不硬编码 UI 文案 | locale/typecheck |
| reference video | 本次不适用；当前产品 capability 仍为 0 | capability conformance |
| 多音频 | 支持节点官方上限 3 段，总时长 15 秒 | 1/3/4 段边界验证 |

## 15. 文件与模块边界

### Provider Gateway / H3

- `src/lib/ai-providers/comfyui/models.ts`：声明 H3 audio capability，删除 MOSS 模型实例。
- `src/lib/ai-providers/comfyui/adapter.ts`：允许 H3 `referenceAudios`；删除 MOSS sound/voice adapter。
- `src/lib/ai-providers/comfyui/h3.ts`：准备参考音频、调用 uploader、构造音频节点并提交唯一 H3 graph。
- `src/lib/ai-providers/comfyui/h3-input-upload.ts`：增加 owner-aware H3 音频上传能力。
- `src/lib/ai-providers/comfyui/profiles.ts`：声明音频节点 identity、上限与动态连线。
- `src/lib/ai-providers/comfyui/workflows/h3-dual-stage-2mp.json`：增加 canonical LoadAudio → Ref2VA 连线。
- `src/lib/ai-providers/comfyui/async-task.ts`、`external-id.ts`：删除 MOSS SOUND/VOICE 路由。
- 删除 MOSS 实现、policy 和 workflow 文件。

### WorkspaceResource / Creative Skills

- `src/lib/video-generation/h3-prompt.ts`：按实际 reference count 校验 Audio/Picture 编号与人物绑定。
- `src/lib/creative-skills/skills/video-direction/SKILL.md`：声明 reference image + audio 模式和官方音色语法。
- 现有 `generation-request.ts`、`generation-ops.ts`、video handler 与 outbound audio 已具备公开字段、冻结、
  时长和出站链路，只补齐 H3-specific 限制时才修改，不复制第二套 reference schema。
- 删除 voiceover Operation、contract、handler 与 materializer 分支。
- `schema-registry.ts` 将 `project.voiceover_audio` 标记为历史只读，保留其他音频 schema。

### 模型配置与产品投影

- `src/lib/ai-registry/platform-models.ts`、`src/lib/platform-models/catalog.ts`、
  `src/lib/platform-runtime/presets.ts`：删除 MOSS defaults，并允许当前没有 sound 默认模型。
- `src/lib/model-access/system-model-resolver.ts`：删除 voiceover purpose；sound 缺失时继续明确失败。
- `src/lib/operations/project-agent.ts`：删除 `produce_voiceover_video` 注册。
- Task registry、进度、Canvas registry、消息文件删除 MOSS/voiceover 专属实例。

### 架构文档

本次不新增或删除 AP-01 至 AP-08。不变量 AP-03、AP-04 和 PG-21 已覆盖 capability、音色 Resource 与
显式 reference role。由于具体执行权威从 voice handler 转移到 H3 video handler，更新
`docs/architecture/modules/audio-production.md` 的“权威入口”，删除 `workspace-resource-voice.ts`，并把
H3 reference audio 的执行入口指向现有 video handler/provider adapter。实现文件、数值上限和删除清单
不复制到架构文档。

每个生产文件都必须映射到 Provider Gateway、Workspace Resource、Audio Production、Creative Skills
或其现有共享契约；无法映射的改动从本任务拆出。

## 16. 验证设计

### 独立契约与静态验证

- 从生产 capability registry 枚举 H3，验证 audio count、视觉依赖、时长与总文件上限。
- 从 canonical H3 workflow/profile 构图，验证 0、1、3 段音频时 `LoadAudio` 和
  `ref_audios.ref_audio_N` 的精确、有序连线；4 段必须被拒绝。
- 使用真实 Planner 输入验证：图片+音频通过；仅音频、少于 2 秒、总计超过 15 秒、模式混合均在
  Resource/Task 副作用前失败。
- Prompt validator 验证缺失 `<Audio N>`、越界编号、重复定义、未绑定 Subject/Speaker 时拒绝。
- 运行 `npm run check:capability-catalog`、`npm run check:model-config-contract`、
  `npm run check:media-normalization`、受影响文件 ESLint 与 TypeScript typecheck。
- MOSS 专属 contract test 随已删除语义一并删除；保留并更新来自生产 registry/graph 的 conformance
  证据，不为调用次数、mock 返回或源码字符串新增测试。
- 全仓检索 MOSS identity、workflow、Operation、Task handler 和默认模型，生产路径必须为零。

### 本地真实 H3 验收

准备一张指定人物参考图、一段 2–15 秒干净 MP3/WAV 人声和一段与参考音频不同的新台词。通过真实
`register_uploaded_media → create_video → Temporal Task → H3 8188` 路径执行，确认：

1. Plan 冻结图片和音频的精确 ResourceVersion；
2. H3 Runtime 收到一个音频上传和一个 `/prompt`；
3. `/prompt` 图包含对应 `LoadAudio → ref_audios.ref_audio_0`；
4. Task 从同一 external id 完成；
5. 最终 MP4 同时包含画面和音轨，指定人物说出新台词；
6. 人工听辨音色与参考人声一致性，并观察口型对应关系。

音色相似度、情绪迁移和口型质量属于模型输出，静态检查不能证明。没有完成真实样片前只能声明实现
完成，不能声明效果验收完成。

### MOSS 退役验证

- 平台/用户模型列表不出现两个 MOSS 模型；sound capability 为空。
- `produce_voiceover_video` 不存在；不能创建 Voice/Voiceover/VoiceoverMix Task。
- `create_audio` 音效 item 因 sound model/capability 缺失在 Plan 前明确失败。
- 已完成的 MOSS 音频、voiceover 视频和参考音频 Resource 仍可读取和播放。
- ACE-Step 音乐继续通过 shared ComfyUI target 工作。

## 17. 完成定义

实现完成需要满足：

- H3 audio reference 从公开 Resource 引用到 Ref2VA 节点只有一条完整链路；
- 指定人物与音色的关系由同一最终 Prompt 明确表达并经过结构校验；
- H3 图片-only reference、帧模式和 continuation 现有能力没有被音频接入破坏；
- 两个 MOSS 模型、工作流、Operation、Task、poll/cancel 和默认配置全部删除；
- 切换时不存在非终态 MOSS 任务或 external invocation；
- 没有兼容分支、fallback、隐藏执行器或第二声音状态机；
- 已有 Resource 和完成历史保持可读；
- 实际验证命令、结果和未完成的真实 H3 效果盲区如实记录。

只有完成本地真实 H3 样片并确认指定人物、参考音色和新台词均落入同一最终 MP4，才能把本阶段称为
效果验收完成。
