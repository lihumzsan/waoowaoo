# MiniMax H3 首帧与首尾帧视频能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有 1–8 张多参考图视频能力的前提下，为同一个 `comfyui::minimax-h3-dual-stage-2mp` 模型增加首帧和首尾帧两种互斥输入模式，并通过真实 `create_video` 路径完成三种模式的最小成片验收。

**Architecture:** 产品层仍只有一个 H3 model identity、一个 ComfyUI adapter、一个 8188 runtime target、一个 submission fence、一个 external-id 协议和一个 WorkspaceResource terminal writer。内部使用两个冻结 graph profile：现有 `MiniMaxH3ReferenceToVideo` 图服务 `reference`；新增一份 `MiniMaxH3ImageToVideo` 图同时服务 `first_frame` 和 `first_last_frame`，区别只在是否连接尾帧。冻结的 `role + channel` 由唯一输入模式 resolver 解析，planner、provider transport 与执行器共同消费该结论。

**Tech Stack:** TypeScript、Next.js、Zod、Vitest、Temporal、ComfyUI `/prompt`/`/history`/`/queue`、JSON API graph、FFprobe。

**Spec:** `docs/superpowers/specs/2026-08-24-comfyui-h3-frame-video-design.md`

## Global Constraints

- 保留现有 `reference` 能力、1–8 张有序 `reference_image` 映射和 reference API graph；不得把单张普通参考图解释为首帧。
- 只新增 `first_frame` 与 `first_last_frame`；不支持 `text_to_video`、仅尾帧、参考音频、参考视频或普通参考图与帧图混用。
- 首帧和首尾帧共用同一份 frame API graph；不得复制 graph、model key、adapter、runtime target 或异步状态机。
- `comfyui::minimax-h3-dual-stage-2mp` 是唯一产品 identity；`h3-dual-stage-2mp` 继续是唯一外部 runtime target/external endpoint identity。内部 profile id 不写入 external id。
- 主 Agent 是最终 H3 Prompt 的唯一 writer；生产 graph 不得包含 `RH_CODEX_NODE`、`LoadImage`、桌面路径或 preview 数据。
- preflight 从实际选中的冻结 graph 派生 node class、model option 与 profile fingerprint；不得维护第二份手写模型清单。
- 不修改 schema，不执行 migration、回填、清理或其他 Provider 重构；不新增 fallback。
- targeted Vitest 显式排除 `.worktrees/**`。
- 每个代码任务先构造可反证失败，再写最小实现，再运行目标验证；不新增 mock 内部实现、源码字符串、调用次数或文件存在性测试。

---

## Task 1: 建立唯一视频输入模式裁判

**Files:**

- Create: `src/lib/video-generation/input-mode.ts`
- Modify: `src/lib/video-generation/reference-images.ts`
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts`
- Create: `tests/unit/video-generation/input-mode.test.ts`
- Modify: `tests/unit/video-generation/reference-images.test.ts`

### 1.1 先写角色集合 oracle

- [ ] 覆盖：空输入 -> `text_to_video`；1–8 张 `image/reference_image` -> `reference`；一张首帧 -> `first_frame`；首尾各一张 -> `first_last_frame`。
- [ ] 覆盖尾帧缺首帧、重复首/尾帧、普通参考图与帧图混用、非法 `channel + role` 均明确失败。
- [ ] 覆盖参考音频/视频被计数但不冒充图片模式；首尾解析不依赖数组顺序。
- [ ] Run and expect FAIL because module does not exist:

```powershell
npx.cmd vitest run tests/unit/video-generation/input-mode.test.ts --exclude ".worktrees/**"
```

### 1.2 实现唯一 resolver

- [ ] 在 `input-mode.ts` 定义：

```ts
export type VideoInputReference = {
  readonly channel: 'image' | 'audio' | 'video'
  readonly role: string
}

export type VideoInputModeErrorCode =
  | 'VIDEO_REFERENCE_ROLE_INVALID'
  | 'VIDEO_MODEL_FRAME_INPUT_INVALID'
  | 'VIDEO_REFERENCE_MODE_CONFLICT'

export class VideoInputModeError extends Error {
  readonly code: VideoInputModeErrorCode
}

export type ResolvedVideoInputMode = {
  readonly mode: VideoInputMode
  readonly firstFrameCount: number
  readonly lastFrameCount: number
  readonly referenceImageCount: number
  readonly referenceAudioCount: number
  readonly referenceVideoCount: number
  readonly usesLastFrame: boolean
}

export function resolveVideoInputMode(
  references: readonly VideoInputReference[],
): ResolvedVideoInputMode
```

- [ ] 先验证合法 role-channel 对再统计；模式只由显式 role 决定，不读取 URL、数量启发式、数组位置、历史记录或模型名称。
- [ ] `reference-images.ts` 先调用 resolver，再按 mode 构造 provider payload；保留冻结 resource/version 与有序 URL 映射。
- [ ] `generation-ops.ts::validateReferenceCapabilities` 删除本地模式推断，消费同一个 resolver 结果；能力校验继续读取生产 registry。
- [ ] resolver 错误翻译为现有 operation 错误边界，不泄露内部异常。

### 1.3 验证并提交

- [ ] Run:

```powershell
npx.cmd vitest run tests/unit/video-generation/input-mode.test.ts tests/unit/video-generation/reference-images.test.ts --exclude ".worktrees/**"
npm.cmd run typecheck
git diff --check
```

- [ ] 检查 `git log --follow -- src/lib/video-generation/reference-images.ts`，再只提交本任务文件：

```powershell
git add src/lib/video-generation/input-mode.ts src/lib/video-generation/reference-images.ts src/lib/operations/domains/workspace-resource/generation-ops.ts tests/unit/video-generation/input-mode.test.ts tests/unit/video-generation/reference-images.test.ts
git commit -m "refactor(video): centralize input mode resolution"
```

---

## Task 2: 将 H3 Prompt 契约扩展为三模式

**Files:**

- Modify: `src/lib/ai-registry/types.ts`
- Rename: `src/lib/video-generation/h3-reference-prompt.ts` -> `src/lib/video-generation/h3-prompt.ts`
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts`
- Modify: `src/lib/ai-providers/comfyui/h3.ts`
- Modify: `src/lib/creative-skills/skills/video-direction/SKILL.md`
- Rename: `tests/unit/video-generation/h3-reference-prompt.test.ts` -> `tests/unit/video-generation/h3-prompt.test.ts`

### 2.1 先扩充 grammar oracle

- [ ] reference 保留现有六段式语法；`first_frame` 必须有 `Picture1` 的 0.00s 锚点。
- [ ] `first_last_frame` 必须有 `Picture1` 的 0.00s 锚点及 `Picture2` 的片尾锚点，片尾时间必须等于冻结 `durationSeconds`。
- [ ] 三模式的 `non_diegetic_music` 都固定为 `N/A`；reference 不受帧锚点误伤。
- [ ] 不扩展 `video-direction-runtime-skill.contract.test.ts` 的源码字符串断言；若它因文案改变失败，确认无独立 oracle 后删除无效断言，而不是扭曲生产文案。
- [ ] Run renamed test and expect frame cases FAIL。

### 2.2 实现 v3 profile

- [ ] 在 `VIDEO_PROMPT_PROFILES` 增加并选用 `minimax_h3_multimodal_v3`；旧 literal 仅在仍有真实消费者时保留。
- [ ] 收敛公共签名：

```ts
export function assertVideoPromptMatchesProfile(input: {
  readonly profile: VideoPromptProfile
  readonly prompt: string
  readonly inputMode: VideoInputMode
  readonly durationSeconds: number
}): void
```

- [ ] 共用 section/time-line parser；仅图片锚点约束按 mode 分支，不复制完整 parser。
- [ ] planner 的每个 Prompt 校验调用都传 resolver 结果和冻结时长；provider 执行边界再次调用同一 validator。
- [ ] 更新 `src/lib/creative-skills/skills/video-direction/SKILL.md`：说明三种互斥 mode 的 Picture 语义，删除 reference-only 范围结论；主 Agent 一次性写最终 Prompt 的规则不变。

### 2.3 验证并提交

- [ ] Run:

```powershell
npx.cmd vitest run tests/unit/video-generation/h3-prompt.test.ts --exclude ".worktrees/**"
npm.cmd run typecheck
git diff --check
```

- [ ] Commit task-owned rename and edits:

```powershell
git add src/lib/ai-registry/types.ts src/lib/video-generation/h3-prompt.ts src/lib/operations/domains/workspace-resource/generation-ops.ts src/lib/ai-providers/comfyui/h3.ts src/lib/creative-skills/skills/video-direction/SKILL.md tests/unit/video-generation/h3-prompt.test.ts
git add -u src/lib/video-generation/h3-reference-prompt.ts tests/unit/video-generation/h3-reference-prompt.test.ts
git commit -m "feat(video): define H3 multimodal prompt contract"
```

---

## Task 3: 扩展 registry、adapter 与 planner capability

**Files:**

- Modify: `src/lib/ai-providers/comfyui/models.ts`
- Modify: `src/lib/ai-providers/comfyui/adapter.ts`
- Modify: `src/lib/operations/domains/workspace-resource/generation-ops.ts`
- Modify: `tests/contracts/comfyui-h3-profile-conformance.test.ts`
- Modify: `tests/integration/task/project-video-model-config.integration.test.ts`

### 3.1 先从生产 registry 建立失败证据

- [ ] conformance 从生产 model registry 读取 H3，断言：

```ts
expect(model.capabilities.supportedInputModes).toEqual([
  'reference',
  'first_frame',
  'first_last_frame',
])
expect(model.capabilities.promptProfile).toBe('minimax_h3_multimodal_v3')
expect(model.runtimeTarget).toBe('h3-dual-stage-2mp')
```

- [ ] 通过真实 operation registry + `planOperation` 分别规划三种合法模式；混合输入和仅尾帧必须不可规划。
- [ ] Run the two tests and expect FAIL because registry/adapter are still reference-only。

### 3.2 扩展唯一 model 与 adapter

- [ ] 只修改现有 `comfyui::minimax-h3-dual-stage-2mp`：

```ts
promptProfile: 'minimax_h3_multimodal_v3',
supportedInputModes: ['reference', 'first_frame', 'first_last_frame'],
```

- [ ] 保留 runtime target、4–13 秒、现有宽高比、1–8 references、音频生成要求和 provider identity。
- [ ] `adapter.ts` 允许 `lastFrameImageUrl` 与 `referenceImages`，外层 `imageUrl` 继续承载首帧；删除对象层“必须有 referenceImages”的 refine。
- [ ] adapter 只做 transport 字段校验，不重新解释业务 mode。
- [ ] `providerTransportPreflightOptions`：reference 构造有序 placeholder references；first-last 构造 placeholder last frame；first frame 仍由外层 `imageUrl` 传递。schema preflight 与冻结 execution options 必须复用同一 helper。

### 3.3 验证并提交

- [ ] Run:

```powershell
npx.cmd vitest run tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/task/project-video-model-config.integration.test.ts tests/unit/video-generation/input-mode.test.ts tests/unit/video-generation/reference-images.test.ts --exclude ".worktrees/**"
npm.cmd run typecheck
git diff --check
```

- [ ] Commit:

```powershell
git add src/lib/ai-providers/comfyui/models.ts src/lib/ai-providers/comfyui/adapter.ts src/lib/operations/domains/workspace-resource/generation-ops.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/task/project-video-model-config.integration.test.ts
git commit -m "feat(video): expose H3 frame input modes"
```

---

## Task 4: 冻结并接入唯一 frame API graph

**Files:**

- Create: `src/lib/ai-providers/comfyui/workflows/h3-frame-dual-stage-2mp.json`
- Modify: `src/lib/ai-providers/comfyui/profiles.ts`
- Modify: `tests/unit/ai-providers/comfyui/h3-dual-stage-profile.test.ts`
- Create: `tests/unit/ai-providers/comfyui/h3-frame-dual-stage-profile.test.ts`

### 4.1 先写 graph conformance

- [ ] 断言节点 309 是 `MiniMaxH3ImageToVideo`，节点 127/306 分别使用 FL2VA 一采/二采模型。
- [ ] 首帧 137/198 接入 `first_frame`；first-last 中尾帧 326/327 接入 `last_frame`。
- [ ] first-frame builder 删除尾帧 loader/resize 与 309 `last_frame` input；first-last 使用同一 frame base graph。
- [ ] 两模式都保留 prompt 138、10/3 有效 steps、1MP/2MP RTX VSR、cache handoff、输出 168、24fps/H.264/YUV420P/CRF10 与音频。
- [ ] graph 不含 `RH_CODEX_NODE`、`LoadImage` 或桌面绝对路径。
- [ ] 保留 reference profile 回归，证明 1–8 张 `ref_image_N` 映射不变。
- [ ] Run both profile tests; reference passes, new frame test fails because builder is absent。

### 4.2 裁剪 canonical API graph

- [ ] 以 `D:\workspace\comfui\workflows\MiniMax H3首尾帧视频_双阶段重绘_二采1MP_RTXVSR成片2MP.json`（SHA-256 `C209491AE29FF53178CCDDF5E2C7AA0F2405A81F3C57E171DACDD9B87AA3A4CC`）为事实依据，转换并版本化最小 API graph。
- [ ] 保留设计规范中的 FL2VA 模型、CLIP、视频/音频 VAE、8-step LoRA、sampler/scheduler、10/3 steps、`denoise=0.2`、两次 VSR、两个 cache handoff 和输出 168。
- [ ] 删除 canvas group/position/preview、未连接节点、本地 filename 与 Codex 节点；运行时不读取桌面 workflow。

### 4.3 实现两个 profile、一个 selector

- [ ] `profiles.ts` 定义 discriminated union：

```ts
export type H3PromptGraphInput =
  | { readonly mode: 'reference'; readonly prompt: string; readonly referenceImageUrls: readonly string[]; readonly durationSeconds: number; readonly aspectRatio: H3AspectRatio; readonly seed: number }
  | { readonly mode: 'first_frame'; readonly prompt: string; readonly firstFrameUrl: string; readonly durationSeconds: number; readonly aspectRatio: H3AspectRatio; readonly seed: number }
  | { readonly mode: 'first_last_frame'; readonly prompt: string; readonly firstFrameUrl: string; readonly lastFrameUrl: string; readonly durationSeconds: number; readonly aspectRatio: H3AspectRatio; readonly seed: number }
```

- [ ] 一个 selector/builder 根据 mode 选择 reference 或 frame frozen graph；first-frame 只从 frame clone 删除尾帧分支。
- [ ] 两个内部 profile id 不同但 output node 都为 168；外部 `H3_DUAL_STAGE_RUNTIME_PROFILE.target` 不变。
- [ ] builder 仅注入已验证 URL、duration、aspect ratio、seed、最终 Prompt，不解析资源或创作 Prompt。

### 4.4 验证并提交

- [ ] Run:

```powershell
npx.cmd vitest run tests/unit/ai-providers/comfyui/h3-dual-stage-profile.test.ts tests/unit/ai-providers/comfyui/h3-frame-dual-stage-profile.test.ts --exclude ".worktrees/**"
npm.cmd run typecheck
git diff --check
```

- [ ] 人工对照源 workflow 的模型与 class 列表；源 canvas 不复制进仓库。
- [ ] Commit:

```powershell
git add src/lib/ai-providers/comfyui/workflows/h3-frame-dual-stage-2mp.json src/lib/ai-providers/comfyui/profiles.ts tests/unit/ai-providers/comfyui/h3-dual-stage-profile.test.ts tests/unit/ai-providers/comfyui/h3-frame-dual-stage-profile.test.ts
git commit -m "feat(comfyui): add H3 frame dual-stage graph"
```

---

## Task 5: 从 selected graph 派生 preflight 并完成执行选择

**Files:**

- Create: `src/lib/ai-providers/comfyui/profile-requirements.ts`
- Modify: `src/lib/ai-providers/comfyui/profiles.ts`
- Modify: `src/lib/ai-providers/comfyui/h3.ts`
- Modify: `tests/contracts/comfyui-h3-profile-conformance.test.ts`
- Modify: `tests/integration/provider/comfyui-h3-submission.contract.test.ts`

### 5.1 扩展真实 provider protocol boundary

- [ ] 在现有 fake ComfyUI HTTP server 上经真实 adapter/provider 分别提交三种 mode 并捕获 `/prompt` body。
- [ ] reference 必须选择 `MiniMaxH3ReferenceToVideo` 且 refs 有序；first-frame/first-last 必须选择同一 `MiniMaxH3ImageToVideo` graph，差异仅尾帧。
- [ ] 三者 endpoint/external target 都为 `h3-dual-stage-2mp`，output 仍读取 168。
- [ ] 混合 input、仅尾帧、参考音频/视频在 `/prompt` 前失败。
- [ ] 既有 4xx rejection、5xx ambiguous acceptance、accepted probe、poll/cancel disposition 不回归。
- [ ] fake 只替代 ComfyUI 协议边界，不 mock resolver、builder、adapter 或 provider service。
- [ ] Run and expect FAIL because `h3.ts` remains reference-only。

### 5.2 实现 graph requirements 派生器

- [ ] `profile-requirements.ts` 从 selected graph 提取唯一 `class_type` 和需要由 `/object_info` 枚举验证的 model/checkpoint/vae/clip/lora/upscale/provider option。
- [ ] 用明确的 node-input schema registry 描述“哪个字段是 option”；不得再次手写“本 H3 需要哪些模型”。
- [ ] 接口：

```ts
export type ComfyUiProfileRequirements = {
  readonly nodeClasses: readonly string[]
  readonly options: readonly {
    readonly classType: string
    readonly inputName: string
    readonly value: string
  }[]
  readonly fingerprint: string
}

export function deriveComfyUiProfileRequirements(input: {
  readonly profileId: string
  readonly graph: ComfyUiPromptGraph
}): ComfyUiProfileRequirements
```

- [ ] fingerprint 为 `profileId + canonical graph JSON` 的稳定 SHA-256；preflight cache key 至少包含 `baseUrl + fingerprint`，graph 改变自动失效。

### 5.3 改造 H3 build/submit 边界

- [ ] `h3.ts` 把 `referenceImages` 映射为 `reference_image`，`input.imageUrl` 映射为 `first_frame`，`lastFrameImageUrl` 映射为 `last_frame`，再调用 canonical resolver。
- [ ] 根据 resolver 结论构造 Task 4 union，执行 v3 Prompt 校验、selected graph requirements preflight 与 `/prompt` 提交。
- [ ] 删除 reference-only 的 `imageUrl`/`lastFrameImageUrl` 拒绝和手写 `expectedModels`，不保留旧旁路。
- [ ] 保持 `generateAudio === true`、4–13 秒/frame-grid、aspect ratio、seed、fence、accepted probe、poll/cancel、output 168、URL 下载和 external id endpoint。
- [ ] selected graph 缺节点/模型/option 时提交前明确失败；不得切图或回退 shared runtime。

### 5.4 验证并提交

- [ ] Run:

```powershell
npx.cmd vitest run tests/integration/provider/comfyui-h3-submission.contract.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/unit/ai-providers/comfyui/h3-dual-stage-profile.test.ts tests/unit/ai-providers/comfyui/h3-frame-dual-stage-profile.test.ts --exclude ".worktrees/**"
npm.cmd run typecheck
git diff --check
```

- [ ] Commit:

```powershell
git add src/lib/ai-providers/comfyui/profile-requirements.ts src/lib/ai-providers/comfyui/profiles.ts src/lib/ai-providers/comfyui/h3.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts
git commit -m "feat(comfyui): route H3 input modes to frozen graphs"
```

---

## Task 6: 静态集成验收与独立 review

**Files:** Review all task-owned files; only modify when a real failure identifies a production defect or invalid existing test.

### 6.1 审核唯一入口与删除项

- [ ] Run:

```powershell
rg -n "h3-reference-prompt|minimax_h3_reference_v2|expectedModels|MiniMaxH3ImageToVideo|MiniMaxH3ReferenceToVideo|supportedInputModes" src tests
```

- [ ] Prompt validator 只有新 canonical 模块；旧 profile literal 仅在有真实消费者时存在；H3 没有手写 model requirements。
- [ ] model key、runtime target、external-id endpoint、adapter、poll/cancel、terminal writer 的数量均未增加。
- [ ] 对实际修改的生产文件运行 `git log --follow -- <file>`，确认最近改动意图。

### 6.2 运行针对性验证

- [ ] Run:

```powershell
npx.cmd vitest run tests/unit/video-generation/input-mode.test.ts tests/unit/video-generation/reference-images.test.ts tests/unit/video-generation/h3-prompt.test.ts tests/unit/ai-providers/comfyui/h3-dual-stage-profile.test.ts tests/unit/ai-providers/comfyui/h3-frame-dual-stage-profile.test.ts tests/contracts/comfyui-h3-profile-conformance.test.ts tests/integration/task/project-video-model-config.integration.test.ts tests/integration/provider/comfyui-h3-submission.contract.test.ts --exclude ".worktrees/**"
npm.cmd run typecheck
npm.cmd run lint
```

- [ ] lint 若为全仓遗留失败，记录精确失败及是否命中本次文件；本次文件错误必须修复，不得把遗留失败描述为通过。
- [ ] Run `npm.cmd run build:verify`。若 Windows Prisma DLL 锁阻止到达 Next.js oracle，确认锁来源后使用仓库既有 `.next-verify` 独立输出方式验证，并记录标准命令盲区；不删除用户进程/文件。

### 6.3 审查与最终静态检查

- [ ] Run:

```powershell
git diff --check next/upstream-assistant...HEAD
git status --short
git log --oneline --decorate next/upstream-assistant..HEAD
```

- [ ] 对照规范确认：三模式、两 graph、一个 model/runtime、统一 resolver、统一 Prompt writer、派生 preflight、无 fallback、无 schema 变更。
- [ ] 使用 `superpowers:requesting-code-review` 做独立 review；对发现按 `superpowers:receiving-code-review` 验证后修复并重跑受影响命令。

---

## Task 7: 本机真实 `create_video` 三模式验收

**Files:** No repository changes expected. 不提交生成媒体、日志、`.env*`、凭据、preview 或本地 workflow。

### 7.1 验证实时依赖和宿主 readiness

- [ ] 检查 `127.0.0.1:8188/system_stats` 与 `/object_info`，确认 selected graph 派生的 node class、model option 与 RTX VSR/VideoCombine 仍存在；这只算依赖证据。
- [ ] 使用 `project-restart` skill 重启 Windows 宿主 Next.js 与 Temporal Worker，使新 registry/provider 生效；请求级 graph 不要求重启 ComfyUI。
- [ ] 确认前端/API readiness、Worker registration 和 lease owner，记录实际 URL/PID/日志证据。

### 7.2 准备冻结输入

- [ ] 从当前项目 ready WorkspaceResource 选择并记录 `resourceId + contentVersion`：reference 至少一张普通参考图；first-frame 一张首帧；first-last 一张首帧和一张尾帧。
- [ ] 三个最小样本使用 4 秒和共同支持的 aspect ratio；Prompt 遵循各 mode v3 profile，`non_diegetic_music: N/A`。
- [ ] 不用本地路径、临时 URL 或错误 role 绕过资源冻结。

### 7.3 依次触发 canonical operation

- [ ] 通过真实 `create_video` 分别提交 reference、first-frame、first-last；每个请求使用唯一 `requestId/sourceId`。
- [ ] 记录 planner accepted、provider accepted、external id、Temporal lifecycle、completed、ready WorkspaceResource、冻结 references 和 output lineage。
- [ ] 任一模式失败时停止扩大样本，用 `superpowers:systematic-debugging` 沿 planner -> frozen payload -> provider graph -> ComfyUI history -> terminal writer 找第一处权威失败，修复后重跑该模式和受影响回归。
- [ ] 禁止用直接 `/prompt` 替代 canonical 业务验收。

### 7.4 验证成片事实

- [ ] 对三个最终 MP4 运行：

```powershell
ffprobe -v error -show_entries format=duration -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate -of json <absolute-video-path>
```

- [ ] 每个样本必须有 H.264 视频流、24fps、约 2MP 尺寸、音频流和约 4 秒 duration；首尾帧样本人工检查开头/结尾与冻结输入对应。
- [ ] 若未实际覆盖 13 秒、全部宽高比、8 references、取消、重试及 ComfyUI 重启恢复，交付时列为盲区，不声称架构完成。

### 7.5 最终交付

- [ ] 确认 worktree clean，生成物未 stage；若真实验收触发修复，使用独立 commit 并重跑受影响的 Task 6/7。
- [ ] 交付包含以下参照物对齐表：

| 参照物触点 | 新实例覆盖 / 不适用原因 | 验证 |
|---|---|---|
| model identity / registry | 同一 H3 model，新增两个 mode | registry conformance |
| frozen inputs | 首尾帧沿既有 WorkspaceResource version 冻结 | planner + lineage |
| planner / capability | 唯一 resolver + production registry | operation integration |
| provider transport | `imageUrl` + optional `lastFrameImageUrl` | adapter/provider contract |
| graph execution | 一个 frame graph 服务两帧模式 | graph conformance + captured `/prompt` |
| preflight | selected graph 派生 fingerprint/node/options | provider contract + live `/object_info` |
| submission lifecycle | 复用 fence/external id/poll/cancel | provider contract + runtime logs |
| terminal persistence | 复用 WorkspaceResource terminal writer | ready resource + lineage |
| failure / recovery | 复用明确失败与 Temporal retry owner | contract；未实测项声明盲区 |
| permissions / i18n | 复用 `create_video` 鉴权与错误翻译 | canonical trigger；无新 UI 文案 |

- [ ] 只有三个真实最小样本和适用静态验证通过时称“实现完成”；未覆盖完整组合时不使用“彻底、不会复发、架构完成”。

---

## Completion Evidence Checklist

- [ ] 分支为 `codex/feat-comfyui-h3-frame-video`，基线保持 `next/upstream-assistant`。
- [ ] reference graph 与 1–8 张映射有回归证据。
- [ ] first-frame 与 first-last 共享唯一 frame graph。
- [ ] model key、adapter、runtime target、external id、poll/cancel、terminal writer 各只有一个。
- [ ] mode 只由冻结 `role + channel` 的 canonical resolver 决定。
- [ ] Prompt v3 覆盖三模式且主 Agent 是唯一 writer。
- [ ] selected graph requirements 与 preflight fingerprint 均由 graph 派生。
- [ ] targeted tests、typecheck、lint/build 的真实结果已记录。
- [ ] 三个 canonical `create_video` 样本达到 ready Resource，FFprobe 与 lineage 已核验。
- [ ] 未验证组合和任何残余双轨已如实列出。
