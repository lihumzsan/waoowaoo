# 音频执行判别契约修复设计

状态：已批准（方案 2）
日期：2026-08-14

## 1. 背景与问题

`create_audio` 是工作区资源生成的唯一公开音频入口，当前同时承载环境音效、提示词音乐和编曲方案音乐三种语义。公开输入已经通过 `audioKind` 区分三类音频，但规划器、重试冻结和 Worker 之间没有共享一份权威的判别式执行契约。

本次真实失败发生在环境音效路径：调用方提交了 `audioKind: sound`，公开契约也接受了该输入，但 `buildPlannedItem` 后续仍按“`mediaType === audio` 即编曲音乐”处理，将环境音效的生成选项交给 `musicScoreGenerationOptionsSchema` 解析。因此请求在任务提交前以 `INVALID_PARAMS` 失败，没有创建异步任务、音频资源或 ComfyUI 作业。

已确认的同根问题包括：

- 所有音频的 `prompt` 在规划阶段被统一清空，环境音效和提示词音乐丢失执行提示词。
- 只有视频保留顶层 `durationSeconds`，环境音效和提示词音乐可能在 Worker 侧失去必需时长。
- 新建和重试路径分别含有“所有音频都是 `music_score_v1`”的推断，形成重复状态解释。
- Worker 仍需从松散字段形状反推音频模式，不能只消费已冻结的明确执行语义。

## 2. 历史与复发分类

历史实现曾让环境音效通过 `create_audio` 传递 `audioKind`、提示词和时长。后续编曲方案音乐重构引入了只适用于 `composition_music` 的假设：音频提示词恒为空、音频选项恒为 `music_score_v1`、显式时长只属于视频。之后虽恢复了环境音效分支和 MOSS 的 `negativePrompt` 处理，但没有删除这些通用音频假设。

本次属于音频生产不变量 AP-08 的换形式复发：公开入口已按 `audioKind` 区分 provider 与能力，但规划、冻结和执行层仍各自解释音频模式。上一版修复覆盖了公开输入与部分 provider 分支，没有覆盖真实的通用规划器路径和重试路径。

| 历史症状 | 根因 | 已有修复 | 当前失效形式 | 本次防线 |
| --- | --- | --- | --- | --- |
| 环境音效无法作为一等音频能力执行 | 音频模态缺少明确分类 | `create_audio` 增加 `audioKind: sound` | 通用规划器仍把全部音频解析为编曲音乐 | 单一判别式冻结契约 |
| MOSS 负面提示词被改变 | 输入边界归一化过度 | 保留 `negativePrompt` 原始空白语义 | 提交前因错误 schema 解析而无法到达 provider | `sound` 分支原样冻结并校验其专属字段 |
| 编曲音乐获得专属时间线 | 编曲需要结构化 cue | 引入 `music_score_v1` 和时间线校验 | 专属解析扩散到所有音频 | 仅 `composition_music` 可持有 `music_score_v1` |

## 3. 目标

- 保留 `create_audio` 作为唯一公开执行入口，不增加第二个 operation、route 或 Worker。
- 由一个权威 resolver 把公开音频输入解析为穷尽、互斥、可冻结的执行模式。
- 新建规划、任务重试和 Worker 执行共同消费同一份判别式契约，不再依据 `mediaType` 或字段存在性猜测音频类别。
- 环境音效精确保留 `prompt`、`durationSeconds` 和 `negativePrompt`；提示词音乐精确保留 `prompt` 与 `durationSeconds`；编曲音乐继续使用现有 cue 时间线。
- 能力缺失或模式字段冲突时在规划边界明确失败，不允许默认、降级或跨模式补字段。

## 4. 非目标与禁止范围

- 不改变数据库 schema，不执行 migration、回填或数据清理。
- 不新增或恢复任何外部音频 provider；音乐、环境音效、TTS 和配音仍只走本机 ComfyUI 的既有 registry 与统一执行入口。
- 不修改 ComfyUI 工作流图、模型配置、资源目录语义或公开工具名称。
- 不把音乐、环境音效、TTS、配音合并成模糊的通用音频能力。
- 不在 Worker 中读取当前项目默认值来修补旧任务，也不建立兼容解析分支。
- 不以真实生成 MP3 作为本阶段自动执行项；该验证会写入任务、资源和外部运行时，需另行获得数据写入授权。

## 5. 方案比较与决策

### 方案 1：局部条件修补

在现有 `mediaType === audio` 分支中增加 `audioKind !== sound` 等条件。改动较小，但新建、重试和 Worker 仍各自解释模式，下一种音频实例仍可能漏接。

### 方案 2：共享判别式音频执行契约（采用）

建立唯一 resolver，将公开输入一次性解析为 `sound`、`prompt_music` 或 `composition_music`。规划器冻结结果，重试复用同一解析边界，Worker 只按判别字段执行。该方案删除重复推断，同时保留单一公开入口和单一任务生命周期。

### 方案 3：拆分多个公开 operation

为环境音效和不同音乐形态建立独立 operation。虽然边界直观，但会产生多个同义音频执行入口，违背本仓库单入口与 registry 收敛原则。

决策：采用方案 2。

## 6. 权威执行契约

新增 `src/lib/workspace-resource/audio-execution-contract.ts`，定义并导出唯一的判别式冻结类型及 resolver。概念结构如下：

```ts
type FrozenAudioExecution =
  | {
      mode: 'sound'
      prompt: string
      durationSeconds: number
      generationOptions: SoundGenerationOptions
    }
  | {
      mode: 'prompt_music'
      prompt: string
      durationSeconds: number
      generationOptions: PromptMusicGenerationOptions
    }
  | {
      mode: 'composition_music'
      prompt: null
      durationSeconds: null
      generationOptions: MusicScoreGenerationOptions
    }
```

最终字段名可在实施时与现有共享类型对齐，但必须保持以下不变量：

- `mode` 是规划、持久冻结、重试和执行阶段唯一的音频语义判别字段。
- `sound` 必须有非空提示词、显式时长和环境音效专属选项；禁止参考音频、编曲 cue 和音乐专属字段。
- `prompt_music` 必须有非空提示词和显式时长；禁止编曲 cue。
- `composition_music` 的提示词和顶层显式时长必须为空；时长由完整、无重叠、精确覆盖目标范围的 cue 时间线决定。
- 只有 `composition_music` 可以解析或持有 `music_score_v1`。
- resolver 只使用已验证的公开输入和既有 provider capability，不从输出、模型名称、字段偶然存在性或当前配置反推模式。

该模块是音频执行语义的唯一 owner 和唯一 projector。`create_audio` 仍是动作的唯一执行入口；任务、资源和 operation execution 的 writer 数量不变。

## 7. 数据流

### 7.1 新建任务

1. `create_audio` 的公开 schema 校验公共字段及 `audioKind`。
2. 规划器调用共享 resolver，将条目解析为 `FrozenAudioExecution`。
3. resolver 完成该模式全部必需字段、禁止字段和 capability 校验；失败时原地返回明确参数或能力错误。
4. 规划器把判别式结果写入现有冻结 payload，不再为音频重建另一份松散字段集合。
5. 现有异步提交入口在全部前置校验完成后创建任务并提交 Worker。

### 7.2 重试

1. 重试读取原任务的冻结执行输入。
2. 通过同一判别式 schema 解析冻结数据并保持原 `mode`，不得重新读取当前模型默认值或根据 `mediaType` 推断。
3. 原模式字段不完整或互相冲突时明确拒绝重试，不自动转成编曲音乐或其他模式。
4. 通过校验后继续使用现有幂等身份和任务生命周期，不新增重试 writer。

### 7.3 Worker

1. `workspace-resource-audio` handler 在入口处解析 `FrozenAudioExecution`。
2. 使用穷尽 `switch (mode)` 选择既有 provider 执行分支。
3. `sound` 直接使用冻结的提示词、时长和负面提示词；`prompt_music` 使用冻结的提示词和时长；`composition_music` 使用冻结 cue 时间线。
4. handler 不再通过 `safeParse(music_score_v1)`、字段存在性或默认值猜测模式。
5. 成功、失败、取消与资源持久化继续复用现有任务和工作区资源权威入口。

## 8. 契约与校验调整

`src/lib/workspace-resource/generation-contract.ts` 保留公开输入职责，并强化三种模式的互斥性：

- 环境音效：要求 `audioKind: sound`、非空 `prompt`、合法 `durationSeconds` 和 MP3 输出语义；拒绝参考音频和所有音乐专属字段。
- 提示词音乐：要求音乐 kind、非空 `prompt` 和合法 `durationSeconds`；拒绝 `compositionPlan` 与 cue 时间线。
- 编曲音乐：要求 `compositionPlan`，拒绝公开提示词和顶层显式时长；每个 cue 必须包含现有的时间线字段并通过完整覆盖校验。

公开 schema 不接受内部冻结字段。内部 `mode` 和 `music_score_v1` 只由 resolver 生成，避免调用方通过重试补写内部字段绕过权威解析。

## 9. 错误处理

- 模式字段冲突：返回确定性的 `OPERATION_INPUT_INVALID`，指出冲突字段所属模式。
- provider capability 缺失：在创建持久记录或提交异步任务前失败，不降级到其他音频模式或 provider。
- 冻结 payload 不符合判别式契约：重试或 Worker 原地失败，保留现有任务错误生命周期，不猜测修复。
- 编曲时间线不完整、重叠或越界：继续使用现有权威时间线校验，不影响环境音效与提示词音乐。
- provider 执行失败：继续由现有异步任务生命周期处理尝试失败、重试和最终失败，本设计不引入第二状态机。

## 10. 文件边界

计划中的生产文件范围：

- `src/lib/workspace-resource/audio-execution-contract.ts`：新增唯一判别式类型、schema 和 resolver。
- `src/lib/operations/domains/workspace-resource/generation-ops.ts`：删除“所有 audio 都是编曲音乐”的规划与重试分支，改为消费 resolver。
- `src/lib/workspace-resource/generation-contract.ts`：强化公开三模式互斥校验，不暴露内部冻结字段。
- `src/lib/task/execution/handlers/workspace-resource-audio.ts`：只按已冻结 `mode` 穷尽执行，删除字段形状猜测。
- `docs/architecture/modules/audio-production.md`：仅在“踩过的坑”增加一行复发原因；AP-08 不变量本身不变。

若实施调查发现必须修改其他生产文件，须先说明它属于哪个既有模块、为何上述权威入口无法承载，再扩展范围。

## 11. 所有权与入口变化

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 公开音频执行入口 | 1（`create_audio`） | 1（不变） |
| 异步任务提交入口 | 1 | 1（不变） |
| 任务/资源持久 writer | 各 1 | 各 1（不变） |
| 音频模式权威 resolver | 0 | 1 |
| 竞争的模式解释位置 | 规划、新建重建、重试、Worker 多处 | 1 个 resolver，消费者只穷尽分派 |
| 音频生命周期状态机 | 1 | 1（不变） |

必须删除的旧逻辑：

- `mediaType === 'audio'` 即清空提示词的通用分支。
- 所有音频统一解析 `musicScoreGenerationOptionsSchema` 的新建和重试分支。
- 仅视频保留显式时长而导致环境音效/提示词音乐丢失时长的分支。
- Worker 依据松散字段形状猜测音频模式的逻辑。

实施后不允许残留临时双轨或兼容分支。

## 12. 验证设计

验证优先使用真实规划入口、类型检查和现有 registry/conformance oracle，不为调用次数或当前对象形状机械新增测试。

### 必须验证

- 用真实 `planOperation` 提交 `audioKind: sound`：计划结果保留完全一致的 `prompt`、`durationSeconds` 和 `negativePrompt`，且不含 `music_score_v1`、编曲 cue 或音乐专属字段。
- 环境音效重试：冻结输入保持 `mode: sound`，不读取当前默认模型，不转换为音乐。
- 提示词音乐规划：结果为 `prompt_music`，保留提示词和时长，不进入编曲 schema。
- 编曲音乐规划与重试：仍生成并验证 `music_score_v1`，cue 时间线规则不回退。
- 冲突输入：每种跨模式字段组合在持久化和任务提交前明确失败。
- Worker 的三分支为类型穷尽；新增 mode 时编译失败，避免静默漏接。
- 运行受影响文件的 typecheck、现有 workspace-resource operation conformance 和 MOSS SoundEffect contract 验证。
- 修复后再次运行真实只读环境音效规划，确认原始 `INVALID_PARAMS` 不再出现。

### 有条件验证

在用户另行授权写入真实任务、资源和 ComfyUI 运行状态后，提交一条短环境音效作业，验证队列完成、history 成功和持久化 MP3 可读。未获得该授权前，交付必须把此项列为未验证盲区，不能声称端到端生成已通过。

## 13. 架构文档影响

本设计不新增、不删除 AP-08，也不改变 `create_audio`、provider registry、任务生命周期或资源持久化的权威归属，因此不修改架构不变量正文。实施时只在 `audio-production.md` 的“踩过的坑”记录：此前修复覆盖了公开 `audioKind` 和 provider 分支，却遗漏通用规划器、冻结重建与重试中的“全部 audio 等于编曲音乐”假设；本次通过唯一判别式 resolver 删除该竞争解释源。

## 14. 完成标准

本阶段的设计完成标准是本文经过用户书面评审。后续实现完成必须满足：

- 三种音频模式只由一个 resolver 判定并冻结。
- 新建、重试和 Worker 不再自行猜测模式。
- 所列旧通用分支全部删除，没有残余双轨。
- 环境音效真实只读规划通过，提示词、时长和负面提示词精确保留。
- 编曲音乐原有时间线不变量仍成立。
- 实际验证命令、结果和真实 ComfyUI 写入盲区在交付中明确列出。
