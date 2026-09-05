# H3 参考音色与 MOSS 退役 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让现有 MiniMax H3 Ref2VA 视频入口直接消费有版本的项目参考音频并生成带指定音色的原生音轨，同时完整删除 MOSS TTS、MOSS SoundEffect 及其 voiceover 执行链。

**Architecture:** 公开输入继续只使用 `WorkspaceResource resourceId + contentVersion + channel + role`；视频 Planner 冻结媒体版本并验证 H3 capability，H3 adapter 经 owner-aware 字节读取把音频上传到同一 8188 Runtime，再构造 `LoadAudio → MiniMaxH3ReferenceToVideo.ref_audios` 的唯一 graph。旧 voice/voiceover Task 、MOSS Provider 和 SOUND/VOICE external-id 分支只在非终态任务排空后删除；不迁移或删除已有 Resource 和历史记录。

**Tech Stack:** TypeScript、Next.js、Zod、Prisma/MySQL、Temporal、Vitest、ComfyUI `/upload/image`/`/prompt`/`/api/jobs`、JSON API graph。

**Spec:** `docs/superpowers/specs/2026-09-05-h3-reference-audio-moss-retirement-design.md`

## Global Constraints

- 执行时从干净 HEAD 创建独立 Git worktree；当前主 worktree 有用户未提交修改，不得携带、覆盖或格式化它们。
- 产品 H3 仍是 `comfyui::minimax-h3-dual-stage-2mp`，runtime target 仍是 `h3-dual-stage-2mp`，external id 仍是 `COMFYUI:h3-dual-stage-2mp:VIDEO:<promptId>`。
- H3 `reference` 模式最多 8 张参考图、3 段参考音频、11 个总文件；音频必须搭配至少一个视觉参考，每段至少 2,000 ms，音频总时长最多 15,000 ms。
- 本次不开放 `reference_video`，不改 H3 现有 frame/continuation 模式。
- 对外请求禁止传裸 URL、storage key 或 base64；继续复用 `generation-request.ts`、Resource version 冻结、`outbound-audio.ts` 和 video handler。
- `<Picture N>` 与 `<Audio N>` 在各自模态内按冻结顺序从 1 编号；每个 `<Audio N>` 必须在最终 Prompt 内绑定一个 `<Subject M> (Sx)` speaker identity。
- 服务端不改写、补写或推测 Prompt 绑定；结构不完整时在 Task/Provider 副作用前失败。
- 参考音频上传属于同一视频提交准备；不新建 Resource、Task、external id 或第二个 `/prompt`。
- 删除 `comfyui::moss-tts-local-1.7b` 和 `comfyui::moss-soundeffect-v2` 的 model、adapter、workflow、poll/cancel、Operation、Task 及默认配置；不保留 fallback、兼容分支或隐藏执行器。
- 保留 provider-neutral `create_audio`、`audioKind: "sound"`、`project.sound_effect_audio`、voice/sound registry vocabulary 供未来新 Provider 使用；当前 `productionCapabilities.sound` 为 `null`，sound 生成在规划阶段明确失败。
- `project.voiceover_audio` 保留为历史可读 schema identity；不执行 schema migration、回填、清理、自动取消或数据删除。
- 保留 shared ComfyUI target 上的 ACE-Step 音乐路径。
- 只为 Prompt 纯逻辑、生产 registry/graph conformance 和真实 HTTP Provider 边界维护自动化证据；删除只复述已退役 MOSS/voiceover 实现的测试。

---

### Task 1: 增加 H3 音频 graph 与临时上传原语

**Files:**

- Modify: `src/lib/media/outbound-audio.ts`
- Modify: `src/lib/ai-providers/comfyui/h3-input-upload.ts`
- Modify: `src/lib/ai-providers/comfyui/profiles.ts`
- Modify: `src/lib/ai-providers/comfyui/workflows/h3-dual-stage-2mp.json`
- Modify: `tests/contracts/comfyui-h3-profile-conformance.test.ts`
- Create: `tests/integration/provider/comfyui-h3-input-upload.contract.test.ts`

**Interfaces:**

- Consumes: `readOwnedMediaBytesForGeneration` 已返回的 owner-authorized bytes 和规范化 MIME。
- Produces: `H3_MAX_REFERENCE_AUDIOS`、`H3ReferenceAudioFile`、`uploadH3ReferenceAudios()` 及接受 `referenceAudioFilenames` 的 `buildH3PromptGraph()`，Task 2 的 H3 adapter 使用这些类型。

- [ ] **Step 1: 先增加可反证的 graph 与 multipart 契约**

在 `comfyui-h3-profile-conformance.test.ts` 从生产 profile 构建 0、1、3 段音频的 reference graph，并增加下列断言：

```ts
expect(zeroAudio.graph['340']).toBeUndefined()
expect(zeroAudio.graph['309']?.inputs['ref_audios.ref_audio_0']).toBeUndefined()
expect(oneAudio.graph['340']).toEqual({
  class_type: 'LoadAudio',
  inputs: { audio: 'waoowaoo/prompt/reference-audio-00.mp3' },
})
expect(oneAudio.graph['309']?.inputs['ref_audios.ref_audio_0']).toEqual(['340', 0])
expect(threeAudio.graph['309']?.inputs['ref_audios.ref_audio_2']).toEqual(['342', 0])
expect(() => buildH3PromptGraph({
  ...referenceInput,
  referenceAudioFilenames: ['1.wav', '2.wav', '3.wav', '4.wav'],
})).toThrow('COMFYUI_H3_REFERENCE_AUDIOS_COUNT_INVALID:3')
```

在新 HTTP 边界测试中直接传入 MP3/WAV bytes，证明每段只上传一次、使用 `temp` subfolder、保持顺序，并且响应 identity 不匹配时拒绝：

```ts
const uploaded = await uploadH3ReferenceAudios({
  baseUrl: server.baseUrl,
  promptId: PROMPT_ID,
  files: [
    { bytes: new Uint8Array([0x49, 0x44, 0x33]), contentType: 'audio/mpeg', extension: 'mp3' },
    { bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]), contentType: 'audio/wav', extension: 'wav' },
  ],
})
expect(uploaded).toEqual([
  `waoowaoo/${PROMPT_ID}/reference-audio-00.mp3`,
  `waoowaoo/${PROMPT_ID}/reference-audio-01.wav`,
])
expect(server.getRequests('POST', '/upload/image')).toHaveLength(2)
```

- [ ] **Step 2: 运行新契约并确认它们因缺少节点与 uploader 失败**

```powershell
npx.cmd vitest run tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-input-upload.contract.test.ts --exclude ".worktrees/**"
```

Expected: graph 测试缺少 `referenceAudioFilenames/ref_audios`，upload 测试缺少 `uploadH3ReferenceAudios` 导出。

- [ ] **Step 3: 实现共享的音频出站限制与 H3 上传类型**

将 `outbound-audio.ts` 中已有限制暴露为唯一政策，同一函数继续供 video handler 使用：

```ts
export const MAX_VIDEO_REFERENCE_AUDIO_BYTES = 15 * 1024 * 1024
export const VIDEO_REFERENCE_AUDIO_MIME_TYPES: ReadonlySet<string> = new Set([
  'audio/mpeg',
  'audio/wav',
])
export function normalizeVideoReferenceAudioMimeType(mimeType: string): string
```

在 `h3-input-upload.ts` 保留 continuation frame uploader，增加专用的 H3 音频文件入口：

```ts
export type H3ReferenceAudioFile = {
  readonly bytes: Uint8Array
  readonly contentType: 'audio/mpeg' | 'audio/wav'
  readonly extension: 'mp3' | 'wav'
}

export async function uploadH3ReferenceAudios(input: {
  readonly baseUrl: string
  readonly promptId: string
  readonly files: readonly H3ReferenceAudioFile[]
}): Promise<readonly string[]>
```

内部共用一个 `uploadH3Input()` 发送 `/upload/image` multipart，固定 `type=input`、`subfolder=waoowaoo/<promptId>`、`overwrite=false`。音频文件名只能是 `reference-audio-00.<ext>` 至 `reference-audio-02.<ext>`；响应的 `name/subfolder/type` 必须逐字段匹配，不接受空响应或 Provider 改名。

- [ ] **Step 4: 扩展 canonical H3 reference graph**

在 workflow 中增加 node `340`：

```json
"340": {
  "class_type": "LoadAudio",
  "inputs": { "audio": "waoowaoo/template/reference-audio-00.mp3" }
}
```

并在 node `309` 的模板输入增加：

```json
"ref_audios.ref_audio_0": ["340", 0]
```

在 `profiles.ts` 增加：

```ts
export const H3_MAX_REFERENCE_AUDIOS = 3
const H3_REFERENCE_AUDIO_NODE_IDS = ['340', '341', '342'] as const

export type H3ReferenceDualStageRuntimeProfile = H3RuntimeProfileBase & {
  readonly id: typeof H3_REFERENCE_DUAL_STAGE_PROFILE_ID
  readonly referenceImageNodeIds: readonly string[]
  readonly referenceResizeNodeIds: readonly string[]
  readonly referenceAudioNodeIds: readonly string[]
}

export type H3ReferencePromptGraphInput = H3PromptGraphCommonInput & {
  readonly mode: 'reference'
  readonly referenceImageUrls: readonly string[]
  readonly referenceAudioFilenames: readonly string[]
}
```

`buildReferencePromptGraph()` 先保存 node `340` 作为模板，然后从 graph 删除 `340/341/342` 和所有 `ref_audios.ref_audio_*`，最后按输入顺序重建实际节点。所有现有 image/frame/continuation 调用点明确传 `referenceAudioFilenames: []`，不在函数内做隐式默认。

- [ ] **Step 5: 验证并提交 graph/uploader 阶段**

```powershell
npx.cmd vitest run tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-input-upload.contract.test.ts --exclude ".worktrees/**"
npm.cmd run typecheck
git diff --check
git add src/lib/media/outbound-audio.ts src/lib/ai-providers/comfyui/h3-input-upload.ts src/lib/ai-providers/comfyui/profiles.ts src/lib/ai-providers/comfyui/workflows/h3-dual-stage-2mp.json tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-input-upload.contract.test.ts
git commit -m "feat(video): add H3 reference audio graph inputs"
```

---

### Task 2: 打通 H3 capability、Prompt 绑定与视频提交

**Files:**

- Modify: `src/lib/ai-providers/comfyui/models.ts`
- Modify: `src/lib/ai-providers/comfyui/adapter.ts`
- Modify: `src/lib/ai-providers/comfyui/h3.ts`
- Modify: `src/lib/video-generation/h3-prompt.ts`
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts`
- Modify: `src/lib/creative-skills/skills/video-direction/SKILL.md`
- Modify: `src/lib/ai-prompts/templates/project-agent/system/project-agent-system.txt`
- Modify: `tests/unit/video-generation/h3-prompt.test.ts`
- Modify: `tests/contracts/comfyui-h3-profile-conformance.test.ts`
- Modify: `tests/integration/provider/comfyui-h3-submission.contract.test.ts`
- Modify: `tests/integration/task/project-video-model-config.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `H3_MAX_REFERENCE_AUDIOS`、`H3ReferenceAudioFile`、`uploadH3ReferenceAudios()` 和 graph `referenceAudioFilenames`。
- Produces: H3 生产 capability、`H3PromptReferenceManifest` 和可执行 `referenceAudios` transport；后续任务不得再引入参考音色入口。

- [ ] **Step 1: 先写 Prompt 媒体编号与 speaker 绑定 oracle**

在 `h3-prompt.test.ts` 为 reference 模式增加一个合法样例：

```text
subject_definitions:
<Subject 1> (S1) is the person shown in <Picture 1>.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).

summary:
<Subject 1> speaks one new line.

retention_analysis:
<Picture 1>: reference - preserve <Subject 1>.
<Audio 1>: reference - <Subject 1> (S1) follows its vocal timbre and measured delivery without copying the original signal.

detailed_description:
[Shot 1] <Subject 1> (S1) faces camera and says <d>[Chinese]这是新台词。</d>

overall_soundscape:
Clean speech with quiet room tone.

non_diegetic_music:
N/A
```

测试必须反证：`<Audio 2>` 越界、已传音频但缺 `<Audio 1>`、Audio 只写在 retention 但未绑定 Subject/Speaker、同一 Audio 重复绑定两个 speaker、被绑定 speaker 没有出现在 `detailed_description` 中的情况。

统一入口签名为：

```ts
export type H3PromptReferenceManifest = {
  readonly pictureCount: number
  readonly audioCount: number
}

export function assertVideoPromptMatchesProfile(input: {
  readonly profile: VideoPromptProfile
  readonly prompt: string
  readonly inputMode: VideoInputMode
  readonly timelineDurationSeconds: number
  readonly references: H3PromptReferenceManifest
}): void
```

`generic_v1` 仍原样返回；H3 所有现有调用都必须显式传 `references`。只在 `audioCount > 0` 时强制 Audio 绑定，不借本次改动强迫历史 image-only reference Prompt 枚举每一张图。

- [ ] **Step 2: 先增加生产 registry/adapter 失败证据**

在 H3 conformance 中断言生产 model entry：

```ts
expect(model.capabilities.video).toMatchObject({
  maxReferenceImages: 8,
  maxReferenceAudios: 3,
  maxReferenceVideos: 0,
  maxReferenceFiles: 11,
  referenceAudioRequiresVisual: true,
  minReferenceAudioDurationMs: 2_000,
  maxTotalReferenceAudioDurationMs: 15_000,
})
```

通过 `normalizeMediaOptionsForSelection()` 断言 1/3 段 `referenceAudios` 通过、4 段失败、`referenceVideos` 仍失败。

在 `project-video-model-config.integration.test.ts` 增加 `seedReadyAudio()`，用 `ensureMediaObjectFromStorageKey()` 写入明确的 `audio/mpeg`、`sizeBytes` 和 `durationMs`，再物化为 `project.voice_reference`。通过真实 `create_video` `planOperation()` 证明：1 张图 + 1 段 2,000 ms 音频通过；1 张图 + 3 段合计 15,000 ms 音频通过；仅音频、单段 1,999 ms、合计 15,001 ms、4 段音频以及 `first_frame + reference_audio` 分别失败。每个拒绝分支前后查询 `Task` 和 `WorkspaceResource` 数量，断言没有创建副作用。

运行三个目标测试，确认它们因现有 H3 capability 为 0、adapter excluded key 和 Prompt manifest 未接入而失败：

```powershell
npx.cmd vitest run tests/unit/video-generation/h3-prompt.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/task/project-video-model-config.integration.test.ts --exclude ".worktrees/**"
```

- [ ] **Step 3: 开放现有 H3 model 的音频 capability 与 adapter schema**

只修改现有 H3 entry：

```ts
maxReferenceImages: H3_MAX_REFERENCE_IMAGES,
maxReferenceAudios: H3_MAX_REFERENCE_AUDIOS,
maxReferenceVideos: 0,
maxReferenceFiles: H3_MAX_REFERENCE_IMAGES + H3_MAX_REFERENCE_AUDIOS,
referenceAudioRequiresVisual: true,
minReferenceAudioDurationMs: 2_000,
maxTotalReferenceAudioDurationMs: 15_000,
```

`adapter.ts` 的 video option schema 将 `referenceAudios` 加入 `allowedKeys`，用 `stringArrayValidator({ maxLength: H3_MAX_REFERENCE_AUDIOS })`，并从 `excludedKeys` 中删除它。`referenceVideos` 仍保持 excluded。Planner 现有 `validateReferenceCapabilities()` 和 `validateReferenceMediaCapabilities()` 继续作为数量、视觉依赖、单段最小时长与总时长的唯一裁判，不复制 H3-specific Planner。

- [ ] **Step 4: 实现 Prompt 的 Audio-to-Speaker 绑定解析**

在 `h3-prompt.ts` 增加模态 token 收集与行绑定解析：

```ts
type H3AudioSpeakerBinding = {
  readonly audioNumber: number
  readonly subjectNumber: number
  readonly speakerNumber: number
}

function assertH3ReferenceManifest(
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
  references: H3PromptReferenceManifest,
): void
```

规则固定为：所有 `<Picture N>/<Audio N>` 的 N 必须是 1-based 且不超过 manifest；每个预期 `<Audio N>` 在 `subject_definitions` 恰好出现一次，同一行必须包含唯一 `<Subject M> (Sx)`；`retention_analysis` 必须同时引用该 Audio 和同一 Subject/Speaker；`detailed_description` 必须引用同一 Subject/Speaker 并包含对话 tag。错误 reason 分别使用 `MEDIA_REFERENCE_INDEX_OUT_OF_RANGE`、`AUDIO_REFERENCE_MISSING`、`AUDIO_SPEAKER_BINDING_INVALID`、`AUDIO_SPEAKER_RETENTION_MISSING`、`AUDIO_SPEAKER_DIALOGUE_MISSING`。

`generation-ops.ts::validateVideoPromptProfile()` 从同一 `ResolvedVideoInputMode` 构造 manifest：reference 模式 `pictureCount=referenceImageCount`；first-frame 为 1；first-last 为 2；continuation 为 0；`audioCount=referenceAudioCount`。

- [ ] **Step 5: 在 H3 adapter 内读取并上传冻结音频**

`h3.ts` 将 `normalizedReferenceUrls()` 收敛为带 label 的通用数组规范化函数，把 audio reference 加入 `VideoInputReference[]`。在内部增加：

```ts
async function readH3ReferenceAudioFiles(input: {
  readonly urls: readonly string[]
  readonly userId: string
}): Promise<readonly H3ReferenceAudioFile[]>
```

每个 URL 通过 `readOwnedMediaBytesForGeneration()` 读取，options 只使用 Task 1 从 `outbound-audio.ts` 导出的 `MAX_VIDEO_REFERENCE_AUDIO_BYTES`、`VIDEO_REFERENCE_AUDIO_MIME_TYPES`、`normalizeVideoReferenceAudioMimeType`。`audio/mpeg` 映射 `mp3`，`audio/wav` 映射 `wav`；其他 MIME 不允许到达 uploader。

`buildGraph()` 接受显式 prepared input：

```ts
type H3PreparedInputs = {
  readonly continuationFrameFilenames: readonly string[]
  readonly referenceAudioFilenames: readonly string[]
}
```

首次构图使用与实际音频数量一致的占位文件名，完成 graph/profile preflight 后才读取和上传字节，然后使用 uploader 返回的文件名重建同一 graph。`preflight()` 对 reference profile 额外验证 `LoadAudio.audio` 输入存在，以及 `MiniMaxH3ReferenceToVideo` 的 `ref_audios` schema 类型为 `AUDIO`；节点不兼容时在上传前失败。

上传与重构图都位于现有 `preAcceptRejected()` 边界内；只有它们成功才能进入现有唯一 `/prompt` 提交与 same-id outcome probe。

- [ ] **Step 6: 更新唯一视频 Skill 和 Agent 契约**

`video-direction/SKILL.md` 将 reference 模式更新为“1–8 张 `reference_image` 可搭配 1–3 段 `reference_audio`”，明确 2,000/15,000 ms 与总文件 11 上限，并放入本 Task Step 1 的完整 Prompt 绑定样例。`project-agent-system.txt` 保留“重用同一 ready audio version”，增加“交由 `<Audio N> → <Subject M> (Sx)`”的结构约束，不再声称存在 MOSS 后期克隆配音工作流。

- [ ] **Step 7: 验证 H3 公开契约并提交**

```powershell
npx.cmd vitest run tests/unit/video-generation/h3-prompt.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts tests/integration/provider/comfyui-h3-input-upload.contract.test.ts tests/integration/task/project-video-model-config.integration.test.ts --exclude ".worktrees/**"
npm.cmd run check:capability-catalog
npm.cmd run typecheck
git diff --check
git add src/lib/ai-providers/comfyui/models.ts src/lib/ai-providers/comfyui/adapter.ts src/lib/ai-providers/comfyui/h3.ts src/lib/video-generation/h3-prompt.ts src/lib/operations/domains/workspace-resource/generation-ops.ts src/lib/creative-skills/skills/video-direction/SKILL.md src/lib/ai-prompts/templates/project-agent/system/project-agent-system.txt tests/unit/video-generation/h3-prompt.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts tests/integration/task/project-video-model-config.integration.test.ts
git commit -m "feat(video): submit H3 reference voice audio"
```

---

### Task 3: 执行 MOSS/voiceover 非终态排空门禁

**Files:**

- Temporary only: `.tmp/check-moss-drain.ts` (run and delete; never commit)

**Interfaces:**

- Consumes: Prisma `Task.status/type/payload/executionCheckpoints.output` 持久事实。
- Produces: “可删除旧 worker 执行分支”的零阻塞证据；它不改写数据。

- [ ] **Step 1: 写入只读的临时排空检查**

```ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const retiredTaskTypes = new Set([
  'workspace_resource_voice',
  'workspace_resource_voiceover',
  'workspace_resource_voiceover_mix',
])
const retiredMarkers = [
  'comfyui::moss-tts-local-1.7b',
  'comfyui::moss-soundeffect-v2',
  'COMFYUI:shared:VOICE:',
  'COMFYUI:shared:SOUND:',
]

try {
  const active = await prisma.task.findMany({
    where: { status: { in: ['queued', 'processing'] } },
    select: {
      id: true,
      type: true,
      status: true,
      payload: true,
      executionCheckpoints: { select: { stepKey: true, state: true, output: true } },
    },
  })
  const blockers = active.filter((task) => {
    const persisted = JSON.stringify({ payload: task.payload, checkpoints: task.executionCheckpoints })
    return retiredTaskTypes.has(task.type)
      || retiredMarkers.some((marker) => persisted.includes(marker))
  })
  process.stdout.write(`${JSON.stringify({ blockerCount: blockers.length, blockers }, null, 2)}\n`)
  if (blockers.length > 0) process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
```

- [ ] **Step 2: 运行门禁并保留可审查输出**

```powershell
New-Item -ItemType Directory -Force -Path '.tmp' | Out-Null
# 将 Step 1 的完整代码保存为 .tmp/check-moss-drain.ts
npx.cmd tsx --env-file=.env .tmp/check-moss-drain.ts
Remove-Item -LiteralPath '.tmp/check-moss-drain.ts'
```

Expected: `blockerCount` 精确为 `0`。如果数据库无法读取或 blocker 非零，继续保留旧 worker，可以保留 Task 1–2 的 H3 新能力，但必须停在 Task 3，不自动取消、重试、改写或删除任何任务。

---

### Task 4: 删除 voice、voiceover 与混音第二执行链

**Files:**

- Delete: `src/lib/operations/domains/workspace-resource/voiceover-ops.ts`
- Delete: `src/lib/workspace-resource/voiceover-contract.ts`
- Delete: `src/lib/task/execution/handlers/workspace-resource-voice.ts`
- Delete: `src/lib/task/execution/handlers/workspace-resource-voiceover.ts`
- Delete: `src/lib/task/execution/handlers/workspace-resource-voiceover-mix.ts`
- Delete: `src/lib/video-compose/voiceover-mix.ts`
- Delete: `src/lib/video-compose/voiceover-timeline.ts`
- Modify: `src/lib/operations/project-agent.ts`
- Modify: `src/lib/model-access/system-model-resolver.ts`
- Modify: `src/lib/platform-runtime/presets.ts`
- Modify: `src/lib/ai-registry/platform-models.ts`
- Modify: `src/lib/ai-exec/engine.ts`
- Modify: `src/lib/task/types.ts`
- Modify: `src/lib/task/definition.ts`
- Modify: `src/lib/task/execution/registry.ts`
- Modify: `src/lib/task/intent.ts`
- Modify: `src/lib/task/estimated-progress.ts`
- Modify: `src/lib/task/progress-message.ts`
- Modify: `src/lib/workspace-resource/task-materializer.ts`
- Modify: `src/lib/workspace-resource/schema-registry.ts`
- Modify: `src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts`
- Modify: `src/lib/project-agent/copy.ts`
- Modify: `messages/zh/progress.json`
- Modify: `messages/en/progress.json`
- Modify: `docs/architecture/modules/audio-production.md`
- Delete: `tests/contracts/voiceover-operation.contract.test.ts`
- Delete: `tests/unit/workspace-resource/voiceover-contract.test.ts`
- Delete: `tests/unit/video-compose/voiceover-timeline.test.ts`
- Delete: `tests/integration/video-compose/voiceover-mix.integration.test.ts`
- Modify: `tests/contracts/workspace-resource-operation-conformance.test.ts`

**Interfaces:**

- Consumes: Task 3 的零 blocker 结论。
- Produces: Task/Operation/materializer 中只剩现行 image/audio/video 生成与 video frame/merge 链；`project.voiceover_audio` 只作为历史可读 schema。

- [ ] **Step 1: 把现有 Operation conformance 改成退役语义**

删除“voiceover 专用 Operation 拥有 schema”的旧断言，改为从生产 registries 反证不可再创建：

```ts
const registry = createProjectAgentOperationRegistryForApi()
expect(registry.produce_voiceover_video).toBeUndefined()
expect(WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.audio)
  .not.toContain(WORKSPACE_RESOURCE_SCHEMA.VOICEOVER_AUDIO)
expect(requireWorkspaceResourceSchema(WORKSPACE_RESOURCE_SCHEMA.VOICEOVER_AUDIO))
  .toMatchObject({ mediaType: 'audio', resourceKind: 'file' })
```

运行并确认首个断言因旧 Operation 仍注册而失败：

```powershell
npx.cmd vitest run tests/contracts/workspace-resource-operation-conformance.test.ts --exclude ".worktrees/**"
```

- [ ] **Step 2: 删除 Operation、system purpose 和 provider 调用 wrapper**

从 `project-agent.ts` 删除 `createWorkspaceResourceVoiceoverOperations()` pack。从 `SystemModelPurpose`、`resolveSystemModelKey()` 和 `PlatformRuntimePurpose` 删除 `voiceover`；删除 `PLATFORM_VOICEOVER_MODEL_KEY`。从 `engine.ts` 删除对外 `generateVoice()` wrapper，但保留 `AiProviderVoiceExecutionContext`、`AiProviderAdapter.voice?` 和其 option vocabulary，供未来新 Provider 在单独任务中重新接入。

- [ ] **Step 3: 一次性删除三种 Task identity 及所有投影**

从 `TASK_TYPE`、`TaskExecutionHandlerKey`、`TASK_DEFINITIONS`、`TASK_EXECUTION_HANDLERS`、intent、estimated-progress、progress label、Canvas resource-card taskTypes 和 terminal materializer 中删除：

```ts
'workspace_resource_voice'
'workspace_resource_voiceover'
'workspace_resource_voiceover_mix'
```

同时删除三个 handler、voiceover contract 和只被 mix handler 使用的两个 `video-compose/voiceover-*` 模块。删除 progress 中的 `workspaceResourceVoice*`、`generateVoiceSubmit`、`persistVoice` 中英文 key，以及 `project-agent/copy.ts` 中无注册消费者的 `bind_voice`。

- [ ] **Step 4: 把 voiceover schema 收敛为历史可读 identity**

`WORKSPACE_RESOURCE_SCHEMA.VOICEOVER_AUDIO` 和 `WORKSPACE_RESOURCE_SCHEMA_IDS_BY_MEDIA.audio` 保留不变，从 `DEDICATED_ORIGIN_SCHEMA_IDS` 移入 `RETIRED_SCHEMA_IDS`：

```ts
const DEDICATED_ORIGIN_SCHEMA_IDS = new Set([
  WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
])

const RETIRED_SCHEMA_IDS = new Set([
  WORKSPACE_RESOURCE_SCHEMA.LEGACY_STYLE,
  WORKSPACE_RESOURCE_SCHEMA.LONG_FORM_PLAN,
  WORKSPACE_RESOURCE_SCHEMA.VOICEOVER_AUDIO,
])
```

这一步不修改 Prisma schema 或数据库行，不删除 `VOICE_REFERENCE`、`UPLOAD_AUDIO` 或既有 Resource 读取/播放路径。

- [ ] **Step 5: 更新架构权威入口，不改不变量**

`audio-production.md` 的执行入口从 `workspace-resource-{audio,voice}.ts` 改为：

```text
- 执行：独立音乐/音效使用 workspace-resource-audio handler；H3 参考音色由 workspace-resource-video handler 经唯一 video provider adapter 传入原生音轨。
```

AP-01 至 AP-08 不增删。在权威入口与“踩过的坑”之间不写文件清单、数值上限或迁移过程。

- [ ] **Step 6: 删除失效测试，运行 registry 契约并提交**

```powershell
npx.cmd vitest run tests/contracts/workspace-resource-operation-conformance.test.ts --exclude ".worktrees/**"
npm.cmd run typecheck
git diff --check
git add -A src/lib/operations/domains/workspace-resource/voiceover-ops.ts src/lib/workspace-resource/voiceover-contract.ts src/lib/task/execution/handlers/workspace-resource-voice.ts src/lib/task/execution/handlers/workspace-resource-voiceover.ts src/lib/task/execution/handlers/workspace-resource-voiceover-mix.ts src/lib/video-compose/voiceover-mix.ts src/lib/video-compose/voiceover-timeline.ts src/lib/operations/project-agent.ts src/lib/model-access/system-model-resolver.ts src/lib/platform-runtime/presets.ts src/lib/ai-registry/platform-models.ts src/lib/ai-exec/engine.ts src/lib/task/types.ts src/lib/task/definition.ts src/lib/task/execution/registry.ts src/lib/task/intent.ts src/lib/task/estimated-progress.ts src/lib/task/progress-message.ts src/lib/workspace-resource/task-materializer.ts src/lib/workspace-resource/schema-registry.ts src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts src/lib/project-agent/copy.ts messages/zh/progress.json messages/en/progress.json docs/architecture/modules/audio-production.md tests/contracts/voiceover-operation.contract.test.ts tests/unit/workspace-resource/voiceover-contract.test.ts tests/unit/video-compose/voiceover-timeline.test.ts tests/integration/video-compose/voiceover-mix.integration.test.ts tests/contracts/workspace-resource-operation-conformance.test.ts
git commit -m "refactor(audio): retire voiceover execution chain"
```

---

### Task 5: 删除两个 MOSS Provider 并表达无 sound Provider 状态

**Files:**

- Delete: `src/lib/ai-providers/comfyui/moss-tts-reference-policy.ts`
- Delete: `src/lib/ai-providers/comfyui/moss.ts`
- Delete: `src/lib/ai-providers/comfyui/tts.ts`
- Delete: `src/lib/ai-providers/comfyui/workflows/moss-soundeffect-v2.json`
- Delete: `src/lib/ai-providers/comfyui/workflows/moss-tts-local-1.7b.json`
- Modify: `src/lib/ai-providers/comfyui/models.ts`
- Modify: `src/lib/ai-providers/comfyui/adapter.ts`
- Modify: `src/lib/ai-providers/comfyui/async-task.ts`
- Modify: `src/lib/ai-providers/comfyui/external-id.ts`
- Modify: `src/lib/ai-providers/index.ts`
- Modify: `src/lib/ai-registry/platform-models.ts`
- Modify: `src/lib/platform-models/catalog.ts`
- Modify: `src/lib/platform-runtime/presets.ts`
- Modify: `src/lib/config-service.ts`
- Modify: `src/lib/projects/creation-defaults.ts`
- Modify: `src/lib/operations/domains/project/system-project-ops.ts`
- Modify: `scripts/check-cloud-env.mjs`
- Modify: `.env.example`
- Modify: `.env.cloud.example`
- Modify: `tests/setup/env.ts`
- Delete: `tests/contracts/comfyui-moss-soundeffect.contract.test.ts`
- Delete: `tests/contracts/comfyui-moss-tts.contract.test.ts`
- Delete: `tests/unit/ai-providers/comfyui-async-task.test.ts`
- Modify: `tests/contracts/comfyui-runtime-target-conformance.test.ts`
- Modify: `tests/contracts/workspace-resource-audio-execution-contract.test.ts`
- Modify: `tests/integration/task/project-video-model-config.integration.test.ts`

**Interfaces:**

- Consumes: Task 3 的排空结论和 Task 4 删除后的零 voice caller。
- Produces: ComfyUI 只注册 H3 video 与 ACE-Step music；平台默认模型类型允许 `soundModel` 缺失，业务投影为 `null`。

- [ ] **Step 1: 先把生产 registry conformance 改成最终集合**

`comfyui-runtime-target-conformance.test.ts` 不再导入两个 MOSS id，并断言：

```ts
expect(COMFYUI_REGISTERED_MODEL_KEYS).toEqual([
  `comfyui::${COMFYUI_H3_MODEL_ID}`,
  `comfyui::${COMFYUI_ACE_STEP_1_5_MODEL_ID}`,
])
expect(resolveComfyUiRuntimeTargetIdForModelKey(`comfyui::${COMFYUI_H3_MODEL_ID}`))
  .toBe('h3-dual-stage-2mp')
expect(resolveComfyUiRuntimeTargetIdForModelKey(`comfyui::${COMFYUI_ACE_STEP_1_5_MODEL_ID}`))
  .toBe('shared')
expect(getPlatformDefaultModels().soundModel).toBeUndefined()
expect(() => getPlatformRuntimePlan('sound')).toThrow('PLATFORM_RUNTIME_MODEL_MISSING:sound')
```

`project-video-model-config.integration.test.ts` 中新本地项目的 `soundModel` 期望值改为 `null`，并断言 `resolveProjectProductionCapabilities()` 或项目 production context 的 `sound` 为 `null`。先运行这两个测试并确认它们因 MOSS 仍注册/仍为默认而失败。

- [ ] **Step 2: 从 ComfyUI registry、adapter 和 async protocol 删除 MOSS**

`models.ts` 删除两个 MOSS id/key、sound/voice capability entries、API catalog entries、platform presets 和 runtime-target mappings；`COMFYUI_REGISTERED_MODEL_KEYS` 只剩 H3 和 ACE-Step。`adapter.ts` 只剩 `video` 和 `music`，不留返回 unsupported 的 `sound/voice` wrapper。

`external-id.ts` 收紧为：

```ts
export type ComfyUiAsyncType = 'VIDEO' | 'MUSIC'
const COMFYUI_ASYNC_TYPES: readonly ComfyUiAsyncType[] = ['VIDEO', 'MUSIC']
```

`async-task.ts` 的 poll/cancel 只在 MUSIC 与 VIDEO 之间穷尽分派，不保留 SOUND/VOICE 解析。`ai-providers/index.ts` 的支持格式文案同步为 `VIDEO|MUSIC`。删除三个 MOSS TypeScript 文件与两份 workflow JSON。

- [ ] **Step 3: 让平台默认契约显式允许 sound 缺失**

定义真实返回类型，取消现有错误的 `Required<DefaultModelsPayload>` 断言：

```ts
export type PlatformDefaultModelField = Exclude<
  keyof Required<DefaultModelsPayload>,
  'analysisModel' | 'soundModel'
>

export type PlatformDefaultModels = DefaultModelsPayload
  & Required<Pick<DefaultModelsPayload, PlatformDefaultModelField>>

export function getPlatformDefaultModels(): PlatformDefaultModels
```

`PLATFORM_DEFAULT_MODEL_KEYS`、`PLATFORM_DEFAULT_MODEL_TYPES` 和 `PLATFORM_DEFAULT_MODEL_ENV` 不再包含 sound。`getPlatformDefaultModelCatalog()` 只枚举实际非空 model key。`getPlatformRuntimePlan('sound')` 通过共享 `requirePlatformRuntimeModelKey()` 抛出 `PLATFORM_RUNTIME_MODEL_MISSING:sound`；`getPlatformCapabilityDefaults()` 不再无条件请求 sound plan。

`config-service.ts` 在 platform mode 将 `analysisModel` 和 `soundModel` 都用 `?? null` 投影到已有 nullable 业务类型。`LOCAL_PROJECT_DEFAULT_MODELS` 删除 `soundModel`；项目创建时使用 `userPreference.soundModel ?? null`，无 preference 时依靠 DB nullable 字段产生 `null`。

- [ ] **Step 4: 删除现行环境和测试默认中的 MOSS identity**

从 `.env.example`、`.env.cloud.example`、`tests/setup/env.ts` 和 `scripts/check-cloud-env.mjs` 删除 `PLATFORM_DEFAULT_SOUND_MODEL` / MOSS 默认；两个 example env 的说明改为“ComfyUI 当前提供 video/music，新 sound/TTS Provider 未配置”。不修改未被 Git 跟踪的本地私有 `.env`。

`workspace-resource-audio-execution-contract.test.ts` 中用于验证 provider-neutral 冻结 schema 的 model key 改为 `test::sound-provider`，不为让测试通过而复活生产 MOSS。删除两个 MOSS contract test 和只测试 MOSS VOICE poll 分支的 `comfyui-async-task.test.ts`。

- [ ] **Step 5: 运行 Provider/default 契约并提交**

```powershell
npx.cmd vitest run tests/contracts/comfyui-runtime-target-conformance.test.ts tests/contracts/workspace-resource-audio-execution-contract.test.ts tests/integration/task/project-video-model-config.integration.test.ts --exclude ".worktrees/**"
npm.cmd run env:platform-models:check
npm.cmd run check:capability-catalog
npm.cmd run check:model-config-contract
npm.cmd run typecheck
git diff --check
git add -A src/lib/ai-providers/comfyui/moss-tts-reference-policy.ts src/lib/ai-providers/comfyui/moss.ts src/lib/ai-providers/comfyui/tts.ts src/lib/ai-providers/comfyui/workflows/moss-soundeffect-v2.json src/lib/ai-providers/comfyui/workflows/moss-tts-local-1.7b.json src/lib/ai-providers/comfyui/models.ts src/lib/ai-providers/comfyui/adapter.ts src/lib/ai-providers/comfyui/async-task.ts src/lib/ai-providers/comfyui/external-id.ts src/lib/ai-providers/index.ts src/lib/ai-registry/platform-models.ts src/lib/platform-models/catalog.ts src/lib/platform-runtime/presets.ts src/lib/config-service.ts src/lib/projects/creation-defaults.ts src/lib/operations/domains/project/system-project-ops.ts scripts/check-cloud-env.mjs .env.example .env.cloud.example tests/setup/env.ts tests/contracts/comfyui-moss-soundeffect.contract.test.ts tests/contracts/comfyui-moss-tts.contract.test.ts tests/unit/ai-providers/comfyui-async-task.test.ts tests/contracts/comfyui-runtime-target-conformance.test.ts tests/contracts/workspace-resource-audio-execution-contract.test.ts tests/integration/task/project-video-model-config.integration.test.ts
git commit -m "refactor(provider): remove MOSS audio models"
```

---

### Task 6: 运行穷尽检查、分层回归与真实 H3 样片

**Files:**

- Verify only: all files changed in Tasks 1–5
- Temporary only: `.tmp/h3-reference-audio-smoke.ps1` and local sample inputs/IDs (never commit)

**Interfaces:**

- Consumes: 最终生产 registry、Prompt validator、H3 adapter、Task/Resource 终态链。
- Produces: 实现完成证据；只有真实 MP4 听辨与口型验收成功才能声称效果验收完成。

- [ ] **Step 1: 全仓检查旧 identity 与旁路为零**

```powershell
rg -n "moss|MOSS|MossTTS|produce_voiceover_video|workspace_resource_voiceover|workspace_resource_voiceover_mix|COMFYUI:shared:(SOUND|VOICE)|PLATFORM_VOICEOVER_MODEL_KEY" src messages .env.example .env.cloud.example tests scripts
rg -n "workspace_resource_voice|WORKSPACE_RESOURCE_VOICE|generateVoice" src messages tests
```

Expected: 两条命令都无生产命中；只允许在本设计/计划文档和 Git 历史中出现退役名称。单独确认 provider-neutral 未来契约仍存在：

```powershell
rg -n "audioKind.*sound|SOUND_EFFECT_AUDIO|AiProviderVoiceExecutionContext|voice\?: AiProviderMediaModalityAdapter" src/lib
```

- [ ] **Step 2: 运行定向独立证据**

```powershell
npx.cmd vitest run tests/unit/video-generation/h3-prompt.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-input-upload.contract.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts tests/contracts/comfyui-runtime-target-conformance.test.ts tests/contracts/workspace-resource-operation-conformance.test.ts tests/contracts/workspace-resource-audio-execution-contract.test.ts tests/integration/task/project-video-model-config.integration.test.ts --exclude ".worktrees/**"
npm.cmd run check:capability-catalog
npm.cmd run env:platform-models:check
npm.cmd run check:model-config-contract
npm.cmd run check:media-normalization
npm.cmd run architecture:impact -- src/lib/ai-providers/comfyui src/lib/operations/domains/workspace-resource src/lib/workspace-resource src/lib/media/outbound-audio.ts
```

- [ ] **Step 3: 运行类型、静态与代码质量验证**

```powershell
npm.cmd run typecheck
npx.cmd eslint src/lib/media/outbound-audio.ts src/lib/ai-providers/comfyui src/lib/video-generation/h3-prompt.ts src/lib/operations/domains/workspace-resource/generation-ops.ts src/lib/operations/project-agent.ts src/lib/model-access/system-model-resolver.ts src/lib/platform-models/catalog.ts src/lib/platform-runtime/presets.ts src/lib/config-service.ts src/lib/projects/creation-defaults.ts src/lib/task src/lib/workspace-resource src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-input-upload.contract.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts
git diff --check HEAD~4..HEAD
git status --short
```

Expected: 命令全部成功，工作树只包含明确记录的非任务文件，或完全干净。不因无关文件失败扩大修改范围。

- [ ] **Step 4: 通过真实 `register_uploaded_media → create_video → Temporal → H3` 生成样片**

先启动当前本地应用、Temporal Worker 和 H3 8188 Runtime。使用一张已 ready 人物图和一段已 ready 的 2–15 秒 MP3/WAV；记录它们的精确 `resourceId/contentVersion`，不按“最近资源”自动选择。将这五个值写入当前 shell 的 `H3_SMOKE_PROJECT_ID`、`H3_SMOKE_IMAGE_RESOURCE_ID`、`H3_SMOKE_IMAGE_CONTENT_VERSION`、`H3_SMOKE_AUDIO_RESOURCE_ID`、`H3_SMOKE_AUDIO_CONTENT_VERSION`，并把当前本地登录 Cookie 写入 `H3_SMOKE_COOKIE`。保存并运行下面的 `.tmp/h3-reference-audio-smoke.ps1`：

```powershell
$required = @(
  'H3_SMOKE_PROJECT_ID',
  'H3_SMOKE_IMAGE_RESOURCE_ID',
  'H3_SMOKE_IMAGE_CONTENT_VERSION',
  'H3_SMOKE_AUDIO_RESOURCE_ID',
  'H3_SMOKE_AUDIO_CONTENT_VERSION',
  'H3_SMOKE_COOKIE'
)
foreach ($name in $required) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Missing environment variable: $name" }
}

$imageVersion = [int]$env:H3_SMOKE_IMAGE_CONTENT_VERSION
$audioVersion = [int]$env:H3_SMOKE_AUDIO_CONTENT_VERSION
if ($imageVersion -lt 1 -or $audioVersion -lt 1) { throw 'Smoke content versions must be positive integers' }

$operationRequestId = [guid]::NewGuid().ToString()
$prompt = @'
subject_definitions:
<Subject 1> (S1) is the person shown in <Picture 1>.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).

summary:
<Subject 1> speaks one new line.

retention_analysis:
<Picture 1>: reference - preserve <Subject 1>.
<Audio 1>: reference - <Subject 1> (S1) follows its vocal timbre and measured delivery without copying the original signal.

detailed_description:
[Shot 1] <Subject 1> (S1) faces camera and says <d>[Chinese]这是新台词。</d>

overall_soundscape:
Clean speech with quiet room tone.

non_diegetic_music:
N/A
'@
$inputPayload = @{
  request = @{
    kind = 'new'
    items = @(@{
      itemId = 'h3-reference-audio-smoke'
      name = 'H3 参考音色样片'
      mediaType = 'video'
      schemaId = 'project.video_segment'
      durationSeconds = 8
      count = 1
      vocalPerformanceMode = 'native_dialogue'
      references = @(
        @{
          resourceId = $env:H3_SMOKE_IMAGE_RESOURCE_ID
          contentVersion = $imageVersion
          channel = 'image'
          role = 'reference_image'
        },
        @{
          resourceId = $env:H3_SMOKE_AUDIO_RESOURCE_ID
          contentVersion = $audioVersion
          channel = 'audio'
          role = 'reference_audio'
        }
      )
      prompt = $prompt
    })
  }
}
$headers = @{
  'Idempotency-Key' = $operationRequestId
  Cookie = $env:H3_SMOKE_COOKIE
}
$baseUrl = "http://localhost:3000/api/projects/$($env:H3_SMOKE_PROJECT_ID)/operations/create_video"
$plan = Invoke-RestMethod -Method Post -Uri "$baseUrl/plan" -Headers $headers -ContentType 'application/json' -Body (@{
  input = $inputPayload
  context = @{ locale = 'zh' }
} | ConvertTo-Json -Depth 20)
$execute = Invoke-RestMethod -Method Post -Uri "$baseUrl/execute" -Headers $headers -ContentType 'application/json' -Body (@{
  input = $inputPayload
  context = @{ locale = 'zh' }
  planSnapshotId = $plan.planSnapshotId
  operationRequestId = $plan.operationRequestId
} | ConvertTo-Json -Depth 20)
$execute | ConvertTo-Json -Depth 20
```

两次请求使用同一 `Idempotency-Key`。从 execute 响应保留 Task id，并通过现有 task API 读取终态。脚本运行后删除 `.tmp/h3-reference-audio-smoke.ps1`。

验收记录必须同时包含：

```text
Planner 冻结的 image/audio ResourceVersion
H3 Runtime 收到的 1 次音频上传
H3 Runtime 收到的 1 次 /prompt
LoadAudio → ref_audios.ref_audio_0 的 graph 连线
唯一 COMFYUI:h3-dual-stage-2mp:VIDEO:<promptId>
最终 MP4 同时有画面和音轨
指定人物说出新台词，音色可听辨地接近参考，口型与新台词对应
```

如果本地 H3 Runtime、可用资源 identity 或真实生成时长不可用，记录为“实现完成，真实效果未验证”，不声称效果验收完成。

- [ ] **Step 5: 只在上述证据都结束后做最终提交审计**

```powershell
git log --oneline -5
git diff HEAD~4..HEAD --stat
git status --short
```

确认四个实现提交分别是 H3 graph/input、H3 公开执行、voiceover 执行链退役、MOSS/default 退役。如果因修正验证问题产生额外提交，提交名必须指向单一根因，不使用宽泛的 `fix blockers`。
