# MOSS 环境音效一等能力接入设计

## 状态与结论

本设计已由用户分两段确认：

1. 环境音效作为独立 `sound` 模态，与 `music` 配乐和 `voice` 配音并存。
2. 继续复用唯一公开入口 `create_audio`，通过显式 `audioKind` 决定模型、参数、计费和资源语义。

本设计取代 `2026-08-09-comfyui-audio-module-design.md` 的环境音部分。旧设计中的 Stable Audio
纯音乐接入、默认音乐模型切换及双工作流交付均不属于本任务。

## 已验证事实

源工作流为 `D:\workspace\comfui\workflows\音效生成.json`。它包含四个 UI 节点：

- `CR Prompt Text`
- `MOSS_SoundEffectV2Loader`
- `MOSS_SoundEffectV2Generate`
- `SaveAudioMP3`

当前 8878 ComfyUI 运行时已验证：

- 两个 MOSS 节点均存在于 `/object_info`。
- 本地模型 `MOSS-SoundEffect-v2.0` 已完整安装，模型索引声明 48 kHz、最长 30 秒。
- 中文 Prompt “雷声隆隆，雨声淅沥。”经 `/prompt` 成功提交。
- 首次模型加载约 74 秒；缓存后 5 秒、50 步样本约 20 秒完成。
- `/api/jobs/{promptId}` 返回明确 `completed`、音频 output 和 output node identity。
- `/view` 返回 5.000 秒、48 kHz、单声道 `audio/mpeg`。
- 当前 `SaveAudioMP3` 被 ComfyUI 标记为 deprecated，但仍是源工作流中可执行的唯一 MP3 output；
  本阶段以严格 preflight 使用它，不建立猜测性替代节点或 fallback。

以上证明 workflow、节点、模型、提交、轮询与下载可以工作；尚未证明 Waoowaoo 的
`create_audio -> Task -> WorkspaceResource` 终态闭环。

## 目标

1. 增加一等 `sound` Provider 模态和项目级 `soundModel`。
2. 让 `create_audio` 可显式生产 `music` 或 `sound`，不新增第二个音频执行入口。
3. 将 MOSS-SoundEffect v2 注册为精确的 ComfyUI sound model。
4. 复用现有 Provider submission fence、异步任务、音频 artifact 和 terminal materializer。
5. 从真实 `create_audio` 入口完成一次中文环境音生成并验证持久终态。
6. 保持现有 BGM 路径、`musicModel` 和音乐 Provider 行为不变。

## 非目标与禁止范围

- 不接入或替换任何 BGM/纯音乐模型。
- 不实现 TTS、配音、音色克隆、歌曲、人声或歌词。
- 不实现参考音频、参考视频、视频驱动音效、自动 Foley 分层或自动混音。
- 不自动把音效挂到视频，也不在音频终态后触发其他任务。
- 不新增 `create_sound` route、专用队列、第二个 worker、第二个 Task 状态机或第二个 Resource writer。
- 不从 Prompt、文件名、模型名或输出内容猜测 `audioKind`。
- 不在任务中自动下载 11 GB 模型，不自动切换 Provider，不维护旧 payload 双轨。
- 不执行 Prisma migration、回填或数据库清理；创建 migration 文件属于实现，应用 migration 需要
  对明确命名数据库的额外授权。
- 不修改用户的 `D:\workspace\comfui\workflows\音效生成.json` 或 ComfyUI 插件代码。
- 本任务没有并行写任务；核心音频契约和 `create_audio` 始终只有一个 owner。

## 方案与选择

### 采用：一等 `sound` 模态，共用 `create_audio`

新增 `sound` registry 模态、`soundModel` 和 sound adapter；`create_audio` item 使用判别联合。
这使模型选择、能力、计费、失败和资源 schema 都由显式事实决定，同时保留一个执行与持久化入口。

### 拒绝：只增加 Provider 私有调用

仅增加 MOSS adapter 无法让项目配置、Agent、Operation 和 Task 到达真实执行路径，只能形成候选代码，
不满足用户可用性。

### 拒绝：把 MOSS 注册为 `music`

该做法会让环境音占用 `musicModel`、接受音乐字段、写成 BGM 并污染报价与恢复语义，违反模态边界。

## 权威入口与数量变化

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 公开音频生产入口 | 1 个 `create_audio` | 1 个 `create_audio` |
| 音频 Task type/handler | 1 个 music-only | 1 个按冻结 `audioKind` 穷尽分派 |
| 音频 terminal writer | 1 个 | 1 个 |
| 音频种类解释者 | audio 隐式等同 music | 1 个共享 `AudioGenerationKind` |
| 模型配置 writer | `musicModel` 的配置 service | 同一 service 分别写 `musicModel`、`soundModel` |
| Provider 模态 | music、voice | music、sound、voice |
| ComfyUI sound profile | 0 | 1 个 MOSS profile |
| workflow 猜测器/fallback | 0 | 0 |

`AudioGenerationKind` 是音频种类唯一裁判；Task payload、retry、handler、billing 和 materializer 只消费
同一个冻结值，不再各自把 `mediaType: audio` 解释成 music。

## 状态与实体所有权

| 事实 | Canonical identity / scope | 唯一 owner / writer | 消费者或 projector |
| --- | --- | --- | --- |
| 音频种类 | `audioKind: music | sound` / generation item | generation contract / Planner 冻结 | handler、billing、schema projector |
| sound 模型选择 | `soundModel` / user + project | config service | production context、Planner |
| Provider invocation | task + invocation key | provider invocation ledger | ai-exec、retry/cancel |
| ComfyUI job | `COMFYUI:SOUND:<promptId>` | ComfyUI adapter 提交一次 | async provider poll/cancel |
| 音频 Resource | `resourceId` / project | WorkspaceResource persistence + terminal materializer | Resource View、后续显式操作 |
| Task 终态与 FailureRecord | `taskId` | Task Terminal Service | Resource View、UI、Assistant |
| 音频对象 | task artifact storage key | audio handler 上传一次 | terminal materializer、下载 View |

ComfyUI output、Task result 和 UI progress 都不是第二份领域状态；它们分别是 Provider 事实、终态交接输入
和 View。

## 领域与公开契约

### 模态和配置

- `UnifiedModelType`、Provider adapter 和 ai-exec media modality 增加 `sound`。
- 默认模型契约增加 `soundModel`；`musicModel` 保持原值与原语义。
- Project/UserPreference 的 `soundModel` 只由现有配置 service 写入。
- 生产上下文增加独立 `productionCapabilities.sound`，缺失时为 `null`，Agent 必须停止而不是改用音乐。
- 自托管 MOSS capability 与 pricing 由生产 registry 声明；初始价格为明确 0 credits。

### `create_audio` 判别联合

`audio_generation_batch` 升级为新 schema version；新提交不接受缺少 `audioKind` 的旧形状，也不建立
兼容解析器。已有持久 JSON 仍是历史 Resource 内容，不被回写或迁移。

音乐 item：

- `audioKind: 'music'`
- `schemaId: 'project.bgm_audio'`
- 保留现有音乐 Prompt、时长、vocal mode、genre、mood、bpm 和已声明引用能力。

音效 item：

- `mediaType: 'audio'`
- `audioKind: 'sound'`
- `schemaId: 'project.sound_effect_audio'`
- `name`、`folderPath` 和完整 provider-ready `prompt`
- 1–30 秒整数 `durationSeconds`
- 可选 `negativePrompt`
- 本阶段不接受 reference、`vocalMode`、genre、mood、bpm、歌词或视频时间线字段。

同一 `create_audio` batch 可以混合 music 和 sound；每个成员在 Plan 时独立选择精确模型、能力和报价，
整个批次仍按现有事务一次冻结完整成员集。retry 读取原 Resource/Task 的 `audioKind`，调用方不能改变
种类、模型、路径或身份。

### Prompt 所有权

- Agent/专业结果拥有完整最终正向 Prompt 和可选负向 Prompt。
- Planner 只严格验证并逐字冻结。
- handler 和 adapter 不翻译、不追加“不要音乐/不要人声”、不拼时长文案。
- MOSS 节点自身的 `append_duration_suffix=true` 是 profile wire option，不改变冻结领域 Prompt。
- 音频专业结果继续使用唯一 `audio_generation_batch` outputKind；现有 `music-direction` Skill 按其既有
  音频说明职责补充 sound item 规则，不新增第二个同义 outputKind。

## ComfyUI MOSS Profile

仓库保存两个隔离资产：

```text
src/lib/ai-providers/comfyui/workflows/moss-soundeffect-v2/
├─ source/sound-effect.ui.json
└─ runtime/sound-effect.api.json
```

- source 是用户文件的审计副本，不参与运行时自动转换。
- runtime 是手工审计的三节点 API graph：Loader -> Generate -> SaveAudioMP3。
- `CR Prompt Text` 属于 UI 编辑辅助，不进入 runtime graph；Prompt 直接注入 Generate。
- runtime 固定当前已验证 profile：50 steps、CFG 4、sigma shift 5、MP3 V0、
  `append_duration_suffix=true`、`preview=false`。
- Loader 固定 `auto_download=false`、`local_files_only=true`、`device=auto`、`dtype=auto`、
  `weight_quantization=auto`、`disable_torch_compile=true`。
- seed 由本次 invocation 的 prompt id 稳定派生；同一 external id 恢复不产生新 seed。
- profile 声明并严格校验 Loader、Generate、SaveAudioMP3 类、连接、模型 option 和唯一 output node。
- `SaveAudioMP3` 将来消失时 preflight 明确失败；本阶段不猜测替代 node。

模型 identity 为 `comfyui::moss-soundeffect-v2`，表示产品 workflow profile，不暴露 UI node id 或
checkpoint 路径。

## 执行数据流

```text
Agent / API
  -> create_audio(audioKind='sound', final prompt, duration)
  -> Plan: discriminated schema + sound capability + price + placement + exact soundModel
  -> one transaction: Resource reservation + Task + billing authorization + frozen member
  -> workspace-resource-audio handler
  -> generateSound through ai-exec and provider invocation fence
  -> ComfyUI MOSS profile -> POST /prompt once
  -> COMFYUI:SOUND:<promptId>
  -> /api/jobs/<promptId> -> /view
  -> bounded audio bytes -> task artifact object
  -> Task Terminal Service + WorkspaceResource materializer
  -> project.sound_effect_audio Resource ready
```

`create_audio` 不自动调用混音、视频或后续任务。

## 异步生命周期、失败与恢复

| 场景 | 权威处理 |
| --- | --- |
| 正常 | preflight 后 POST 一次；同 external id 轮询到 completed；下载并交给唯一 terminal writer |
| 明确拒绝 | `/prompt` 明确 validation 400 映射 typed rejected，不创建 external id |
| 提交断连/超时 | 用同一 prompt id 查询 `/api/jobs`；能证明存在则恢复，否则 `outcome_unknown`，不重提 |
| 排队/执行中 | `/api/jobs` 的 pending/in_progress 是唯一运行投影，不用 timer 猜状态 |
| Provider 失败 | 保存原生 execution error 并生成完整 FailureRecord |
| 未知状态/畸形结果 | 原地失败，不映射为 completed |
| 输出缺失 | 只接受 profile output node 的 audio；缺失或多义结果失败 |
| 下载异常 | `/view` 必须 200、`audio/mpeg`、不超过 100 MB；否则失败 |
| 用户取消 | 本地 terminal 先提交 canceled；随后按 ledger external id 尽力调用 Provider cancel |
| queue timeout | 先持久化旧 external id 作废/replay-authorized，再取消旧 job，下一 attempt 才可重提 |
| Activity retry/进程重启 | 从 ledger 读取同 external id 继续 poll，不再次 POST |
| duplicate/replay | provider fence 与 terminal receipt 返回同一事实，不创建第二 Resource/扣费 |
| 晚到 completed | 已提交 canceled/failed 终态不重开；补偿不改写本地事实 |
| batch 部分失败 | 只允许现有失败成员 retry，成功成员和 identity 不变 |
| 刷新/断线 | 正式 Resource/Task View 从持久事实恢复；通知只优化延迟 |
| 并发 | 服从现有 capacity/Temporal；ComfyUI queue 不成为第二个业务 attempt owner |

Adapter 不按错误文案、HTTP 5xx 或超时猜测“未受理”。无明确证据时保持 outcome unknown。

## 事务、幂等与崩溃结果

- Plan 前完成 schema、模型、capability、pricing、路径和 Provider 本地 preflight。
- `create_audio` commit 继续在一个事务内预留全部成员 Resource、Task、计费授权和冻结 payload。
- logical invocation key 对 sound 使用独立固定 identity；Provider fence 是唯一提交权 owner。
- `/prompt` 成功后先持久化 external id，再进入可恢复 poll。
- 音频 bytes 以 task artifact key 幂等上传；terminal materializer 在一个事务内提交 Task、Billing、
  Resource version、Lineage 和 Resource ready。
- 在上传后、终态前崩溃会留下可重放的同 key artifact，不产生第二 Resource。
- cancel 补偿失败只记录诊断，不复活 Task、不改 Billing、不阻塞 cancellation receipt。

## UI、i18n 与迁移

- 项目与个人默认模型 UI 增加独立“环境音效模型”卡片/字段。
- 所有用户可见标签、进度阶段和错误补齐中文与英文 locale；不硬编码固定语言。
- API config catalog 只展示 registry 声明的 sound model。
- Prisma 增加 `soundModel` 持久字段及 migration 文件，但本任务不执行 migration。
- 在未获指定本地数据库 migration 授权前，真实项目配置闭环属于明确盲区；不得用临时 env、
  `musicModel` 或 JSON 私有字段绕过。

## H3 Reference Implementation 对齐

选择当前 `comfyui::minimax-h3-fast` 作为 Provider/异步协议最近参照物，因为它已验证同一 ComfyUI
配置、preflight、submission fence、`/api/jobs`、cancel、bounded download 和 registry 接线。
Workspace 音频持久化则复用现有 music handler/materializer。

| 参照物触点 | MOSS sound 覆盖 / 不适用原因 | 验证 |
| --- | --- | --- |
| provider/model identity | registry 声明精确 `comfyui::moss-soundeffect-v2` | catalog check |
| project default | 新增独立 `soundModel`，不改 `musicModel` | config contract |
| capability | sound 声明 1–30 秒、MP3、无 references | registry conformance |
| workflow profile | source/runtime 隔离，三节点严格 graph | JSON + contract inspection |
| node/model preflight | 精确 object_info 和本地 model option | live 8878 |
| option normalization | prompt、negativePrompt、duration 只规范化一次 | planner/adapter inspection |
| submission fence | `/prompt` 每 logical invocation 最多一次 | provider invocation evidence |
| external id | `COMFYUI:SOUND:<promptId>` 严格 parse/format | async registry conformance |
| poll/recovery | `/api/jobs` 同 id 恢复 | live completed job + retry inspection |
| cancel | 复用 ComfyUI job cancel，晚到不改本地终态 | cancellation inspection/smoke |
| failure | 原生 response + typed FailureRecord | focused failure evidence |
| output parse | 只读声明 output node 的 audio | live job output |
| bounded download | `/view`、MIME、redirect policy、100 MB | live MP3 + boundary inspection |
| persistence | 复用 artifact upload 和 terminal materializer | real create_audio E2E |
| permission | 复用 project auth、Plan、Resource owner | existing operation boundary |
| i18n | sound config/progress/error 中英文 | locale checks |
| pricing | 自托管零价格由 catalog 明确声明 | pricing check |

## 历史回归矩阵

| 历史症状 | 根因 | 当时修法及不足 | 当前防线 |
| --- | --- | --- | --- |
| 2026-07 环境音有独立 route、queue、worker、UI 状态和清理链 | 同一音频动作建立第二执行与状态入口 | 功能很多但真实 ComfyUI 不可达，测试主要自证私有链 | 只扩展 `create_audio` 判别联合，复用 Task/terminal；禁止恢复旧专用链 |
| 2026-08 Stable Audio 环境 profile 报 node 79 缺失 | graph 使用 99/100，profile 硬编码 79/76，输出连接也不一致 | 只有代码/graph 候选，无 live 闭环 | 直接学习当前 MOSS graph；source/runtime 隔离；live object_info、submit、job、view 已验证 |
| audio 在 Planner/handler/billing 中一律映射 music | `mediaType` 被当成业务种类 | 旧设计提出 sound，但未落地 | `AudioGenerationKind` 成为唯一裁判，旧 music-only 分支一次性删除 |
| 只验证进程或 graph parse 就宣称能力可用 | 未走真实终态入口 | 缺少 Task/Resource/存储证据 | 完成定义要求真实 `create_audio` 到 Resource ready；否则只称实现完成 |

长期结论将在实现阶段收敛到 `audio-production` 模块不变量；本表不扩散为永久事故库。

## 架构契约变化与删除项

实施时在 `docs/architecture/modules/audio-production.md` 增加一条长期不变量：音频业务种类必须由共享
判别联合显式声明；music 与 sound 分别解析模型、能力、字段、报价和 Resource schema，禁止从媒体类型、
Prompt、文件名或模型名推断。

需要删除或替换：

- 所有 `mediaType === 'audio' ? 'music'` 的生产分支。
- audio task payload 只允许 `musicModel` 的单轨解释。
- `create_audio` 默认 schema 永远为 BGM 的假设。
- production context 只有 music、缺 sound 的能力投影。
- async engine 只等待 music/voice、不等待 sound 的分支。

不保留兼容 payload、fallback 或第二种状态解释。Provider Gateway、WorkspaceResource 和 Task terminal
的 owner 不改变，只新增穷尽 registry 实例。

## 实施阶段

### 阶段一：一次性领域契约切换

- 增加 `sound` 模态、`AudioGenerationKind`、sound capability/pricing 和 `soundModel` 契约。
- 将 `create_audio` item、PlanSnapshot、Task payload、retry、billing 和 handler 改为穷尽 `audioKind`。
- 新增 sound Resource schema、production context、配置 UI 和 i18n。
- 创建但不执行 Prisma migration。
- 删除 music-only audio 解释，不允许临时双轨进入下一阶段。

### 阶段二：MOSS Provider 实例

- 复制源 workflow，提交手工审计 runtime graph。
- 增加 profile、adapter、async poll/cancel、output parser 和 bounded download。
- 注册 MOSS sound model、capability、pricing 和 API config 展示。
- 通过 live 8878 完成 provider 级中文生成。

### 阶段三：真实终态闭环

- 获得对明确本地开发数据库执行 migration 的额外授权后，配置项目 `soundModel`。
- 从真实 `create_audio` 提交 sound item，等待 Temporal terminal。
- 验证 Task、Resource、storage、schema、duration、provider/model provenance 与 BGM 路径无回归。
- 若未获 migration 授权，阶段三保持未完成，不使用旁路伪造证据。

## 验证方式与完成定义

计划执行：

1. `npm.cmd run typecheck` 和受影响文件静态检查。
2. 现有 capability、pricing、model config、operation registry conformance checks。
3. 只在独立 oracle 存在时补充 registry/profile conformance；不写 mock 自证测试。
4. Live `/object_info` 检查节点和模型。
5. 通过项目 sound adapter 提交中文 5 秒任务，轮询 `/api/jobs` 并从 `/view` 下载。
6. 验证 MP3 MIME、精确时长、48 kHz、大小上限和非空音频。
7. 经真实 `create_audio`/Temporal/MinIO/MySQL 验证 `project.sound_effect_audio` Resource ready。
8. 验证 `musicModel`、既有 BGM item 和 music handler 行为未改变。

只有同时满足以下条件才称为阶段完成：

- sound 从唯一 `create_audio` 到达真实 ComfyUI 和唯一 terminal materializer。
- music 与 sound 的模型、capability、字段、报价、schema 和失败语义没有混用。
- external id 可恢复，取消不改写已提交终态，未知提交结果不会自动重提。
- 没有第二 route/worker/writer、旧 payload 双轨、Prompt 重写或 Provider fallback。
- 实际验证结果与数据库 migration、长时、并发等盲区被如实列出。

在真实数据库迁移和终态闭环未验证前，只能表述为“实现完成”或“Provider 级闭环通过”，不能使用
“彻底、统一、不会复发”或“架构完成”。
