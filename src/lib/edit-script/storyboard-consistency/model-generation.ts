import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import { executeAiTextStep, executeAiVisionStep } from '@/lib/ai-exec/engine'
import { safeParseJsonObject } from '@/lib/json-repair'
import type { Locale } from '@/i18n/routing'
import {
  cameraPlanBlockModelOutputSchema,
  cameraPlanModelOutputSchema,
  cameraStyleBibleModelOutputSchema,
  generatedPanelPromptSchema,
  gridCoordinateAnalysisModelOutputSchema,
  gridFloorPlanModelOutputSchema,
  type CameraPlanBlockModelOutput,
  type CameraPlanModelOutput,
  type CameraPlanPanel,
  type CameraStyleBibleModelOutput,
  type GridFloorPlanModelOutput,
  type StoryboardFloorPlanSceneGroup,
  type StoryboardConsistencySourceVideoBlock,
  type StoryboardConsistencySourceSnapshot,
  type StoryboardPanelPromptDraft,
} from './types'
import { buildFloorPlanSceneGroups, classifyStoryboardConsistencyBlocks, resolveGridDensity } from './strategies'

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
    strategy: 'grid_coordinates_camera_plan',
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

async function runVisionJsonStep(input: GenerationContext & {
  readonly promptId: typeof AI_PROMPT_IDS[keyof typeof AI_PROMPT_IDS]
  readonly variables: Record<string, string>
  readonly imageUrls: readonly string[]
  readonly stepTitle: string
  readonly stepIndex: number
  readonly stepTotal: number
}): Promise<Record<string, unknown>> {
  const finalPrompt = buildAiPrompt({
    promptId: input.promptId,
    locale: input.locale,
    variables: input.variables,
  })
  const completion = await executeAiVisionStep({
    userId: input.userId,
    model: input.model,
    prompt: finalPrompt,
    imageUrls: [...input.imageUrls],
    temperature: 0.2,
    projectId: input.projectId,
    action: input.promptId,
    meta: {
      stepId: input.promptId,
      stepTitle: input.stepTitle,
      stepIndex: input.stepIndex,
      stepTotal: input.stepTotal,
    },
  })
  if (!completion.text.trim()) throw new Error(`EDIT_SCRIPT_STORYBOARD_VISION_EMPTY:${input.promptId}`)
  return safeParseJsonObject(completion.text)
}

export async function generateGridFloorPlan(input: GenerationContext & {
  readonly snapshot: StoryboardConsistencySourceSnapshot
}): Promise<GridFloorPlanModelOutput> {
  const density = resolveGridDensity(input.snapshot.project.videoRatio)
  const classifications = classifyStoryboardConsistencyBlocks(input.snapshot)
  const sceneGroups = buildFloorPlanSceneGroups(input.snapshot, classifications)
  const raw = await runTextJsonStep({
    ...input,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_GRID_FLOOR_PLAN,
    variables: {
      source_snapshot_json: stringifyForPrompt(input.snapshot),
      block_classification_draft_json: stringifyForPrompt(classifications),
      scene_floor_plan_groups_json: stringifyForPrompt(sceneGroups),
      grid_density_json: stringifyForPrompt(density),
    },
    stepTitle: 'Generate edit-script storyboard grid floor plan prompts',
    stepIndex: 1,
    stepTotal: 1,
  })
  const parsed = gridFloorPlanModelOutputSchema.parse(readStrategyOutput(raw))
  if (
    parsed.grid.columns !== density.columns
    || parsed.grid.rows !== density.rows
    || parsed.grid.ratio !== density.ratio
  ) {
    throw new Error('EDIT_SCRIPT_STORYBOARD_GRID_DENSITY_MISMATCH')
  }
  return {
    ...parsed,
    floorPlans: dedupeFloorPlansByScene(sceneGroups, parsed.floorPlans),
  }
}

function dedupeFloorPlansByScene(
  sceneGroups: readonly StoryboardFloorPlanSceneGroup[],
  floorPlans: GridFloorPlanModelOutput['floorPlans'],
): GridFloorPlanModelOutput['floorPlans'] {
  if (floorPlans.length === 0) return floorPlans
  if (sceneGroups.length === 0) {
    throw new Error('EDIT_SCRIPT_STORYBOARD_FLOOR_PLAN_SCENE_GROUP_MISMATCH')
  }
  const byLocation = new Map<string, GridFloorPlanModelOutput['floorPlans'][number]>()
  floorPlans.forEach((plan) => {
    const matchedGroup = matchFloorPlanSceneGroup(sceneGroups, plan)
    if (!matchedGroup) throw new Error('EDIT_SCRIPT_STORYBOARD_FLOOR_PLAN_SCENE_GROUP_MISMATCH')
    const previous = byLocation.get(matchedGroup.locationTargetId)
    if (!previous || previous.skipped) {
      byLocation.set(matchedGroup.locationTargetId, {
        ...plan,
        groupIndex: matchedGroup.groupIndex,
        sourceVideoBlockIds: [...matchedGroup.sourceVideoBlockIds],
        classification: matchedGroup.classification,
        location: matchedGroup.locationName,
        participants: [...new Set([...matchedGroup.participants, ...plan.participants])],
      })
    }
  })
  const deduped = Array.from(byLocation.values()).sort((left, right) => left.groupIndex - right.groupIndex)
  return deduped
}

function normalizeSceneName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function matchFloorPlanSceneGroup(
  sceneGroups: readonly StoryboardFloorPlanSceneGroup[],
  plan: GridFloorPlanModelOutput['floorPlans'][number],
): StoryboardFloorPlanSceneGroup | null {
  const normalizedLocation = plan.location === null ? '' : normalizeSceneName(plan.location)
  if (normalizedLocation) {
    const locationMatched = sceneGroups.find((group) => normalizeSceneName(group.locationName) === normalizedLocation)
    if (locationMatched) return locationMatched
  }

  const groupIndexMatched = sceneGroups.find((group) => group.groupIndex === plan.groupIndex)
  if (groupIndexMatched) return groupIndexMatched

  const sourceMatchedGroups = sceneGroups.filter((group) => (
    plan.sourceVideoBlockIds.some((sourceVideoBlockId) => group.sourceVideoBlockIds.includes(sourceVideoBlockId))
  ))
  return sourceMatchedGroups.length === 1 ? sourceMatchedGroups[0] ?? null : null
}

function readStrategyOutput(raw: Record<string, unknown>): unknown {
  const output = raw.strategyOutput
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('EDIT_SCRIPT_STORYBOARD_STRATEGY_OUTPUT_MISSING')
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function coordinateBlocks(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.blocks)) return []
  return value.blocks.filter(isRecord)
}

function hasUsableCoordinates(block: Record<string, unknown>): boolean {
  return block.skipped !== true
    && block.classification !== 'no_fixed_space'
    && Array.isArray(block.coordinates)
    && block.coordinates.length > 0
}

function coordinateStrategyOutputForCameraPlan(
  coordinateStrategyOutput: unknown,
  sourceVideoBlockId: string | null,
): Record<string, unknown> {
  const base = isRecord(coordinateStrategyOutput) ? coordinateStrategyOutput : {}
  const blocks = coordinateBlocks(coordinateStrategyOutput).filter((block) => (
    hasUsableCoordinates(block)
    && (sourceVideoBlockId === null || block.sourceVideoBlockId === sourceVideoBlockId)
  ))
  return {
    ...base,
    strategy: typeof base.strategy === 'string' ? base.strategy : 'grid_coordinates',
    blocks,
  }
}

export async function analyzeGridCoordinates(input: GenerationContext & {
  readonly snapshot: StoryboardConsistencySourceSnapshot
  readonly floorPlanArtifacts: readonly Record<string, unknown>[]
  readonly overlayImageUrls: readonly string[]
}): Promise<{
  readonly strategyOutput: unknown
}> {
  if (input.overlayImageUrls.length === 0) throw new Error('EDIT_SCRIPT_STORYBOARD_GRID_OVERLAY_IMAGE_REQUIRED')
  const raw = await runVisionJsonStep({
    ...input,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_GRID_VISION,
    imageUrls: input.overlayImageUrls,
    variables: {
      source_snapshot_json: stringifyForPrompt(input.snapshot),
      floor_plan_artifacts_json: stringifyForPrompt(input.floorPlanArtifacts),
      panel_contract_json: stringifyForPrompt(panelContract(input.snapshot)),
    },
    stepTitle: 'Analyze edit-script storyboard coordinate overlays',
    stepIndex: 1,
    stepTotal: 1,
  })
  const parsed = gridCoordinateAnalysisModelOutputSchema.parse(raw)
  return {
    strategyOutput: parsed.strategyOutput,
  }
}

export async function generateCameraPlan(input: GenerationContext & {
  readonly snapshot: StoryboardConsistencySourceSnapshot
  readonly coordinateStrategyOutput: unknown
}): Promise<CameraPlanModelOutput & {
  readonly panels: readonly StoryboardPanelPromptDraft[]
  readonly cameraStyleBible: CameraStyleBibleModelOutput['cameraStyleBible']
  readonly blockOutputs: readonly CameraPlanBlockModelOutput['cameraPlanBlockOutput'][]
}> {
  const cameraPlanCoordinateOutput = coordinateStrategyOutputForCameraPlan(input.coordinateStrategyOutput, null)
  const bibleRaw = await runTextJsonStep({
    ...input,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_CAMERA_STYLE_BIBLE,
    variables: {
      source_snapshot_json: stringifyForPrompt(input.snapshot),
      coordinate_strategy_output_json: stringifyForPrompt(cameraPlanCoordinateOutput),
    },
    stepTitle: 'Generate edit-script storyboard camera style bible',
    stepIndex: 1,
    stepTotal: 2,
  })
  const bible = cameraStyleBibleModelOutputSchema.parse(bibleRaw)
  const blockOutputs = await Promise.all(input.snapshot.videoBlocks.map(async (block) => {
    const contract = panelContractForBlock(input.snapshot, block)
    const blockCoordinateOutput = coordinateStrategyOutputForCameraPlan(input.coordinateStrategyOutput, block.sourceVideoBlockId)
    const raw = await runTextJsonStep({
      ...input,
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN_BLOCK,
      variables: {
        source_snapshot_json: stringifyForPrompt(input.snapshot),
        camera_style_bible_json: stringifyForPrompt(bible.cameraStyleBible),
        coordinate_strategy_output_json: stringifyForPrompt(blockCoordinateOutput),
        video_block_json: stringifyForPrompt(block),
        block_shots_json: stringifyForPrompt(shotsForBlock(input.snapshot, block)),
        adjacent_blocks_json: stringifyForPrompt(adjacentBlocks(input.snapshot, block.blockIndex)),
        panel_contract_json: stringifyForPrompt(contract),
      },
      stepTitle: `Generate edit-script storyboard camera plan for block ${block.blockIndex + 1}`,
      stepIndex: 2,
      stepTotal: 2,
    })
    const parsed = cameraPlanBlockModelOutputSchema.parse(raw)
    if (parsed.cameraPlanBlockOutput.sourceVideoBlockId !== block.sourceVideoBlockId) {
      throw new Error(`EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN_BLOCK_MISMATCH:${block.sourceVideoBlockId}`)
    }
    validatePanelContractEntries(contract, parsed.cameraPlanBlockOutput.panels)
    return parsed.cameraPlanBlockOutput
  }))
  const cameraPlanPanels = blockOutputs.flatMap((block) => block.panels)
  const parsed = cameraPlanModelOutputSchema.parse({
    cameraPlanOutput: {
      strategy: 'camera_plan',
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
    { source: 'camera_plan', strategy: 'grid_coordinates_camera_plan' },
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
