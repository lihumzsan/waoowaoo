# MiniMax Music 3 平台接入设计

## 目标

把已经在本机 H3 ComfyUI 实例成功运行的 MiniMax Music 3 工作流接入现有平台，使主 Agent 能通过唯一 `create_audio` Operation 生成纯音乐或带歌词歌曲，并沿用现有 Task、Provider fence、异步轮询、取消、失败记录、对象存储和 WorkspaceResource 终态链路。

## 非目标与禁止范围

- 不新增 route、队列、音乐专用状态机、持久实体或数据库 migration。
- 不新增 Provider；MiniMax Music 3 仍属于现有 `comfyui` Provider。
- 不从 Prompt 文本解析 Caption、Lyrics 或生命周期状态。
- 不自动回退到 ACE-Step、其他 ComfyUI 实例或外部 Provider。
- 不修改用户提供的原始 UI 工作流文件。
- 不顺带修复基线 `check:local-provider-boundary` 对 `.github/workflows/verify.yml` 的既有失败。

## 方案选择

采用完整能力接入：MiniMax Music 3 作为第二个 ComfyUI `music` profile 注册，并成为本地平台默认音乐模型。公共音乐 item 增加显式 `lyrics` 字段；`vocalMode=vocal` 必须提供歌词，`instrumental` 禁止提供歌词并由 adapter 映射为 Provider 固定值 `[Instrumental]`。

拒绝两个替代方案：

1. 不复用 ACE model key。那会让新生成 Resource 的 model provenance 冒充 ACE。
2. 不在现有 adapter 和异步轮询中继续增加 model-name `if/switch`。持续新增同类实例必须由穷尽 registry 管理。

## 权威入口与所有权

| 事实或动作 | 唯一 owner / writer |
| --- | --- |
| 用户/Agent 音乐请求 | `audio_generation_batch` strict schema |
| 执行入口 | `create_audio` Operation |
| 模型选择与能力 | AI capability/model registry |
| Caption 与 Lyrics 创作 | 当前 Turn 的主 Agent |
| 冻结执行参数 | workspace-resource generation planner |
| Provider 提交许可 | Task provider invocation fence |
| ComfyUI Graph | 选中 music profile 的 graph builder |
| 外部运行事实 | ComfyUI job identity |
| 本地业务终态 | Task Terminal Service |
| 音频内容与 lineage | WorkspaceResource materializer |

持久 writer 数量保持不变：Task 1→1，Resource 1→1，Provider submission fence 1→1。公开执行入口保持 1→1。ComfyUI 音乐模型解释从一个 ACE 专用分支收敛为一个 profile registry；“所有 MUSIC 都是 ACE”的竞争解释从 1→0。

## 组件设计

### 1. 生产 API Graph

把 `C:/workspace/image/MiniMax+Music音乐生成.json` 转成只包含生产节点的 API Graph。删除 MarkdownNote、CR Prompt Text、SeedNode、ComfySwitchNode 和当前未选中的 tiled decode 分支。保留经本机验证的模型文件与参数：

- UNET：`MiniMax-Music-3\\minimax_music3_dit_fp16.safetensors`
- CLIP：`Minimax-music-3\\minimax_music3_text_encoder_bf16.safetensors`
- VAE：`MiniMax-Music-3\\minimax_music3_dav.safetensors`
- encoder：`cfg_scale=1.7`、`top_k=50`
- sampler：`steps=30`、`cfg=1.7`、`euler/simple`、`denoise=1`
- output：`SaveAudioAdvanced`、MP3 V0

所有 ComfyUI music profiles 使用 canonical output node id `107`。这样异步 external ID 只需表达 runtime target、media type 与 request id，轮询不需要从结果内容或模型名猜输出节点。

### 2. ComfyUI Music Profile Registry

新增一个穷尽 registry，单条 profile 同时声明：

- model id/key、显示名、运行目标；
- capability 与默认 generation options；
- immutable workflow、output node；
- option schema 与 graph builder。

ACE-Step 1.5 和 MiniMax Music 3 都进入该 registry。`models.ts`、adapter describe/execute、runtime target 映射与 conformance 从 registry 派生。未知 model key 原地失败。

提交、轮询、取消和结果下载改成通用 ComfyUI music runtime。提交仍生成一次 prompt id，并用现有 submission disposition 保护 accepted/unknown 边界；轮询和取消按 external ID 中的 target 定位实际 ComfyUI。

### 3. Runtime Graph 预检

提交 fence 之前读取 `/object_info/<class>`，复用 `deriveComfyUiProfileRequirements` 和 `assertComfyUiPromptGraphRuntimeContract` 校验：

- 所有节点 class 存在；
- Graph 的 required input 完整；
- link 的输入输出类型兼容；
- loader 中声明的实际模型文件存在；
- scalar 值落在当前节点 schema 范围内；
- canonical output node 存在且为 `SaveAudioAdvanced`。

MiniMax Music 3 使用 `h3-dual-stage-2mp` runtime target，即当前 `COMFYUI_H3_DUAL_STAGE_BASE_URL`。本机 `/object_info` 已确认 `max_duration` 范围为 0.04–360 秒；平台公共 item 保持整数秒，因此该 profile 声明 1–360 秒。

### 4. Caption、Lyrics 与冻结

公共 `prompt` 直接作为 MiniMax `caption`，不经服务端扩写。公共 `lyrics` 进入 generation options 并随 Task payload、retry 和 Provider request identity 一起冻结：

- `vocalMode=vocal`：`lyrics` 必须为非空字符串；
- `vocalMode=instrumental`：禁止 caller 提供 `lyrics`，adapter 固定写 `[Instrumental]`；
- ACE-Step 仍只声明并接受 instrumental，且不接受 lyrics；
- seed 维持现有 ComfyUI submit identity 派生方式，同一 accepted prompt id 的恢复使用同一 seed。

MiniMax 的 BPM、调性和拍号属于 Caption 内容，不声明为独立 capability option。Provider 专属 cfg、top-k 和 sampler 固定在 profile，不进入公共 Schema。

### 5. 主 Agent Skill

现有 `music-direction` 按系统注入的 `productionCapabilities.music.generationMode` 分支，而不是按 provider/model 名称分支：

- `composition_plan`：保留现有 Eleven Composition Plan 写法；
- `prompt`：输出 provider-ready Caption、时长和 capability 允许的 vocalMode；vocal 时同时输出结构化段落标签歌词；
- 不配乐统一返回机器 Schema 已声明的 `decision: "no_audio"`。

主 Agent 仍是 Caption/Lyrics 唯一 writer，服务端只校验、冻结和映射 wire 字段。

## 生命周期与时序

### 正常路径

1. 主 Agent 生成一个 strict `audio_generation_batch`。
2. `create_audio` 校验项目、模型 capability、Caption/Lyrics 关系和时长。
3. 同一 Operation 事务创建 Resource reservation、Task 和 batch member。
4. Task handler 经 `ai-exec` 选中 ComfyUI music profile。
5. profile preflight 在 submission fence 外完成；缺节点/模型时确定性失败且不提交。
6. fence 授予唯一提交权后 POST `/prompt`，保存 external id。
7. 通用 MUSIC poll 读取 canonical output node `107`。
8. 下载 MP3、探测真实 duration、写对象存储并由 terminal owner 原子提交 Resource ready。

### 失败、取消与恢复

- 参数、节点或模型缺失：pre-accept rejected，不产生 external id。
- ComfyUI 4xx：typed rejected，不自动换模型。
- submit ACK 丢失：用同一 prompt id 查询 job；无法证明时进入 outcome unknown，不重提。
- pending/failed/cancelled：保留 Provider 原生 job 证据并映射 FailureRecord。
- 网络轮询错误：抛出并恢复同一 external id。
- 用户取消：先由本地 terminal owner 提交 canceled，再执行 Provider cancel 补偿。
- retry：读取原 Task 已冻结 Caption、Lyrics、模型和 options；不从当前项目设置重建。
- 晚到 completed：服从现有 terminal/checkpoint 裁决，不能覆盖已提交终态。

## 删除与收敛

- 删除 `adapter.ts` 中 ACE-only music option schema 和 execute 绑定。
- 删除 `async-task.ts` 中 `MUSIC → poll/cancel ACE` 的模型假设。
- 删除 ACE 文件内重复的 submit/poll/cancel transport；保留为 profile graph builder 或并入 registry 模块。
- 生产 Graph 不携带 UI notes、prompt helper、SeedNode、switch 或闲置 tiled branch。
- 不增加 fallback、timer、第二状态 projector 或第二 Resource writer。

## 历史回归矩阵

| 历史症状 | 根因 | 当前防线 | 本次复发形式 | 处理 |
| --- | --- | --- | --- | --- |
| 新 H3 模型漏接 runtime target/profile | 模型 identity、运行目标和 Graph 验证分散 | H3 target registry 与 Graph contract | 新音乐模型若只加 catalog，会漏接 adapter/poll | 单一 music profile registry + conformance |
| MUSIC poll 只能读 ACE 输出 | async type 被当成具体模型 | 无穷尽 profile 防线 | MiniMax 完成后按 ACE node 读取 | canonical music output node + generic poll |
| 主 Agent Skill 与实际模型能力不一致 | Eleven 被移除后 Skill 仍硬编码 composition plan | runtime capability 已注入但 Skill 未消费 prompt 分支 | MiniMax prompt profile 无法形成合法 item | Skill 按 generationMode 穷尽分支 |
| Skill 返回 `no_music`、Schema 只收 `no_audio` | 散文与机器契约漂移 | strict schema 能拒绝但不能纠正散文 | 无音乐分支确定性失败 | Skill 改用 Schema identity，不新增第二枚举 |

这是“新实例漏接契约 + 既有防线失效”，不是建立新架构。长期不变量已经存在于 provider-gateway、audio-production、workspace-resource 和 async-task-lifecycle；不新增或删除不变量，因此不修改 `docs/architecture/**`。

## 验证

- TDD 验证公共 Caption/Lyrics 交叉约束和 frozen retry payload。
- Registry conformance 从生产 registry 穷尽检查 identity、capability、runtime target、output node 与 adapter 覆盖，不维护手写实例清单。
- 类型检查、capability catalog、logic、conformance 和适用 provider critical suite。
- 使用当前 H3 ComfyUI 真实执行至少两轮：一轮 instrumental、一轮 vocal；两轮都必须通过 adapter、external id、poll 和 MP3 下载链路。
- 每轮记录 prompt id、target、最终状态、字节数和真实 duration，不保存测试音频到仓库。

已知基线盲区：`npm run typecheck` 的两个 TypeScript 编译阶段通过，但随后 `check:local-provider-boundary` 对基线 `.github/workflows/verify.yml` 报错。本任务不修改该文件；交付时分别报告 TypeScript 结果和该既有检查失败。
