# MiniMax H3 多参考图、首帧与首尾帧视频能力并存设计

日期：2026-08-24
状态：聊天设计已获用户确认，待书面规范复核

## 背景与本次产品决策

Waoowaoo 当前通过 `comfyui::minimax-h3-dual-stage-2mp` 提供 MiniMax H3 双阶段 2MP 视频能力，
现有生产路径只声明 `reference` 输入模式，接受 1–8 张有序 `reference_image`，并通过
`MiniMaxH3ReferenceToVideo` 完成一采、1MP 重绘输入、二采和 2MP RTX VSR 成片。

本次不是替换现有多参考图能力，而是在同一个模型 identity 和同一条产品执行链上增加：

- `first_frame`：精确一张 `role=first_frame` 图片；
- `first_last_frame`：精确一张 `role=first_frame` 和一张 `role=last_frame` 图片。

最终产品能力必须同时保留以下三种互斥模式：

1. `reference`：1–8 张普通参考图；
2. `first_frame`：一张首帧；
3. `first_last_frame`：一张首帧和一张尾帧。

普通参考图不得因数量为一而被推断为首帧，帧模式也不得与普通参考图混用。输入模式只由冻结的
`role + channel` 显式事实解析。

本规范取代
`docs/superpowers/specs/2026-08-16-minimax-h3-dual-stage-2mp-replacement-design.md`
中“删除首帧/首尾帧、仅保留 reference”的产品范围决定；此前已经落地的 runtime target、提交协议、
多参考图 graph、轮询、取消和终态所有权继续有效。

## 已验证事实

### 当前代码与历史

- 当前基线分支为 `next/upstream-assistant`，设计分支从提交
  `59fe3bf7f0a8da0eca83c96eebc90dbe7f7ac807` 创建。
- 当前冻结多参考图 API graph 是
  `src/lib/ai-providers/comfyui/workflows/h3-dual-stage-2mp.json`。
- 当前 H3 adapter、profile、model capability、runtime target、external id 和异步轮询已经形成完整生产链。
- 历史提交 `47e9a42b7` 曾接入首帧与首尾帧两份 H3 graph；历史提交 `4bd7fb9a0` 后用双阶段
  reference graph 替换。历史实现可用于确认 provider-neutral 首尾帧 transport，但本次不得恢复两份
  帧模式 graph 或旧模型 identity。
- 当前多参考图扩展由提交 `9a2bc13f6` 引入，1–8 张图片按数组顺序映射为
  `ref_images.ref_image_N`。本次必须保留这条映射和上限。

### 新工作流

用户提供的字面路径包含一个实际不存在的子目录。按文件名定位到的最新有效文件是：

```text
D:\workspace\comfui\workflows\MiniMax H3首尾帧视频_双阶段重绘_二采1MP_RTXVSR成片2MP.json
```

调查时该文件的事实为：

- 最后保存时间：2026-08-24 07:45:06；
- SHA-256：`C209491AE29FF53178CCDDF5E2C7AA0F2405A81F3C57E171DACDD9B87AA3A4CC`；
- ComfyUI UI-canvas 格式，69 个节点、75 条链接、13 个 group，版本 0.4；
- 一采核心节点：`MiniMaxH3ImageToVideo`，节点 309；
- 首帧经节点 137/198 进入 `first_frame`；
- 尾帧经节点 326/327 进入 `last_frame`；
- 图生视频和首尾帧视频使用同一个执行图，唯一差异是是否存在 `last_frame` 输入；
- 一采模型：`h3\minimax_h3_fl2va_int8_convrot.safetensors`；
- 二采模型：`h3\minimax_h3_fl2va_pruned_int8_convrot.safetensors`；
- CLIP：`h3\qwen3vl_32b_minimax_h3_int8_convrot.safetensors`；
- 视频 VAE：`h3\minimax_h3_video_vae_int8_convrot.safetensors`；
- 音频 VAE：`h3\minimax_h3_audio_vae_fp32.safetensors`；
- LoRA：`h3\minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`；
- 一采有效步数由链接的 `INTConstant` 206 决定为 10，二采由 215 决定为 3；
- 一采 sampler 为 Euler，二采 sampler 为 `res_multistep`、`denoise=0.2`；
- 一采输出经 RTX VSR 放大到 1MP 后重新编码，二采解码后再经 RTX VSR 放大到 2MP；
- 最终输出节点是 `VHS_VideoCombine` 168，24fps、H.264 MP4、YUV420P、CRF 10，并保留原生音频；
- 两个 `easy clearCacheAll` 继续承担单卡显存交接。

该 JSON 是 UI canvas，不是可直接提交到 `/prompt` 的 API graph。生产实现必须生成并版本控制一份裁剪后的
API graph，不得在运行时读取、转换或解释桌面工作流文件。

### 8188 实时环境

调查时 `127.0.0.1:8188` 实际运行：

- ComfyUI 0.33.1；
- Python 3.12.10；
- PyTorch 2.10.0+cu130；
- NVIDIA GeForce RTX 5070 Ti；
- 启动入口属于 `D:\workspace\AI-T8-video-onekey\ComfyUI`。

`/object_info` 已实时确认 `MiniMaxH3ImageToVideo`、URL 图片加载、首尾帧预处理、两阶段采样、VAE、
`PT_H3ConcatAVLatent`、RTX VSR 和 `VHS_VideoCombine` 所需节点均已注册；上述 FL2VA 模型、CLIP、VAE、
LoRA、`nvidia_rtx_vsr` 和 `comfy kitchen attention` 也在实时选项中。

这些事实只证明静态接入条件，不代替三个输入模式的真实生产验收。

## 目标

- 同一个 H3 model key 同时声明并执行 `reference`、`first_frame` 和 `first_last_frame`。
- 完整保留现有 1–8 张多参考图 graph、Prompt 语义和执行能力。
- 首帧与首尾帧共用一份新的 canonical API graph，只通过显式尾帧输入决定模式。
- 三种模式共用一个 provider adapter、一个 runtime target、一个 submission fence、一个 external-id 协议、
  一套 poll/cancel 和一个 WorkspaceResource terminal writer。
- 主 Agent 继续是最终 H3 Prompt 的唯一 writer；ComfyUI graph 不调用 Codex。
- preflight 从实际选中的冻结 graph 派生节点、模型和能力要求，不再维护会漂移的手写第二清单。
- 通过真实 `create_video` 触发证明三种能力都能到达 `accepted -> completed -> ready Resource`。

## 非目标与禁止范围

- 不删除、覆盖、降级或改名现有多参考图能力。
- 不支持 `text_to_video`、仅尾帧或中间过渡帧模式。
- 不允许普通参考图与首帧/尾帧混用。
- 不允许参考音频或参考视频进入本 H3 模型。
- 不为首帧和首尾帧分别建立两份 graph。
- 不建立第二个 H3 model key、第二个 provider adapter、第二个 runtime target 或第二套异步状态机。
- 不把 UI canvas、`LoadImage` 本地路径、preview 数据或 `RH_CODEX_NODE` 带入生产 graph。
- 不在 8188 失败时回退到 shared ComfyUI、其他模型或外部 Provider。
- 不修改数据库 schema，不执行迁移、回填、清理或历史任务删除。
- 不借本次能力扩展清理其他 Provider、音频工作流或无关测试。

## 方案比较与采用方案

### 采用：一个模型 identity、两个明确 graph profile、三个输入模式

保留现有 reference profile，新增一个 frame profile。frame profile 始终绑定首帧；只有
`first_last_frame` 才绑定尾帧，`first_frame` 构造时明确删除 `last_frame` 输入和不需要的尾帧 URL 节点。

profile 选择发生在 ComfyUI H3 adapter 内，但选择依据来自 provider-neutral 引用解析器已经保留的显式角色：

- `referenceImages` 非空且 `imageUrl` 为空：reference profile；
- `imageUrl` 非空且无 `lastFrameImageUrl`：frame profile 的首帧模式；
- `imageUrl` 和 `lastFrameImageUrl` 都非空：同一 frame profile 的首尾帧模式。

任何混合、缺首帧、空 URL、超限或额外通道都在 `/prompt` 前失败。该映射不是“按图片数量猜模式”，因为
`imageUrl`、`lastFrameImageUrl` 和 `referenceImages` 已由唯一 role projector 从明确 Workspace role 生成。

### 拒绝：独立新增 frame 模型

独立模型会复制 model selection、capability、默认配置和用户选择，并让一个 H3 产品能力出现两个入口。
它也无法表达用户明确要求的“在现有多参考图能力基础上增加两种能力”。

### 拒绝：三种模式共用一个可变通用 graph

`MiniMaxH3ReferenceToVideo` 与 `MiniMaxH3ImageToVideo` 是不同节点契约和不同一采模型。强行把它们塞进一个
含 switch/bypass 的通用 graph 会同时装载无关分支、增加显存和隐藏执行路径。两个明确 profile 是同一
adapter 下的穷尽实现，不是两套业务入口。

### 拒绝：恢复历史两份 frame graph

首帧和首尾帧唯一差异只是 `last_frame` 输入。两份几乎相同的 JSON 会让模型、二采、VSR、输出节点和
固定参数出现重复事实源，未来必然漂移。

## 最接近的参照实现与触点对齐

参照物选择当前 `comfyui::minimax-h3-dual-stage-2mp` 多参考图实现，因为新模式必须复用其模型 identity、
Capability registry、Workspace 输入冻结、出站图片、provider fence、8188 runtime、异步恢复和终态物化。

| 参照物触点 | 新模式覆盖 / 不适用原因 | 验证 |
| --- | --- | --- |
| 模型 identity | 复用 `comfyui::minimax-h3-dual-stage-2mp`，不新增 model key | 生产 catalog 穷尽解析 |
| capability | 从仅 `reference` 扩展为三种互斥模式；reference 上限仍为 8 | registry conformance + planner |
| Prompt writer | 主 Agent + `video-direction` 仍是唯一 writer | 实际项目 Turn 与 Prompt 校验 |
| 输入 identity | 继续冻结 `resourceId + contentVersion + role + channel + position` | Task payload 与 Lineage |
| 模式解析 | 新增唯一 `resolveVideoInputMode`，全部消费者复用 | 三种模式与非法组合的纯逻辑 oracle |
| 图片出站 | 继续走 owner-aware `resolveOwnedImageUrlForGeneration` | 实际 Worker 输入 URL |
| provider 入口 | 继续由同一个 ComfyUI video adapter 执行 | registry route selection |
| graph profile | reference 复用现有 graph；两种 frame 模式共用一份新 graph | frozen graph 检查 + 8188 submission |
| 提交 fence | 完全复用，每个逻辑 invocation 每 attempt 至多一次 `/prompt` | provider submission contract |
| runtime target | 继续使用 `h3-dual-stage-2mp -> COMFYUI_H3_DUAL_STAGE_BASE_URL` | 配置解析与实时目标确认 |
| external id | 保持 `COMFYUI:h3-dual-stage-2mp:VIDEO:<promptId>` | parser/formatter + 恢复轮询 |
| 轮询/取消 | 完全复用同一 target 的 `/api/jobs/:id` | 真实完成与取消/终态响应 |
| 输出解释 | 两个 graph 都固定最终输出节点 168 | graph conformance + history/output |
| 失败 | 保留 pre-accept、rejected、outcome-unknown 和完整 FailureRecord | 现有协议 oracle + 真实拒绝 |
| 终态写入 | 继续由 WorkspaceResource Task terminal owner 唯一物化 | ready Resource、版本和通知 |
| 权限 | 上游 Project/Resource owner 校验不变 | canonical create_video 调用 |
| i18n | UI/Agent 只消费 capability View，不新增硬编码中文分支 | locale/typecheck |

## 权威入口与数据流

```text
Workspace references（显式 role/channel/version）
  -> 唯一 video input-mode resolver
  -> create_video Planner 校验 capability、Prompt 和冻结引用
  -> WorkspaceResource Task payload
  -> owner-aware 图片 URL 投影
  -> provider-neutral reference payload projector
  -> provider invocation fence
  -> ComfyUI H3 adapter 穷尽选择 reference profile 或 frame profile
  -> 同一 8188 /prompt
  -> 同一 target external id
  -> 同一 poll/cancel/download
  -> 同一 WorkspaceResource terminal materializer
```

| 事实 | 唯一 owner / writer | 消费者 |
| --- | --- | --- |
| 支持的三个输入模式 | H3 production capability registry | Agent context、Planner、UI |
| 当前 item 的输入模式 | 纯 resolver 从冻结 roles 派生，不持久化第二份事实 | Prompt validator、Planner、transport |
| reference 图片顺序 | 冻结 references 数组 position | profile builder、Lineage |
| H3 Prompt | 主 Agent 的 `video-direction` 输出 | Planner、adapter |
| graph 及可注入节点 | H3 runtime profiles | H3 adapter、preflight、poll |
| runtime target 到 URL | ComfyUI target registry | submit、probe、poll、cancel、download |
| Provider 接受身份 | provider invocation fence + external id | retry、poll、cancel |
| Provider 运行状态 | 8188 `/api/jobs/:promptId` | async provider registration |
| Wao 业务终态 | Task terminal owner | Resource、Lineage、通知、UI projector |

输入模式是冻结 role 的纯派生值，不新增数据库字段、Task writer 或第二状态。相同冻结输入在 Planner、retry 和
Worker 中必须解析出相同模式。

## Canonical graph profiles

### Reference profile：完整保留现有能力

继续使用当前受版本控制的 `h3-dual-stage-2mp.json` 和 `MiniMaxH3ReferenceToVideo`：

- 1–8 个 `Load Image From Url (mtb)` / resize 节点按数组 position 映射；
- `ref_images.ref_image_0` 至 `_7` 只按实际数量存在；
- 一采使用 Ref2VA 模型；
- 二采、1MP/2MP RTX VSR、两次 cache clear、原生音频和最终节点保持不变。

实现不得为了 frame 模式重写现有 reference graph 的节点语义。

### Frame profile：首帧与首尾帧共用

新增 `src/lib/ai-providers/comfyui/workflows/h3-frame-dual-stage-2mp.json`。它从最新 UI canvas 裁剪为
canonical API graph，并满足：

- 首帧 URL 节点和预处理节点固定存在；
- 尾帧 URL 节点只在 `first_last_frame` 构造结果中存在；
- `MiniMaxH3ImageToVideo` 一采使用 FL2VA 模型；
- 首帧模式的 H3 node 不包含 `last_frame` key；
- 首尾帧模式的 H3 node 把 `last_frame` 连接到尾帧预处理节点；
- Prompt、width、height、length 和 seed 由 builder 写入；
- 10/3 steps、sampler、denoise、1MP/2MP RTX VSR、cache clear、VAE 和原生音频保持源图语义；
- 唯一保存输出是节点 168，其他预览输出全部删除或 `save_output=false`。

### UI canvas 中必须删除或展开的内容

- 删除 `RH_CODEX_NODE`，避免第二个 Prompt writer；
- 删除本地 `LoadImage`，替换为 URL loader；
- 删除 Label、preview state、`easy showAnything` 和只用于桌面观察的节点；
- 删除 Prompt 拼接与工作流内 Codex 调用，直接使用 Wao 冻结 Prompt；
- 展开 `SetNode/GetNode` 为明确 API links；
- 展开 Primitive、ResolutionSelector 和数学 UI 控件为 builder 注入的明确值；
- 不把 UI 文件路径、预览文件、COS URL 或桌面 metadata 带入仓库。

## Profile identity、runtime target 与异步恢复

graph profile identity 与 runtime target identity 必须分开：

- 内部 graph profile：reference 与 frame 两个穷尽值；
- 外部 runtime target：仍只有 `h3-dual-stage-2mp`；
- `GenerateResult.endpoint` 和 external id 继续记录 runtime target，而不是 graph profile；
- poll/cancel 不需要知道 graph profile，因为两个 graph 都在同一 target 运行，并声明同一个最终输出节点 168。

因此本次不修改 external-id 格式、不增加 parser 分支、不迁移历史 external id。已经接受的 reference 任务
继续从同一 target 和输出节点恢复。

## Preflight 单一事实源

当前 `h3.ts` 同时维护冻结 graph 和一份手写 `expectedModels`/`requiredNodeClasses`。调查发现手写清单检查的
UNET 名称已经与当前冻结 graph 不一致，但因为那些无关模型也恰好安装，preflight 仍可能给出假阳性。

本次把 preflight 收敛为：

1. 先根据显式输入选择实际 profile；
2. 从该 profile 的 `class_type` 穷尽派生必需节点；
3. 从实际 loader 节点输入派生精确 UNET、CLIP、VAE、LoRA；
4. 从实际 VSR 和 attention 节点输入派生必需 option；
5. 对相同 base URL + profile fingerprint 做短 TTL 缓存；
6. graph 改变时 fingerprint 改变，不能复用另一 profile 或旧 graph 的成功缓存。

删除手写第二清单后，冻结 API graph 成为节点和模型要求的唯一事实。任何缺失在 provider fence 和
`/prompt` 前产生 pre-accept rejection，不回退、不猜测同名模型。

## Prompt 契约

当前 `minimax_h3_reference_v2` 名称和规则只描述普通参考图，不能准确覆盖帧时间锚点。本次将 H3
capability 的 Prompt 方言一次性收敛为 `minimax_h3_multimodal_v3`，仍由同一个 `video-direction` Skill
生成，不创建第二个 Skill。

三种模式共享现有六段式结构和独立配乐边界：

```text
subject_definitions:
summary:
retention_analysis:
detailed_description:
overall_soundscape:
non_diegetic_music:
N/A
```

模式差异只来自显式 input mode：

- `reference`：`<Picture N>` 仅绑定身份、服装、风格、道具和空间事实；禁止把任何图片描述成第一帧或
  最后一帧；现有多参考图 Prompt 语义保持不变。
- `first_frame`：Picture 1 是 0.00 秒时间锚点；`detailed_description` 开头必须明确 Picture 1 与
  0.00 秒对齐，然后描述从该状态连续发展的动作。
- `first_last_frame`：Picture 1 对齐 0.00 秒，Picture 2 对齐本 Segment 的有效结束时间；描述从首帧
  状态收敛到尾帧状态的连续运动路径，不新增第三张 H3 原生关键帧。

Prompt validator 接收同一个 canonical input mode resolver 的结果，在任何 Plan/Resource/Task 副作用前
验证结构和模式锚点。adapter 对冻结 Prompt 调用同一 validator 作为 Provider 边界防线，但不改写 Prompt。

背景音乐继续由独立音乐工作流唯一负责，`non_diegetic_music` 固定为 `N/A`；原生对白、环境声、动作声和
非语言人声仍可由 H3 生成。

## Capability 与消费者

同一模型 capability 调整为：

- `promptProfile: 'minimax_h3_multimodal_v3'`；
- `supportedInputModes: ['reference', 'first_frame', 'first_last_frame']`；
- `supportsTextToVideo: false`；
- `assetReferenceMultiReference: true`；
- `maxReferenceImages: 8`；
- `maxReferenceFiles: 8`，只约束普通 reference 通道；
- `firstlastframe: true`；
- `durationOptions: [4, 5, ..., 13]`；
- `generateAudioOptions: [true]`；
- 不声明参考音频或参考视频能力。

Planner 规则：

- reference：1–8 张 `reference_image`，没有 frame/audio/video role；
- first_frame：精确一张 `first_frame`，没有其他 reference；
- first_last_frame：精确一张 `first_frame` 和一张 `last_frame`，没有其他 reference；
- last_frame without first_frame、重复 frame、混合模式、空引用和未知 role 原地失败。

UI 和主 Agent 只消费 registry 投影的最终 View，不根据模型名或当前附件数量猜测可用模式。预计不需要新增
独立页面或 route；若当前消费者存在 reference-only 私有判断，实施时必须删除并改为消费 capability。

## 生命周期与失败矩阵

| 场景 | 行为 |
| --- | --- |
| 正常 reference | 现有 graph 接受 1–8 张 reference，完成双阶段 2MP 输出 |
| 正常 first_frame | frame graph 只绑定首帧，不包含 `last_frame` input |
| 正常 first_last_frame | 同一 frame graph 绑定首帧和尾帧 |
| 模式混合 | Planner 在副作用前拒绝，adapter 再次 fail closed |
| 缺首帧/重复帧 | 明确 `INVALID_PARAMS`，不提交 `/prompt` |
| 节点/模型/VSR 缺失 | selected-profile preflight 产生 pre-accept rejection |
| Provider `/prompt` 400 | 保留原生响应并标记 rejected，不重提 |
| 提交断连/超时 | 用同一 prompt id 查询同一 target；能证明接受则恢复，否则 outcome unknown |
| queued/running | 继续使用现有独立 queue/generation 预算 |
| Provider failed/cancelled | 产生完整 FailureRecord，不选择中间视频 |
| 用户取消 | 先服从 Wao 本地终态，再按同一 external id 补偿取消 |
| poll 网络异常 | 恢复同一 external id，不伪造 Provider 终态 |
| 输出缺失或错误格式 | 只读取节点 168 的 MP4；缺失、非视频或超限明确失败 |
| Wao 重启 | 从持久 external id 恢复同一 8188 job |
| 重复/并发 | provider invocation fence 继续是唯一提交裁判 |
| 第一阶段成功、二采失败 | 中间结果不是产品终态，不物化 WorkspaceResource 版本 |
| 晚到完成 | 本地 terminal owner 拒绝覆盖已取消/失败终态 |

## 事务、幂等与切换

- 不改变 create-video 的 Plan/commit 事务和 pending Resource 预留。
- 不改变 provider invocation identity、submission fence 或 prompt-id 生成时机。
- 不把两个采样阶段拆成两个 Wao Task、两个 external id 或两个可独立重试步骤。
- 不新增数据库 writer、migration 或缓存事实。
- 模型 identity、runtime target 和最终 output node 不变，因此不要求排空现有 reference 任务。
- 已冻结的旧 reference Prompt 与新 `reference` 模式保持同一六段结构，可由新 validator 接受，不需要
  alias、fallback 或历史兼容分支。
- 新代码部署后，旧 accepted job 继续按原 external id 轮询；新提交才参与 graph profile 选择。

## 状态解释者和入口数量

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| H3 model identity | 1 | 1 |
| H3 输入模式 | 1 | 3 |
| H3 graph profiles | 1 | 2（reference / frame） |
| frame graph | 0 | 1（两种 frame 模式共用） |
| Prompt writer | 1 | 1 |
| input-mode resolver | 1 个局部推导 | 1 个共享纯 resolver |
| provider adapter / submit 入口 | 1 / 1 | 1 / 1 |
| runtime target | 1 | 1 |
| external-id parser/formatter | 1 / 1 | 1 / 1 |
| poll/cancel 入口 | 1 / 1 | 1 / 1 |
| Task terminal writer | 1 | 1 |
| 竞争生命周期解释者 | 0 | 0 |

两个 graph profile 对应不可互换的 H3 节点契约，但由一个穷尽 selector 裁决，不构成两个业务入口或竞争
状态机。

## 删除项与残余双轨

实施时删除：

- H3 adapter 的 reference-only 拒绝分支；
- capability 和 `video-direction` 中“没有 first_frame/last_frame”的旧声明；
- H3 preflight 手写的节点/模型第二清单；
- 新 frame API graph 中所有 `RH_CODEX_NODE`、本地 `LoadImage`、preview 和 UI-only 状态；
- 若发现调用方按 model name 或图片数量判断 frame/reference，删除该旁路并复用共享 resolver。

不删除：

- 现有多参考图 API graph；
- `MiniMaxH3ReferenceToVideo` profile builder；
- 1–8 张 reference 映射；
- 当前 model key、runtime target、external id、poll/cancel 和 terminal materializer。

交付后允许存在两个明确 graph profile，不允许存在第二个 model key、第二个 adapter、第二个 input-mode
resolver、第二个 prompt writer、动态 canvas 转换或 fallback。

## 预计代码边界

- `src/lib/ai-registry/types.ts`：增加统一 H3 Prompt profile 枚举；不新增第二个 mode 枚举。
- `src/lib/video-generation/input-mode.ts`：新增唯一纯 input-mode resolver，或将现有 reference projector
  收敛为同一职责模块。
- `src/lib/video-generation/h3-reference-prompt.ts`：改名或收敛为多模式 H3 Prompt validator。
- `src/lib/operations/domains/workspace-resource/generation-ops.ts`：复用 resolver 做 capability 和 Prompt preflight。
- `src/lib/video-generation/reference-images.ts`：复用 resolver 投影 provider-neutral frame/reference 字段。
- `src/lib/ai-providers/comfyui/workflows/h3-frame-dual-stage-2mp.json`：新增唯一 frame API graph。
- `src/lib/ai-providers/comfyui/profiles.ts`：保留 reference builder，新增 frame builder和穷尽 profile 类型。
- `src/lib/ai-providers/comfyui/h3.ts`：选择 profile、从 graph 派生 preflight、保持单一 submit/poll/cancel。
- `src/lib/ai-providers/comfyui/adapter.ts`：允许三种模式对应的规范化 transport 字段。
- `src/lib/ai-providers/comfyui/models.ts`：同一 model key 声明三种模式。
- `src/lib/creative-skills/skills/video-direction/SKILL.md`：按显式模式写 reference 或 frame 锚点。
- 受影响的 production-registry conformance、provider protocol 和非平凡纯 resolver 验证文件。

实际实施必须先按最近引用链再次定位文件。若发现需要 schema、第二 writer 或第二异步入口，停止并重新评审，
不能把它作为实现细节顺带扩大。

## 验证策略

### 确定性验证

1. 冻结 frame API graph 的每条 link 都指向存在节点，且不存在 `RH_CODEX_NODE`、`LoadImage`、preview URL
   或本地绝对路径。
2. reference graph 保持 1–8 张有序映射；frame graph 对首帧和首尾帧只差 `last_frame` 输入。
3. 两个 profile 都包含 10/3 steps、0.2 denoise、两次 RTX VSR、两次 cache clear、原生音频和唯一输出 168。
4. profile-derived preflight 精确得到各自 UNET、CLIP、VAE、LoRA、attention 和 VSR 要求。
5. 从生产 registry 穷尽验证同一 model key 的三种模式、reference 上限、4–13 秒和固定原生音频。
6. input-mode resolver 使用角色事实验证四个有效/无效边界：reference、first、first+last、混合/缺首帧。
7. Provider submission 协议继续验证 pre-accept、400 rejected、5xx/timeout outcome unknown 和同 prompt-id probe。
8. 运行 `npm.cmd run typecheck`、针对受影响文件的 ESLint、适用 conformance/provider checks 和
   `git diff --check`。

自动化验证只在 graph、registry、数学、角色集合或 Provider 协议提供独立 oracle 时新增或修改；不新增
源码字符串、文件存在、mock 调用次数或展示快照测试。

### 8188 实时验证

1. 部署前重新读取 `/system_stats` 和两个 selected profile 的 `/object_info`/模型选项。
2. 用真实 ready WorkspaceResource 对三种模式分别执行 canonical planner，确认 frozen mode、引用角色和
   generation options。
3. 通过真实 `create_video` 各提交一个最短合法小样：
   - 1–2 张普通 reference（证明现有能力未丢失）；
   - 一张 first frame；
   - 一张 first frame + 一张 last frame。
4. 每个任务观察 `accepted -> queued/running -> completed`，不得直接调用 `/prompt` 冒充产品验收。
5. 核对最终 ready Resource、输入 Lineage、model key、provider、storage object 和唯一版本物化。
6. 用 FFprobe 验证 MP4 可读、24fps、约 2MP 分辨率和原生音轨；确认没有错误选择一采中间输出。
7. reference 小样的 Prompt 不包含时间锚点；first/first-last Prompt 包含与模式相符的 Picture 对齐。

### 重启与运行边界

代码和 capability 变更后需要重启 Windows 宿主机上的 Next.js 与 Temporal Worker，并实际确认二者 readiness。
ComfyUI 节点、模型和外部工作流文件未改时不需要重启 8188；仍需在提交前重新做实时 preflight。

若只生成最短时长小样，交付必须声明 13 秒、全部宽高比和并发组合尚未真实生成，不能用静态数学或短样片
暗示全部运行组合已通过。

## 完成定义

### 实现完成

- 同一 model key 声明三种互斥输入模式；
- 现有 1–8 张多参考图 graph 和能力保留；
- 首帧与首尾帧共用一份新 frame API graph；
- 单一 resolver、adapter、runtime target、fence、external id、poll/cancel 和 terminal writer；
- profile-derived preflight 取代漂移的手写清单；
- 适用静态检查、类型检查和协议验证通过，盲区如实列出。

### 阶段完成

在实现完成基础上，三个 canonical `create_video` 小样均完成并物化 ready Resource，输出 2MP MP4、24fps、
原生音轨和 Lineage 符合预期；Next.js 与 Temporal Worker 重启后 readiness 已实际确认。

### 架构完成

只有在没有第二 model key、第二 input-mode resolver、第二 Prompt writer、动态 canvas 转换、fallback 或竞争
终态解释者，并且三个模式的真实路径、恢复/取消边界和适用历史回归均无关键盲区时，才可称架构完成。
存在最长时长、全部比例或并发盲区时只能称阶段完成。

## 架构文档判断

本设计扩展同一 Provider Gateway 能力实例，但不改变 provider adapter、WorkspaceResource terminal writer、
媒体出站投影、Task 生命周期或 Prompt writer 的权威归属。它落实既有 PG-03、PG-04、PG-05、PG-06、
PG-20、PG-21 与 WR-08、WR-09，不新增或删除架构不变量。

因此默认不修改 `docs/architecture/**`。只有实施调查证明权威入口或不变量必须改变时，才按仓库准入规则
重新评审并更新模块文档。
