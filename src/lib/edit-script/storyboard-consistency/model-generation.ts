import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { safeParseJsonObject } from '@/lib/json-repair'
import type { Locale } from '@/i18n/routing'
import {
  cameraPlanModelOutputSchema,
  cameraStyleBibleModelOutputSchema,
  generatedPanelPromptSchema,
  panelFinalPromptBlockModelOutputSchema,
  type CameraPlanModelOutput,
  type CameraPlanPanel,
  type CameraStyleBibleModelOutput,
  type PanelFinalPromptBlockModelOutput,
  type StoryboardConsistencySourceVideoBlock,
  type StoryboardConsistencySourceSnapshot,
  type StoryboardPanelPromptDraft,
} from './types'

interface GenerationContext {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
}

function stringifyForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function panelContract(snapshot: StoryboardConsistencySourceSnapshot) {
  return snapshot.shots.map((shot, panelIndex) => {
    const block = snapshot.videoBlocks.find((item) => item.shotNumbers.includes(shot.shotNumber))
    if (!block) throw new Error(`EDIT_SCRIPT_STORYBOARD_PANEL_CONTRACT_BLOCK_MISSING:${shot.shotNumber}`)
    return {
      panelIndex,
      sourceShotNumber: shot.shotNumber,
      sourceVideoBlockId: block.sourceVideoBlockId,
      shot,
    }
  })
}

function panelContractForBlock(
  snapshot: StoryboardConsistencySourceSnapshot,
  block: StoryboardConsistencySourceVideoBlock,
) {
  const shotNumbers = new Set(block.shotNumbers)
  return panelContract(snapshot).filter((panel) => shotNumbers.has(panel.sourceShotNumber))
}

function shotsForBlock(
  snapshot: StoryboardConsistencySourceSnapshot,
  block: StoryboardConsistencySourceVideoBlock,
) {
  const shotNumbers = new Set(block.shotNumbers)
  return snapshot.shots.filter((shot) => shotNumbers.has(shot.shotNumber))
}

function adjacentBlocks(snapshot: StoryboardConsistencySourceSnapshot, blockIndex: number) {
  return {
    previous: blockIndex > 0 ? snapshot.videoBlocks[blockIndex - 1] ?? null : null,
    next: blockIndex < snapshot.videoBlocks.length - 1 ? snapshot.videoBlocks[blockIndex + 1] ?? null : null,
  }
}

function panelKey(panel: {
  readonly panelIndex: number
  readonly sourceShotNumber: number
  readonly sourceVideoBlockId: string
}): string {
  return `${panel.panelIndex}:${panel.sourceShotNumber}:${panel.sourceVideoBlockId}`
}

function validatePanelContractEntries(
  contract: readonly ReturnType<typeof panelContract>[number][],
  panels: readonly {
    readonly panelIndex: number
    readonly sourceShotNumber: number
    readonly sourceVideoBlockId: string
  }[],
): void {
  const requiredKeys = new Set(contract.map(panelKey))
  const seen = new Set<string>()
  for (const panel of panels) {
    const key = panelKey(panel)
    if (!requiredKeys.has(key)) throw new Error(`EDIT_SCRIPT_STORYBOARD_LLM_PANEL_UNEXPECTED:${key}`)
    if (seen.has(key)) throw new Error(`EDIT_SCRIPT_STORYBOARD_LLM_PANEL_DUPLICATE:${key}`)
    seen.add(key)
  }
  for (const required of requiredKeys) {
    if (!seen.has(required)) throw new Error(`EDIT_SCRIPT_STORYBOARD_LLM_PANEL_MISSING:${required}`)
  }
}

function validatePanelContract(
  snapshot: StoryboardConsistencySourceSnapshot,
  panels: readonly {
    readonly panelIndex: number
    readonly sourceShotNumber: number
    readonly sourceVideoBlockId: string
  }[],
): void {
  validatePanelContractEntries(panelContract(snapshot), panels)
}

function validatePanels(
  snapshot: StoryboardConsistencySourceSnapshot,
  panels: readonly typeof generatedPanelPromptSchema._output[],
  metadata: Record<string, unknown>,
): StoryboardPanelPromptDraft[] {
  validatePanelContract(snapshot, panels)
  return panels
    .slice()
    .sort((left, right) => left.panelIndex - right.panelIndex)
    .map((panel) => ({
      panelIndex: panel.panelIndex,
      sourceShotNumber: panel.sourceShotNumber,
      sourceVideoBlockId: panel.sourceVideoBlockId,
      prompt: panel.prompt.trim(),
      metadata,
    }))
}

function cameraPlanMetadata(panel: CameraPlanPanel): Record<string, unknown> {
  return {
    source: 'camera_plan',
    strategy: 'spatial_text_blocking',
    cameraPlan: {
      shotScale: panel.shotScale,
      cameraPosition: panel.cameraPosition,
      cameraHeight: panel.cameraHeight,
      cameraAngle: panel.cameraAngle,
      composition: panel.composition,
      cameraMovement: panel.cameraMovement,
      lensAndDepth: panel.lensAndDepth,
      screenDirection: panel.screenDirection,
      aestheticIntent: panel.aestheticIntent,
      emotionalEffect: panel.emotionalEffect,
      continuityNote: panel.continuityNote,
      shotBlocking: panel.shotBlocking,
    },
  }
}

async function runTextJsonStep(input: GenerationContext & {
  readonly promptId: typeof AI_PROMPT_IDS[keyof typeof AI_PROMPT_IDS]
  readonly variables: Record<string, string>
  readonly stepTitle: string
  readonly stepIndex: number
  readonly stepTotal: number
}): Promise<Record<string, unknown>> {
  const finalPrompt = buildAiPrompt({
    promptId: input.promptId,
    locale: input.locale,
    variables: input.variables,
  })
  const completion = await executeAiTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: finalPrompt }],
    temperature: 0.35,
    projectId: input.projectId,
    action: input.promptId,
    meta: {
      stepId: input.promptId,
      stepTitle: input.stepTitle,
      stepIndex: input.stepIndex,
      stepTotal: input.stepTotal,
    },
  })
  if (!completion.text.trim()) throw new Error(`EDIT_SCRIPT_STORYBOARD_LLM_EMPTY:${input.promptId}`)
  return safeParseJsonObject(completion.text)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function spatialProfileStrategyOutputForCameraPlan(
  spatialProfileStrategyOutput: unknown,
  sourceVideoBlockId: string | null,
): Record<string, unknown> {
  const base = isRecord(spatialProfileStrategyOutput) ? spatialProfileStrategyOutput : {}
  return {
    ...base,
    strategy: 'spatial_text_blocking',
    sourceVideoBlockId,
  }
}

export async function generateStoryboardPanelFinalPrompts(input: GenerationContext & {
  readonly snapshot: StoryboardConsistencySourceSnapshot
  readonly spatialProfileStrategyOutput: unknown
}): Promise<CameraPlanModelOutput & {
  readonly panels: readonly StoryboardPanelPromptDraft[]
  readonly cameraStyleBible: CameraStyleBibleModelOutput['cameraStyleBible']
  readonly blockOutputs: readonly PanelFinalPromptBlockModelOutput['panelFinalPromptBlockOutput'][]
}> {
  const cameraPlanSpatialProfileOutput = spatialProfileStrategyOutputForCameraPlan(input.spatialProfileStrategyOutput, null)
  const bibleRaw = await runTextJsonStep({
    ...input,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_CAMERA_STYLE_BIBLE,
    variables: {
      source_snapshot_json: stringifyForPrompt(input.snapshot),
      spatial_profile_strategy_output_json: stringifyForPrompt(cameraPlanSpatialProfileOutput),
    },
    stepTitle: 'Generate edit-script storyboard camera style bible',
    stepIndex: 1,
    stepTotal: 2,
  })
  const bible = cameraStyleBibleModelOutputSchema.parse(bibleRaw)
  const blockOutputs = await Promise.all(input.snapshot.videoBlocks.map(async (block) => {
    const contract = panelContractForBlock(input.snapshot, block)
    const blockSpatialProfileOutput = spatialProfileStrategyOutputForCameraPlan(input.spatialProfileStrategyOutput, block.sourceVideoBlockId)
    const raw = await runTextJsonStep({
      ...input,
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_PANEL_FINAL_PROMPT_BLOCK,
      variables: {
        source_snapshot_json: stringifyForPrompt(input.snapshot),
        camera_style_bible_json: stringifyForPrompt(bible.cameraStyleBible),
        spatial_profile_strategy_output_json: stringifyForPrompt(blockSpatialProfileOutput),
        video_block_json: stringifyForPrompt(block),
        block_shots_json: stringifyForPrompt(shotsForBlock(input.snapshot, block)),
        adjacent_blocks_json: stringifyForPrompt(adjacentBlocks(input.snapshot, block.blockIndex)),
        panel_contract_json: stringifyForPrompt(contract),
      },
      stepTitle: `Generate edit-script storyboard final panel prompts for block ${block.blockIndex + 1}`,
      stepIndex: 2,
      stepTotal: 2,
    })
    const parsed = panelFinalPromptBlockModelOutputSchema.parse(raw)
    if (parsed.panelFinalPromptBlockOutput.sourceVideoBlockId !== block.sourceVideoBlockId) {
      throw new Error(`EDIT_SCRIPT_STORYBOARD_PANEL_FINAL_PROMPT_BLOCK_MISMATCH:${block.sourceVideoBlockId}`)
    }
    validatePanelContractEntries(contract, parsed.panelFinalPromptBlockOutput.panels)
    return parsed.panelFinalPromptBlockOutput
  }))
  const cameraPlanPanels = blockOutputs.flatMap((block) => block.panels)
  const parsed = cameraPlanModelOutputSchema.parse({
    cameraPlanOutput: {
      strategy: 'spatial_text_blocking',
      cameraStyleBible: bible.cameraStyleBible,
      blocks: blockOutputs,
      panels: cameraPlanPanels,
    },
  })
  validatePanelContract(input.snapshot, parsed.cameraPlanOutput.panels)
  const panels = validatePanels(
    input.snapshot,
    parsed.cameraPlanOutput.panels.map((panel) => ({
      panelIndex: panel.panelIndex,
      sourceShotNumber: panel.sourceShotNumber,
      sourceVideoBlockId: panel.sourceVideoBlockId,
      prompt: panel.finalPanelPrompt,
    })),
    { source: 'camera_plan', strategy: 'spatial_text_blocking' },
  ).map((panel) => {
    const cameraPlan = parsed.cameraPlanOutput.panels.find((item) => panelKey(item) === panelKey(panel))
    if (!cameraPlan) throw new Error(`EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN_PANEL_MISSING:${panel.sourceShotNumber}`)
    return {
      ...panel,
      metadata: cameraPlanMetadata(cameraPlan),
    }
  })
  return {
    ...parsed,
    panels,
    cameraStyleBible: bible.cameraStyleBible,
    blockOutputs,
  }
}
