# H3 Ref T8 4+5 双采 2MP 工作流替换设计

日期：2026-09-06
状态：设计完成，待用户确认后进入实施计划

## 1. 决策摘要

本次只替换 MiniMax H3 的 `reference`（Ref）执行图。`first_frame`、`first_last_frame` 和
`continuation` 的 capability、工作流、帧引导、尺寸和执行行为全部保持现状。

采用附件工作流的 T8 双采样主链、4+5 parity 调度、按有效帧数分档的一采/二采 MP，以及最终
RTX VSR 2MP；将附件 UI 画布离线整理成受版本控制的 canonical ComfyUI API graph。最终输出固定为：

```text
H.264 + yuv420p + CRF 10 + 24fps + MP4
```

不保留当前 Ref 图、不建立旧任务 parser、不做运行时回退或双轨选择。当前系统没有需要继续执行的旧
Ref 任务，因此这是一次硬切换；切换前仍做一次只读非终态任务检查，结果非空时停止部署并报告，不替
用户取消或清理数据。

参考输入能力保持不变：1–8 张有序参考图、0–3 段有序参考音频，音频必须与至少一张参考图同时使用。
Ref 继续支持当前 H3 的全部比例：`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`、`9:21`；请求传入
哪个合法比例，两级采样尺寸和最终 2MP 输出就使用哪个比例。`16:9` 只是附件工作流的服务器实测配置，
不是 capability 限制。Ref 可请求 5–15 秒；其他三个 H3 模式仍使用现有 4–11 秒规则。

## 2. 输入材料的权威性

附件
`(原作风格兼容10秒)MiniMax+H3双采参考生视频V2_4+5_1MP_RTXVSR2MP.json`
是已经由用户在目标服务器验证的工作流事实来源。附件中的节点、连接和固定采样参数用于本次图转换；
节点标题、分组、预览路径、COS 地址、机器目录和其他 UI 元数据不是产品指令，也不得进入仓库。

用户在对话中给出的适用范围、帧数公式、MP 表、Ref-only 边界、保留多参考能力、取消旧任务兼容及编码
选择优先于附件默认值。代码库的 capability registry、WorkspaceResource 所有权契约、Provider fence
和 Task 终态协议继续是运行时权威。

## 3. 目标、非目标与禁止范围

### 3.1 目标

- 用附件的 T8 4+5 双采链完整替换当前 H3 Ref graph。
- 在 RTX 5070 Ti 16GB 的 16:9 实测基线上，按“有效帧数 × MP”约束 5–15 秒采样负载，并把同一
  恒定面积 MP 档位应用到当前全部合法比例。
- 继续支持最多 8 张参考图和 3 段参考音频，并保持冻结后的输入顺序。
- 将每种输入模式可用的时长和模型合法比例放在统一 capability policy 中，由规划、执行前校验和
  Provider 防御共同消费。
- 保持一个 Wao 视频 Task、一个 Provider submission、一个 ComfyUI prompt id 和一个最终视频结果。
- 在 `/prompt` 前验证必需节点、模型、端口、自增长输入和固定选项，能力缺失时明确失败。
- 最终交付浏览器兼容的 H.264 8-bit 4:2:0 MP4，并保留 H3 原生音轨。

### 3.2 非目标

- 不修改 `first_frame`、`first_last_frame` 或 `continuation` 的执行图与效果参数。
- 不修改 H3 Prompt 方言、六段式结构、参考音频人物绑定语义或背景音乐规则。
- 不新增视频模型 identity、用户可见 Provider、质量档位或手工 MP 控件。
- 不自动清理数据库 Task、Resource、MediaObject、对象存储文件或 ComfyUI 输出。
- 不接入外部视频 Provider，不把 ComfyUI 图片节点暴露为图片 Provider。
- 不以本次任务为由清理其他 Provider、工作流或非 H3 Ref 代码。

### 3.3 禁止范围

- 禁止保留新旧 Ref graph 的运行时开关、回退、按任务版本分流或兼容 parser。
- 禁止由 adapter、UI、Agent Prompt 或 ComfyUI 数学节点各自解释时长、比例或 MP。
- 禁止将用户机器路径、预览 URL、bucket 信息和 UI widget 状态复制进 canonical graph。
- 禁止绕过 `outbound-image` 读取参考图片，或用普通 `fetch` 读取 WorkspaceResource。
- 禁止把两阶段拆成两个 Task、两个 external id 或两个可独立重试的产品步骤。
- 禁止用自动裁切、时长降级、减少参考文件或切换旧图掩盖不支持的请求。

并行边界：本阶段只允许一个 owner 修改视频 capability policy、H3 Ref profile 和 `h3.ts` 核心执行入口；
其他任务不得同时修改这些权威入口。与本任务无关的现有脏工作区文件保持原样且不进入提交。

## 4. 采用方案与拒绝方案

### 4.1 采用：同一模型下的穷尽“输入模式策略”

在 `VideoCapabilities` 中建立按 `VideoInputMode` 索引的 `inputModePolicies`。每个已声明的
`supportedInputModes` 必须且只能有一项时长策略；模型级 `aspectRatioOptions` 是所有模式共同消费的
唯一合法比例集合。registry 解析时拒绝缺项、额外项、空列表、重复值和非法值。

H3 的单一策略为：

| 输入模式 | 时长 | 比例 |
| --- | --- | --- |
| `reference` | 5–15 秒整数档 | 现有 H3 比例集合 |
| `first_frame` | 现有 4–11 秒整数档 | 现有 H3 比例集合 |
| `first_last_frame` | 现有 4–11 秒整数档 | 现有 H3 比例集合 |
| `continuation` | 现有 4–11 秒整数档 | 现有 H3 比例集合 |

删除 H3 顶层 `durationOptions`，避免全局列表和模式列表同时成为真相。新增模型级
`aspectRatioOptions`，把目前藏在 ComfyUI adapter/profile 中的七种合法比例提升为 capability 事实。
共享 resolver 是唯一状态解释者，负责“当前模型 + 输入模式 + 时长 + 比例”组合的解析与拒绝。
ProjectProductionContext、Planner/operation preflight 和 ComfyUI adapter 防御均调用这一 resolver；
adapter 的基础 schema 只做类型与有界结构校验，不复制业务集合。

ProjectProductionContext 先验证项目比例属于模型级 `aspectRatioOptions`，随后向 Agent 暴露全部现有 H3
模式。`segmentDurationPlans` 按各模式自己的 duration policy 生成，不再对全局 duration 列表做笛卡尔
积。现有上下文结构已能表达 `inputMode + requestedDurationSeconds` 的精确计划，无需新增第二份模式状态；
`allowedSegmentDurationsSeconds` 保留为当前可执行模式时长的去重并集，精确选择仍以
`segmentDurationPlans` 为准。

### 4.2 采用：Ref 独立 canonical API profile，模型 identity 不变

删除当前 `h3-dual-stage-2mp.json`，新增语义清晰的
`h3-reference-t8-dual-stage-2mp.json`，并让 Ref runtime profile 唯一引用新图。`first_frame` 和
`continuation` profile 仍引用现有 frame graph。产品能力仍是同一个 MiniMax H3 模型，因此保留
`comfyui::minimax-h3-dual-stage-2mp`；新增第二个模型会制造用户不需要的模型选择与 capability 分裂。

新的 Ref profile 使用独立、明确的节点 ID 声明。最终输出节点继续使用当前所有 H3 profile 共同声明的
`168`，以保持 poll 只有一个显式输出契约；这不是旧任务兼容，而是同一 provider 的现行结果协议。

### 4.3 采用：参考媒体先物化，再由 `LoadImage` / `LoadAudio` 读取

附件在目标服务器已用本地 `LoadImage` 验证。新链路沿用这一真实边界：Planner 冻结 Resource version，
Worker 通过 owner-aware 出站模块有界读取字节，再上传到 H3 runtime 的 prompt 专属目录，canonical graph
通过 `LoadImage` / `LoadAudio` 使用返回的受验证文件身份。

图片读取能力补充到现有 `outbound-image` 模块并由它调用共享 owned-media 实现；H3 adapter 不直接绕过
图片权威入口。音频继续复用现有 owner-aware 音频读取链路。上传只是 Provider 输入传输，不创建第二个
Resource、Task 或业务 identity。

### 4.4 拒绝：只把全局 H3 时长改成 5–15 秒

这会错误放宽另外三个模式，并让 Agent 生成 Provider 实际不支持的时长组合；也会迫使调用方根据模式名
增加散落分支。

### 4.5 拒绝：在 `h3.ts` 中私有判断 Ref 时长与比例

Provider-only 分支会使 Agent 上下文、Planner 和 adapter 各自拥有不同事实，错误只能在 Task 已创建后
发现。它违反 capability 是可执行组合唯一权威的既有契约。

### 4.6 拒绝：运行时读取并转换附件 UI JSON

UI JSON 含展示节点、断开的可选节点、机器路径和非执行元数据；运行时转换会增加第二种图协议和不稳定
解释器。附件只在实施阶段离线转换一次，仓库只保存可直接提交的 API graph。

### 4.7 拒绝：附件原始 H.265 10-bit 输出

H.265 + `yuv420p10le` + CRF 22 通常具有更好的压缩率与渐变保真，但 Web 播放、浏览器解码、系统预览和
后续合并链的兼容性更差；现有合并链还可能将它再次转码为 H.264，增加时间和代际损失。

H.264 + `yuv420p` + CRF 10 的代价是文件更大、只有 8-bit 色深、同体积压缩效率低于 H.265；收益是与
当前 `<video>` 播放和合并链一致，通常无需再次转码。对 5–15 秒、约 2MP 的短视频，预计仍远低于统一
512MB 上限。真实验收必须记录成片大小；超限时明确失败，不能静默提高上限或降质。

## 5. 帧数与两阶段 MP 权威表

Ref 帧数由应用层唯一函数计算：

```text
rawFrames = round(requestedDurationSeconds × 24)
frameCount = rawFrames + ((5 - rawFrames % 17 + 17) % 17)
```

建立关闭世界的 Ref runtime plan 表。每一项同时声明请求时长、预期帧数、一采 MP、二采 MP；模块加载或
conformance 验证时重新计算帧数，表与公式不一致即失败。MP 不用插值、秒数区间 fallback 或经验公式推断。
这组 MP 是 RTX 5070 Ti 16GB 上经过验证的运行边界，不是 UI 推荐值：无论请求哪种合法比例，都必须按
时长取同一档总像素面积，尤其不得让 11–15 秒继续使用 0.70/1.00 MP。

| 请求时长 | 有效帧数 | 预计成片时长 | 一采 MP | 二采 MP | 最终 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5 秒 | 124 | 5.167 秒 | 0.70 | 1.00 | 2.00 MP |
| 6 秒 | 158 | 6.583 秒 | 0.70 | 1.00 | 2.00 MP |
| 7 秒 | 175 | 7.292 秒 | 0.70 | 1.00 | 2.00 MP |
| 8 秒 | 192 | 8.000 秒 | 0.70 | 1.00 | 2.00 MP |
| 9 秒 | 226 | 9.417 秒 | 0.70 | 1.00 | 2.00 MP |
| 10 秒 | 243 | 10.125 秒 | 0.70 | 1.00 | 2.00 MP |
| 11 秒 | 277 | 11.542 秒 | 0.61 | 0.88 | 2.00 MP |
| 12 秒 | 294 | 12.250 秒 | 0.58 | 0.83 | 2.00 MP |
| 13 秒 | 328 | 13.667 秒 | 0.52 | 0.75 | 2.00 MP |
| 14 秒 | 345 | 14.375 秒 | 0.49 | 0.71 | 2.00 MP |
| 15 秒 | 362 | 15.083 秒 | 0.47 | 0.67 | 2.00 MP |

`resolveH3DurationPlan` 改为必须接收 `inputMode`，并从该模式 policy 验证请求时长；不保留旧签名重载。
continuation 仍在基础请求帧之上加入现有 22 个 guide frames，其他模式为 0。Ref runtime plan 再把本表
的一采/二采 MP 写入图。由此帧网格只有一个算法、模式范围只有一个 policy、Ref MP 只有一个关闭表。

生成后的实际媒体时长继续由现有媒体探测写入结果事实；预计时长只用于 Prompt 时间轴，不覆盖实测值，
也不在正常 Ref 路径做裁切。

## 6. Canonical graph 设计

### 6.1 保留的附件执行链

- 视频 VAE、音频 VAE、CLIP、混合 UNET 和 Turbo LoRA loader。
- SageAttention、PyTorch attention backend 与 SolAttnMiniMax 参数。
- 一采与二采各自的 LoRA 链及附件中固定的权重和顺序。
- 两个 `MiniMaxH3AudioConditioningT8`，均使用 `Ref2VA`、原生音频和一致的 Prompt、帧数、参考图、
  参考音频顺序。
- `DualClockSigmas`、`ParityFEC_Schedule` 的 4+5 调度、noise、guiders、第一阶段 sampler。
- learned latent upscale、latent reconcile、detail mixer 和第二阶段 sampler。
- AV decode、应用注入的固定 2MP 最终尺寸、NVIDIA RTX VSR。
- 唯一 `VHS_VideoCombine`，24fps，并连接 H3 原生音轨。

所有固定采样器、scheduler、attention、LoRA、denoise、VAE 和 RTX VSR 值按服务器已验证附件逐项冻结；
它们不成为用户 option。

### 6.2 删除或改写的附件内容

- 删除 UI group、position、size、color、widget 状态和 workflow preview 元数据。
- 删除 COS URL、bucket、绝对路径和任何用户/机器专属字段。
- 删除不在最终输出祖先链上的 9 个断开节点。
- 删除附件中的时长输入和数学表达式节点；应用把唯一 `frameCount` 同时写入两级 conditioning。
- 只保留最多 8 个参考图 loader，不把附件第 9 个备用图片节点解释成新 capability。
- Prompt 只保留一个节点/输入源，两级 conditioning 引用同一冻结 Prompt。
- 删除附件中两个只承担 UI 尺寸计算的 `ResolutionSelector`。[ComfyUI 核心节点实现](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_resolution.py)
  不提供 `9:21` 枚举，不能用它缩窄现有 H3 capability；graph builder 使用与该节点相同的“比例 + 总 MP
  + 32 对齐”公式，把一采和最终阶段的宽高整数直接写入消费节点。
- 将最终编码从 H.265 10-bit CRF 22 改为 H.264、yuv420p、CRF 10。
- 将最终输出节点规范为 profile 声明的 `168`；删除备用输出和中间预览输出。

### 6.3 动态注入边界

每次 Ref 请求只允许注入：

- 已冻结并通过既有结构验证的最终 Prompt；
- 5–15 秒中一个合法请求值对应的 `frameCount`；
- 当前 H3 七种合法比例中的一个请求值；
- 对应关闭表的一采 MP 和二采 MP；
- 1–8 个按冻结顺序上传后的参考图片文件身份；
- 0–3 个按冻结顺序上传后的参考音频文件身份；
- 从逻辑 invocation identity 派生的稳定安全整数 seed。

graph builder 从产品比例和时长档的一采 MP 计算一采宽高，直接写入第一级 conditioning；learned latent
upscaler 使用同档二采 MP 并保持来源比例；最终宽高从同一产品比例和固定 2MP 计算，直接写入 RTX VSR
resize。宽高计算严格复制 ComfyUI `ResolutionSelector` 的面积公式并按 32 对齐，但不依赖其不完整枚举。
graph builder 删除未使用的动态 `ref_images.ref_image_N` / `ref_audios.ref_audio_N` 输入，并把实际 loader
同序连接到两级 conditioning；不以空字符串、重复第一张图或静默截断填满端口。

## 7. 参考媒体所有权与传输

1. `create_video` Planner 使用现有 WorkspaceResource resolver 校验 `userId + projectId + resourceId +
   contentVersion`，冻结角色、版本和相对顺序。
2. 图片必须经 `outbound-image` 的 owner-aware 能力解析；在该模块补充本地 Provider 所需的有界字节结果，
   底层继续复用现有 owned-media 读取，不新增 URL/存储 key 旁路。
3. 音频继续经现有 outbound audio/owned-media 路径校验 owner、MIME、大小与冻结版本。
4. H3 uploader 将媒体写入 prompt 专属输入目录：

```text
waoowaoo/<promptId>/reference-image-00.<ext>
...
waoowaoo/<promptId>/reference-image-07.<ext>
waoowaoo/<promptId>/reference-audio-00.<ext>
...
waoowaoo/<promptId>/reference-audio-02.<ext>
```

5. 上传响应必须与预期 filename、subfolder 和 `input` 类型一致；任何不一致为 pre-accept 协议失败。
6. 媒体上传成功不代表视频任务成功，也不创建持久业务事实。`/prompt` 接受前失败时，现有 Task 终态 owner
   记录失败；不自动删除 ComfyUI 输入目录，也不重提。

允许的图片 MIME/扩展名和音频 MIME/扩展名由现有媒体契约穷尽映射；未知类型原地失败，不凭 URL 后缀猜测。

## 8. Preflight 与运行时要求

H3 Ref preflight 在任何媒体上传和 `/prompt` 前获取目标 runtime `/object_info`，并验证：

- canonical graph 使用的每个 `class_type` 均已注册；
- 两个 `MiniMaxH3AudioConditioningT8` 的固定端口、`ref_images.ref_image_N` 和
  `ref_audios.ref_audio_N` 自增长端口存在，且至少覆盖 8 图 / 3 音频；
- 视频 VAE、音频 VAE、CLIP、UNET、所有 LoRA 和 learned latent upscale 模型精确存在；
- 固定 sampler/scheduler/attention/backend/detail mixer 选项被当前节点接受；
- RTX VSR 节点和 `nvidia_rtx_vsr` 选项存在；
- learned latent upscaler 接受 `target_megapixels` 和保持来源比例的固定策略；
- 两级 conditioning 与最终 RTX VSR resize 接受 graph builder 写入的宽高整数；
- `VHS_VideoCombine` 支持 H.264、yuv420p、CRF 与音轨输入；
- 两级 conditioning 的图连线、同一 Prompt、同一帧数与参考顺序满足 profile contract；
- 最终输出节点唯一且为 `168`。

profile requirements 需要扩展目前未被检查的模型选择字段，包括 LoRA loader 与 learned latent upscale
model。缺能力时返回带稳定错误码的 pre-accept failure；禁止跳过节点、替换模型、换 attention 或回退旧图。

## 9. 权威入口与端到端数据流

```text
视频 capability registry / input-mode policy
  -> ProjectProductionContext 投影当前比例可执行模式与逐模式 duration plans
  -> video-direction 选择 Ref、时长与现有 H3 Prompt profile
  -> create_video Planner 校验模式/比例/时长/参考数量并冻结 Resource versions
  -> provider invocation fence 取得唯一提交权
  -> outbound-image / outbound-audio 有界读取已授权媒体
  -> H3 target preflight
  -> H3 input uploader 写入 prompt 专属文件
  -> Ref T8 graph builder 注入帧数、两级 MP、Prompt、seed 和有序媒体
  -> H3 runtime /prompt 接受一个 prompt id
  -> 现有 external id 持久化并用于 poll/cancel/recovery
  -> 只读取 output node 168 的 H.264 MP4
  -> 现有 Task terminal owner 与 WorkspaceResource materializer 写入最终事实
  -> UI 只消费最终 Resource/Task View
```

调试入口仅允许读取冻结请求、profile id、节点/模型 preflight 结果、external id、Provider 原始失败与最终
媒体探测结果；ComfyUI 页面、画布标题、历史消息、文件名和队列位置都不是业务状态权威。

## 10. 状态、实体与 writer 所有权

| 事实 | 唯一 owner / writer | 消费者 / projector |
| --- | --- | --- |
| H3 模型 identity | builtin model registry | 配置、catalog、adapter selection |
| 每种输入模式的时长 | video `inputModePolicies` + shared resolver | context、Planner、adapter |
| H3 合法比例 | video `aspectRatioOptions` + shared resolver | context、Planner、graph builder |
| Ref 帧数与两级 MP | H3 duration/runtime plan module | context、Ref graph builder |
| Prompt 最终文本 | 主 Agent 经现有 `video-direction` profile | Planner validator、graph builder |
| 参考媒体 identity、version、role、顺序 | create_video 冻结 payload | Worker、graph builder |
| 图片/音频 owner 与可读字节 | WorkspaceResource + outbound media | H3 uploader |
| ComfyUI 临时文件 identity | H3 input uploader | Ref graph loader nodes |
| canonical graph 与可变节点 | H3 Ref runtime profile | H3 adapter |
| Provider 接受身份 | invocation fence + external id | retry、poll、cancel、recovery |
| Provider 运行事实 | H3 runtime job API | async provider registration |
| 视频业务终态 | Task terminal service | Resource materializer、UI |
| 最终媒体元数据/实测时长 | 现有 MediaObject 写入入口 | UI、后续生产链 |

入口与竞争解释源计数：

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| `create_video` 公开执行入口 | 1 | 1 |
| H3 video provider adapter | 1 | 1 |
| H3 Ref runtime graph | 1 | 1（旧图删除后换新图） |
| H3 模式时长真相 | 1 个全局表 + continuation 私有计算 | 1 个模式 policy + 1 个共享 resolver |
| Ref 帧数真相 | 应用函数 + 附件图内数学节点 | 1 个应用函数 |
| Ref MP 真相 | 当前固定值 / 附件 UI 控件 | 1 个关闭 runtime plan 表 |
| 视频 Task / Resource writer | 各 1 | 各 1 |
| Provider submission | 1 | 1 |
| 自动 fallback | 0 | 0 |
| 旧任务兼容分支 | 0 | 0 |

## 11. 生命周期与失败矩阵

| 场景 | 权威行为 |
| --- | --- |
| 正常 | 策略校验、冻结输入、fence、preflight、上传、一次 `/prompt`，最终只物化节点 168 的 MP4 |
| 七种现有比例中的 Ref | 保留请求比例，并由同一公式计算一采与最终宽高；MP 仍按时长档取值 |
| 不支持的比例 | Planner 在 Task/Resource/上传前拒绝，不改成近似比例，不换输入模式 |
| Ref 时长不在 5–15 | Planner 在副作用前拒绝，不截断、不就近选择 |
| 其他模式 12–15 秒 | 仍按其现有 4–11 policy 拒绝，Ref 扩容不得泄漏 |
| 缺图或引用超限 | 按现有 reference capability 在副作用前拒绝，不丢弃多余输入 |
| 音频无视觉引用 | 按现有 `referenceAudioRequiresVisual` 拒绝 |
| owner/version/MIME/大小失败 | outbound media 原地失败，不上传、不提交 |
| runtime 缺节点/模型/端口/选项 | preflight 明确失败，不降级或回退 |
| 上传部分成功 | 不是产品成功；停止 `/prompt`，Task 由现有终态 owner 失败，已上传临时文件不成为业务事实 |
| `/prompt` 明确拒绝 | 保留原始响应并记录 rejected，不用旧图重提 |
| `/prompt` 断连/超时 | 复用预生成 prompt id 执行现有接受探测；不能证明未接受时为 outcome unknown，不二次 POST |
| 排队/生成 | 继续使用同一 external id 和现有队列/生成预算 |
| Provider 失败 | 完整 FailureRecord 进入唯一 Task terminal owner，不返回一采或二采中间产物 |
| 最终输出缺失/格式错误/超限 | 明确失败，不猜其他输出节点、不持久化伪成功 |
| 用户取消 | Wao 本地终态优先，补偿 Activity 按同一 external id 幂等取消 Provider job |
| 取消晚到 | 已完成、已失败或 404 按现有 cancel contract 处理，不反写本地终态 |
| poll 网络失败 | 恢复时继续查询同一 external id，不伪造 Provider 最终失败 |
| retry | 冻结输入、Prompt、mode policy 结果、seed 和 prompt id 遵守现有 invocation fence，不新建并行作业 |
| 重复/并发 | 由现有 request identity 与 invocation fence 拒绝重复 writer，不依赖队列位置或事件顺序 |
| 刷新/断线 | UI 从持久 Task/Resource View 恢复，不从 ComfyUI 页面或 timer 推断 |
| 晚到/replay | 现有任务终态与版本规则拒绝旧覆盖；Provider 状态不是第二份业务终态 |
| 第一阶段成功、第二阶段失败 | 整体失败；中间 latent、视频或音频不构成产品部分成功 |
| 旧 Ref 任务 | 切换前必须为 0；新代码不解析、恢复或回退到旧 Ref graph |

## 12. 事务、幂等、崩溃与补偿

- create-video 的前置 capability、引用、媒体时长和 owner 校验必须在创建持久 Resource/Task 前完成。
- 现有 provider invocation fence 继续拥有“本 attempt 是否可发出唯一 `/prompt`”的裁决权。
- `promptId` 在上传前生成，同时作为临时目录 identity、Provider 请求 identity 和 external id 的核心部分。
- seed 从同一逻辑 invocation 稳定派生，poll/recovery 不重新生成。
- 上传完成但 `/prompt` 未受理：没有 Provider job；Task 记录明确失败，临时上传不作业务补偿写入。
- `/prompt` 接受后 Wao 崩溃：恢复从持久 external id 查询同一 job，不重新上传并提交第二个 graph。
- Provider 完成后、Wao 下载前崩溃：恢复轮询同一 job 并再次读取唯一最终输出。
- 最终媒体写入失败：由现有 Resource materialization/retry owner 处理；不把 Provider 成功直接解释成 Wao
  Resource 成功。
- 取消和超时补偿只针对同一 external id；不扫描 ComfyUI 队列、不按文件名猜 job。
- 本次不执行数据 migration、回填、删除或清理，因此没有数据库结构事务。

## 13. 切换与删除项

部署前只读枚举模型为 `comfyui::minimax-h3-dual-stage-2mp`、输入模式为 `reference` 的非终态视频
Task/invocation。准入条件为集合为空。非空时维持旧 Worker 排空并停止本次切换；不部署双轨、不自动取消、
不修改数据。

一次切换中删除：

- 当前 Ref canonical graph `h3-dual-stage-2mp.json`；
- 当前 Ref profile 的旧节点 ID、旧 resize 节点和旧固定质量参数；
- H3 顶层全局 `durationOptions` 解释；
- `resolveH3DurationPlan(number)` 旧签名及调用方的模式外推断；
- 任何把 Ref 当作 4–11 秒能力的 schema/validator 分支；
- 新图构建后发现的旧 Ref URL-loader、resize 或动态输入旁路。

保留：

- 同一 H3 model key、runtime target 和 external-id 协议；
- `create_video`、Provider adapter、Task/Resource 终态和持久化入口；
- 当前最多 8 图 / 3 音频、冻结版本和 Prompt contract；
- frame、first/last-frame、continuation profiles 与工作流；
- 现有完成历史数据和媒体读取能力。

切换完成后旧 Ref graph 与新 Ref graph 不能同时存在于生产 registry，残余双轨为 0。

## 14. 最接近参照物与触点对齐

内部参照物选择当前 `h3-reference-dual-stage-2mp` 调用链，因为它拥有同一公开 Operation、参考媒体冻结、
Provider fence、H3 runtime、external id、poll/cancel 和最终 Resource 交接。图内参数参照物选择用户已在同一
服务器验证的附件 T8 workflow。两者分别提供产品生命周期与模型执行事实，不能互相替代。

| 参照物触点 | 新实现覆盖 / 不适用原因 | 验证 |
| --- | --- | --- |
| 模型 identity | 保留现有 model key；只是同一 Ref 实现硬切换 | production catalog 解析 |
| capability | 新增穷尽 per-mode 时长 policy 与模型级比例集合；Ref 5–15、全部现有比例，其他模式时长不变 | registry conformance + context 投影 |
| Prompt | 继续使用 `minimax_h3_multimodal_v3`，两级 conditioning 同源 | graph contract + Prompt validator |
| 图片 identity/顺序 | 冻结 Resource version，owner-aware 读取，0..7 同序上传/连线 | Planner + graph conformance |
| 音频 identity/顺序 | 继续现有冻结和时长限制，0..2 同序上传/连线 | Planner + graph conformance |
| 执行入口 | 复用唯一 ComfyUI video adapter 和一次 `/prompt` | invocation 观察 |
| 图效果参数 | 按附件保留 T8 模型链、LoRA、attention、4+5、upscale、VSR | canonical graph 对照清单 + `/object_info` |
| 时长 | 应用唯一对齐公式，删除图内计算 | 数学 oracle 逐表验证 |
| 比例传递 | 产品比例计算一采与最终宽高，二采保持来源比例；不依赖缺少 9:21 的 UI selector | 七种比例 graph 构建验证 |
| 两级 MP | 每种比例都按关闭表精确写入一采/二采 | 11 个档位 graph 构建验证 |
| 输出 | 节点 168 唯一 H.264/yuv420p/CRF10 MP4 + 原生音轨 | graph contract + ffprobe |
| 生命周期 | 保留现有 queued/running/terminal owner | async protocol 检查 |
| 失败 | preflight、上传、拒绝、missing output 均显式失败 | 错误路径检查 |
| 恢复 | 复用同一 external id，不引入 graph-version parser | poll/recovery 检查 |
| 持久化 | 最终仍只写现有 video Resource | Task/Resource View |
| 权限 | 继续 project owner + frozen version；本地 ComfyUI 不承担用户鉴权 | owner mismatch 验证 |
| 投影 | 当前项目比例来自 capability，UI/Agent 不自行推断或固定 16:9 | context snapshot inspection |
| i18n | 新用户可见错误只通过稳定 code 和消息键投影 | locale/typecheck |
| 首帧模式 | 不适用变更；现有 profile 原样保留 | targeted regression |
| 首尾帧模式 | 不适用变更；现有 profile 原样保留 | targeted regression |
| 续写模式 | 不适用变更；现有 22 帧来源视频引导链原样保留 | targeted regression |

## 15. 历史回归矩阵

| 历史症状 | 根因 | 当时修复 | 本次可能复发形式 | 本次防线 / 上一版不足 |
| --- | --- | --- | --- | --- |
| H3 capability 只有一个全局时长表 | 当时所有模式共用范围，未出现 Ref 独立上限 | 建立 4–11 秒统一 H3 表 | 直接改成 5–15 导致其他模式误放开 | 用 per-mode policy 替换全局表；上一版无法表达模式差异 |
| continuation 时间轴需要额外 guide frames | 续写输出包含 22 个来源引导帧 | 单独 continuation duration 函数 | 重构时长后丢失 guide 或把它加到 Ref | resolver 显式接收 mode；只有 continuation policy 加 guide |
| H3 Ref 从单图扩到 8 图 | 旧冻结图只接了一个参考端口 | 动态图片节点和有序连接 | 新附件只带一个 active 图而退回单图 | capability 上限不变，新图构建覆盖 1/8 边界；附件备用第 9 图不扩大能力 |
| H3 Ref 新增最多 3 段音频 | 只扩 capability 会让真实图漏接音频 | uploader + LoadAudio + ordered autogrow | 新图只给一级 conditioning 接音频或静默忽略 | 两级 conditioning 同序连线并 preflight 3 个端口 |
| H3 多模态 Prompt 必须由主 Agent 唯一写入 | 工作流内 Prompt 改写会产生第二 writer | 固定 `minimax_h3_multimodal_v3` | 保留 UI prompt/math helper 重新解释内容 | 只注入一个冻结 Prompt，图不生成或改写文案 |
| H3 输出统一为 H.264 | 播放/合并链以 H.264 为共同边界 | 当前图使用 H.264 CRF10 | 照抄附件 H.265 触发浏览器问题或二次转码 | canonical graph 固定 H.264/yuv420p/CRF10，真实 ffprobe |
| 模型能力需在 Provider 接受前证明 | 节点存在不代表模型/选项存在 | profile requirements + `/object_info` | 新 LoRA/upscaler 字段未进入 preflight | 扩展 requirements 到新图所有模型选择与关键固定选项 |
| 附件以 16:9 完成服务器验证 | 测试实例的 selector 默认值被误读为产品限制 | 不适用，本次评审中纠正 | Ref 被错误缩窄为只支持 16:9 | capability 保留七种比例；应用直接计算并注入宽高 |
| 15 秒需要降低两阶段面积 | 显存负载由有效帧数与采样面积共同决定 | 用户提供实测安全 MP 表 | 只放宽时长而仍使用 0.70/1.00 MP，导致 16GB 显存失败 | 关闭表把时长、帧数和两级 MP 作为不可拆分的 runtime plan |

本次属于“同一模型的一个输入模式执行图和时长/负载约束同时改变”。上一版全局 duration capability
只能描述所有模式共有事实，无法承载 Ref-only 5–15 秒；因此不能继续在旧全局字段上叠加例外。比例仍是
H3 各模式共享事实，但必须从隐藏的 adapter 常量提升为显式 capability，并由新图 builder 计算和注入尺寸。

## 16. 文件与模块映射

实施计划应以实际检索结果为准，预计触点如下：

| 模块 / 不变量 | 预计文件 | 同阶段原因 |
| --- | --- | --- |
| Provider Gateway：PG-15/20/21 capability 与完整 preflight | `src/lib/ai-registry/types.ts`、共享 video policy resolver、`src/lib/ai-providers/comfyui/models.ts` | 建立唯一 per-mode 可执行组合 |
| Creative Skills / Project context | `src/lib/project-production-context.ts`、必要时 video-direction 说明 | 让 Agent 只看到项目比例下真实可执行模式与逐模式时长 |
| Workspace Resource：WR-17 副作用前校验 | `src/lib/operations/generation-ops.ts` 及共享输入模式校验 | 在 Task/Resource 创建前拒绝非法组合 |
| Provider Gateway：H3 graph/runtime | `src/lib/ai-providers/comfyui/profiles.ts`、`h3.ts`、`adapter.ts`、`profile-requirements.ts`、新 Ref workflow JSON | 注入唯一 Ref plan 并完整证明运行时能力 |
| Workspace Resource：出站图片唯一入口 | `src/lib/media/outbound-image.ts`、H3 input uploader | 合法物化并上传参考图片，不旁路 owner/version |
| H3 时间线纯逻辑 | `src/lib/video-generation/h3-duration.ts`、`h3-timeline.ts` 的现有常量消费者 | 统一 mode-aware 帧计划，保持 continuation guide |
| 测试治理 | 现有 registry/数学/graph conformance 测试 | 只保留具有独立 oracle 的组合、公式和图契约证据 |

`architecture:impact` 已将核心 Provider 文件映射到 Provider Gateway，将生成 Handler/Operation 映射到
Async Task Lifecycle、Free Product 与 Workspace Resource。此次不新增/删除架构不变量，也不改变
`create_video`、Provider adapter、Task terminal service 或 WorkspaceResource materializer 的权威归属，
所以不修改 `docs/architecture/**`。具体秒数、MP、节点和文件名属于实现事实，也不复制进架构文档。

## 17. 验证设计

### 17.1 独立 oracle 与静态验证

- capability registry conformance：每个 supported input mode 恰有一个 duration policy，无缺项/额外项/
  重复值；H3 Ref 支持 5–15，其他三个模式保持当前 4–11；模型比例精确为现有七种。
- 数学 oracle：按独立 `17n+5` 公式验证 5–15 秒全部 11 个有效帧数和预计时长；继续验证 continuation
  22 guide-frame 行为。
- 关闭表 conformance：每个 Ref duration 唯一映射到用户确认的一采/二采 MP，非法时长无 fallback。
- graph conformance：从 production profile 构建 1/8 图与 0/1/3 音频，检查两级 conditioning 的节点数、
  顺序、Prompt、帧数、比例、MP、seed、唯一输出和 H.264 参数；9 图、4 音频在 Planner 被拒绝。
- 比例 conformance：七种产品比例逐一验证一采和最终尺寸的面积公式、方向与 32 对齐，二采保持来源比例；
  任一未声明比例在 Planner 被拒绝，不构造 graph。
- ProjectProductionContext：七种项目比例均投影 Ref 5–15 和其他模式 4–11。
- Planner 副作用边界：Ref 非法比例、4 秒、16 秒、缺图、音频无图均在 Resource/Task 创建前失败。
- profile preflight：对 production graph 枚举全部 class/model/关键 option；缺一项即明确失败。
- 运行受影响文件 ESLint、TypeScript typecheck、capability catalog、model config、media normalization 等现有
  检查；不新增只断言 mock 调用次数或复述源码字符串的测试。
- 全仓检索旧 Ref workflow import、旧节点 ID 和 H3 顶层 `durationOptions`，生产执行路径应为零。

### 17.2 真实 H3 验收

在用户已验证的 H3 runtime 上，从产品真实路径至少执行：

1. 5 秒、`9:16`、1 张图、0 音频，确认非 16:9 比例真实生效；
2. 10 秒、`21:9`、至少 2 张有序图片、1 段音频；
3. 15 秒、`16:9`、8 张图片、3 段音频（若参考材料具备），验证用户已有的显存安全基线；
4. 条件允许时再执行一个 15 秒非 16:9 样片，验证极端比例经 32 对齐后的显存边界；
5. 一个现有 `first_frame` 或 `continuation` 小样，确认非 Ref 图未受影响。

每个 Ref 样片确认只有一个 `/prompt`、图内帧数和两级 MP 与表一致、节点 168 产生 MP4、Task 从同一
external id 完成。使用 `ffprobe` 验证视频为 H.264、`yuv420p`、24fps，分辨率符合请求比例且面积约
2MP（16:9 约 1920×1088），并且存在音轨；记录实际时长和字节数。人物一致性、动作质量、音色迁移、
口型和 4+5 双采效果需人工观察，静态检查不能证明。

### 17.3 明确盲区

- 没有在目标 RTX 5070 Ti runtime 完成真实 15 秒多参考生成前，只能声称实现完成，不能声称性能或效果
  验收完成；用户提供的 MP 表已证明 16:9 基线，其他比例的同面积推导仍需至少一个极端比例样片确认。
- H.264 CRF10 的最大实际文件大小、峰值显存和生成耗时只能由真实样片测得。
- ComfyUI 自定义节点升级可能改变端口/选项；preflight 能阻止错误提交，但不能替代升级后的效果复验。
- 本次不验证非 Ref 模式的画质变化，因为其 graph 不改；仅做最小回归证明调用链仍可执行。

## 18. 完成定义

实现完成需要同时满足：

- 生产 registry 只有一个穷尽 per-mode duration policy 和一个模型级比例集合；Ref 与其他模式没有散落
  时长/比例判断。
- 当前 Ref graph 已删除，新 T8 canonical graph 是唯一 Ref profile，旧任务兼容和 fallback 为 0。
- 1–8 图、0–3 音频经过冻结、owner-aware 物化和有序双级 conditioning 连线。
- Ref 5–15 秒的帧数和两级 MP 精确来自唯一关闭表，并适用于全部合法比例；工作流内没有第二时长解释器。
- 最终输出固定 H.264/yuv420p/CRF10/24fps/2MP 并保留原生音轨。
- 非 Ref 三种模式的 capability 和 workflow 保持现状。
- 所有修改文件可映射到现有模块和不变量；没有无关文件进入提交。
- 实际执行的验证命令、结果、未执行的真实 runtime 场景和盲区如实交付。

只有真实 5/10/15 秒边界样片、至少两个非 16:9 比例、至少一个多参考音频组合以及一个非 Ref 回归均
通过，才能称本次 Ref 工作流替换达到本地效果验收；在此之前最多称“实现完成”或“阶段完成”。
