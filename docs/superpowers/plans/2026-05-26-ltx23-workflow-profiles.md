# LTX2.3 工作流 Profile 化接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先接入 7 类 LTX2.3 工作流能力画像，支持手动选择和 profile 化运行，不在本阶段做自动推荐。

**Architecture:** 新增一个 LTX2.3 workflow profile 层，把每个 ComfyUI workflow key 的类别、输入图槽位、时长上限、PromptRelay 策略、是否可在分镜面板选择都收口到一个 TypeScript 模块。现有 ComfyUI registry 仍然负责加载和注入 workflow JSON，video generator、音频时长绑定、prompt enhance、catalog/UI 只读取 profile 决策，不把 T8/大麦茶特殊逻辑散落在业务代码里。

**Tech Stack:** Next.js 15, TypeScript, Vitest, ComfyUI workflow JSON, PromptRelay, existing model capability catalog, existing video worker queue.

---

## 分支和阶段边界

当前分支已经确认是：

```bash
git branch --show-current
```

期望输出：

```text
codex/ltx23-workflow-profiles
```

本计划只做工作流接入，不做自动推荐。自动推荐需要等这批 profile 跑通后再基于真实效果和失败原因做规则或模型路由。

本阶段包含 7 类能力：

| 类别 | 第一阶段工作流 | 面板可选 | 说明 |
|---|---|---:|---|
| 单图精准图生视频 | T8 Smart VBVR 390K V2 | 是 | 默认 profile，适合 4-12 秒稳定主体 |
| 微表情 / 细节变化 | T8 Sulphur-2 PromptRelay | 是 | 适合眼神、嘴型、手部细节 |
| 单图大幅变化 | T8 四重控制派生版 | 是 | 外部只收 1 张图，内部四段过渡，时长 12-20 秒 |
| 首尾帧 | T8 丝滑首尾帧 + 保留现有首尾帧 | 是 | 第一阶段只接手动选择，不设默认 |
| 长视频 / 20-30 秒 | 大麦茶图生 30 秒 + 长视频 PromptRelay | 是 | 替代当前 12 秒上限和自动拆段逻辑 |
| AIO 兜底 | 大麦茶 AIO V2 无字幕版 | 是 | 不作为默认，只给复杂场景人工兜底 |
| 后处理 | T8 ICLORA 修复高清化 + Edit Anything | 否 | 先作为 workflow profile 注册，不混入图生视频主链路 |

## 源工作流文件

只从这些已下载文件复制进入项目，不直接依赖下载目录运行：

```text
/Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2054480431743021058-Ltx2-3-Prompt-Relay-Smart-VBVR-390K-V2.json
/Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2054743040564178946-Ltx2-3-Sulphur-2-Prompt-Relay.json
/Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2052622530854301697-ltx2-3-VBVR-transition-Prompt-Relay-V1.json
/Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2052425175639052290-LTX2-3-V1.json
/Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2053727074506035201-LTX-2-3-ICLORA-V1.json
/Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2052715103241416706-LTX2-3-Edit-Anything.json
/Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-damaicha-workflows/workflows/2043904012268871681-LTX2-3-image-to-30s-long-video.json
/Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-damaicha-workflows/workflows/2049157702005297154-LTX2-3-long-video-PromptRelay.json
/Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-damaicha-workflows/workflows/2050758511885332481-LTX2-3-AIO-V2-no-subtitles.json
```

## 文件结构

- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/ltx23-workflow-profiles.ts`
  - 维护 7 类 profile、workflow key、输入图槽位策略、时长范围、PromptRelay 策略和面板可见性。
- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/*.json`
  - 项目内置的 T8 / 大麦茶 workflow JSON。
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflow-registry.ts`
  - 在 LoadImage 注入前按 profile 扩展图片槽位。
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/client.ts`
  - 允许视频 workflow 上传 `referenceImageUrls`，为后续多参考图保留接口。
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/generators/comfyui-video.ts`
  - 默认改成 T8 Smart VBVR profile，保留旧多镜头 workflow 的降级逻辑。
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/video-duration/audio-binding.ts`
  - 从固定 12 秒 cap 改成 profile max duration。
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/workers/video.worker.ts`
  - normal 模式不再对 LTX2.3 长音频做自动拆段和 concat，长视频交给长视频 workflow。
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/video-duration/ltx23-prompt-enhance.ts`
  - 静态镜头约束改成 profile-aware，大幅变化和长视频允许连续运镜。
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/standards/capabilities/image-video.catalog.json`
  - 注册可手动选择的视频 profile 和时长选项。
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/profile/components/api-config/types.ts`
  - 添加用户可见的 ComfyUI LTX2.3 profile 模型名。
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceProjectSnapshot.ts`
  - 更新默认视频模型和旧默认归一化。
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/usePanelVideoModel.ts`
  - 更新面板默认视频模型和旧默认归一化。
- Test: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts`
- Test: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui/workflow-registry.test.ts`
- Test: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui-client.test.ts`
- Test: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/generators/comfyui-video.test.ts`
- Test: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/video/audio-binding.test.ts`
- Test: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/video/ltx23-prompt-enhance.test.ts`
- Test: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/worker/video-worker.test.ts`
- Test: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/model-capabilities/comfyui-video-capabilities.test.ts`

### Task 1: 复制选中的 workflow JSON，并派生单图大幅变化工作流

**Files:**
- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2.json`
- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-sulphur2-promptrelay-micro.json`
- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-single-image-large-motion-4stage.json`
- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/<removed-legacy-first-last-frame-workflow>.json`
- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/damaicha-image-to-30s-long-video.json`
- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/damaicha-long-video-promptrelay.json`
- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/damaicha-aio-v2-no-subtitles.json`
- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-iclora-restore-upscale.json`
- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-edit-anything.json`

- [ ] **Step 1: 复制 workflow 文件到项目内置目录**

Run:

```bash
mkdir -p /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles
cp /Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2054480431743021058-Ltx2-3-Prompt-Relay-Smart-VBVR-390K-V2.json /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2.json
cp /Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2054743040564178946-Ltx2-3-Sulphur-2-Prompt-Relay.json /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-sulphur2-promptrelay-micro.json
cp /Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2052622530854301697-ltx2-3-VBVR-transition-Prompt-Relay-V1.json /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-single-image-large-motion-4stage.json
cp /Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2052425175639052290-LTX2-3-V1.json /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/<removed-legacy-first-last-frame-workflow>.json
cp /Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-damaicha-workflows/workflows/2043904012268871681-LTX2-3-image-to-30s-long-video.json /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/damaicha-image-to-30s-long-video.json
cp /Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-damaicha-workflows/workflows/2049157702005297154-LTX2-3-long-video-PromptRelay.json /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/damaicha-long-video-promptrelay.json
cp /Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-damaicha-workflows/workflows/2050758511885332481-LTX2-3-AIO-V2-no-subtitles.json /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/damaicha-aio-v2-no-subtitles.json
cp /Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2053727074506035201-LTX-2-3-ICLORA-V1.json /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-iclora-restore-upscale.json
cp /Users/tigli/Documents/Codex/2026-05-21/hyperframes-plugin-hyperframes-openai-curated/analysis/runninghub-ltx23-t8-workflows/workflows/2052715103241416706-LTX2-3-Edit-Anything.json /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-edit-anything.json
```

Expected: 9 个 workflow JSON 文件存在。

- [ ] **Step 2: 调整单图大幅变化派生 workflow 的四段约束**

Run:

```bash
node <<'NODE'
const fs = require('fs')
const path = '/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/t8-single-image-large-motion-4stage.json'
const workflow = JSON.parse(fs.readFileSync(path, 'utf8'))
for (const node of workflow.nodes || []) {
  if (node.id === 1408 || node.id === 1409) {
    node.widgets_values = [0, 0.92, 96, 0.72, 192, 0.56, -1, 0.42, 0.55, 0]
  }
  if (node.id === 1418 && Array.isArray(node.widgets_values)) {
    node.widgets_values[1] = 385
    node.widgets_values[3] = '主体从起始画面进入动作准备，身份、服装和环境保持一致 | 动作开始扩大，身体姿态和画面重心发生明显变化 | 动作进入高潮，允许连续推近、平移或跟随，但不切换场景 | 动作完成并稳定到新的画面状态，保留主体身份和环境连续性'
    node.widgets_values[4] = '96, 96, 96, 97'
  }
  if (node.id === 1416 && node.widgets_values && typeof node.widgets_values === 'object') {
    node.widgets_values.frame_rate = 25
  }
}
fs.writeFileSync(path, JSON.stringify(workflow, null, 2) + '\n')
NODE
```

Expected: 派生版仍然是 4 个 LoadImage，但四段 guide 强度从全 1 改成前强后弱，PromptRelay 默认段落改成“单图起点 + 四段大幅变化”。

- [ ] **Step 3: 校验 workflow JSON**

Run:

```bash
jq empty /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/*.json
```

Expected: 无输出，退出码为 0。

- [ ] **Step 4: 提交 workflow 文件**

Run:

```bash
git add /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles
git commit -m "chore: bundle ltx23 profile workflows"
```

Expected: 只提交 workflow JSON 文件。

### Task 2: 新增 LTX2.3 workflow profile 元数据

**Files:**
- Create: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/ltx23-workflow-profiles.ts`
- Create: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts`

- [ ] **Step 1: 写失败测试**

Create `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
  COMFYUI_LTX23_WORKFLOW_KEYS,
  expandLtx23WorkflowImageFilenames,
  getLtx23WorkflowProfile,
  isComfyUiLtx23LongVideoWorkflow,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'

describe('ltx23 workflow profiles', () => {
  it('defaults to the T8 Smart VBVR single-image profile', () => {
    expect(COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise)
    expect(getLtx23WorkflowProfile(COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise)).toMatchObject({
      category: 'single_image_precise',
      promptPolicy: 'stable_single_image',
      imageSlotPolicy: 'single',
      maxDurationSeconds: 12,
      selectableInPanel: true,
    })
  })

  it('expands one image into four slots for the single-image large-motion profile', () => {
    expect(expandLtx23WorkflowImageFilenames(
      COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
      ['first.png'],
    )).toEqual(['first.png', 'first.png', 'first.png', 'first.png'])
  })

  it('keeps first and last images distinct for smooth first-last-frame slots', () => {
    expect(expandLtx23WorkflowImageFilenames(
      COMFYUI_LTX23_WORKFLOW_KEYS.smoothFirstLastFrame,
      ['first.png', 'last.png'],
    )).toEqual(['first.png', 'last.png', 'last.png'])
  })

  it('marks long-video workflows separately', () => {
    expect(isComfyUiLtx23LongVideoWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s)).toBe(true)
    expect(isComfyUiLtx23LongVideoWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.microDetail)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts
```

Expected: 模块不存在导致失败。

- [ ] **Step 3: 创建 profile 实现**

Create `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/ltx23-workflow-profiles.ts`:

```ts
export const COMFYUI_LTX23_WORKFLOW_KEYS = {
  singleImagePrecise: 'basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
  microDetail: 'basevideo/ltx23-profiles/t8-sulphur2-promptrelay-micro',
  singleImageLargeMotion: 'basevideo/ltx23-profiles/t8-single-image-large-motion-4stage',
  smoothFirstLastFrame: 'basevideo/ltx23-profiles/<removed-legacy-first-last-frame-workflow>',
  existingFirstLastFrame: 'basevideo/首尾帧/ltx2.3首尾帧',
  damaichaImageTo30s: 'basevideo/ltx23-profiles/damaicha-image-to-30s-long-video',
  damaichaLongPromptRelay: 'basevideo/ltx23-profiles/damaicha-long-video-promptrelay',
  damaichaAioV2: 'basevideo/ltx23-profiles/damaicha-aio-v2-no-subtitles',
  t8IcloraRestoreUpscale: 'basevideo/ltx23-profiles/t8-iclora-restore-upscale',
  t8EditAnything: 'basevideo/ltx23-profiles/t8-edit-anything',
} as const

export const COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID = COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise

export type Ltx23WorkflowCategory =
  | 'single_image_precise'
  | 'micro_detail'
  | 'single_image_large_motion'
  | 'first_last_frame'
  | 'long_video'
  | 'aio_fallback'
  | 'postprocess'

export type Ltx23PromptPolicy =
  | 'stable_single_image'
  | 'micro_detail'
  | 'large_motion_single_image'
  | 'first_last_frame'
  | 'long_promptrelay'
  | 'aio'
  | 'postprocess'

export type Ltx23ImageSlotPolicy =
  | 'single'
  | 'repeat_single_to_four'
  | 'repeat_single_to_three'
  | 'first_last_three'

export interface Ltx23WorkflowProfile {
  workflowKey: string
  label: string
  category: Ltx23WorkflowCategory
  promptPolicy: Ltx23PromptPolicy
  imageSlotPolicy: Ltx23ImageSlotPolicy
  maxDurationSeconds: number | null
  defaultDurationSeconds: number
  durationOptions: number[]
  fps: number
  selectableInPanel: boolean
  postprocessOnly: boolean
}

const PROFILES: Ltx23WorkflowProfile[] = [
  {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise,
    label: 'ComfyUI · LTX2.3 单图精准 Smart VBVR',
    category: 'single_image_precise',
    promptPolicy: 'stable_single_image',
    imageSlotPolicy: 'single',
    maxDurationSeconds: 12,
    defaultDurationSeconds: 6,
    durationOptions: [4, 5, 6, 8, 10, 12],
    fps: 25,
    selectableInPanel: true,
    postprocessOnly: false,
  },
  {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.microDetail,
    label: 'ComfyUI · LTX2.3 微表情 Sulphur2',
    category: 'micro_detail',
    promptPolicy: 'micro_detail',
    imageSlotPolicy: 'single',
    maxDurationSeconds: 12,
    defaultDurationSeconds: 6,
    durationOptions: [4, 5, 6, 8, 10, 12],
    fps: 25,
    selectableInPanel: true,
    postprocessOnly: false,
  },
  {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
    label: 'ComfyUI · LTX2.3 单图大幅变化四段控制',
    category: 'single_image_large_motion',
    promptPolicy: 'large_motion_single_image',
    imageSlotPolicy: 'repeat_single_to_four',
    maxDurationSeconds: 20,
    defaultDurationSeconds: 16,
    durationOptions: [12, 16, 20],
    fps: 25,
    selectableInPanel: true,
    postprocessOnly: false,
  },
  {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.smoothFirstLastFrame,
    label: 'ComfyUI · LTX2.3 丝滑首尾帧',
    category: 'first_last_frame',
    promptPolicy: 'first_last_frame',
    imageSlotPolicy: 'first_last_three',
    maxDurationSeconds: 12,
    defaultDurationSeconds: 6,
    durationOptions: [4, 5, 6, 8, 10, 12],
    fps: 25,
    selectableInPanel: true,
    postprocessOnly: false,
  },
  {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s,
    label: 'ComfyUI · LTX2.3 大麦茶图生30秒',
    category: 'long_video',
    promptPolicy: 'long_promptrelay',
    imageSlotPolicy: 'single',
    maxDurationSeconds: 30,
    defaultDurationSeconds: 20,
    durationOptions: [12, 16, 20, 24, 30],
    fps: 25,
    selectableInPanel: true,
    postprocessOnly: false,
  },
  {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay,
    label: 'ComfyUI · LTX2.3 大麦茶长视频 PromptRelay',
    category: 'long_video',
    promptPolicy: 'long_promptrelay',
    imageSlotPolicy: 'single',
    maxDurationSeconds: 24,
    defaultDurationSeconds: 16,
    durationOptions: [12, 16, 20, 24],
    fps: 25,
    selectableInPanel: true,
    postprocessOnly: false,
  },
  {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.damaichaAioV2,
    label: 'ComfyUI · LTX2.3 大麦茶 AIO V2 无字幕',
    category: 'aio_fallback',
    promptPolicy: 'aio',
    imageSlotPolicy: 'repeat_single_to_three',
    maxDurationSeconds: 12,
    defaultDurationSeconds: 8,
    durationOptions: [6, 8, 10, 12],
    fps: 25,
    selectableInPanel: true,
    postprocessOnly: false,
  },
  {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.t8IcloraRestoreUpscale,
    label: 'ComfyUI · LTX2.3 T8 ICLORA 修复高清化',
    category: 'postprocess',
    promptPolicy: 'postprocess',
    imageSlotPolicy: 'single',
    maxDurationSeconds: null,
    defaultDurationSeconds: 0,
    durationOptions: [],
    fps: 25,
    selectableInPanel: false,
    postprocessOnly: true,
  },
  {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.t8EditAnything,
    label: 'ComfyUI · LTX2.3 T8 Edit Anything',
    category: 'postprocess',
    promptPolicy: 'postprocess',
    imageSlotPolicy: 'single',
    maxDurationSeconds: null,
    defaultDurationSeconds: 0,
    durationOptions: [],
    fps: 25,
    selectableInPanel: false,
    postprocessOnly: true,
  },
]

const PROFILE_BY_KEY = new Map(PROFILES.map((profile) => [profile.workflowKey, profile]))

export function getLtx23WorkflowProfiles(): Ltx23WorkflowProfile[] {
  return PROFILES.map((profile) => ({ ...profile, durationOptions: [...profile.durationOptions] }))
}

export function getLtx23WorkflowProfile(workflowKey: string | null | undefined): Ltx23WorkflowProfile | null {
  const normalized = normalizeLtx23WorkflowKey(workflowKey)
  const profile = normalized ? PROFILE_BY_KEY.get(normalized) : null
  return profile ? { ...profile, durationOptions: [...profile.durationOptions] } : null
}

export function normalizeLtx23WorkflowKey(workflowKey: string | null | undefined): string {
  return typeof workflowKey === 'string' ? workflowKey.replace(/^comfyui::/, '').trim() : ''
}

export function isComfyUiLtx23LongVideoWorkflow(workflowKey: string | null | undefined): boolean {
  return getLtx23WorkflowProfile(workflowKey)?.category === 'long_video'
}

export function expandLtx23WorkflowImageFilenames(
  workflowKey: string | null | undefined,
  imageFilenames: string[] | undefined,
): string[] | undefined {
  const filenames = Array.isArray(imageFilenames)
    ? imageFilenames.filter((filename) => typeof filename === 'string' && filename.trim().length > 0)
    : []
  const first = filenames[0]
  const second = filenames[1]
  const profile = getLtx23WorkflowProfile(workflowKey)
  if (!profile || !first) return imageFilenames

  if (profile.imageSlotPolicy === 'repeat_single_to_four') return [first, first, first, first]
  if (profile.imageSlotPolicy === 'repeat_single_to_three') return [first, first, first]
  if (profile.imageSlotPolicy === 'first_last_three') {
    const last = second || first
    return [first, last, last]
  }
  return filenames
}
```

- [ ] **Step 4: 运行 profile 测试**

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts
```

Expected: 全部通过。

- [ ] **Step 5: 提交 profile 元数据**

Run:

```bash
git add /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/ltx23-workflow-profiles.ts /Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts
git commit -m "feat: add ltx23 workflow profiles"
```

Expected: 只提交 profile 模块和测试。

### Task 3: 接入 profile 图片槽位扩展和多参考图上传

**Files:**
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflow-registry.ts`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/client.ts`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui/workflow-registry.test.ts`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui-client.test.ts`

- [ ] **Step 1: 给 workflow registry 增加失败测试**

Append to `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui/workflow-registry.test.ts`:

```ts
it('expands a single source image across all large-motion LoadImage slots', () => {
  workflowRoot = createWorkflowRoot()
  process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot

  writeWorkflow(workflowRoot, 'basevideo/ltx23-profiles/t8-single-image-large-motion-4stage', {
    nodes: [
      { id: 1, type: 'LoadImage', inputs: [{ name: 'image', type: 'COMBO', widget: { name: 'image' } }], widgets_values: ['a.png'] },
      { id: 2, type: 'LoadImage', inputs: [{ name: 'image', type: 'COMBO', widget: { name: 'image' } }], widgets_values: ['b.png'] },
      { id: 3, type: 'LoadImage', inputs: [{ name: 'image', type: 'COMBO', widget: { name: 'image' } }], widgets_values: ['c.png'] },
      { id: 4, type: 'LoadImage', inputs: [{ name: 'image', type: 'COMBO', widget: { name: 'image' } }], widgets_values: ['d.png'] },
    ],
    links: [],
  })

  const graph = resolveComfyUiWorkflow('basevideo/ltx23-profiles/t8-single-image-large-motion-4stage', {
    imageFilenames: ['source.png'],
  })

  expect(graph['1']?.inputs?.image).toBe('source.png')
  expect(graph['2']?.inputs?.image).toBe('source.png')
  expect(graph['3']?.inputs?.image).toBe('source.png')
  expect(graph['4']?.inputs?.image).toBe('source.png')
})
```

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/providers/comfyui/workflow-registry.test.ts -t "large-motion LoadImage"
```

Expected: 当前实现只按顺序注入现有图片，测试失败。

- [ ] **Step 2: 在 registry 中使用 profile 图片扩展**

Modify `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflow-registry.ts`:

```ts
import {
  COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
  expandLtx23WorkflowImageFilenames,
} from './ltx23-workflow-profiles'
```

Set default:

```ts
export const COMFYUI_DEFAULT_VIDEO_WORKFLOW_ID = COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID
```

Change the image injection section in `resolveComfyUiWorkflow`:

```ts
  const profileImageFilenames = expandLtx23WorkflowImageFilenames(workflowKey, inject.imageFilenames)
  applyImageInjection(graph, profileImageFilenames)
```

- [ ] **Step 3: 扩展 ComfyUI client 参数**

Modify `/Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/client.ts`:

```ts
export async function runComfyUiVideoWorkflow(params: {
  baseUrl: string
  workflowKey?: string
  prompt?: string
  firstFrameImageUrl: string
  lastFrameImageUrl?: string
  referenceImageUrls?: string[]
  width?: number
  height?: number
  durationSeconds?: number
  fps?: number
  llmApi?: ComfyUiWorkflowLlmApiInject
}): Promise<{ videoBase64: string; mimeType: string }> {
  const base = normalizeComfyBaseUrl(params.baseUrl)
  const imageUrls = [
    params.firstFrameImageUrl,
    ...(Array.isArray(params.referenceImageUrls) ? params.referenceImageUrls : []),
    params.lastFrameImageUrl,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const imageFilenames = await uploadComfyUiImages(base, imageUrls)
```

- [ ] **Step 4: 补充 client 上传顺序测试**

In `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui-client.test.ts`, add a test that calls `runComfyUiVideoWorkflow` with `firstFrameImageUrl`, `referenceImageUrls: ['mid-a', 'mid-b']`, and `lastFrameImageUrl`; assert upload mock receives URLs in that order.

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/providers/comfyui/workflow-registry.test.ts tests/unit/providers/comfyui-client.test.ts
```

Expected: registry and client tests pass.

- [ ] **Step 5: 提交 registry/client 接线**

Run:

```bash
git add /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflow-registry.ts /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/client.ts /Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui/workflow-registry.test.ts /Users/tigli/workspace/work/github/waoowaoo/tests/unit/providers/comfyui-client.test.ts
git commit -m "feat: wire ltx23 profile image slots"
```

Expected: 只提交 registry/client 和对应测试。

### Task 4: 更新 ComfyUI 视频生成默认值和旧多镜头降级规则

**Files:**
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/generators/comfyui-video.ts`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/generators/comfyui-video.test.ts`

- [ ] **Step 1: 增加失败测试**

Append to `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/generators/comfyui-video.test.ts`:

```ts
import { COMFYUI_LTX23_WORKFLOW_KEYS } from '@/lib/providers/comfyui/ltx23-workflow-profiles'

it('does not rewrite new ltx23 profile keys through legacy multi-shot fallback', () => {
  expect(selectComfyUiVideoWorkflowKey(
    COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
    'GLOBAL: rain alley\nLOCAL: [0-16] character runs forward',
    { generationMode: 'normal' },
  )).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion)
})
```

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/generators/comfyui-video.test.ts -t "profile keys"
```

Expected: 新 import 或选择逻辑尚未接入时失败。

- [ ] **Step 2: 使用 profile 默认 workflow**

Modify `/Users/tigli/workspace/work/github/waoowaoo/src/lib/generators/comfyui-video.ts`:

```ts
import {
  COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
  COMFYUI_LTX23_WORKFLOW_KEYS,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'
```

Use this default:

```ts
const workflowKey = typeof options.modelId === 'string' && options.modelId.trim()
  ? options.modelId.trim()
  : COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID
```

Keep the legacy rewrite only for existing `basevideo/多镜头/` workflow ids. New `basevideo/ltx23-profiles/` ids must pass through unchanged.

- [ ] **Step 3: 透传参考图 URLs**

Add this field in the `runComfyUiVideoWorkflow` call:

```ts
referenceImageUrls: Array.isArray(options.referenceImageUrls)
  ? options.referenceImageUrls.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  : undefined,
```

- [ ] **Step 4: 运行 generator 测试**

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/generators/comfyui-video.test.ts
```

Expected: 全部通过。

- [ ] **Step 5: 提交 generator 变更**

Run:

```bash
git add /Users/tigli/workspace/work/github/waoowaoo/src/lib/generators/comfyui-video.ts /Users/tigli/workspace/work/github/waoowaoo/tests/unit/generators/comfyui-video.test.ts
git commit -m "feat: default comfyui video to ltx23 profiles"
```

Expected: 只提交 generator 和测试。

### Task 5: 用长视频 workflow 替换 12 秒 cap 和自动拆段

**Files:**
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/video-duration/audio-binding.ts`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/workers/video.worker.ts`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/video/audio-binding.test.ts`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/worker/video-worker.test.ts`

- [ ] **Step 1: 增加 audio-binding profile 时长测试**

Append to `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/video/audio-binding.test.ts`:

```ts
it('uses ltx23 profile max duration instead of the product 12 second cap', () => {
  const timing = getVideoTimingProfile('comfyui::basevideo/ltx23-profiles/damaicha-image-to-30s-long-video')
  expect(timing).toEqual({
    fps: 25,
    maxDurationSeconds: 30,
  })
})
```

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/video/audio-binding.test.ts -t "profile max duration"
```

Expected: 当前固定 12 秒 cap 导致失败。

- [ ] **Step 2: 增加 worker 长视频不拆段测试**

Replace the current test named `VIDEO_PANEL: auto-splits long linked audio into continuous video segments` in `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/worker/video-worker.test.ts` with:

```ts
it('VIDEO_PANEL: sends long linked audio to selected long-video workflow without split segments', async () => {
  const processor = workerState.processor
  expect(processor).toBeTruthy()

  prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValue([
    {
      id: 'line-1',
      speaker: 'Doctor',
      content: 'We need to review every symptom carefully before giving the next instruction.',
      audioDuration: 23_700,
    },
  ])

  const job = buildJob({
    type: TASK_TYPE.VIDEO_PANEL,
    payload: {
      videoModel: 'comfyui::basevideo/ltx23-profiles/damaicha-image-to-30s-long-video',
      videoDurationBinding: {
        mode: 'match_audio',
        voiceLineIds: ['line-1'],
      },
      generationOptions: {
        duration: 20,
        resolution: '720p',
      },
    },
  })

  await processor!(job)

  expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)
  expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      allowCustomDuration: true,
      options: expect.objectContaining({
        duration: 23.7,
        fps: 25,
        generationMode: 'normal',
      }),
    }),
  )
  expect(prismaMock.novelPromotionPanelVideoSegment.upsert).not.toHaveBeenCalled()
  expect(ffmpegMock.extractVideoLastFrame).not.toHaveBeenCalled()
  expect(ffmpegMock.concatVideos).not.toHaveBeenCalled()
})
```

Delete the current test named `VIDEO_PANEL: resumes split generation from completed segment records`, because normal LTX2.3 生成不再保留这条拆段恢复路径。

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/worker/video-worker.test.ts -t "long linked audio"
```

Expected: 当前 worker 仍进入 split 分支，测试失败。

- [ ] **Step 3: 改 audio-binding 为 profile-aware**

Modify `/Users/tigli/workspace/work/github/waoowaoo/src/lib/video-duration/audio-binding.ts`:

```ts
import { getLtx23WorkflowProfile } from '@/lib/providers/comfyui/ltx23-workflow-profiles'
```

At the start of `getVideoTimingProfile`, after model key normalization:

```ts
const ltx23Profile = getLtx23WorkflowProfile(modelKey)
if (ltx23Profile) {
  return {
    fps: ltx23Profile.fps,
    maxDurationSeconds: ltx23Profile.maxDurationSeconds,
  }
}
```

Keep the old LTX2.3 text detection branch only as fallback for legacy workflow ids.

- [ ] **Step 4: 移除 worker normal 模式自动拆段入口**

Modify `/Users/tigli/workspace/work/github/waoowaoo/src/lib/workers/video.worker.ts`:

```ts
if (audioDrivenDuration && !audioDrivenDuration.canGenerate) {
  throwBlockedAudioTiming(audioDrivenDuration)
}
```

Remove the branch that calls `generateSplitVideoForPanel` for `generationMode === 'normal' && audioDrivenDuration.splitPlan`. After TypeScript reports unused imports/functions, remove the unused split helpers from this file.

- [ ] **Step 5: 运行时长和 worker 测试**

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/video/audio-binding.test.ts tests/unit/worker/video-worker.test.ts
```

Expected: 全部通过。

- [ ] **Step 6: 提交长视频时长逻辑**

Run:

```bash
git add /Users/tigli/workspace/work/github/waoowaoo/src/lib/video-duration/audio-binding.ts /Users/tigli/workspace/work/github/waoowaoo/src/lib/workers/video.worker.ts /Users/tigli/workspace/work/github/waoowaoo/tests/unit/video/audio-binding.test.ts /Users/tigli/workspace/work/github/waoowaoo/tests/unit/worker/video-worker.test.ts
git commit -m "feat: route ltx23 long video by workflow profile"
```

Expected: 只提交时长绑定、worker 和测试。

### Task 6: 让 LTX2.3 prompt enhance 按 profile 控制镜头约束

**Files:**
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/lib/video-duration/ltx23-prompt-enhance.ts`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/video/ltx23-prompt-enhance.test.ts`

- [ ] **Step 1: 增加大幅变化和微表情测试**

Append to `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/video/ltx23-prompt-enhance.test.ts`:

```ts
it('allows controlled camera movement for the large-motion single-image workflow', async () => {
  aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
    text: JSON.stringify({
      enhanced_prompt: 'GLOBAL: neon alley, same character, continuous shot\nLOCAL: [0-16] camera slowly pushes in as the character runs through rain',
    }),
  })

  const result = await enhanceLtx23VideoPrompt({
    userId: 'user-1',
    locale: 'en',
    projectId: 'project-1',
    modelKey: 'comfyui::basevideo/ltx23-profiles/t8-single-image-large-motion-4stage',
    originalPrompt: 'the character runs from stillness into heavy rain as the camera pushes in',
    panel: {
      description: 'character starts still then runs into rain',
      characters: 'Doctor',
    },
    durationSeconds: 16,
    fps: 25,
    generationMode: 'normal',
  })

  const promptText = aiRuntimeMock.executeAiTextStep.mock.calls[0]?.[0]?.messages?.[0]?.content as string
  expect(promptText).toContain('large_motion_single_image')
  expect(promptText).toContain('four continuous motion stages')
  expect(result.prompt).toContain('camera slowly pushes in')
  expect(result.prompt.split('Source-frame continuity lock:')[0]).not.toContain('locked-off static camera')
})

it('keeps static-camera constraints for the micro-detail workflow', async () => {
  aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
    text: JSON.stringify({
      enhanced_prompt: 'The doctor smiles while the camera slowly pans across the room.',
    }),
  })

  const result = await enhanceLtx23VideoPrompt({
    userId: 'user-1',
    locale: 'en',
    projectId: 'project-1',
    modelKey: 'comfyui::basevideo/ltx23-profiles/t8-sulphur2-promptrelay-micro',
    originalPrompt: 'doctor smiles with a subtle eye movement',
    panel: {
      description: 'doctor smiles with a subtle eye movement',
      characters: 'Doctor',
    },
    generationMode: 'normal',
  })

  expect(result.prompt).toContain('locked-off static camera')
  expect(result.prompt.split('Source-frame continuity lock:')[0]).not.toMatch(/\b(pans?|panning)\b/i)
})
```

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/video/ltx23-prompt-enhance.test.ts -t "large-motion|micro-detail"
```

Expected: 大幅变化测试失败，因为当前 normal 模式统一替换为静态镜头。

- [ ] **Step 2: 新增 prompt policy helper**

Modify `/Users/tigli/workspace/work/github/waoowaoo/src/lib/video-duration/ltx23-prompt-enhance.ts`:

```ts
import { getLtx23WorkflowProfile, type Ltx23PromptPolicy } from '@/lib/providers/comfyui/ltx23-workflow-profiles'

function resolveLtx23PromptPolicy(modelKey: string | null | undefined): Ltx23PromptPolicy {
  return getLtx23WorkflowProfile(modelKey)?.promptPolicy ?? 'stable_single_image'
}

function allowsCameraMovement(policy: Ltx23PromptPolicy): boolean {
  return policy === 'large_motion_single_image' || policy === 'long_promptrelay' || policy === 'first_last_frame'
}
```

- [ ] **Step 3: 调整 generation context 和安全约束**

In `buildGenerationContextText`, add profile-specific movement lines:

```ts
const promptPolicy = resolveLtx23PromptPolicy(input.modelKey)
const movementLines = allowsCameraMovement(promptPolicy)
  ? [
      `Workflow profile: ${promptPolicy}.`,
      promptPolicy === 'large_motion_single_image'
        ? 'Use four continuous motion stages over the full duration. The source image defines identity and starting composition, but action may progress substantially without adding new subjects.'
        : 'Use a continuous PromptRelay timeline over the full duration. Camera movement is allowed when it supports continuity and does not create scene cuts.',
      'Camera movement may include push-in, pull-back, pan, or track when described as one continuous shot.',
    ]
  : [
      `Workflow profile: ${promptPolicy}.`,
      'Keep the source-frame composition locked. For normal single-shot mode, use a locked-off static camera only.',
      'The final enhanced_prompt must not include orbit, circle, circling, pan, tracking, dolly, zoom, travel, or parallax.',
    ]
```

Use `movementLines` where the current hard-coded static-camera lines live.

Change `stabilizeNormalSingleShotPrompt`:

```ts
function stabilizeNormalSingleShotPrompt(
  basePrompt: string,
  input: EnhanceLtx23VideoPromptInput,
  promptPolicy: Ltx23PromptPolicy,
): string {
  if (input.generationMode === 'firstlastframe') return basePrompt
  if (allowsCameraMovement(promptPolicy)) return basePrompt

  return basePrompt
    .replace(/\b(?:tiny\s+within-frame\s+)?(?:parallax|camera\s+parallax)(?:\s+simulating\s+[^,.]+)?/gi, 'locked-off static camera')
    .replace(/\b(?:slow(?:ly)?\s+)?(?:circling|circle|orbits?|orbiting|pans?|panning|tracks?|tracking|dolly|dolly(?:ing)?|zooms?|zooming|travels?|traveling|travelling)\b/gi, 'locked-off static camera')
}
```

Update callers to pass `promptPolicy`.

- [ ] **Step 4: 运行 prompt 测试**

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/video/ltx23-prompt-enhance.test.ts
```

Expected: 全部通过。

- [ ] **Step 5: 提交 prompt profile 变更**

Run:

```bash
git add /Users/tigli/workspace/work/github/waoowaoo/src/lib/video-duration/ltx23-prompt-enhance.ts /Users/tigli/workspace/work/github/waoowaoo/tests/unit/video/ltx23-prompt-enhance.test.ts
git commit -m "feat: make ltx23 prompt constraints profile aware"
```

Expected: 只提交 prompt enhance 和测试。

### Task 7: 注册手动可选 profile 到 catalog 和 UI

**Files:**
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/standards/capabilities/image-video.catalog.json`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/profile/components/api-config/types.ts`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceProjectSnapshot.ts`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/usePanelVideoModel.ts`
- Modify: `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/model-capabilities/comfyui-video-capabilities.test.ts`

- [ ] **Step 1: 增加 catalog 失败测试**

Append to `/Users/tigli/workspace/work/github/waoowaoo/tests/unit/model-capabilities/comfyui-video-capabilities.test.ts`:

```ts
it('registers selectable ltx23 profile workflows with profile-specific durations', () => {
  const largeMotion = findBuiltinCapabilities('video', 'comfyui', 'basevideo/ltx23-profiles/t8-single-image-large-motion-4stage')
  const long30 = findBuiltinCapabilities('video', 'comfyui', 'basevideo/ltx23-profiles/damaicha-image-to-30s-long-video')

  expect(largeMotion?.video?.generationModeOptions).toEqual(['normal'])
  expect(largeMotion?.video?.durationOptions).toEqual([12, 16, 20])
  expect(largeMotion?.video?.resolutionOptions).toEqual(['720p'])
  expect(largeMotion?.video?.firstlastframe).toBe(false)

  expect(long30?.video?.generationModeOptions).toEqual(['normal'])
  expect(long30?.video?.durationOptions).toEqual([12, 16, 20, 24, 30])
  expect(long30?.video?.resolutionOptions).toEqual(['720p'])
  expect(long30?.video?.firstlastframe).toBe(false)
})
```

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/model-capabilities/comfyui-video-capabilities.test.ts -t "ltx23 profile"
```

Expected: profile model id 尚未注册，测试失败。

- [ ] **Step 2: 添加 7 个可选生成 profile 的 catalog 条目**

Modify `/Users/tigli/workspace/work/github/waoowaoo/standards/capabilities/image-video.catalog.json` and add entries for:

```text
basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2 -> durationOptions [4, 5, 6, 8, 10, 12], generationModeOptions ["normal"]
basevideo/ltx23-profiles/t8-sulphur2-promptrelay-micro -> durationOptions [4, 5, 6, 8, 10, 12], generationModeOptions ["normal"]
basevideo/ltx23-profiles/t8-single-image-large-motion-4stage -> durationOptions [12, 16, 20], generationModeOptions ["normal"]
basevideo/ltx23-profiles/<removed-legacy-first-last-frame-workflow> -> durationOptions [4, 5, 6, 8, 10, 12], generationModeOptions ["firstlastframe"], firstlastframe true
basevideo/ltx23-profiles/damaicha-image-to-30s-long-video -> durationOptions [12, 16, 20, 24, 30], generationModeOptions ["normal"]
basevideo/ltx23-profiles/damaicha-long-video-promptrelay -> durationOptions [12, 16, 20, 24], generationModeOptions ["normal"]
basevideo/ltx23-profiles/damaicha-aio-v2-no-subtitles -> durationOptions [6, 8, 10, 12], generationModeOptions ["normal"]
```

All seven entries use:

```json
{
  "modelType": "video",
  "provider": "comfyui",
  "capabilities": {
    "video": {
      "resolutionOptions": ["720p"],
      "supportGenerateAudio": false
    }
  }
}
```

Do not add postprocess-only workflows to the panel generation catalog.

- [ ] **Step 3: 添加用户可见模型名**

In `/Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/profile/components/api-config/types.ts`, add:

```ts
{ modelId: 'basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2', name: 'ComfyUI · LTX2.3 单图精准 Smart VBVR', type: 'video', provider: 'comfyui' },
{ modelId: 'basevideo/ltx23-profiles/t8-sulphur2-promptrelay-micro', name: 'ComfyUI · LTX2.3 微表情 Sulphur2', type: 'video', provider: 'comfyui' },
{ modelId: 'basevideo/ltx23-profiles/t8-single-image-large-motion-4stage', name: 'ComfyUI · LTX2.3 单图大幅变化四段控制', type: 'video', provider: 'comfyui' },
{ modelId: 'basevideo/ltx23-profiles/<removed-legacy-first-last-frame-workflow>', name: 'ComfyUI · LTX2.3 丝滑首尾帧', type: 'video', provider: 'comfyui' },
{ modelId: 'basevideo/ltx23-profiles/damaicha-image-to-30s-long-video', name: 'ComfyUI · LTX2.3 大麦茶图生30秒', type: 'video', provider: 'comfyui' },
{ modelId: 'basevideo/ltx23-profiles/damaicha-long-video-promptrelay', name: 'ComfyUI · LTX2.3 大麦茶长视频 PromptRelay', type: 'video', provider: 'comfyui' },
{ modelId: 'basevideo/ltx23-profiles/damaicha-aio-v2-no-subtitles', name: 'ComfyUI · LTX2.3 大麦茶 AIO V2 无字幕', type: 'video', provider: 'comfyui' },
```

- [ ] **Step 4: 更新默认模型和旧默认归一化**

In both default-model files:

```text
/Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceProjectSnapshot.ts
/Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/usePanelVideoModel.ts
```

Set:

```ts
const DEFAULT_VIDEO_MODEL = 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2'
```

Add legacy ids into `LEGACY_DEFAULT_VIDEO_MODELS`:

```ts
'comfyui::basevideo/多镜头/Ltx2.3多镜头时间+逻辑控制PromptRelay和VBVR（KJ版）1',
'basevideo/多镜头/Ltx2.3多镜头时间+逻辑控制PromptRelay和VBVR（KJ版）1',
```

- [ ] **Step 5: 运行 catalog/UI 测试**

Run:

```bash
npm run check:capability-catalog
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/model-capabilities/comfyui-video-capabilities.test.ts
```

Expected: catalog 检查和能力测试通过。

- [ ] **Step 6: 提交 catalog/UI 注册**

Run:

```bash
git add /Users/tigli/workspace/work/github/waoowaoo/standards/capabilities/image-video.catalog.json /Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/profile/components/api-config/types.ts /Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceProjectSnapshot.ts /Users/tigli/workspace/work/github/waoowaoo/src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/usePanelVideoModel.ts /Users/tigli/workspace/work/github/waoowaoo/tests/unit/model-capabilities/comfyui-video-capabilities.test.ts
git commit -m "feat: expose ltx23 profiles for manual selection"
```

Expected: 只提交 catalog、UI 模型名、默认模型和测试。

### Task 8: 最终验证

**Files:**
- No planned source edits.

- [ ] **Step 1: 校验 workflow JSON**

Run:

```bash
jq empty /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflows/basevideo/ltx23-profiles/*.json
```

Expected: 无输出，退出码为 0。

- [ ] **Step 2: 运行定向测试集**

Run:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run \
  tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts \
  tests/unit/providers/comfyui/workflow-registry.test.ts \
  tests/unit/providers/comfyui-client.test.ts \
  tests/unit/generators/comfyui-video.test.ts \
  tests/unit/video/audio-binding.test.ts \
  tests/unit/video/ltx23-prompt-enhance.test.ts \
  tests/unit/worker/video-worker.test.ts \
  tests/unit/model-capabilities/comfyui-video-capabilities.test.ts
```

Expected: 全部通过。

- [ ] **Step 3: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected: TypeScript 检查通过。

- [ ] **Step 4: 运行 catalog 检查**

Run:

```bash
npm run check:capability-catalog
```

Expected: capability catalog 检查通过。

- [ ] **Step 5: 运行 lint**

Run:

```bash
npm run lint -- \
  /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/ltx23-workflow-profiles.ts \
  /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/workflow-registry.ts \
  /Users/tigli/workspace/work/github/waoowaoo/src/lib/providers/comfyui/client.ts \
  /Users/tigli/workspace/work/github/waoowaoo/src/lib/generators/comfyui-video.ts \
  /Users/tigli/workspace/work/github/waoowaoo/src/lib/video-duration/audio-binding.ts \
  /Users/tigli/workspace/work/github/waoowaoo/src/lib/workers/video.worker.ts \
  /Users/tigli/workspace/work/github/waoowaoo/src/lib/video-duration/ltx23-prompt-enhance.ts
```

Expected: ESLint 通过。

- [ ] **Step 6: 查看最终状态**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: 工作区干净，并能看到本计划中的阶段提交。

## 执行方式

计划文件写完后不要直接编码。执行前在两种方式中选一种：

1. Subagent-Driven：每个 Task 一个新 subagent 执行，我在每个 Task 后做 review。
2. Inline Execution：当前会话按 Task 顺序执行，每个 Task 后停下来检查。

推荐 Subagent-Driven，因为本次改动跨 workflow JSON、registry、worker、prompt、catalog 和 UI 默认值，分任务隔离更容易发现问题。
