# MiniMax H3 双模型二采 2MP 工作流替换设计

日期：2026-08-16
状态：三个设计章节已获用户确认，待正式文档最终确认

## 背景

Waoowaoo 当前通过 `comfyui::minimax-h3-fast` 接入两份 MiniMax H3 API 工作流，分别支持
`first_frame` 和 `first_last_frame`。它们共享一个全局 `COMFYUI_BASE_URL`，提供 480p/720p
选择，并把主 Agent 已完成的 Prompt 原样提交给 `MiniMaxH3ImageToVideo`。

本次要用以下 ComfyUI UI-canvas 工作流完整替换当前 H3：

```text
D:\workspace\comfui\workflows\双模型加强版minimax+h3二采重绘v2版！超级加强！清晰度天花板！.json
```

目标工作流不是旧 H3 的首帧/首尾帧变体，而是一张普通参考图驱动的
`MiniMaxH3ReferenceToVideo` 工作流。它先用 Ref2VA 模型生成带原生音轨的视频，再把视频放大到
1MP、用第二套模型低降噪重绘，最后通过 NVIDIA RTX VSR 放大到 2MP。原工作流还包含一个
`RH_CODEX_NODE`，会调用本机 Codex 重写 Prompt。

用户确认该工作流只运行在 `http://127.0.0.1:8188/`，必须与其他 ComfyUI 音乐、环境音、TTS、
配音运行时隔离。历史 H3 数据无需兼容，可以失效；本设计不要求也不自动执行数据库清理。

## 已验证事实

### 工作流图

目标 JSON 是 ComfyUI UI-canvas 图，不是可直接提交到 `/prompt` 的 API 图。其核心节点和参数为：

- 第一模型：`h3\minimax_h3_ref2va_int8_convrot.safetensors`。
- 第二模型：`minimax_h3_fl2va_pruned_w4a8_mixed.safetensors`。
- CLIP：`h3\qwen3vl_32b_minimax_h3_int8_convrot.safetensors`。
- 视频 VAE：`h3\minimax_h3_video_vae_int8_convrot.safetensors`。
- 音频 VAE：`h3\minimax_h3_audio_vae_fp32.safetensors`。
- LoRA：`h3\minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`。
- 第一阶段：10 steps、Euler、beta scheduler。
- 二采：3 steps、`res_multistep`、beta scheduler、`denoise=0.2`。
- 一张参考图先按最短边 1072 预处理，再进入 `MiniMaxH3ReferenceToVideo`。
- 二采输入使用 `ImageResizeKJv2 + nvidia_rtx_vsr` 固定到 1MP。
- 二采解码后再次使用 `ImageResizeKJv2 + nvidia_rtx_vsr` 固定到 2MP。
- 最终输出为 24fps、H.264 MP4、CRF 10、YUV420P，并使用第一阶段解码的原生音频。
- 两个 `easy clearCacheAll` 是 16GB 显存环境下的核心生命周期节点，必须保留。
- 时长使用 24fps 并对齐到 H3 要求的 `17n+5` 帧网格，原图支持 4–15 秒输入。

### 8188 实时运行环境

设计调查时 `127.0.0.1:8188` 实际运行：

- ComfyUI 0.33.1、Python 3.12.10、PyTorch 2.10.0+cu130。
- NVIDIA RTX 5070 Ti 16GB。
- 启动入口属于 `D:\workspace\AI-T8-video-onekey\ComfyUI`。
- `/object_info` 已注册目标工作流要求的节点，包括 `MiniMaxH3ReferenceToVideo`、
  `ImageResizeKJv2`、`ModelAttentionBackend`、`VHS_VideoCombine`、两个采样器所需节点和
  `easy clearCacheAll`。
- 实时模型选项包含上述两套 UNET、CLIP、VAE 和 LoRA。
- `ImageResizeKJv2` 的实时选项包含 `nvidia_rtx_vsr`。
- `/api/jobs/:promptId` 协议存在，队列在调查时为空。

上述事实证明运行时具备静态接入条件，但不能替代真实双阶段 2MP 生成验收。

## 产品决策

1. 新模型 identity 为 `comfyui::minimax-h3-dual-stage-2mp`，旧
   `comfyui::minimax-h3-fast` 完整删除。
2. 输入模式只保留一张普通 `reference_image`；删除首帧和首尾帧模式。
3. 支持 4–15 秒整数时长和现有七种宽高比。
4. 不暴露 480p/720p 或质量档位；固定执行“1MP 二采输入 + 2MP RTX VSR 最终输出”。
5. 原生音频固定开启；对白、动作声、环境声和非语言人声由 H3 生成。
6. 背景配乐继续由独立音乐生产链唯一负责。H3 Prompt 必须明确禁止背景配乐。
7. `RH_CODEX_NODE` 从 ComfyUI 图删除。Wao 主 Agent 是最终 Prompt 的唯一 writer。
8. 两个模型阶段、两次放大和最终封装作为一个 ComfyUI 任务提交，不拆成两个 Wao Task。
9. H3 只使用 `http://127.0.0.1:8188` 对应的专属运行目标，不回退到共享地址。
10. 旧 external id、旧保存任务和旧 H3 capability 不做兼容。

## 目标

- 用一份经过裁剪的 canonical API profile 完整承载目标工作流的双阶段生成链。
- 保留二采、1MP/2MP RTX VSR、显存清理和第一阶段原生音频这些核心效果。
- 让主 Agent 基于参考图和导演上下文直接输出最终六段式 H3 Prompt。
- 让模型 capability、运行目标、提交、轮询、取消和输出解释都有唯一权威入口。
- 在副作用前验证 8188 的连接、节点、模型和 RTX VSR 能力。
- 删除旧 H3 的输入模式、分辨率选择、工作流和兼容分支。

## 非目标与禁止范围

- 不支持无参考图文生视频、首帧、尾帧或首尾帧视频。
- 不支持多张参考图、参考音频或参考视频。
- 不把 ComfyUI 内部图片节点注册为用户可选择的图片 Provider。
- 不让 adapter、route 或 ComfyUI 节点二次创作、扩写或修补 Prompt。
- 不把背景音乐合并进 H3 原生音轨。
- 不把两阶段拆成两个持久 Task、两个 external id 或两个可独立重试的产品步骤。
- 不在 8188 失败时自动使用共享 ComfyUI、旧 H3 或其他模型。
- 不自动删除数据库记录、媒体文件或现有 ComfyUI 输出。
- 不借本次替换清理其他旧 Provider 或音频工作流。

## 方案比较

### 采用：专属运行目标 + 单一双阶段 API profile

建立 ComfyUI 运行目标 registry。H3 模型声明固定目标 `h3-dual-stage-2mp`，其地址只来自
`COMFYUI_H3_DUAL_STAGE_BASE_URL`。提交一份包含全部核心阶段的 API graph，并把目标 identity 写入
external id。

该方案保留一个产品 Task、一个 provider submission fence、一个 ComfyUI prompt id 和一个最终结果，
同时保证提交、轮询、取消、下载都回到同一类运行环境。

### 拒绝：把全局 `COMFYUI_BASE_URL` 改成 8188

这会让音乐、环境音、TTS 和配音隐式切换到 H3 环境，运行环境所有权不明确；一旦某个节点只存在于
另一套 ComfyUI，错误将推迟到运行期。它也无法让已接受任务记住自己的运行目标。

### 拒绝：把两阶段拆成两个 Wao Task

这会新增中间视频持久化、第二次提交、第二个重试 owner、部分成功和补偿语义。第一阶段成功而第二阶段
失败时还会产生用户不需要的半成品。目标工作流本身已经把显存释放和阶段交接放在单图中，没有理由
在产品层建立第二状态机。

### 拒绝：保留 `RH_CODEX_NODE`

主 Agent 和 ComfyUI 内 Codex 会成为两个竞争 Prompt writer。后一个调用不可由 Wao 的 provider fence、
Turn 生命周期和 Prompt provenance 管理，还硬编码本机可执行文件与模型。删除它才能保证可重放任务使用
同一份已经冻结的 Prompt。

## 最接近的参照实现

参照物选择当前 `comfyui::minimax-h3-fast`，因为它与新实例共享同一个视频 provider adapter、
提交 fence、ComfyUI `/prompt`/`/api/jobs` 异步协议、出站图片投影和视频结果持久化链。音乐或 MOSS TTS
虽然也使用 ComfyUI，但输入模态、结果类型和 Prompt 所有权都不如当前 H3 接近。

| 参照物触点 | 新实例覆盖 / 不适用原因 | 验证 |
| --- | --- | --- |
| 模型 identity | 用 `minimax-h3-dual-stage-2mp` 一次性替换旧 identity | 从生产 catalog 穷尽解析 |
| capability | 单 `reference`、一张图、4–15 秒、七种比例、固定音频和 2MP | capability conformance + planner preflight |
| Prompt writer | 继续由主 Agent + `video-direction` 唯一写入，升级为新 profile | 项目上下文投影 + 实际 Turn 检查 |
| 媒体所有权 | 继续走 `WorkspaceResource` 固定版本和 owner-aware 出站图片入口 | 生产调用链检查 |
| adapter 入口 | 继续由 ComfyUI video adapter 唯一执行 | registry 解析与聚焦验证 |
| 提交 fence | 复用现有 provider invocation fence；每 attempt 至多一次提交 | 现有协议检查 + 断连探测路径 |
| runtime 配置 | 从无目标 identity 的全局 URL，补全为一个穷尽 target registry | 配置解析与缺失/非法值检查 |
| external id | 四段式写入 target、type、prompt id；旧三段式拒绝 | parser/formatter round trip |
| 轮询 | 按 external id 的 target 查询同一 `/api/jobs/:id` | 8188 接受任务后轮询 |
| 取消 | 按同一 target 幂等取消；404/已终态为 no-op | 取消协议检查 |
| 失败 | 保留 ComfyUI 原生响应并产生完整 FailureRecord | 失败状态 fixture/真实拒绝 |
| 恢复 | 重启或 retry 从持久 external id 恢复同一逻辑 target | parser + poll 恢复检查 |
| 输出解释 | profile 声明唯一最终合成节点，只下载其 MP4 | 完成历史检查 + MIME/大小校验 |
| 权限 | 本地 ComfyUI 无独立用户权限；上游项目/资源权限继续适用 | route/operation 调用链检查 |
| i18n | 用户界面的名称、固定 2MP 说明和错误说明使用消息键 | locale/typecheck 检查 |
| 真实效果 | 参照物不适用；新图必须做一次真实双阶段 RTX VSR 小样 | 8188 真实 queue/history/output |

## 权威入口与数据流

```text
视频模型 capability registry
  -> ProjectProductionContext 注入 minimax_h3_reference_v2
  -> 主 Agent 读取参考图与导演事实
  -> video-direction 写出唯一六段式最终 Prompt
  -> create_video 校验一张 reference_image、时长、比例并冻结
  -> owner-aware 图片出站投影
  -> provider invocation fence
  -> ComfyUI H3 adapter 解析固定 runtime target
  -> 8188 /prompt 提交完整双阶段 API graph
  -> external id 持久化
  -> 轮询/取消/结果下载继续解析同一 target
  -> 唯一最终 MP4 进入现有视频持久化入口
```

权威所有权如下：

| 事实 | 唯一 owner / writer | 消费者 |
| --- | --- | --- |
| H3 模型 identity 和 capability | 生产模型 registry | Planner、UI、Agent context、adapter selection |
| H3 Prompt 方言 | `video-direction` profile；主 Agent 写最终实例 | Planner、adapter |
| 冻结输入与媒体版本 | create-video Planner / generation task payload | provider engine |
| ComfyUI target identity 到 URL | ComfyUI runtime target registry | submit、poll、cancel、download |
| API graph 与可修改节点 | H3 runtime profile | H3 adapter |
| provider 接受身份 | provider invocation fence + external id | retry、poll、cancel |
| ComfyUI 运行状态 | 8188 `/api/jobs/:promptId` | async provider registration |
| Wao 业务终态与资源写入 | 现有 Task terminal owner / persistence | UI projector、后续生产链 |

## Prompt 契约

模型 capability 的 `promptProfile` 改为 `minimax_h3_reference_v2`。新 profile 仍复用唯一
`video-direction` Skill，不创建第二个 Skill 或第二个生成对象。

最终 Prompt 必须按顺序包含且只包含以下六个顶层栏目：

```text
subject_definitions:
...

summary:
...

retention_analysis:
...

detailed_description:
...

overall_soundscape:
...

non_diegetic_music:
None. Do not generate background music or musical score.
Retain only dialogue, environmental ambience and action sound effects.
```

- `subject_definitions` 使用 `<Subject N>` 与 `<Picture 1>` 明确参考图主体。
- `summary` 概括本段剧情、表演与镜头目标。
- `retention_analysis` 明确必须从参考图保留的身份、外貌、服装、道具、风格和空间事实。
- `detailed_description` 写完整时间线、镜头、动作、对白和可见落点。
- `overall_soundscape` 只写世内对白、环境声、动作声和非语言人声。
- `non_diegetic_music` 必须保留栏目并明确“无背景配乐”，不能只依赖模糊的 `N/A`。

主 Agent 在调用 `create_video` 前完成该 Prompt。Planner 做有界结构校验：六个栏目完整、顺序正确、
内容非空且音乐栏目表达禁止背景配乐。Planner 不改写内容；不合法时在副作用前拒绝，让 Agent 重新构造。
adapter 只把冻结字符串写入 H3 节点。

## API profile 转换

原 UI JSON 只作为设计输入，不在运行时读取或动态转换。实现时生成一份受版本控制的 canonical API
profile，并人工核对每条核心连线。

### 保留

- 两套 UNET、CLIP、视频/音频 VAE、Turbo LoRA 和两个 attention backend。
- 参考图最短边 1072 预处理与 `MiniMaxH3ReferenceToVideo`。
- 同一个随机噪声/seed 对两个采样阶段的原始连线语义。
- 第一阶段采样、视频解码和音频解码。
- 1MP RTX VSR、视频/音频 VAE 重编码和 AV latent 拼接。
- 第二阶段低降噪采样、解码、2MP RTX VSR。
- 两个 `easy clearCacheAll`。
- 唯一最终 `VHS_VideoCombine` 及第一阶段原生音频连接。

### 删除或展开

- 删除 `RH_CODEX_NODE`。
- 删除展示、字符串拼接、Primitive、数学表达式和只用于预览的合成节点。
- 把 `SetNode/GetNode` 展开成明确 API 连线，减少运行时自定义状态节点依赖。
- 把本地 `LoadImage` 替换成现有 URL 图片加载节点，URL 来自 owner-aware 出站投影。
- 宽高、帧数、seed 和 Prompt 由 profile builder 写入明确节点，不保留 UI 控件解释器。

profile 必须声明精确的参考图节点、H3 节点、随机噪声节点和最终输出节点 ID。轮询成功后只读取该
最终输出节点，不能继续使用多个候选 node id 猜结果。

## 动态参数与固定质量参数

每次任务只允许注入：

- 已冻结的六段式 Prompt。
- 一张 `reference_image` 绝对出站 URL。
- 4–15 秒整数时长。
- `21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16` 或 `9:21`。
- 从逻辑 invocation identity 派生的安全整数 seed。

以下参数固定，未知或额外 option 原地失败：

- 第一阶段 1MP、10 steps、Euler、beta。
- 二采输入 1MP、RTX VSR、3 steps、`res_multistep`、beta、`denoise=0.2`。
- 最终输出 2MP、RTX VSR、24fps、H.264、CRF 10、YUV420P。
- `generateAudio=true`。

三个尺寸阶段都按用户选择的宽高比计算面积并对齐 32 的倍数，不从输入图片尺寸或 UI 旧
`resolution` 字段猜测。时长继续使用目标工作流原公式：先按 24fps 计算，再向上对齐到 `17n+5` 帧。

### 最终文件大小边界

旧 H3 adapter 在读取 ComfyUI 结果时另设了 100MB 上限，而产品统一视频持久化边界
`MAX_VIDEO_BYTES` 是 512MB。2MP、15 秒、CRF 10 的目标成片不能继续被旧 H3 私有上限提前截断。

新 H3 必须复用统一的 512MB 视频上限，继续有界读取并验证 `video/mp4`，不得改为无限读取。adapter
从受信任、配置锁定的 8188 `/view` 读取后，仍交给现有媒体持久化入口；不能让对象存储层自行绕过
SSRF policy 访问任意本机 URL。

当前异步协议通过 data URL 把本地 ComfyUI 结果交给持久化层，会同时占用二进制和 Base64 内存。真实
验收必须记录 4 秒和可用时 15 秒成片字节数及 Worker 峰值内存。如果 15 秒成片接近 512MB 或造成不可
接受的内存峰值，应先补全 provider-owned 临时文件/流式交接的唯一媒体协议，再宣称支持该真实组合；
不得简单继续放大上限或跳过边界。

## ComfyUI 运行目标隔离

在 `src/lib/ai-providers/comfyui/` 建立唯一 runtime target registry：

| target id | 环境变量 | 模态 |
| --- | --- | --- |
| `h3-dual-stage-2mp` | `COMFYUI_H3_DUAL_STAGE_BASE_URL` | 新 H3 视频 |
| `shared` | `COMFYUI_BASE_URL` | 现有音乐、环境音、TTS、配音 |

`.env.example` 明确给出：

```dotenv
COMFYUI_H3_DUAL_STAGE_BASE_URL=http://127.0.0.1:8188
```

registry 对 URL 统一执行 scheme、凭据、query/hash 和尾斜杠规范化。调用方只能请求穷尽 target id，
不能传任意 URL，也不能在目标缺失时回退到 `shared`。

模型 registry 显式声明 H3 的 target id。提交、接受探测、轮询、取消和输出下载都从该 target 解析
base URL。其他 ComfyUI 模态继续声明 `shared`，不能因为 H3 地址可用而切换过去。

## External ID 与持久恢复

ComfyUI external id 一次性改为：

```text
COMFYUI:<targetId>:<type>:<promptId>
```

示例：

```text
COMFYUI:h3-dual-stage-2mp:VIDEO:550e8400-e29b-41d4-a716-446655440000
COMFYUI:shared:MUSIC:550e8400-e29b-41d4-a716-446655440001
```

- parser 只接受 registry 中存在的 target id、合法 modality 和 UUID。
- formatter 要求显式 target，不补默认。
- poll/cancel 根据 `type` 选择实现，根据 `targetId` 选择 runtime。
- H3 poll/cancel 还要断言 target 为 `h3-dual-stage-2mp`；类型与 target 不匹配原地失败。
- 旧三段式 `COMFYUI:VIDEO:<id>` 不再解析，不建立兼容分支。
- target 映射在单进程生命周期内视为不可变配置；修改地址需要停止应用与 Worker，并处理仍在运行的任务。

## 生命周期与失败矩阵

| 场景 | 行为 |
| --- | --- |
| 正常 | preflight 通过，fence 取得提交权，8188 接受一个 prompt id，external id 持久化，最终节点 MP4 下载并持久化 |
| 本地校验失败 | 缺图、多个引用、时长/比例/Prompt 不合法时在 fence 和 `/prompt` 前拒绝 |
| 环境缺失 | H3 target 未配置或 URL 非法时明确失败，不读取 shared target |
| 运行时能力缺失 | 必需节点、模型、LoRA、VAE 或 RTX VSR 选项缺失时 pre-accept rejected |
| Provider 明确拒绝 | `/prompt` 400 保留原始响应，标记 rejected，不自动重提 |
| 提交断连/超时 | 只在同一 8188 查询预生成的 prompt id；能证明已接受则持久化，否则 outcome unknown，不重新提交 |
| 排队 | `/api/jobs` 的 pending 映射 queued，使用现有独立排队预算 |
| 生成 | in_progress 映射 running，使用现有生成预算 |
| Provider 失败 | failed/cancelled 产生完整 FailureRecord，不返回中间产物 |
| 用户取消 | 先服从 Wao 本地终态，再由补偿 Activity 按 external id 到同一 target 幂等取消 |
| 取消晚到 | 已 completed/failed/404 视为 provider cancel no-op，不改写本地终态 |
| poll 网络异常 | 抛 transport 错误并恢复同一 external id，不伪造 provider 失败 |
| 未知状态 | 原地失败为协议错误，不猜 pending 或 completed |
| 输出缺失/错误节点 | 明确 `COMFYUI_VIDEO_OUTPUT_MISSING`，不选中间视频 |
| 输出格式/超限 | MIME 不是 MP4 或超过上限时失败，不持久化伪成功 |
| 重试 | poll/cancel 重试复用同一 external id；submission fence 禁止同 attempt 二次 POST |
| 重复/并发 | provider invocation identity 和 fence 继续是唯一提交裁判，不以 ComfyUI 队列位置判断重复 |
| 刷新/断线 | UI 从 Wao 持久 Task View 恢复；不从 ComfyUI 页面、历史消息或 timer 推断终态 |
| 部分成功 | 第一阶段或 1MP/二采中间结果不构成产品终态，整个 graph 只有最终 2MP MP4 成功 |
| 旧任务 | 旧 model identity 或三段式 external id 不兼容；切换时允许直接失效，不迁移和不自动清理 |

## 事务、幂等与崩溃边界

- Wao 现有 provider invocation fence 继续拥有“是否允许发出唯一一次 `/prompt`”的裁决。
- ComfyUI `prompt_id` 在提交前生成，并在断连探测和 external id 中复用。
- API graph 的 seed 来自同一逻辑 invocation 的稳定输入，不在 poll/retry 中重新生成。
- 8188 接受后 Wao 崩溃：恢复从持久 external id 查询同一 prompt id。
- 8188 完成后、Wao 下载前崩溃：恢复轮询再次读取同一最终输出。
- 最终媒体写入继续由现有持久化入口和 Task terminal owner 负责；ComfyUI history 不是第二个业务 writer。
- 二采阶段不跨 Wao 事务边界，不产生需要补偿的中间 WorkspaceResource。
- 不使用 timer、页面 refetch 或输出文件时间戳承担正确性。

## 状态解释者和入口数量

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 视频 Prompt writer | 1（主 Agent） | 1（主 Agent） |
| H3 provider 提交入口 | 1 | 1 |
| H3 产品 Task / ComfyUI prompt id | 1 / 1 | 1 / 1 |
| H3 API profiles | 2（首帧、首尾帧） | 1（参考图双阶段） |
| H3 输入模式 | 2 | 1 |
| H3 用户质量档位 | 2 | 0（固定质量） |
| ComfyUI external-id parser/formatter | 1 | 1 |
| ComfyUI runtime target resolver | 0（全局 URL） | 1（穷尽 registry） |
| H3 可接受最终输出节点 | 多候选猜测 | 1（profile 声明） |
| 二采产品状态机 | 0 | 0（仍在同一 provider graph 内） |

不新增业务 writer、提交入口、终态解释者或第二状态机。新增的是一个明确的运行目标 identity，并删除
全局地址对全部 ComfyUI 模态的隐式支配。

## Capability 与 UI

新视频 capability：

- `promptProfile: 'minimax_h3_reference_v2'`。
- `supportedInputModes: ['reference']`。
- `supportsTextToVideo: false`。
- `maxReferenceImages: 1`、`maxReferenceFiles: 1`。
- 不声明 `maxReferenceAudios` 或 `maxReferenceVideos`；结合单一 `reference` 图片模式和
  `maxReferenceFiles: 1`，Planner 必须拒绝任何参考音频或参考视频。
- `durationOptions: [4, 5, ..., 15]`。
- 保留七种宽高比。
- 音频固定为 true。
- 不再声明 `resolutionOptions`、first/last-frame 或多参考能力。

UI 只显示一张“参考图”、时长和宽高比，并用 i18n 文案显示“固定 2MP 增强输出”。删除首帧、首尾帧、
480p/720p、多参考和音频开关。UI 不自行判断模式；它只消费 capability 投影后的最终 View。

## 删除与切换

实施时一次性删除：

- 旧 `minimax-h3-fast` 模型 identity、名称和默认 option。
- `h3-fast-first-frame`、`h3-fast-first-last-frame` profile 与两份旧 API workflow JSON。
- `MiniMaxH3ImageToVideo`、last-frame 和 480p/720p 的 adapter 分支。
- H3 旧 `minimax_h3_v1` 首帧/首尾帧 Prompt 方言；由 reference v2 取代。
- ComfyUI 三段式 external-id formatter/parser。
- H3 对全局 `readComfyUiBaseUrl()` 的直接调用。

不保留 alias、旧模型 fallback、双 profile、旧 external-id parser 或迁移期限。部署切换前应停止应用与
Worker，确认没有需要保留的旧 H3 运行任务；用户已接受旧 H3 任务失效。无需为本次目标执行数据库删除。

## 预计代码边界

- `src/lib/ai-providers/comfyui/config.ts`：runtime target registry 与 URL 解析。
- `src/lib/ai-providers/comfyui/async-task.ts`：四段式 external id 和 target-aware dispatch。
- `src/lib/ai-providers/comfyui/h3.ts`：新模型、专属 target、preflight、唯一输出、poll/cancel。
- `src/lib/ai-providers/comfyui/profiles.ts`：单一双阶段 API profile builder、尺寸和时长。
- `src/lib/ai-providers/comfyui/workflows/**`：删除两份旧图，增加一份 canonical API 图。
- `src/lib/ai-providers/comfyui/models.ts`：新 model identity 和 capability。
- `src/lib/ai-providers/comfyui/adapter.ts`：新 reference 输入映射，删除首帧/首尾帧分支。
- `src/lib/ai-providers/comfyui/transport.ts`：若需要，增加按 profile 精确读取输出的共享能力；不能硬编码 H3 特例污染其他模态。
- `src/lib/http/body-size-constants.ts` 只作为现有统一 512MB 视频边界来源；本设计不新增第二个 H3 文件上限。
- `src/lib/ai-registry/**`、`src/lib/platform-models/**`：只修改现有穷尽 registry 所需触点。
- `src/lib/project-production-context.ts` 与 `video-direction/SKILL.md`：投影并执行新 Prompt profile。
- `.env.example`：增加 H3 专属地址并澄清 shared 地址用途。
- 前端模型能力消费者与 locale messages：删除旧控件，显示固定 2MP 说明。

实际实施前以生产 registry 和旧 H3 的真实调用链重新穷尽文件范围。若发现需要建立第二写入入口或第二
状态机，停止实施并重新评审设计。

## 验证策略

### 确定性验证

1. 从 production registry 穷尽验证新 H3 identity、单 reference 模式、4–15 秒和无分辨率选择。
2. external-id formatter/parser 对所有四种 ComfyUI 模态做 target-aware round trip；旧三段式拒绝。
3. target registry 证明 H3 只解析专属环境变量；缺失、非法或与 modality 不匹配时拒绝，无 fallback。
4. API profile 静态验证所有 input link 指向存在节点，核心节点类型和唯一输出节点完整。
5. profile builder 对七种比例、4 与 15 秒验证 32 倍数尺寸、1MP/2MP面积和 `17n+5` 帧公式。
6. 验证冻结 Prompt 和一张 reference URL 逐字写入正确节点，额外引用和未知 option 被拒绝。
7. 验证两个模型文件、两次 `nvidia_rtx_vsr`、两处 cache clear、10/3 steps、0.2 denoise 和原生音频连线没有被转换遗漏。
8. 运行受影响的现有 Vitest/conformance、ESLint 和 `npm.cmd run typecheck`。

只在具有独立 graph、registry、数学或协议 oracle 时新增自动化测试；不使用源码字符串、mock 调用次数或
快照自证工作流正确。

### 8188 实时验证

1. 重新读取 `/system_stats`、`/object_info` 和精确模型选项，避免复用旧快照。
2. 向专属 8188 提交一张合法参考图、4 秒、小样 Prompt，确认只有一个 prompt id。
3. 观察 queue/history：第一阶段、1MP VSR、二采、2MP VSR、最终合成完整结束。
4. 下载唯一最终节点 MP4，验证 MIME、可播放性、分辨率约 2MP、24fps 和存在原生音轨。
5. 检查没有背景配乐；允许对白、环境声和动作音效。
6. 在适合时执行一次 accepted-job cancel，确认请求只发往 8188 且 Wao 本地终态不被晚到结果覆盖。
7. 记录成片字节数和 Worker 峰值内存，证明旧 100MB 私有上限已消失且统一 512MB 边界没有被绕过。

15 秒上限通过同一确定性帧数/graph contract 验证。若不实际生成 15 秒成片，交付时必须把“最长时长的
显存和耗时尚未真实验收”列为盲区，不能用 4 秒小样暗示全部真实组合已通过。

## 验收标准

### 实现完成

- 旧 H3 identity、profile、输入模式和 workflow 已删除，无兼容分支。
- 新模型只接受一张 reference image、4–15 秒和七种比例。
- 主 Agent 是唯一 Prompt writer，ComfyUI 图中没有 Codex 调用。
- 8188 专属 target 贯穿 submit、probe、poll、cancel 和 download。
- 双模型二采、1MP/2MP RTX VSR、cache clear、原生音频和唯一最终输出在 canonical API 图中完整。
- 聚焦静态验证、typecheck 和适用现有检查通过；失败和盲区如实列出。

### 阶段完成

在实现完成基础上，真实 8188 的 4 秒双阶段任务完成，最终 MP4 的分辨率、帧率、音轨和无背景配乐
达到要求；取消或恢复路径至少完成一项真实协议验证。

### 架构完成

只有在旧入口已删除、所有 ComfyUI 新 external id 都包含 target、运行任务切换边界已处理、真实最长时长
和取消/恢复组合无关键盲区后，才可称架构完成。在此之前只称实现完成或阶段完成。

## 架构文档判断

本设计改变 ComfyUI external-id 协议和运行目标解析，但不改变 Provider Gateway、Task terminal owner、
媒体出站投影或 Prompt writer 的归属；它落实现有 PG-03、PG-04、PG-05、PG-06、PG-20 和 PG-21。
因此默认不修改 `docs/architecture/**`。只有实施调查证明需要新增/删除不变量或改变权威入口归属时，才
按仓库准入规则更新对应模块文档。
