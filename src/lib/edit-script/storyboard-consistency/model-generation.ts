import { AI_PROMPT_IDS, buildAiPromptContent } from '@/lib/ai-prompts'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { safeParseJsonObject } from '@/lib/json-repair'
import type { Locale } from '@/i18n/routing'
import {
  panelFinalPromptBlockModelOutputSchema,
  type PanelFinalPromptBlockModelOutput,
  type ShotBlocking,
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

const EDIT_SCRIPT_PROMPT_CACHE_MIN_CHARS = 1024

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

function cinematographyShotFor(
  snapshot: StoryboardConsistencySourceSnapshot,
  shotNumber: number,
) {
  const shot = snapshot.cinematographyShotPlan.shots.find((item) => item.shotNumber === shotNumber)
  if (!shot) throw new Error(`EDIT_SCRIPT_STORYBOARD_CINEMATOGRAPHY_SHOT_MISSING:${shotNumber}`)
  return shot
}

function cameraPlanMetadata(
  snapshot: StoryboardConsistencySourceSnapshot,
  shotNumber: number,
  shotBlocking: ShotBlocking,
): Record<string, unknown> {
  const shot = cinematographyShotFor(snapshot, shotNumber)
  return {
    source: 'camera_plan',
    strategy: 'spatial_text_blocking',
    cameraPlan: {
      shotScale: shot.shotScale,
      cameraPosition: shot.cameraPosition,
      cameraHeight: shot.cameraHeight,
      cameraAngle: shot.cameraAngle,
      composition: shot.composition,
      cameraMovement: shot.movement,
      lensAndDepth: `${shot.lens}; ${shot.depthOfField}`,
      lighting: shot.lighting,
      axisAndEyeline: shot.axisAndEyeline,
      continuityIn: shot.continuityIn,
      continuityOut: shot.continuityOut,
      shotBlocking,
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
  const finalPromptContent = buildAiPromptContent({
    promptId: input.promptId,
    locale: input.locale,
    variables: input.variables,
    cacheVariableKeys: Object.keys(input.variables),
    minCacheChars: EDIT_SCRIPT_PROMPT_CACHE_MIN_CHARS,
  })
  const completion = await executeAiTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: finalPromptContent }],
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
}): Promise<{
  readonly cameraPlanOutput: {
    readonly strategy: 'spatial_text_blocking'
    readonly panels: readonly Record<string, unknown>[]
  }
  readonly panels: readonly StoryboardPanelPromptDraft[]
  readonly blockOutputs: readonly PanelFinalPromptBlockModelOutput['panelFinalPromptBlockOutput'][]
}> {
  const blockOutputs = await Promise.all(input.snapshot.videoBlocks.map(async (block) => {
    const contract = panelContractForBlock(input.snapshot, block)
    const adjacent = adjacentBlocks(input.snapshot, block.blockIndex)
    const blockSpatialProfileOutput = spatialProfileStrategyOutputForCameraPlan(input.spatialProfileStrategyOutput, block.sourceVideoBlockId)
    const raw = await runTextJsonStep({
      ...input,
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_PANEL_FINAL_PROMPT_BLOCK,
      variables: {
        director_decoupage_json: stringifyForPrompt(input.snapshot.directorDecoupage),
        cinematography_shot_plan_json: stringifyForPrompt(input.snapshot.cinematographyShotPlan),
        full_edit_script_json: stringifyForPrompt({
          ...input.snapshot.editScript,
          shots: input.snapshot.shots,
          videoBlocks: input.snapshot.videoBlocks,
        }),
        source_snapshot_json: stringifyForPrompt(input.snapshot),
        spatial_profile_strategy_output_json: stringifyForPrompt(blockSpatialProfileOutput),
        video_block_json: stringifyForPrompt(block),
        block_shots_json: stringifyForPrompt(shotsForBlock(input.snapshot, block)),
        adjacent_blocks_json: stringifyForPrompt(adjacent),
        previous_block_json: stringifyForPrompt(adjacent.previous),
        next_block_json: stringifyForPrompt(adjacent.next),
        panel_contract_json: stringifyForPrompt(contract),
      },
      stepTitle: `Generate edit-script storyboard final panel prompts for block ${block.blockIndex + 1}`,
      stepIndex: 1,
      stepTotal: 1,
    })
    const parsed = panelFinalPromptBlockModelOutputSchema.parse(raw)
    if (parsed.panelFinalPromptBlockOutput.sourceVideoBlockId !== block.sourceVideoBlockId) {
      throw new Error(`EDIT_SCRIPT_STORYBOARD_PANEL_FINAL_PROMPT_BLOCK_MISMATCH:${block.sourceVideoBlockId}`)
    }
    validatePanelContractEntries(contract, parsed.panelFinalPromptBlockOutput.panels)
    return parsed.panelFinalPromptBlockOutput
  }))
  const finalPanels = blockOutputs.flatMap((block) => block.panels)
  validatePanelContract(input.snapshot, finalPanels)
  const finalPanelByKey = new Map(finalPanels.map((panel) => [panelKey(panel), panel]))
  const panels = finalPanels
    .slice()
    .sort((left, right) => left.panelIndex - right.panelIndex)
    .map((panel) => ({
      panelIndex: panel.panelIndex,
      sourceShotNumber: panel.sourceShotNumber,
      sourceVideoBlockId: panel.sourceVideoBlockId,
      prompt: panel.finalPanelPrompt.trim(),
      videoPrompt: panel.finalVideoPrompt.trim(),
      shotBlocking: panel.shotBlocking,
      metadata: cameraPlanMetadata(input.snapshot, panel.sourceShotNumber, panel.shotBlocking),
    }))
  const cameraPlanOutput = {
    strategy: 'spatial_text_blocking' as const,
    panels: panelContract(input.snapshot).map((panel) => {
      const shot = cinematographyShotFor(input.snapshot, panel.sourceShotNumber)
      const generatedPanel = finalPanelByKey.get(panelKey(panel))
      if (!generatedPanel) throw new Error(`EDIT_SCRIPT_STORYBOARD_PANEL_FINAL_PROMPT_MISSING:${panel.sourceShotNumber}`)
      return {
        panelIndex: panel.panelIndex,
        sourceShotNumber: panel.sourceShotNumber,
        sourceVideoBlockId: panel.sourceVideoBlockId,
        shotScale: shot.shotScale,
        cameraPosition: shot.cameraPosition,
        cameraHeight: shot.cameraHeight,
        cameraAngle: shot.cameraAngle,
        composition: shot.composition,
        cameraMovement: shot.movement,
        lensAndDepth: `${shot.lens}; ${shot.depthOfField}`,
        screenDirection: shot.axisAndEyeline,
        aestheticIntent: shot.lighting,
        emotionalEffect: input.snapshot.directorDecoupage.shots.find((item) => item.shotNumber === panel.sourceShotNumber)?.dramaticPurpose ?? null,
        continuityNote: `${shot.continuityIn} ${shot.continuityOut}`.trim(),
        shotBlocking: generatedPanel.shotBlocking,
      }
    }),
  }
  return {
    cameraPlanOutput,
    panels,
    blockOutputs,
  }
}
