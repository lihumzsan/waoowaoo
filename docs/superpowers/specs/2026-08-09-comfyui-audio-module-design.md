# ComfyUI 音频模块设计

> **状态：已被窄化设计取代，不再作为实施权威。** 环境音部分由
> [`2026-08-11-moss-soundeffect-integration-design.md`](2026-08-11-moss-soundeffect-integration-design.md)
> 取代。本文件中的 Stable Audio 纯音乐、默认音乐模型切换和双工作流交付未在当前任务中获批，
> 只能作为历史背景，实施不得据此扩张范围。

## 状态与已确认决策

本设计覆盖两个同时交付的音频能力：

- 纯器乐 BGM：使用 `stable+audio3+pure+music.json`，不支持歌曲、人声或歌词。
- 环境音：使用 `stable-audio-3-medium.json`，生成连续环境氛围和背景声，不生成音乐、对白或旁白。

用户已确认当前产品的默认音乐只承担纯器乐 BGM。两个源工作流均已由用户在本地 ComfyUI 中成功运行；接入仍需从 Wao 的真实 `create_audio` 入口完成端到端验证。

## 目标

1. 保留一个公开生产入口 `create_audio`，通过显式 `audioKind` 区分 `music` 与 `environment`。
2. 将纯器乐 BGM 的平台默认模型切换为 ComfyUI Stable Audio 3 Pure Music。
3. 增加独立环境音模态和默认模型，不把环境音伪装成 `music` 或 `project.bgm_audio`。
4. 源工作流原样复制进仓库；所有转换、删减和参数注入只修改仓库副本。
5. ComfyUI 提交、external id、排队、执行、完成、失败、取消与结果下载接入现有 Provider Gateway 和 Task 生命周期。
6. 不恢复上一版跨视频、语音和大量工作流的通用 ComfyUI router；本阶段只实现两个有明确节点契约的音频 profile。

## 非目标

- 歌曲、人声、歌词、TTS 或音色克隆。
- Stable Audio 音频到音频、局部重绘、续写和 LoRA。
- 视频工作流、口型同步或视频原生音频。
- 运行时把 UI workflow 自动猜测或通用转换为 API graph。
- ComfyUI 故障时自动切换 FAL、Google、Mureka 或其他 Provider。
- 执行数据库迁移、回填或批量改写现有项目数据；这些操作需要单独授权。

## 现状与问题

当前 `create_audio`、`audioGenerationItemSchema`、`workspace-resource-audio` handler、`musicModel` 默认配置、能力 registry、错误码和 `project.bgm_audio` schema 都只表达音乐。把环境音工作流注册成 `music` 会造成四个错误：

1. 环境音被持久化为 BGM。
2. `vocalMode`、`genre`、`mood`、`bpm` 等音乐字段会被错误地投射到环境音。
3. Agent 会继续使用音乐 Skill 编写环境音 Prompt。
4. 报价、模型选择、失败信息和后续混音会把两个不同产品语义混为一谈。

上一版 ComfyUI 实现一次引入了视频、音乐、语音、启发式注入器和大量工作流，随后因新工作流资产尚未确认而整体撤回。本次按 profile 明确节点、参数和输出，不恢复启发式大路由。

## 方案比较

### 方案 A：把两个工作流都注册为 `music`

改动最少，但环境音的模型、资源、Prompt、报价和状态语义全部错误；拒绝。

### 方案 B：新增 `create_environment_audio`

可以隔离字段，但会建立第二个音频生产入口、第二套提交链和重复 handler；违反一个动作只有一个执行入口；拒绝。

### 方案 C：一个 `create_audio`，显式音频种类与两种 registry 模态

`create_audio` 接收穷尽的 `audioKind`，音乐走既有 `music` 模态，环境音走新增 `sound` 模态；两者共用计划、授权、Task、materializer 和 WorkspaceResource 写入入口。该方案保留唯一入口并让能力边界显式，是本设计采用的方案。

## 权威入口与数量变化

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 公开音频生产入口 | 1 个 `create_audio` | 1 个 `create_audio` |
| 音频 Task handler | 1 个 music-only handler | 1 个按 `audioKind` 穷尽分派的 handler |
| 音频结果持久化 writer | 1 个 terminal materializer | 1 个 terminal materializer |
| 音频业务种类解释者 | 隐式只有 music | 1 个共享 `AudioGenerationKind` 契约 |
| 默认模型 owner | `musicModel` | `musicModel` 与 `soundModel` 各自唯一 |
| ComfyUI 音频 workflow profile | 0 | 2 个显式 profile |
| 运行时 workflow 猜测器 | 0 | 0 |

不会新增第二套 Task 状态机、第二个资源 writer、route 直连 ComfyUI 或 UI 状态解释。

## 领域契约

### 音频种类

新增共享穷尽类型：

```ts
type AudioGenerationKind = 'music' | 'environment'
```

`create_audio` 的 item 改为按 `audioKind` 判别的 union。

音乐 item：

- `audioKind: 'music'`
- `schemaId: 'project.bgm_audio'`
- 完整 provider-ready Prompt
- `durationSeconds`
- `vocalMode` 只能是 `instrumental`
- 可选 `genre`、`mood`、`bpm`、时间线用途字段
- 只允许当前音乐契约支持的显式引用

环境音 item：

- `audioKind: 'environment'`
- `schemaId: 'project.environment_audio'`
- 完整 provider-ready 环境音 Prompt
- `durationSeconds`
- 不接受 `vocalMode`、`genre`、`mood`、`bpm` 或歌词字段
- 本阶段不接受参考音频、参考视频或参考图片

重试从已保留 Resource 和冻结 Task payload 读取原 `audioKind`，调用方不能在 retry 时改变种类、模型、路径或资源身份。

### Prompt 所有权

- 音乐 Prompt 继续由 `music-direction` Skill 产生，严格为纯器乐。
- 新增环境音方向 Skill，负责把用户意图写成最终环境声音描述。
- 两类 Skill 均消费服务端注入的模型能力，包括时长、Prompt 目标语言和字符预算。
- Planner 只验证并逐字冻结 Prompt；handler 和 ComfyUI adapter 不翻译、不补写流派、不追加时长文案。
- Stable Audio profile 声明 `promptLanguage: 'en'`；用户界面、进度和错误文案继续按 locale 显示，不硬编码英文用户文案。
- Pure Music 工作流中的 Qwen `TextGenerate`、模板选择、StringReplace 和 Switch 不进入生产 API graph，避免第二个 Prompt writer。

### 资源语义

- 纯器乐输出继续使用 `project.bgm_audio`。
- 环境音新增 `project.environment_audio`。
- 两者仍是普通 `WorkspaceResource`，共享 project owner、路径、content version、lineage 和 terminal materializer。
- 环境音不会自动触发混音或视频；任何采用、混音和视频装配仍需独立用户意图。

## Registry、配置与计费

### 模态

保留 `music`，新增 `sound` 作为 Provider Gateway 的正式模态。`sound` 首个 capability 只声明 `environment`，未来若新增 SFX 必须通过 registry 扩展，调用方不得按模型名猜测。

### 模型 identity

- `comfyui::stable-audio-3-medium-pure-music`
  - 模态：`music`
  - 音频种类：`music`
  - 人声模式：仅 `instrumental`
  - 输出：MP3
- `comfyui::stable-audio-3-medium-environment`
  - 模态：`sound`
  - 音频种类：`environment`
  - 明确排除音乐、旋律、对白、人声和旁白
  - 输出：MP3

模型 key 表示项目 workflow profile，不用 checkpoint 文件名或 UI 文件名作为领域 identity。

### 默认模型

- 平台 `musicModel` 默认值切换为 Pure Music profile。
- 新增 `soundModel`，默认值为 Environment profile。
- Project/UserPreference 对 `soundModel` 的持久字段由唯一配置 service 写入；需要 Prisma migration，但本任务只在获得额外授权后执行迁移。
- 迁移文件可以随实现创建，但在用户明确授权把它应用到指定本地数据库之前，不执行任何 migration。若授权尚未给出，依赖真实 Project/UserPreference `soundModel` 字段的端到端验证必须标记为未完成，不能宣称阶段三完成。
- 已有项目显式保存的 `musicModel` 不做静默回填或覆盖；其值仍是当前事实。未显式选择时继承平台默认。
- 不声明 Provider failover route。选中 ComfyUI 就只调用 ComfyUI。

### 计费

自托管 ComfyUI 初始 catalog cost/retail 明确为 0 credits，界面说明 GPU 成本由部署方承担。云端若要计费，必须在启用该模型前通过权威 pricing catalog 明确配置，不能在 adapter 内猜价格。

## 工作流资产隔离

仓库内新增：

```text
src/lib/ai-providers/comfyui/workflows/stable-audio-3/
├─ source/
│  ├─ environment.ui.json
│  └─ pure-music.ui.json
└─ runtime/
   ├─ environment.api.json
   └─ pure-music.api.json
```

- `source/*.ui.json` 是用户提供文件的原样副本，只用于审计和在 ComfyUI UI 中复现。
- `runtime/*.api.json` 是项目执行资产，只保留 API prompt graph。
- 项目绝不修改 `D:\workspace\comfui\workflows\*.json`。
- API graph 在构建期提交，不在运行时从 UI graph 自动转换。
- 加载时校验根对象、节点 id、`class_type`、连接、模型字段和唯一输出节点；任一漂移立即失败。

### Pure Music profile

保留 Stable Audio 生成链：checkpoint、Stable Audio CLIP、正负 conditioning、latent duration、KSampler、VAE decode 和 `SaveAudioMP3`。保留用户已验证的 base checkpoint 与 50 steps/CFG 7/Euler 参数，不擅自替换为 post-trained checkpoint。

删除运行 graph 中的 Qwen loader、`TextGenerate`、四类内嵌模板、Switch、Replace、Preview、CustomCombo 和推广 Markdown。正向 Prompt 注入原节点 62，时长注入 latent 节点 59，seed 注入 KSampler 节点 60；负向 Prompt 保持空。

### Environment profile

保留用户已验证的 Stable Audio Medium、8 steps/CFG 1/LCM、环境音负向 Prompt 和 MP3 输出。正向 Prompt 注入节点 86，时长注入节点 83，seed 注入节点 84。负向 Prompt 固定排除 `music, melody, speech, dialogue, vocals, narration`，调用方不能覆盖。

## ComfyUI 协议与生命周期

### 提交

1. Planner 在副作用和报价前验证 `audioKind`、模型 capability、时长、Prompt 和引用数量。
2. Provider adapter 按精确 model id 选择唯一 profile，clone graph 并通过节点契约注入参数。
3. POST `${COMFYUI_BASE_URL}/prompt`，读取 `prompt_id`。
4. 返回 async result 和 `COMFYUI:{MUSIC|SOUND}:{profileToken}:{promptId}` external id。
5. 明确的 ComfyUI prompt validation 4xx 是 pre-accept rejection；断连、超时、5xx 或无法证明是否受理的响应是 `outcome_unknown`，禁止自动重提。

### 轮询

- `/queue` 精确区分 `queued` 与 `running`。
- `/history/{promptId}` 是完成和失败结果的权威来源。
- 未知状态、缺失终态字段或 malformed history 原地失败，不把“从队列消失”猜成完成。
- 完成时只读取 profile 声明的 `SaveAudioMP3` 输出节点。
- 当前真实 history 形状为 `outputs.<node>.audio[]`，成员含 `filename`、`subfolder`、`type`；解析器严格验证后调用 `/view`。
- Provider client 在 ComfyUI 配置边界内下载音频、执行 MIME 和 100MB 上限校验，并以 `data:audio/...;base64,...` 交回现有 `loadGeneratedAudio`。不把 `127.0.0.1/view` 当普通外部 URL 交给 SSRF-safe downloader。

### 取消与恢复

- 本地 Task terminal owner 先提交 canceled 事实；Provider cancel 仅做后续尽力补偿。
- pending prompt 使用 `/queue` 的精确 prompt id 删除，要求幂等。
- running prompt 不调用全局 `/interrupt`，因为它会影响其他任务；本地取消后忽略晚到结果，Provider 可能继续消耗本地算力。
- 同一个 external id 可在 Activity retry、进程重启和断线后继续轮询，不重新 POST `/prompt`。
- queue timeout 先将旧 external id 标记为 replay-authorized，再删除 pending prompt，最后由新 attempt 取得唯一提交权。

### 并发

音乐和环境音共享一个 ComfyUI audio capacity bucket，初始默认并发为 1。并发配置只管理容量，不承担正确性；ComfyUI queue 和 prompt identity 仍是生命周期事实。

## 数据流

```text
Agent / API
  -> create_audio(audioKind, final prompt, duration, ...)
  -> Plan: schema + capability + pricing + placement + exact model
  -> Task reservation and authorization
  -> workspace_resource_audio handler
  -> generateMusic or generateSound through ai-exec
  -> ComfyUI profile adapter
  -> /prompt -> prompt_id -> /queue + /history -> /view
  -> bounded audio bytes
  -> task artifact storage
  -> terminal WorkspaceResource materializer
  -> project.bgm_audio or project.environment_audio
```

## 错误处理

至少提供可本地化的稳定错误码：

- ComfyUI URL 缺失或非法。
- profile/model 不支持所选 `audioKind`。
- workflow 文件、节点或连接契约漂移。
- checkpoint、CLIP 或自定义节点在 ComfyUI 中不可用。
- Prompt、时长、seed 或输出格式不合法。
- submission 明确拒绝、submission outcome unknown。
- queue timeout、generation timeout、Task canceled。
- history 明确失败、history malformed、输出节点缺失。
- `/view` 下载失败、MIME 非音频、结果超过大小上限。

错误保留 ComfyUI 原生响应并追加 typed interpretation；日志不记录完整 Prompt graph、base64 音频或环境机密。

## Reference implementation 对齐

选择 FAL music async adapter 作为最近参照物：它已经从 `create_audio` 经过 `generateMusic`、submission fence、external id、poll、audio materialization 到 WorkspaceResource；ComfyUI 的差异仅停留在 provider 私有 transport 与新增 `sound` 模态。

| 参照物触点 | ComfyUI 覆盖 / 不适用原因 | 验证 |
| --- | --- | --- |
| provider/model identity | registry 声明两个精确 workflow model key | catalog/conformance check |
| 凭证与连接 | 无 API key；唯一 `COMFYUI_BASE_URL` | config validation + live `/object_info` |
| option schema | music 与 sound 分别声明允许字段 | planner preflight |
| 提交 fence | `/prompt` 每 logical invocation 最多一次 | provider invocation integration evidence |
| external id | `COMFYUI:MUSIC|SOUND:profile:promptId` | strict parse/format conformance |
| queued/running | `/queue` 精确投影 | live queue smoke |
| provider failure | `/history` 原生状态转 FailureRecord | malformed/failed fixture or live evidence |
| 恢复 | 同 external id 继续 poll | Activity retry/resume smoke |
| 取消 | pending 定向删除；running 不全局 interrupt | pending cancellation smoke + code inspection |
| 结果下载 | profile 输出节点 -> `/view` -> bounded data URL | live MP3 retrieval |
| 持久化 | 复用现有 artifact upload 与 terminal materializer | end-to-end Resource ready evidence |
| 权限 | 复用 project/user auth、Plan 和 Resource owner | existing operation boundary inspection |
| i18n | 新字段、模型和错误补齐中英文消息 | locale key check |
| 计费 | registry 精确零 credits，无隐藏 Provider fallback | pricing coverage check |

## 架构文档变化

音频模块新增一条长期不变量：音频种类必须由共享 discriminated union 显式声明，音乐与环境音分别解析模型能力、Prompt 字段、schema 和报价；禁止从 Prompt 内容、文件名或模型名推断种类。该不变量影响模型选择、费用和持久资源语义，实施时写入 `docs/architecture/modules/audio-production.md`。

Provider Gateway、WorkspaceResource 和异步 Task 的既有不变量不变，只补全 registry 实例和实现。

## 实施阶段

### 阶段一：音频领域契约一次性切换

- 增加 `AudioGenerationKind`、sound modality、sound capabilities 和 pricing type。
- 将 `create_audio`、PlanSnapshot、Task payload、handler、Resource schema 与 creative output 改为穷尽 `audioKind`。
- 新增环境音方向 Skill 和中文/英文文案。
- 新增 `soundModel` 配置字段和 migration 文件；未获授权不执行 migration。
- 阶段一可以完成代码与静态验证，但数据库相关运行验证受上一节迁移授权门约束。
- 删除所有把任意 audio 等同于 music 的旧分支，不保留双轨 payload。

### 阶段二：窄 ComfyUI audio provider

- 原样复制两个 UI workflow。
- 提交两个手工审计后的 API prompt graph。
- 实现 profile registry、严格注入、client、adapter、async provider 和结果解析。
- 注册 music/sound capability、pricing 和 API config model。

### 阶段三：默认模型与真实链路

- 开始本阶段前，必须取得对明确命名的本地开发数据库执行 migration 的单独授权；否则停在阶段二已实现、数据库链路未验证的状态。
- 将平台默认 pure music 切换到 ComfyUI profile，配置默认 sound model。
- 复用同一 `create_audio` 生成一条纯器乐 BGM 和一条环境音。
- 验证各自 Resource schema、模型 identity、时长、MP3、Task progress 和错误投影。

### 阶段四：收敛与交付

- 删除临时转换脚本、调试输出和旧的 music-only 解释分支。
- 按 hunk 审核，排除用户已有修改。
- 分类提交领域契约、Provider 实现、workflow assets 和 i18n/文档；任务完成后统一 push。

## 验证策略

自动化测试不作为默认完成条件，只在独立 oracle 存在时使用。计划执行：

1. JSON parse 和严格节点契约检查；source 与 runtime 资产均可读取。
2. `/object_info` 确认两个 profile 的节点、checkpoint 和 CLIP 可用。
3. 通过项目 adapter 提交短时纯器乐与环境音，验证 `/prompt`、queue、history、`/view` 和 MP3 MIME。
4. 通过真实 `create_audio`/Task handler 生成两种 WorkspaceResource，验证 resource kind、model key、provider、duration 和 terminal state。
5. 对一个 pending prompt 验证定向取消不影响其他 prompt；running cancellation 明确记录为未在 Provider 侧中断。
6. 运行 `npm.cmd run typecheck`、`check:no-media-provider-bypass`、`check:capability-catalog`、`check:pricing-catalog`、`check:model-config-contract` 和适用的 registry conformance suites。
7. 如 broad suite 暴露既有无关失败，单独报告，不为通过腐烂断言增加 fallback。

## 完成定义

本阶段只有同时满足以下条件才可称为“音频模块阶段完成”：

- 两类 item 都从唯一 `create_audio` 到达真实 ComfyUI 和唯一 terminal materializer。
- BGM 与环境音的 model、capability、schema、Prompt 和错误语义不混用。
- 两个源 workflow 已隔离复制，运行只使用仓库 API graph。
- external id 可恢复，pending 可定向取消，running 不使用全局 interrupt。
- Pure Music 成为未显式覆盖时的平台默认音乐模型；环境音有唯一默认 sound model。
- 没有第二个 audio route、第二个 writer、Prompt 重写旁路、自动 Provider fallback 或未声明双轨。
- 实际验证结果和仍未验证的长时、并发或部署盲区被如实列出。
