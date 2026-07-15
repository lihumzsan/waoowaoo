# Bernini 与 LTX 视频画幅连续性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让横屏 Seedance2 Bernini 480P 原生输出 `848×464` 且不烘焙左右黑边，同时保持 LTX 和 Bernini 其他画幅行为不变。

**Architecture:** 在视频生成器层把 Bernini 的 `16:9` 项目请求解析为专用的 `848×464` 尺寸，而不修改通用 LTX 画幅表；在 ComfyUI 工作流注册层保留这一精确尺寸，并把输入图缩放节点设为 `custom 53:29 + crop`，使预处理比例与 Bernini conditioning 画布一致。最终通过单元测试、类型检查和一条真实 MP4 生成验证整个链路。

**Tech Stack:** TypeScript、Vitest、ComfyUI workflow JSON/API、Next.js worker pipeline、Windows PowerShell、剪映。

## Global Constraints

- LTX 工作流和其生成器请求尺寸保持不变；实测 LTX 最终 MP4 继续为 `1280×704`。
- 新的横屏 Bernini 最终 MP4 必须为 `848×464`，两边均按 16 像素对齐，最长边不超过 848。
- 节点 `416` 必须使用 `aspect_ratio = custom`、`proportional_width = 53`、`proportional_height = 29`、`fit = crop`。
- 节点 `417` 必须为 848；节点 `384` 必须为 `width = 848`、`height = 464`。
- Bernini 竖屏及非 `16:9` 比例继续使用现有 480 短边、848 长边上限和 16 像素对齐逻辑。
- 不增加 FFmpeg 或任何服务端视频转码，不修改浏览器视频卡片预览，不迁移数据库或历史媒体。
- 实际 MP4 尺寸或画面验收不通过时继续定位根因，不能用补黑边作为降级方案。

---

## File Structure

- Modify: `src/lib/generators/comfyui-video.ts` — 把 Bernini `16:9` 业务请求转换成精确的 `848×464` 工作流注入尺寸，保持显式尺寸优先和其他模型逻辑不变。
- Modify: `tests/unit/generators/comfyui-video.test.ts` — 锁定 Bernini 横屏尺寸合同和 LTX 请求尺寸回归合同。
- Modify: `src/lib/providers/comfyui/workflow-registry.ts` — 保留 `848×464`，并把 Bernini 输入图预处理与 conditioning 设成同一精确画幅。
- Modify: `tests/unit/providers/comfyui-workflow-registry.test.ts` — 同时验证标准 Bernini 与 Audio LipSync Bernini 的节点注入合同。
- No new runtime files or dependencies.

### Task 1: 锁定生成器层的 Bernini 横屏尺寸合同

**Files:**
- Modify: `src/lib/generators/comfyui-video.ts:14-52,187-192`
- Test: `tests/unit/generators/comfyui-video.test.ts:258-284`

**Interfaces:**
- Consumes: `VideoGenerateParams.options.modelId?: string`、`aspectRatio?: string`、`size?: string`，以及 `isSeedance2BerniniWorkflowKey(workflowKey): boolean`。
- Produces: `runComfyUiVideoWorkflow()` 的 Bernini `width = 848`、`height = 464` 注入合同；显式 `size` 仍优先于 `aspectRatio`；非 Bernini 的 `16:9` 请求仍为 `1280×736` 注入合同。

- [ ] **Step 1: 写出会失败的 Bernini 测试和 LTX 回归测试**

在 `tests/unit/generators/comfyui-video.test.ts` 的 `ComfyUI video generator` describe 内加入：

```ts
  it('uses the exact Bernini 848x464 canvas for landscape project requests', async () => {
    const generator = new ComfyUIVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'hero turns toward the camera',
      options: {
        modelId: BERNINI_WORKFLOW_ID,
        aspectRatio: '16:9',
      },
    })

    expect(result.success).toBe(true)
    expect(runComfyUiVideoWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      workflowKey: BERNINI_WORKFLOW_ID,
      width: 848,
      height: 464,
    }))
  })

  it('keeps the LTX Goon landscape request size unchanged', async () => {
    const generator = new ComfyUIVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'bridge the two frames',
      options: {
        modelId: COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame,
        generationMode: 'firstlastframe',
        lastFrameImageUrl: 'https://example.com/last.png',
        aspectRatio: '16:9',
      },
    })

    expect(result.success).toBe(true)
    expect(runComfyUiVideoWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame,
      width: 1280,
      height: 736,
    }))
  })
```

- [ ] **Step 2: 运行测试并确认 Bernini 断言按预期失败**

Run:

```powershell
$env:BILLING_TEST_BOOTSTRAP='0'; npx.cmd vitest run tests/unit/generators/comfyui-video.test.ts -t "exact Bernini|LTX Goon landscape"
```

Expected: Bernini 用例 `FAIL`，收到 `width: 832, height: 480`；LTX 回归用例 `PASS`，仍收到 `1280×736`。

- [ ] **Step 3: 实现最小的 Bernini 专用画幅解析**

在 `ASPECT_TO_SIZE` 后加入：

```ts
const BERNINI_LANDSCAPE_16_9_SIZE = { w: 848, h: 464 } as const
```

在 `normalizeBernini480pVideoSize` 后加入以下 helper；它保留显式尺寸优先级，只对没有显式尺寸的 Bernini `16:9` 请求应用专用画布，同时允许显式 `848x464` 保持不变：

```ts
function resolveBernini480pVideoSize(
  directSize: { w: number; h: number } | null,
  aspectRatio: string | undefined,
  aspectSize: { w: number; h: number } | undefined,
): { w: number; h: number } {
  if (directSize) {
    if (directSize.w === BERNINI_LANDSCAPE_16_9_SIZE.w && directSize.h === BERNINI_LANDSCAPE_16_9_SIZE.h) {
      return { ...BERNINI_LANDSCAPE_16_9_SIZE }
    }
    return normalizeBernini480pVideoSize(directSize)
  }

  if (aspectRatio === '16:9') {
    return { ...BERNINI_LANDSCAPE_16_9_SIZE }
  }

  return normalizeBernini480pVideoSize(aspectSize || null)
}
```

把 `doGenerate` 中的 `aspectSize` 和 `targetSize` 计算替换为：

```ts
    const requestedAspectRatio = typeof options.aspectRatio === 'string'
      ? options.aspectRatio.trim()
      : undefined
    const aspectSize = requestedAspectRatio
      ? ASPECT_TO_SIZE[requestedAspectRatio]
      : undefined
    const targetSize = isSeedance2BerniniWorkflowKey(selectedWorkflowKey)
      ? resolveBernini480pVideoSize(directSize, requestedAspectRatio, aspectSize)
      : normalizeComfyUiVideoSize(directSize || aspectSize || null)
```

- [ ] **Step 4: 运行生成器测试并确认全部通过**

Run:

```powershell
$env:BILLING_TEST_BOOTSTRAP='0'; npx.cmd vitest run tests/unit/generators/comfyui-video.test.ts
```

Expected: 文件内全部测试 `PASS`；新的 Bernini 用例为 `848×464`，LTX Goon 用例保持 `1280×736`。

- [ ] **Step 5: 提交生成器尺寸合同**

```powershell
git add -- src/lib/generators/comfyui-video.ts tests/unit/generators/comfyui-video.test.ts
git commit -m "fix: align Bernini landscape video canvas"
```

### Task 2: 让 Bernini 工作流精确保留 53:29 画布

**Files:**
- Modify: `src/lib/providers/comfyui/workflow-registry.ts:1969-1995,2344-2358`
- Test: `tests/unit/providers/comfyui-workflow-registry.test.ts:700-803`

**Interfaces:**
- Consumes: Task 1 注入的 `ComfyUiWorkflowInject.width = 848`、`height = 464`。
- Produces: 标准和 Audio LipSync Bernini 工作流中节点 `416` 的 `custom 53:29 + crop`、节点 `417 = 848`、节点 `384 = 848×464`；其他 Bernini 尺寸继续走原有归一化。

- [ ] **Step 1: 写出会失败的标准/音频 Bernini 节点合同测试**

在现有 Bernini 测试附近加入：

```ts
  it('keeps the exact 53:29 landscape canvas in both Bernini workflows', () => {
    const cases: Array<{ workflowKey: string; audioFilenames?: string[] }> = [
      { workflowKey: BERNINI_WORKFLOW_KEY },
      { workflowKey: BERNINI_AUDIO_WORKFLOW_KEY, audioFilenames: ['voice-line.wav'] },
    ]

    for (const { workflowKey, audioFilenames } of cases) {
      const workflow = resolveComfyUiWorkflow(workflowKey, {
        prompt: 'hero turns toward the camera',
        imageFilenames: ['source.png'],
        ...(audioFilenames ? { audioFilenames } : {}),
        width: 848,
        height: 464,
        durationSeconds: 5,
        fps: 24,
        motionStrength: 1,
      })

      expect(workflow['416']?.inputs.aspect_ratio).toBe('custom')
      expect(workflow['416']?.inputs.proportional_width).toBe(53)
      expect(workflow['416']?.inputs.proportional_height).toBe(29)
      expect(workflow['416']?.inputs.fit).toBe('crop')
      expect(workflow['416']?.inputs.method).toBe('lanczos')
      expect(workflow['416']?.inputs.round_to_multiple).toBe('16')
      expect(workflow['416']?.inputs.scale_to_side).toBe('longest')
      expect(workflow['417']?.inputs.value).toBe(848)
      expect(workflow['384']?.inputs.width).toBe(848)
      expect(workflow['384']?.inputs.height).toBe(464)
    }
  })
```

- [ ] **Step 2: 运行测试并确认当前模糊比例处理失败**

Run:

```powershell
$env:BILLING_TEST_BOOTSTRAP='0'; npx.cmd vitest run tests/unit/providers/comfyui-workflow-registry.test.ts -t "exact 53:29 landscape"
```

Expected: `FAIL`；当前工作流把 `848×464` 重新归一化为 `848×480`，并把节点 `416.aspect_ratio` 设为 `16:9`。

- [ ] **Step 3: 保留精确尺寸并注入自定义比例**

在 `alignToMultiple` 后加入：

```ts
const SEEDANCE2_BERNINI_LANDSCAPE_SIZE = {
  width: 848,
  height: 464,
  longestSide: 848,
} as const

function isSeedance2BerniniLandscapeSize(size: { width: number; height: number }): boolean {
  return size.width === SEEDANCE2_BERNINI_LANDSCAPE_SIZE.width
    && size.height === SEEDANCE2_BERNINI_LANDSCAPE_SIZE.height
}
```

在 `resolveSeedance2BerniniSize` 读取 `inputWidth`、`inputHeight` 后、计算 `ratio` 前加入：

```ts
  if (inputWidth === SEEDANCE2_BERNINI_LANDSCAPE_SIZE.width
    && inputHeight === SEEDANCE2_BERNINI_LANDSCAPE_SIZE.height) {
    return { ...SEEDANCE2_BERNINI_LANDSCAPE_SIZE }
  }
```

把 `applySeedance2BerniniWorkflowControls` 中节点 `416` 的比例赋值部分替换为：

```ts
  const resizeNode = graph['416']
  if (resizeNode && isRecord(resizeNode.inputs)) {
    if (isSeedance2BerniniLandscapeSize(size)) {
      resizeNode.inputs.aspect_ratio = 'custom'
      resizeNode.inputs.proportional_width = 53
      resizeNode.inputs.proportional_height = 29
    } else {
      resizeNode.inputs.aspect_ratio = formatAspectRatio(size.width, size.height)
    }
    resizeNode.inputs.fit = 'crop'
    resizeNode.inputs.method = 'lanczos'
    resizeNode.inputs.round_to_multiple = '16'
    resizeNode.inputs.scale_to_side = 'longest'
  }
```

保留紧随其后的 conditioning 注入代码不变：

```ts
  const conditioningNode = graph['384']
  if (conditioningNode && isRecord(conditioningNode.inputs)) {
    if (!isConnectionValue(conditioningNode.inputs.width)) conditioningNode.inputs.width = size.width
    if (!isConnectionValue(conditioningNode.inputs.height)) conditioningNode.inputs.height = size.height
  }
```

- [ ] **Step 4: 运行工作流测试并确认全部通过**

Run:

```powershell
$env:BILLING_TEST_BOOTSTRAP='0'; npx.cmd vitest run tests/unit/providers/comfyui-workflow-registry.test.ts
```

Expected: 文件内全部测试 `PASS`；标准和 Audio LipSync Bernini 都满足 `custom 53:29`、`417 = 848`、`384 = 848×464`。

- [ ] **Step 5: 提交工作流尺寸合同**

```powershell
git add -- src/lib/providers/comfyui/workflow-registry.ts tests/unit/providers/comfyui-workflow-registry.test.ts
git commit -m "fix: preserve Bernini 53x29 workflow framing"
```

### Task 3: 全链路与真实 MP4 验证

**Files:**
- Verify only: Task 1 和 Task 2 的四个文件
- Runtime evidence: 新生成的一条 Bernini MP4 和一条现有 LTX MP4；不把媒体文件提交到 Git

**Interfaces:**
- Consumes: Task 1 的 `848×464` 生成器注入合同和 Task 2 的 `custom 53:29` 工作流合同。
- Produces: 可交付验收证据：单元测试通过、类型检查通过、真实 Bernini MP4 为 `848×464` 且无左右黑边、与 LTX 相邻放入剪映时没有可见画幅跳变。

- [ ] **Step 1: 同时运行两个定向测试文件**

Run:

```powershell
$env:BILLING_TEST_BOOTSTRAP='0'; npx.cmd vitest run tests/unit/generators/comfyui-video.test.ts tests/unit/providers/comfyui-workflow-registry.test.ts
```

Expected: 两个文件全部测试 `PASS`，进程退出码为 0。

- [ ] **Step 2: 运行 TypeScript 类型检查**

Run:

```powershell
npm.cmd run typecheck
```

Expected: `tsc --noEmit` 退出码为 0，不出现 TypeScript error。

- [ ] **Step 3: 检查提交与工作树**

Run:

```powershell
git log -2 --oneline
git status --short --branch
```

Expected: 最近两个提交分别是生成器尺寸合同和工作流尺寸合同；工作树没有未提交的生产代码或测试改动。

- [ ] **Step 4: 通过真实 UI 重新生成一条横屏 Bernini 视频**

使用当前登录态的工作区，选择 `ComfyUI · Seedance2.0 Bernini 480p I2V`，在一个 `16:9` 横屏分镜上重新生成。等待卡片状态从“生成中”变为“已生成”，不要修改 LTX 模型或历史媒体。

Expected: 任务成功，卡片加载新的 Bernini MP4；没有 ComfyUI preflight、节点输入或 worker 错误。

- [ ] **Step 5: 读取真实视频元数据并检查画面边缘**

使用应用内浏览器检查新视频元素的原生属性：

```js
({
  src: video.currentSrc,
  width: video.videoWidth,
  height: video.videoHeight,
  duration: video.duration,
})
```

Expected: `width === 848`、`height === 464`，`duration > 0`。截取视频首帧或播放帧并目视检查，图像内容应到达画布左右边缘，不存在烘焙的黑色竖条。

- [ ] **Step 6: 做剪映相邻镜头验收**

把新 Bernini `848×464` 和一条已验证的 LTX `1280×704` 放到同一横屏剪映项目的相邻轨道位置，两段都使用“填充画布”，不单独添加背景或边框，然后播放转场点。

Expected: 两段都铺满同一画布；转场处没有可见的画幅宽窄跳变。若真实 MP4 尺寸不是 `848×464`、存在黑边或仍有明显跳变，停止交付并回到 ComfyUI 节点解析继续调试。
