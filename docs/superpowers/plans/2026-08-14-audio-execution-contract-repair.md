# Audio Execution Contract Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `create_audio` 的环境音效、提示词音乐和编曲方案音乐通过同一份持久化判别契约完成规划、重试和 Worker 执行，彻底删除“所有 audio 都是编曲音乐”的重复推断。

**Architecture:** 保留一个 `create_audio`、一个异步任务入口和现有资源 writer；新增 `audio-execution-contract.ts` 作为音频执行模式的唯一 resolver。冻结 payload 只新增 `audioExecutionMode` 判别字段，继续复用既有 `resource.prompt`、`durationSeconds` 和 `generationOptions` 事实，避免再存一份嵌套副本；规划器、重试和 Worker 都通过 `parseFrozenAudioExecution` 获得穷尽 union。

**Tech Stack:** TypeScript 5、Zod 4、Next.js、Prisma、Temporal、Vitest、PowerShell/npm.cmd。

## Global Constraints

- Node.js 必须为 `>=22`，npm 必须为 `>=9.0.0`，不新增依赖。
- 禁止 `any`；边界输入使用 `unknown`、Zod 和显式解析。
- `create_audio` 仍是唯一公开音频执行入口；不得新增 operation、route、Worker、writer、状态机或 provider fallback。
- 音乐、环境音效、TTS 和配音保持独立模态；本计划只修改 `create_audio` 下的环境音效与音乐执行判别。
- 不改变数据库 schema，不创建或执行 migration，不回填或清理数据。
- 不修改 ComfyUI 工作流图、模型配置、资源目录语义、公开工具名称或 provider registry。
- 不兼容解析缺少 `audioExecutionMode` 的旧音频任务；实施前必须确认没有 queued、processing、failed 或 canceled 的旧 `workspace_resource_audio` 任务。
- 能力或冻结契约不完整时原地失败；禁止默认、降级、字段形状猜测或从当前项目配置重建旧任务。
- 自动化验证只使用判别契约这一独立 oracle、现有 registry/conformance 和 provider 协议测试；不得 mock 自己的 planner、Worker、数据库或队列后自证调用次数。
- 未获得用户单独授权前，不提交真实音频任务，不创建资源，不调用 ComfyUI `/prompt` 生成 MP3。

---

## File Structure

| 文件 | 职责 |
| --- | --- |
| `src/lib/workspace-resource/audio-execution-contract.ts` | 唯一音频模式 resolver、判别式冻结 schema、模式专属生成选项 schema |
| `src/lib/workspace-resource/generation-request.ts` | `create_audio` 公开 item schema；拒绝调用方传入内部 mode，以及跨模式字段 |
| `src/lib/workspace-resource/generation-contract.ts` | 持久任务 envelope；要求音频 payload 携带 `audioExecutionMode` 并与既有冻结事实一致 |
| `src/lib/operations/domains/workspace-resource/generation-ops.ts` | 新建规划、input hash、重试冻结和 preflight 的唯一消费者 |
| `src/lib/task/execution/handlers/workspace-resource-audio.ts` | 按冻结 mode 穷尽执行现有 `generateSound`/`generateMusic` 分支 |
| `tests/contracts/workspace-resource-audio-execution-contract.test.ts` | 由批准设计提供 oracle 的三模式互斥与精确保真 conformance |
| `tests/contracts/comfyui-moss-soundeffect.contract.test.ts` | MOSS 环境音效冻结 payload 与负面提示词协议 |
| `tests/contracts/comfyui-ace-step-music.contract.test.ts` | ACE-Step 提示词音乐冻结 payload 协议 |
| `docs/architecture/modules/audio-production.md` | AP-08 的复发原因；不修改不变量正文 |

`generation-request.ts` 比批准设计中的初步文件表多一个触点，因为现场代码确认它才是公开 `create_audio` item schema 的权威 owner；`generation-contract.ts` 只拥有冻结任务 envelope。`task-materializer.ts` 不修改：它继续从 `resource.prompt` 与 `generationOptions` 写入现有 provenance。

---

### Task 1: 建立唯一冻结音频执行契约

**Files:**
- Create: `src/lib/workspace-resource/audio-execution-contract.ts`
- Create: `tests/contracts/workspace-resource-audio-execution-contract.test.ts`
- Modify: `src/lib/workspace-resource/generation-request.ts:100-154`
- Modify: `src/lib/workspace-resource/generation-contract.ts:87-176,178-261`
- Modify: `tests/contracts/comfyui-moss-soundeffect.contract.test.ts:81-152`
- Modify: `tests/contracts/comfyui-ace-step-music.contract.test.ts:186-237`

**Interfaces:**
- Consumes: `AudioGenerationItem`（从 `generation-request.ts` 导出的公开音频 item union）、`MusicScoreGenerationOptions`、`WorkspaceResourceJsonValue`。
- Produces: `AudioExecutionMode`、`FrozenAudioExecution`、`audioExecutionModeSchema`、`frozenAudioExecutionSchema`、`freezeAudioExecution(input)`、`parseFrozenAudioExecution(input)`。

- [ ] **Step 1: 运行旧音频任务只读闸门**

在 PowerShell 中运行：

```powershell
npx.cmd tsx --env-file=.env -e "import { prisma } from './src/lib/prisma'; void (async () => { const rows = await prisma.task.findMany({ where: { type: 'workspace_resource_audio', status: { in: ['queued', 'processing', 'failed', 'canceled'] } }, select: { id: true, status: true, targetId: true } }); console.log(JSON.stringify(rows, null, 2)); await prisma.`$disconnect(); })()"
```

Expected: 输出 `[]`。若存在任何记录，停止实施并报告这些 task identity；不得加入旧 payload 推断、自动迁移或兼容分支。

- [ ] **Step 2: 写判别契约的失败测试**

创建 `tests/contracts/workspace-resource-audio-execution-contract.test.ts`，至少包含以下 oracle：

```ts
import { describe, expect, it } from 'vitest'
import {
  freezeAudioExecution,
  parseFrozenAudioExecution,
} from '@/lib/workspace-resource/audio-execution-contract'
import {
  compositionPlanMusicGenerationItemSchema,
  promptMusicGenerationItemSchema,
  soundGenerationItemSchema,
} from '@/lib/workspace-resource/generation-request'

describe('frozen workspace audio execution contract', () => {
  it('freezes sound prompt, duration, and negative prompt without music score fields', () => {
    const item = soundGenerationItemSchema.parse({
      itemId: 'rain', name: 'Rain', mediaType: 'audio', audioKind: 'sound',
      schemaId: 'project.sound_effect_audio', prompt: 'Dense rain on a metal roof.',
      durationSeconds: 12, negativePrompt: 'music, speech', count: 1,
    })
    const frozen = freezeAudioExecution({
      item,
      generationOptions: { durationSeconds: 12, negativePrompt: 'music, speech', outputFormat: 'mp3' },
    })
    expect(frozen).toEqual({
      mode: 'sound', audioKind: 'sound', prompt: item.prompt, durationSeconds: 12,
      generationOptions: { durationSeconds: 12, negativePrompt: 'music, speech', outputFormat: 'mp3' },
    })
    expect(frozen.generationOptions).not.toHaveProperty('kind')
    expect(frozen.generationOptions).not.toHaveProperty('compositionPlan')
  })

  it('keeps prompt music distinct from composition music', () => {
    const item = promptMusicGenerationItemSchema.parse({
      itemId: 'pulse', name: 'Pulse', mediaType: 'audio', audioKind: 'music',
      schemaId: 'project.bgm_audio', prompt: 'A restrained metallic pulse.',
      durationSeconds: 26, vocalMode: 'instrumental', count: 1,
    })
    expect(freezeAudioExecution({
      item,
      generationOptions: { durationSeconds: 26, vocalMode: 'instrumental', outputFormat: 'mp3' },
    })).toMatchObject({ mode: 'prompt_music', prompt: item.prompt, durationSeconds: 26 })
  })

  it('accepts music_score_v1 only for composition music', () => {
    const compositionPlan = {
      chunks: [{
        text: 'Low drone.', durationMs: 6_000,
        positiveStyles: ['dark ambient'], negativeStyles: ['vocals'],
        contextAdherence: 'high' as const,
      }],
    }
    const item = compositionPlanMusicGenerationItemSchema.parse({
      itemId: 'score', name: 'Score', mediaType: 'audio', audioKind: 'music',
      schemaId: 'project.bgm_audio', compositionPlan, startMs: 0,
      fadeInMs: 0, fadeOutMs: 0, gainDb: 0,
      references: [{ resourceId: 'timeline', contentVersion: 1, role: 'score_timeline', channel: 'context' }],
      count: 1,
    })
    const frozen = freezeAudioExecution({
      item,
      generationOptions: {
        kind: 'music_score_v1', compositionPlan, startMs: 0, fadeInMs: 0,
        fadeOutMs: 0, gainDb: 0, timelineInputPosition: 0, outputFormat: 'mp3',
      },
    })
    expect(frozen).toMatchObject({ mode: 'composition_music', prompt: null, durationSeconds: null })
  })

  it('rejects a persisted mode that conflicts with audioKind or frozen fields', () => {
    expect(() => parseFrozenAudioExecution({
      audioExecutionMode: 'composition_music', audioKind: 'sound',
      prompt: 'Rain.', durationSeconds: 5,
      generationOptions: { durationSeconds: 5, outputFormat: 'mp3' },
    })).toThrow()
  })
})
```

- [ ] **Step 3: 运行测试，确认缺少权威模块而失败**

Run:

```powershell
npx.cmd vitest run tests/contracts/workspace-resource-audio-execution-contract.test.ts --exclude ".worktrees/**"
```

Expected: FAIL，原因是 `audio-execution-contract` 或其导出尚不存在。

- [ ] **Step 4: 实现判别式 contract 和公开输入互斥**

在 `generation-request.ts` 导出：

```ts
export type AudioGenerationItem = z.infer<typeof audioGenerationItemSchema>
```

从 `compositionPlanMusicGenerationItemSchema` 删除 `prompt: z.string().optional()`；严格 schema 随后拒绝编曲音乐携带 prompt、durationSeconds 或内部 `audioExecutionMode`。现有 prompt music 与 sound 严格 schema 继续分别拒绝 `compositionPlan`、引用和跨模式字段。

在新模块中锁定以下接口：

```ts
export const audioExecutionModeSchema = z.enum([
  'sound',
  'prompt_music',
  'composition_music',
])

export type AudioExecutionMode = z.infer<typeof audioExecutionModeSchema>

const providerPromptSchema = z.string().min(1).max(100_000)
  .refine((value) => value.trim().length > 0, 'prompt must contain non-whitespace content.')
const negativePromptSchema = z.string().max(100_000)
  .refine((value) => value.trim().length > 0, 'negativePrompt must contain non-whitespace content.')

export const soundGenerationOptionsSchema = z.object({
  durationSeconds: z.number().int().min(1).max(30),
  negativePrompt: negativePromptSchema.optional(),
  outputFormat: z.literal('mp3'),
}).strict()

export const promptMusicGenerationOptionsSchema = z.object({
  durationSeconds: z.number().int().min(1).max(600),
  providerDurationSeconds: z.number().int().min(1).max(600).optional(),
  negativePrompt: negativePromptSchema.optional(),
  vocalMode: z.enum(['instrumental', 'vocal']).optional(),
  genre: z.string().trim().min(1).max(200).optional(),
  mood: z.string().trim().min(1).max(200).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  keyScale: z.enum(MUSIC_KEY_SCALE_VALUES).optional(),
  timeSignature: z.enum(MUSIC_TIME_SIGNATURE_VALUES).optional(),
  outputFormat: z.enum(['mp3', 'wav']),
}).strict()

export type SoundGenerationOptions = z.infer<typeof soundGenerationOptionsSchema>
export type PromptMusicGenerationOptions = z.infer<typeof promptMusicGenerationOptionsSchema>

const soundAudioExecutionSchema = z.object({
  mode: z.literal('sound'), audioKind: z.literal('sound'), prompt: providerPromptSchema,
  durationSeconds: z.number().int().min(1).max(30),
  generationOptions: soundGenerationOptionsSchema,
}).strict().superRefine((execution, context) => {
  if (execution.durationSeconds !== execution.generationOptions.durationSeconds) {
    context.addIssue({ code: 'custom', path: ['durationSeconds'], message: 'Sound duration must match frozen generationOptions.' })
  }
})

const promptMusicAudioExecutionSchema = z.object({
  mode: z.literal('prompt_music'), audioKind: z.literal('music'), prompt: providerPromptSchema,
  durationSeconds: z.number().int().min(1).max(600),
  generationOptions: promptMusicGenerationOptionsSchema,
}).strict().superRefine((execution, context) => {
  if (execution.durationSeconds !== execution.generationOptions.durationSeconds) {
    context.addIssue({ code: 'custom', path: ['durationSeconds'], message: 'Prompt music duration must match frozen generationOptions.' })
  }
})

const compositionMusicAudioExecutionSchema = z.object({
  mode: z.literal('composition_music'), audioKind: z.literal('music'), prompt: z.null(),
  durationSeconds: z.null(), generationOptions: musicScoreGenerationOptionsSchema,
}).strict()

export const frozenAudioExecutionSchema = z.discriminatedUnion('mode', [
  soundAudioExecutionSchema,
  promptMusicAudioExecutionSchema,
  compositionMusicAudioExecutionSchema,
])

export type FrozenAudioExecution = z.infer<typeof frozenAudioExecutionSchema>

export function freezeAudioExecution(input: {
  readonly item: AudioGenerationItem
  readonly generationOptions: Readonly<Record<string, WorkspaceResourceJsonValue>>
}): FrozenAudioExecution

export function parseFrozenAudioExecution(input: {
  readonly audioExecutionMode: AudioExecutionMode | undefined
  readonly audioKind: 'music' | 'sound' | undefined
  readonly prompt: string | null
  readonly durationSeconds: number | undefined
  readonly generationOptions: Readonly<Record<string, WorkspaceResourceJsonValue>>
}): FrozenAudioExecution
```

`freezeAudioExecution` 只根据已通过公开 schema 的 item 判定一次 mode：`sound`；带 `compositionPlan` 的 music；其余 music。`parseFrozenAudioExecution` 只根据持久化 `audioExecutionMode` 进入 `z.discriminatedUnion`，不得从 `generationOptions.kind` 猜 mode。

- [ ] **Step 5: 把 mode 纳入冻结任务 envelope 并删除重复音频字段**

在 `workspaceResourceGenerationTaskPayloadSchema` 增加：

```ts
audioExecutionMode: audioExecutionModeSchema.optional(),
```

在 `superRefine` 中，音频 payload 必须用 `frozenAudioExecutionSchema.safeParse` 对以下事实联合校验：`audioExecutionMode` 映射为 `mode`，并联合 `resource.audioKind`、`resource.prompt`、`durationSeconds ?? null`、`generationOptions`；将失败 issues 转挂到对应 payload path。非音频 payload 携带 `audioExecutionMode` 必须失败。`parseFrozenAudioExecution` 使用同一个 schema 的 `.parse`，确保 envelope、retry 和 Worker 没有第二份规则。

删除 envelope 顶层重复的 `negativePrompt`、`vocalMode`、`genre`、`mood`、`bpm`、`keyScale`、`timeSignature`、`outputFormat` 字段及两个 parse 函数中的同名复制。它们的唯一冻结位置是 `generationOptions`。保留视频与显式时长音频共用的顶层 `durationSeconds`。

- [ ] **Step 6: 更新既有音频 payload fixture**

MOSS payload 加入 `audioExecutionMode: 'sound'`，把 `negativePrompt` 只放在：

```ts
generationOptions: {
  durationSeconds: 5,
  negativePrompt,
  outputFormat: 'mp3',
},
```

断言改为 `parseFrozenAudioExecution(...)` 返回的 `generationOptions.negativePrompt` 与输入逐字符一致。ACE-Step 提示词音乐 payload 加入 `audioExecutionMode: 'prompt_music'`；其他音乐参数只保留在 `generationOptions`。

- [ ] **Step 7: 运行 contract 与既有 payload 测试**

Run:

```powershell
npx.cmd vitest run tests/contracts/workspace-resource-audio-execution-contract.test.ts tests/contracts/comfyui-moss-soundeffect.contract.test.ts tests/contracts/comfyui-ace-step-music.contract.test.ts tests/contracts/vocal-performance-generation.contract.test.ts --exclude ".worktrees/**"
```

Expected: 四个测试文件全部 PASS；sound、prompt music、composition music 都只能通过各自的冻结 mode，视频 payload 仍禁止音频 mode。

- [ ] **Step 8: 提交 contract 边界**

```powershell
git add src/lib/workspace-resource/audio-execution-contract.ts src/lib/workspace-resource/generation-request.ts src/lib/workspace-resource/generation-contract.ts tests/contracts/workspace-resource-audio-execution-contract.test.ts tests/contracts/comfyui-moss-soundeffect.contract.test.ts tests/contracts/comfyui-ace-step-music.contract.test.ts
git commit -m "feat(audio): add canonical frozen execution contract"
```

---

### Task 2: 让新建规划和重试只消费统一 resolver

**Files:**
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts:669-824,826-915,933-945,979-1140,1340-1441`

**Interfaces:**
- Consumes: Task 1 的 `FrozenAudioExecution`、`freezeAudioExecution`、`parseFrozenAudioExecution`。
- Produces: 带 `audioExecutionMode` 的唯一冻结 task payload；新建和重试共用相同的音频事实与 input hash。

- [ ] **Step 1: 将 `compileMediaExecution` 返回值改为穷尽 union**

定义局部类型：

```ts
type CompiledMediaExecution =
  | {
      readonly kind: 'visual'
      readonly prompt: string
      readonly generationOptions: z.infer<typeof workspaceResourceGenerationOptionsSchema>
    }
  | {
      readonly kind: 'audio'
      readonly execution: FrozenAudioExecution
    }
```

音频 preflight 的 prompt 使用规则必须是：sound 与 prompt music 传入原始 `item.prompt`；composition music 不传 prompt。preflight 完成后，composition music 先构造现有 `music_score_v1`，其他音频使用冻结 scalar options，随后统一调用：

```ts
const execution = freezeAudioExecution({ item, generationOptions })
return { kind: 'audio', execution }
```

删除 `const prompt = item.mediaType === 'audio' ? null : item.prompt`。图片和视频继续返回 `{ kind: 'visual', prompt: item.prompt, generationOptions }`。

- [ ] **Step 2: 用 execution 构造新任务与 fingerprint**

`buildPlannedItem` 必须先从 compiled union 取得且只取得一次：

```ts
const audioExecution = compiled.kind === 'audio' ? compiled.execution : null
const prompt = audioExecution?.prompt ?? compiled.prompt
const generationOptions = audioExecution?.generationOptions ?? compiled.generationOptions
const durationSeconds = audioExecution?.durationSeconds
  ?? (item.mediaType === 'video' ? item.durationSeconds : undefined)
```

composition timeline 校验条件改为 `audioExecution?.mode === 'composition_music'`。`generationInputFingerprint` 输入类型新增 `audioExecutionMode?: AudioExecutionMode`，新建和重试 hash 都传入冻结 mode。

payload 构造必须包含：

```ts
...(audioExecution ? { audioExecutionMode: audioExecution.mode } : {}),
...(durationSeconds !== undefined ? { durationSeconds } : {}),
generationOptions,
```

删除从 `compiled.generationOptions` 再复制 `negativePrompt`、音乐参数和 `outputFormat` 到 envelope 顶层的全部分支。

- [ ] **Step 3: 收敛 retry 的冻结事实来源**

对 `mediaType === 'audio'`：

```ts
const audioExecution = parseFrozenAudioExecution({
  audioExecutionMode: source.audioExecutionMode,
  audioKind: source.resource.audioKind,
  prompt: source.resource.prompt,
  durationSeconds: source.durationSeconds,
  generationOptions: source.generationOptions,
})
```

音频 retry 的 `modelKey` 使用 `source.resource.modelKey`，并验证它与目标资源行的 `modelKey` 相同；prompt、duration、generationOptions 和 mode 全部来自 `audioExecution`。不得读取项目当前 defaults/overrides 来重建它们。

`preflightFrozenRetry` 接收 `audioExecution: FrozenAudioExecution | null`。只有 `mode === 'composition_music'` 时调用 `validateMusicCompositionCapability` 和 `validateFrozenMusicScoreTimeline`；sound 与 prompt music 将各自的 `generationOptions` 和显式时长送入现有 provider preflight。

重建 payload 时原样写入 `audioExecutionMode`，不复制已删除的顶层音频字段。

- [ ] **Step 4: 用静态检查确认旧通用推断已删除**

Run:

```powershell
rg -n "item\.mediaType === 'audio' \? null|mediaType === 'audio'\) musicScoreGenerationOptionsSchema|item\.mediaType === 'audio'\) \{|source\.(negativePrompt|vocalMode|genre|mood|bpm|keyScale|timeSignature|outputFormat)" src/lib/operations/domains/workspace-resource/generation-ops.ts
```

Expected: 无匹配。保留的 `musicScoreGenerationOptionsSchema` 只能位于明确的 `composition_music` 构造或校验分支。

- [ ] **Step 5: 运行类型检查和新 contract**

Run:

```powershell
npm.cmd run typecheck
npx.cmd vitest run tests/contracts/workspace-resource-audio-execution-contract.test.ts tests/contracts/workspace-resource-operation-conformance.test.ts --exclude ".worktrees/**"
```

Expected: typecheck PASS；两个 contract 文件 PASS。若 baseline 出现与本变更无关的失败，记录完整命令与错误，不修改生产代码迎合腐烂 fixture。

- [ ] **Step 6: 提交 planner/retry 收敛**

```powershell
git add src/lib/operations/domains/workspace-resource/generation-ops.ts
git commit -m "fix(audio): freeze planner and retry execution mode"
```

---

### Task 3: 让 Worker 按冻结 mode 穷尽执行

**Files:**
- Modify: `src/lib/task/execution/handlers/workspace-resource-audio.ts:1-160`

**Interfaces:**
- Consumes: Task 1 的 `parseFrozenAudioExecution` 与 `FrozenAudioExecution`。
- Produces: 对 `sound`、`prompt_music`、`composition_music` 穷尽且无猜测的 Worker 分派。

- [ ] **Step 1: 运行 fixture，确认冻结边界基线**

Run:

```powershell
npx.cmd vitest run tests/contracts/comfyui-moss-soundeffect.contract.test.ts tests/contracts/comfyui-ace-step-music.contract.test.ts tests/contracts/workspace-resource-audio-execution-contract.test.ts --exclude ".worktrees/**"
```

Expected: payload/contract 测试 PASS；这一步只证明协议 fixture 已对齐，不宣称 Worker 执行已验证。

- [ ] **Step 2: 用 `switch (execution.mode)` 替换 Worker 猜测**

handler 解析通用 payload 后立即调用：

```ts
const execution = parseFrozenAudioExecution({
  audioExecutionMode: payload.audioExecutionMode,
  audioKind: payload.resource.audioKind,
  prompt: payload.resource.prompt,
  durationSeconds: payload.durationSeconds,
  generationOptions: payload.generationOptions,
})
```

删除 `musicScoreGenerationOptionsSchema.safeParse`。分派语义固定为：

```ts
switch (execution.mode) {
  case 'sound':
    // generateSound(userId, model, execution.prompt, execution.generationOptions, ...)
    break
  case 'prompt_music':
    // generateMusic(userId, model, { kind: 'prompt', prompt: execution.prompt }, execution.generationOptions, ...)
    break
  case 'composition_music':
    // duration comes from compositionPlan; generateMusic receives { kind: 'composition_plan', compositionPlan }
    break
  default: {
    const exhaustive: never = execution
    throw new Error(`WORKSPACE_RESOURCE_AUDIO_EXECUTION_MODE_UNSUPPORTED:${String(exhaustive)}`)
  }
}
```

实际实现应抽出一个局部 `generated` 结果而不是复制 progress/persistence 链。短音乐裁剪只允许 `execution.mode === 'prompt_music' && providerDurationSeconds !== undefined`；composition music 与 sound 禁止进入该分支。进度文案、artifact key 和结果 model 字段继续按 `execution.audioKind` 使用既有值。

- [ ] **Step 3: 运行类型与 provider 协议验证**

Run:

```powershell
npm.cmd run typecheck
npx.cmd vitest run tests/contracts/workspace-resource-audio-execution-contract.test.ts tests/contracts/comfyui-moss-soundeffect.contract.test.ts tests/contracts/comfyui-ace-step-music.contract.test.ts tests/contracts/workspace-resource-operation-conformance.test.ts --exclude ".worktrees/**"
```

Expected: typecheck PASS，四个 contract 文件全部 PASS。新增第四种 `AudioExecutionMode` 时，handler 的 `never` 分支必须使 typecheck 失败，直至显式实现。

- [ ] **Step 4: 提交 Worker**

```powershell
git add src/lib/task/execution/handlers/workspace-resource-audio.ts
git commit -m "fix(audio): dispatch worker by frozen execution mode"
```

---

### Task 4: 记录复发防线并完成真实只读规划验证

**Files:**
- Modify: `docs/architecture/modules/audio-production.md:50-64`

**Interfaces:**
- Consumes: Tasks 1–3 的唯一 resolver、planner/retry/Worker 消费路径。
- Produces: AP-08 的一行长期复发记录，以及实现完成的验证证据。

- [ ] **Step 1: 更新“踩过的坑”，不改 AP-08 正文**

新增一行，表达完整因果：

```markdown
- 公开 `audioKind` 与 provider 分支正确仍不足以保证音频模式正确：编曲方案重构曾把“全部 audio 等于 `music_score_v1`”遗留在通用规划、冻结重建和重试路径，导致环境音效在提交前被错误 schema 拒绝；音频模式必须由持久化判别式 resolver 一次裁决，planner、retry 与 Worker 只能穷尽消费。
```

- [ ] **Step 2: 运行完整的受影响验证集合**

Run:

```powershell
npm.cmd run architecture:impact -- src/lib/workspace-resource/audio-execution-contract.ts src/lib/workspace-resource/generation-request.ts src/lib/workspace-resource/generation-contract.ts src/lib/operations/domains/workspace-resource/generation-ops.ts src/lib/task/execution/handlers/workspace-resource-audio.ts
npm.cmd run typecheck
npx.cmd vitest run tests/contracts/workspace-resource-audio-execution-contract.test.ts tests/contracts/comfyui-moss-soundeffect.contract.test.ts tests/contracts/comfyui-ace-step-music.contract.test.ts tests/contracts/workspace-resource-operation-conformance.test.ts tests/contracts/vocal-performance-generation.contract.test.ts --exclude ".worktrees/**"
git diff --check
```

Expected: impact 仍映射到 audio-production、workspace-resource、async-task-lifecycle 等既有模块；typecheck PASS；五个 contract 文件全部 PASS；`git diff --check` 无输出。

- [ ] **Step 3: 运行真实 `planOperation` 只读环境音效复验**

先在当前 PowerShell 会话中设置 `AUDIO_PLAN_USER_ID` 和 `AUDIO_PLAN_PROJECT_ID`，值来自本机已登录用户与已配置 sound model 的现有项目；这些本机 identity 不写入仓库。随后运行以下只读脚本，它只调用 `planOperation`，不调用 commit、plan snapshot persistence 或 task submit：

```powershell
$verification = @'
import { prisma } from './src/lib/prisma'
import { createProjectAgentOperationRegistryForApi } from './src/lib/operations/registry'
import { planOperation } from './src/lib/operations/planning'
import { parseWorkspaceResourceGenerationTaskPayload } from './src/lib/workspace-resource/generation-contract'
import { parseFrozenAudioExecution } from './src/lib/workspace-resource/audio-execution-contract'

const userId = process.env.AUDIO_PLAN_USER_ID?.trim()
const projectId = process.env.AUDIO_PLAN_PROJECT_ID?.trim()
if (!userId || !projectId) throw new Error('AUDIO_PLAN_LOCAL_IDENTITY_REQUIRED')

void (async () => {
const originalPrompt = 'Continuous controlled-room electrical pressure, low mechanical air movement, no transient impacts.'
const originalDurationSeconds = 26
const originalNegativePrompt = '  music, speech, dialogue, rhythm, explosion\n'
const operation = createProjectAgentOperationRegistryForApi().create_audio
if (!operation) throw new Error('CREATE_AUDIO_OPERATION_REQUIRED')
const input = operation.inputSchema.parse({
  request: {
    kind: 'new',
    items: [{
      itemId: 'sound-read-only-contract-check',
      name: 'Sound read-only contract check',
      folderPath: null,
      mediaType: 'audio',
      audioKind: 'sound',
      schemaId: 'project.sound_effect_audio',
      prompt: originalPrompt,
      durationSeconds: originalDurationSeconds,
      negativePrompt: originalNegativePrompt,
      count: 1,
    }],
  },
})
const plan = await planOperation({
  operation,
  ctx: {
    request: null,
    requestId: 'audio-plan-contract-read-only',
    userId,
    projectId,
    context: {},
    invocationChannel: 'api',
    source: 'audio-plan-contract-read-only',
    writer: null,
    toolCallId: null,
    activityId: null,
  },
  input,
})
if (plan.tasks.length !== 1) throw new Error(`AUDIO_PLAN_TASK_COUNT_INVALID:${String(plan.tasks.length)}`)
const plannedTask = plan.tasks[0]
const payload = parseWorkspaceResourceGenerationTaskPayload(plannedTask.payload)
const execution = parseFrozenAudioExecution({
  audioExecutionMode: payload.audioExecutionMode,
  audioKind: payload.resource.audioKind,
  prompt: payload.resource.prompt,
  durationSeconds: payload.durationSeconds,
  generationOptions: payload.generationOptions,
})
if (execution.mode !== 'sound') throw new Error(`AUDIO_PLAN_MODE_INVALID:${execution.mode}`)
if (execution.prompt !== originalPrompt) throw new Error('AUDIO_PLAN_PROMPT_CHANGED')
if (execution.durationSeconds !== originalDurationSeconds) throw new Error('AUDIO_PLAN_DURATION_CHANGED')
if (execution.generationOptions.negativePrompt !== originalNegativePrompt) throw new Error('AUDIO_PLAN_NEGATIVE_PROMPT_CHANGED')
if ('kind' in execution.generationOptions || 'compositionPlan' in execution.generationOptions) {
  throw new Error('AUDIO_PLAN_MUSIC_SCORE_FIELDS_PRESENT')
}
const targetIds = plan.tasks.map((task) => task.target.targetId)
const [taskWrites, resourceWrites, operationWrites] = await Promise.all([
  prisma.task.count({ where: { targetId: { in: targetIds } } }),
  prisma.workspaceResource.count({ where: { id: { in: targetIds } } }),
  prisma.operationExecution.count({ where: { requestId: 'audio-plan-contract-read-only' } }),
])
if (taskWrites !== 0 || resourceWrites !== 0 || operationWrites !== 0) {
  throw new Error(`AUDIO_PLAN_WROTE_STATE:${String(taskWrites)}:${String(resourceWrites)}:${String(operationWrites)}`)
}
console.log(JSON.stringify({ mode: execution.mode, promptPreserved: true, durationPreserved: true, negativePromptPreserved: true, taskWrites, resourceWrites, operationWrites }, null, 2))
await prisma.$disconnect()
})()
'@
npx.cmd tsx --env-file=.env -e $verification
```

Expected output:

```json
{
  "mode": "sound",
  "promptPreserved": true,
  "durationPreserved": true,
  "negativePromptPreserved": true,
  "taskWrites": 0,
  "resourceWrites": 0,
  "operationWrites": 0
}
```

该检查只读取配置与资源，并构造内存计划。Expected: 不再出现 `music_score_v1` ZodError；payload 没有 `compositionPlan`、cue 或音乐专属字段；数据库 Task、WorkspaceResource 和 OperationExecution 数量不增加。

- [ ] **Step 4: 复核权威入口与残余双轨**

Run:

```powershell
rg -n "musicScoreGenerationOptionsSchema\.(parse|safeParse)|audioExecutionMode|parseFrozenAudioExecution|freezeAudioExecution" src/lib/workspace-resource src/lib/operations/domains/workspace-resource/generation-ops.ts src/lib/task/execution/handlers/workspace-resource-audio.ts
```

Expected:

- `freezeAudioExecution` 只在新建 planner 使用。
- `parseFrozenAudioExecution` 在 frozen envelope、retry 和 Worker 使用。
- `musicScoreGenerationOptionsSchema` 只存在于新 contract 的 `composition_music` schema，以及明确的 composition timeline helper；不存在任何 `mediaType === 'audio'` 通用解析。
- `create_audio`、task submit、resource writer 和 operation execution writer 数量均未增加。

- [ ] **Step 5: 提交架构复发记录**

```powershell
git add docs/architecture/modules/audio-production.md
git commit -m "docs(audio): record frozen mode regression"
```

- [ ] **Step 6: 交付验证边界**

交付信息必须列出：实际运行命令与结果、真实只读 `planOperation` 结果、唯一 resolver/入口/writer、删除的四类旧逻辑、残余双轨为零。明确说明真实 ComfyUI `/prompt`、queue/history 完成和持久化 MP3 尚未执行；只有用户另行授权数据写入后才能补做该端到端验证。
