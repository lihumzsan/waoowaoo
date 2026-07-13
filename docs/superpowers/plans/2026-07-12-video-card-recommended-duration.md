# Video Card Recommended Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the legacy Bernini Audio LipSync choice from normal video cards, default each Bernini card to its valid `textPanel.duration`, and make motion strength `1` the first and default choice.

**Architecture:** Keep backend workflow registration intact and filter only the shared normal-video option list. Add a pure recommended-duration adapter between the catalog definitions and panel-local capability state, then expose recommendation metadata to the existing dropdown renderer. Keep Bernini catalog defaults and workflow fallback constants aligned at `1`.

**Tech Stack:** TypeScript, React 19, Next.js, Vitest, JSON capability catalog, PowerShell with `npm.cmd`/`npx.cmd`.

## Global Constraints

- The fourth workflow is hidden only from novel-promotion normal-video selectors; backend registration and historical-data compatibility remain intact.
- Use `textPanel.duration` only when it parses to a finite number greater than zero.
- If `textPanel.duration` is missing or invalid, preserve the current duration options and default behavior exactly.
- If the recommended duration already exists, show one option and mark it recommended.
- Do not hard-code `9`; recommendation is card-specific.
- Bernini motion-strength order and fallback default must both be `1, 2, 3` with default `1`.

---

### Task 1: Hide the fourth workflow from normal-video selectors

**Files:**
- Modify: `src/lib/model-capabilities/video-model-options.ts`
- Test: `tests/unit/novel-promotion/video-model-options.test.ts`

**Interfaces:**
- Consumes: `isBerniniAudioLipsyncVideoModelKey(raw): boolean` from `src/lib/novel-promotion/video-model-defaults.ts`.
- Produces: unchanged `filterNormalVideoModelOptions<T>(models: T[]): T[]`, now excluding first/last-only models and the Bernini Audio LipSync model key.

- [ ] **Step 1: Write the failing filter test**

Add the real legacy model to the fixture and require it to be absent:

```ts
{
  value: 'comfyui::basevideo/seedance2/bernini-480p-i2v-audio-lipsync',
  label: 'Bernini Audio LipSync',
  capabilities: {
    video: {
      generationModeOptions: ['normal'],
      firstlastframe: false,
    },
  },
},
```

Keep the expected list unchanged:

```ts
expect(normalModels.map((item) => item.value)).toEqual([
  'p::normal',
  'p::both',
  'p::custom-no-capability',
])
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx.cmd vitest run tests/unit/novel-promotion/video-model-options.test.ts
```

Expected: FAIL because the Audio LipSync key is still present in `normalModels`.

- [ ] **Step 3: Implement the minimal shared filter**

Import the compatibility predicate and extend the existing filter:

```ts
import { isBerniniAudioLipsyncVideoModelKey } from '@/lib/novel-promotion/video-model-defaults'

interface VideoModelCapabilityCarrier {
  value?: string
  capabilities?: ModelCapabilities
}

export function filterNormalVideoModelOptions<T extends VideoModelCapabilityCarrier>(models: T[]): T[] {
  return models.filter((model) => (
    !isFirstLastFrameOnlyModel(model)
    && !isBerniniAudioLipsyncVideoModelKey(model.value)
  ))
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run the same Vitest command. Expected: all tests in the file PASS.

- [ ] **Step 5: Commit the isolated behavior**

```powershell
git add src/lib/model-capabilities/video-model-options.ts tests/unit/novel-promotion/video-model-options.test.ts
git commit -m "fix(video): hide legacy Bernini audio workflow"
```

---

### Task 2: Build and apply card-specific recommended duration definitions

**Files:**
- Create: `src/lib/model-capabilities/video-recommended-duration.ts`
- Create: `tests/unit/model-capabilities/video-recommended-duration.test.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/usePanelVideoModel.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/videoPanelRuntimeCore.tsx`

**Interfaces:**
- Produces: `normalizeRecommendedVideoDuration(value: unknown): number | null`.
- Produces: `applyRecommendedVideoDurationSelection(selection, input): Record<string, CapabilityValue>` so initial render and later synchronization use the same default rule.
- Produces: `withRecommendedVideoDuration(definitions, input): EffectiveVideoCapabilityDefinition[]`, where `input` contains `modelKey` and raw `recommendedDuration`.
- Extends: `usePanelVideoModel` input with `recommendedDuration?: unknown`.
- Produces: each returned duration capability field includes `recommendedValue?: VideoGenerationOptionValue`.

- [ ] **Step 1: Write failing pure-function tests**

Create tests that describe valid, duplicate, missing, invalid, and non-Bernini behavior:

```ts
import { describe, expect, it } from 'vitest'
import {
  applyRecommendedVideoDurationSelection,
  normalizeRecommendedVideoDuration,
  withRecommendedVideoDuration,
} from '@/lib/model-capabilities/video-recommended-duration'

const definitions = [{ field: 'duration', options: [5, 10], fieldI18n: null }]
const bernini = 'comfyui::basevideo/seedance2/bernini-480p-i2v'

describe('video recommended duration', () => {
  it('prepends a valid card duration and removes duplicates', () => {
    expect(withRecommendedVideoDuration(definitions, {
      modelKey: bernini,
      recommendedDuration: 9,
    })[0].options).toEqual([9, 5, 10])

    expect(withRecommendedVideoDuration(definitions, {
      modelKey: bernini,
      recommendedDuration: 10,
    })[0].options).toEqual([10, 5])
  })

  it.each([undefined, null, '', 0, -2, 'nope'])(
    'preserves current options for invalid recommendation %s',
    (value) => {
      expect(withRecommendedVideoDuration(definitions, {
        modelKey: bernini,
        recommendedDuration: value,
      })).toEqual(definitions)
    },
  )

  it('does not add custom seconds to a non-Bernini workflow', () => {
    expect(withRecommendedVideoDuration(definitions, {
      modelKey: 'comfyui::other',
      recommendedDuration: 9,
    })).toEqual(definitions)
  })

  it('normalizes numeric strings and rejects non-positive values', () => {
    expect(normalizeRecommendedVideoDuration('9')).toBe(9)
    expect(normalizeRecommendedVideoDuration(0)).toBeNull()
  })

  it('replaces only the default duration selection for Bernini', () => {
    expect(applyRecommendedVideoDurationSelection(
      { duration: 5, motionStrength: 2 },
      { modelKey: bernini, recommendedDuration: 9 },
    )).toEqual({ duration: 9, motionStrength: 2 })
    expect(applyRecommendedVideoDurationSelection(
      { duration: 5, motionStrength: 2 },
      { modelKey: bernini, recommendedDuration: undefined },
    )).toEqual({ duration: 5, motionStrength: 2 })
  })
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
npx.cmd vitest run tests/unit/model-capabilities/video-recommended-duration.test.ts
```

Expected: FAIL because `video-recommended-duration.ts` does not exist.

- [ ] **Step 3: Implement the pure adapter**

Create the module with exact positive-number parsing and Bernini-only adaptation:

```ts
import type { EffectiveVideoCapabilityDefinition } from '@/lib/model-capabilities/video-effective'
import type { CapabilityValue } from '@/lib/model-config-contract'
import { isSeedance2BerniniWorkflowKey } from '@/lib/providers/comfyui/seedance2-bernini-workflow'

export function normalizeRecommendedVideoDuration(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) return null
  return Number(parsed.toFixed(2))
}

export function withRecommendedVideoDuration(
  definitions: EffectiveVideoCapabilityDefinition[],
  input: { modelKey: string; recommendedDuration: unknown },
): EffectiveVideoCapabilityDefinition[] {
  const recommended = normalizeRecommendedVideoDuration(input.recommendedDuration)
  if (recommended === null || !isSeedance2BerniniWorkflowKey(input.modelKey)) return definitions
  return definitions.map((definition) => definition.field === 'duration'
    ? {
        ...definition,
        options: [recommended, ...definition.options.filter((value) => value !== recommended)],
      }
    : definition)
}

export function applyRecommendedVideoDurationSelection(
  selection: Record<string, CapabilityValue>,
  input: { modelKey: string; recommendedDuration: unknown },
): Record<string, CapabilityValue> {
  const recommended = normalizeRecommendedVideoDuration(input.recommendedDuration)
  if (recommended === null || !isSeedance2BerniniWorkflowKey(input.modelKey)) return selection
  return { ...selection, duration: recommended }
}
```

- [ ] **Step 4: Run the pure-function test and verify GREEN**

Run the same new Vitest file. Expected: all tests PASS.

- [ ] **Step 5: Write a failing panel-body wiring test**

Change the `ModelCapabilityDropdown` mock in `video-panel-card-body.test.ts` to expose `recommendedValue`, then add a normal-card test:

```ts
vi.mock('@/components/ui/config-modals/ModelCapabilityDropdown', () => ({
  ModelCapabilityDropdown: (props: { capabilityFields: Array<{ field: string; recommendedValue?: unknown }> }) =>
    React.createElement('div', null, JSON.stringify(props.capabilityFields)),
}))

it('passes the recommended duration metadata to the dropdown', () => {
  const runtime = createRuntime()
  runtime.layout = { ...runtime.layout, isLinked: false, isLastFrame: false, nextPanel: null }
  runtime.videoModel.capabilityFields = [{
    field: 'duration',
    label: '视频时长',
    options: [9, 5, 10],
    disabledOptions: [],
    value: 9,
    recommendedValue: 9,
  }]

  const markup = renderToStaticMarkup(React.createElement(VideoPanelCardBody, { runtime }))
  expect(markup).toContain('&quot;recommendedValue&quot;:9')
})
```

- [ ] **Step 6: Run the panel-body test and verify RED**

Run:

```powershell
npx.cmd vitest run tests/unit/novel-promotion/video-panel-card-body.test.ts
```

Expected: the new test FAILS because `VideoPanelCardBody` does not forward `recommendedValue`.

- [ ] **Step 7: Wire the recommendation through runtime and hook state**

Pass the raw card value from `videoPanelRuntimeCore.tsx`:

```ts
const videoModel = usePanelVideoModel({
  defaultVideoModel: effectiveDefaultVideoModel,
  capabilityOverrides,
  userVideoModels,
  recommendedDuration: panel.textPanel?.duration,
})
```

In `usePanelVideoModel.ts`, derive `recommendedDurationSeconds`, adapt `capabilityDefinitions`, and apply the same recommended selection to both the initial state and the synchronization effect:

```ts
const recommendedDurationSeconds = normalizeRecommendedVideoDuration(recommendedDuration)
const usesRecommendedDuration = recommendedDurationSeconds !== null
  && isSeedance2BerniniWorkflowKey(selectedModel)

const [generationOptions, setGenerationOptions] = useState<VideoGenerationOptions>(() =>
  applyRecommendedVideoDurationSelection(
    readSelectionForModel(capabilityOverrides, normalizedDefaultVideoModel),
    { modelKey: normalizedDefaultVideoModel, recommendedDuration },
  ),
)

const capabilityDefinitions = useMemo(() => withRecommendedVideoDuration(
  resolveEffectiveVideoCapabilityDefinitions({
    videoCapabilities: selectedOption?.capabilities?.video,
    pricingTiers,
  }),
  { modelKey: selectedModel, recommendedDuration },
), [pricingTiers, recommendedDuration, selectedModel, selectedOption?.capabilities?.video])

const selectionForDefaults = applyRecommendedVideoDurationSelection(
  selectedModelOverrides,
  { modelKey: selectedModel, recommendedDuration },
)
```

Use `selectionForDefaults` in the model/default synchronization effect. When mapping `capabilityFields`, add:

```ts
recommendedValue: definition.field === 'duration' && usesRecommendedDuration
  ? recommendedDurationSeconds
  : undefined,
```

In `VideoPanelCardBody.tsx`, forward `recommendedValue: field.recommendedValue` in the dropdown field mapping.

- [ ] **Step 8: Run focused hook-adapter and panel tests**

Run:

```powershell
npx.cmd vitest run tests/unit/model-capabilities/video-recommended-duration.test.ts tests/unit/novel-promotion/video-panel-card-body.test.ts
```

Expected: both files PASS.

- [ ] **Step 9: Commit recommended-duration behavior**

```powershell
git add src/lib/model-capabilities/video-recommended-duration.ts tests/unit/model-capabilities/video-recommended-duration.test.ts src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/usePanelVideoModel.ts src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/videoPanelRuntimeCore.tsx src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardBody.tsx tests/unit/novel-promotion/video-panel-card-body.test.ts
git commit -m "feat(video): default cards to recommended duration"
```

---

### Task 3: Render the recommended option label

**Files:**
- Modify: `src/components/ui/config-modals/ModelCapabilityDropdown.tsx`
- Modify: `tests/unit/components/model-capability-dropdown-translation.test.ts`

**Interfaces:**
- Extends: `CapabilityFieldDefinition` with optional `recommendedValue?: CapabilityValue`.
- Produces: exported `formatRecommendedCapabilityLabel(label, value, recommendedValue): string` for deterministic rendering tests.

- [ ] **Step 1: Write the failing formatter test**

Import the formatter and assert both recommended and ordinary options:

```ts
import {
  formatRecommendedCapabilityLabel,
  ModelCapabilityDropdown,
} from '@/components/ui/config-modals/ModelCapabilityDropdown'

it('marks only the recommended capability option', () => {
  expect(formatRecommendedCapabilityLabel('9', 9, 9)).toBe('9（推荐）')
  expect(formatRecommendedCapabilityLabel('5', 5, 9)).toBe('5')
  expect(formatRecommendedCapabilityLabel('9', 9, undefined)).toBe('9')
})
```

- [ ] **Step 2: Run the component test and verify RED**

Run:

```powershell
npx.cmd vitest run tests/unit/components/model-capability-dropdown-translation.test.ts
```

Expected: FAIL because the formatter export does not exist.

- [ ] **Step 3: Implement label metadata and use it for every capability control**

Add:

```ts
export interface CapabilityFieldDefinition {
  field: string
  label: string
  options: CapabilityValue[]
  disabledOptions?: CapabilityValue[]
  recommendedValue?: CapabilityValue
}

export function formatRecommendedCapabilityLabel(
  label: string,
  value: CapabilityValue,
  recommendedValue: CapabilityValue | undefined,
): string {
  return recommendedValue !== undefined && value === recommendedValue
    ? `${label}（推荐）`
    : label
}
```

For fixed, select, and segmented controls, replace each displayed `formatOptionLabel(opt)` with:

```tsx
{formatRecommendedCapabilityLabel(
  formatOptionLabel(opt),
  opt,
  def.recommendedValue,
)}
```

- [ ] **Step 4: Run component and panel tests and verify GREEN**

Run:

```powershell
npx.cmd vitest run tests/unit/components/model-capability-dropdown-translation.test.ts tests/unit/novel-promotion/video-panel-card-body.test.ts
```

Expected: both files PASS.

- [ ] **Step 5: Commit the label behavior**

```powershell
git add src/components/ui/config-modals/ModelCapabilityDropdown.tsx tests/unit/components/model-capability-dropdown-translation.test.ts
git commit -m "feat(video): label recommended card duration"
```

---

### Task 4: Make Bernini motion strength default to 1

**Files:**
- Modify: `standards/capabilities/image-video.catalog.json`
- Modify: `src/lib/providers/comfyui/seedance2-bernini-workflow.ts`
- Modify: `tests/unit/model-capabilities/comfyui-video-capabilities.test.ts`
- Modify: `tests/unit/model-capabilities/video-singleton-default.test.ts`
- Modify: `tests/unit/providers/comfyui-workflow-registry.test.ts`

**Interfaces:**
- Changes: both Bernini `motionStrengthOptions` arrays from `[2, 1, 3]` to `[1, 2, 3]`.
- Changes: `SEEDANCE2_BERNINI_DEFAULT_MOTION_STRENGTH` from `2` to `1`.
- Preserves: `normalizeSeedance2BerniniMotionStrength` and workflow injection APIs.

- [ ] **Step 1: Update expectations first and add fallback coverage**

Change both catalog/default test fixtures to `[1, 2, 3]` and expected normalized values to `1`. Add a workflow helper assertion using the exported normalizer:

```ts
expect(normalizeSeedance2BerniniMotionStrength(undefined)).toBe(1)
expect(normalizeSeedance2BerniniMotionStrength(2)).toBe(2)
```

In the workflow registry test that inspects node `399`, omit `motionStrength` from the injection and expect:

```ts
expect(graph['399'].inputs.strength_model).toBe(1)
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx.cmd vitest run tests/unit/model-capabilities/comfyui-video-capabilities.test.ts tests/unit/model-capabilities/video-singleton-default.test.ts tests/unit/providers/comfyui-workflow-registry.test.ts
```

Expected: FAIL with current order/default `2`.

- [ ] **Step 3: Change catalog order and fallback constant**

For both Bernini catalog entries set:

```json
"motionStrengthOptions": [
  1,
  2,
  3
]
```

Set:

```ts
export const SEEDANCE2_BERNINI_DEFAULT_MOTION_STRENGTH = 1
```

- [ ] **Step 4: Validate the catalog and run focused tests**

Run:

```powershell
npm.cmd run check:capability-catalog
npx.cmd vitest run tests/unit/model-capabilities/comfyui-video-capabilities.test.ts tests/unit/model-capabilities/video-singleton-default.test.ts tests/unit/providers/comfyui-workflow-registry.test.ts
```

Expected: catalog check exits `0`; all focused tests PASS.

- [ ] **Step 5: Commit the motion-strength behavior**

```powershell
git add standards/capabilities/image-video.catalog.json src/lib/providers/comfyui/seedance2-bernini-workflow.ts tests/unit/model-capabilities/comfyui-video-capabilities.test.ts tests/unit/model-capabilities/video-singleton-default.test.ts tests/unit/providers/comfyui-workflow-registry.test.ts
git commit -m "fix(video): default Bernini motion strength to one"
```

---

### Task 5: Verify the complete change set

**Files:**
- Verify all files changed in Tasks 1-4.

**Interfaces:**
- Consumes: all completed behavior from Tasks 1-4.
- Produces: fresh evidence that focused behavior, type safety, catalog validity, and production build remain sound.

- [ ] **Step 1: Run the complete focused test set**

```powershell
npx.cmd vitest run tests/unit/novel-promotion/video-model-options.test.ts tests/unit/model-capabilities/video-recommended-duration.test.ts tests/unit/novel-promotion/video-panel-card-body.test.ts tests/unit/components/model-capability-dropdown-translation.test.ts tests/unit/model-capabilities/comfyui-video-capabilities.test.ts tests/unit/model-capabilities/video-singleton-default.test.ts tests/unit/providers/comfyui-workflow-registry.test.ts
```

Expected: all files PASS with zero failures.

- [ ] **Step 2: Run static and catalog verification**

```powershell
npm.cmd run check:capability-catalog
npm.cmd run typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 3: Run the production build**

```powershell
npm.cmd run build
```

Expected: Prisma generation and Next.js production build both exit `0`.

- [ ] **Step 4: Inspect the final diff and repository state**

```powershell
git diff HEAD~4 --check
git status --short --branch
git log -5 --oneline
```

Expected: no whitespace errors; branch is clean; the four implementation commits follow the design and plan commits.
