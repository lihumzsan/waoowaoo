import type { Locale } from '@/i18n/routing'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { flattenChatMessageContent } from '@/lib/ai-registry/message-content'
import { AI_PROMPT_IDS, buildAiPromptContent } from '@/lib/ai-prompts'
import { safeParseJsonObject } from '@/lib/json-repair'
import { withTextBilling } from '@/lib/billing'
import { prisma } from '@/lib/prisma'
import { inferVideoGridModeForShotCount } from '@/lib/video-groups/core'
import { buildStoryboardVideoSegmentPromptFacts } from '@/lib/edit-script/prompt-builders'
import { buildStoryboardConsistencySource } from '@/lib/edit-script/storyboard-consistency/source-snapshot'
import {
  imagePromptComposerOutputSchema,
  validateImagePromptComposerOutput,
  validateVideoPromptComposerOutput,
  videoPromptComposerOutputSchema,
  type PanelPromptFactInput,
  type SegmentPromptFactInput,
} from './validation'
import { upsertComposedVideoGroupPrompt } from './video-groups'

const PROMPT_CACHE_MIN_CHARS = 1024

interface PromptComposerRunInput {
  readonly projectId: string
  readonly userId: string
  readonly model: string
  readonly locale: Locale
  readonly promptId:
    | typeof AI_PROMPT_IDS.EDIT_SCRIPT_IMAGE_PROMPT_COMPOSE
    | typeof AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT_COMPOSE
  readonly composerInput: Record<string, unknown>
  readonly action: string
}

interface ComposePromptInput {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly userId: string
  readonly locale: Locale
  readonly analysisModel: string
}

function readPrompt(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function runComposerPrompt(input: PromptComposerRunInput): Promise<Record<string, unknown>> {
  const composerInputJson = JSON.stringify(input.composerInput, null, 2)
  const content = buildAiPromptContent({
    promptId: input.promptId,
    locale: input.locale,
    variables: {
      composer_input_json: composerInputJson,
    },
    cacheVariableKeys: ['composer_input_json'],
    minCacheChars: PROMPT_CACHE_MIN_CHARS,
  })
  const finalPrompt = flattenChatMessageContent(content)
  const maxInputTokens = Math.max(1200, Math.ceil(finalPrompt.length * 1.2))
  const completion = await withTextBilling(
    input.userId,
    input.model,
    maxInputTokens,
    {
      projectId: input.projectId,
      action: input.action,
      metadata: { promptId: input.promptId },
    },
    async () => await executeAiTextStep({
      userId: input.userId,
      model: input.model,
      messages: [{ role: 'user', content }],
      temperature: 0.35,
      projectId: input.projectId,
      action: input.action,
      meta: {
        stepId: input.action,
        stepTitle: input.action,
        stepIndex: 1,
        stepTotal: 1,
      },
    }),
  )
  const text = completion.text.trim()
  if (!text) throw new Error(`PROMPT_COMPOSER_EMPTY:${input.promptId}`)
  return safeParseJsonObject(text)
}

async function loadPanelsForEditScript(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
}) {
  const storyboards = await prisma.projectStoryboard.findMany({
    where: {
      editScriptId: input.editScriptId,
      episodeId: input.episodeId,
      episode: {
        projectId: input.projectId,
      },
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      panels: {
        orderBy: { panelIndex: 'asc' },
      },
    },
  })
  const panels = storyboards.flatMap((storyboard) => storyboard.panels)
  if (panels.length === 0) throw new Error('PROMPT_COMPOSER_PANELS_REQUIRED')
  return panels
}

function panelFactInputs(panels: Awaited<ReturnType<typeof loadPanelsForEditScript>>): PanelPromptFactInput[] {
  return panels.map((panel) => {
    if (typeof panel.sourceShotNumber !== 'number' || !Number.isInteger(panel.sourceShotNumber) || panel.sourceShotNumber <= 0) {
      throw new Error(`PROMPT_COMPOSER_PANEL_SOURCE_SHOT_MISSING:${panel.id}`)
    }
    if (panel.renderFactsJson === null || panel.renderFactsJson === undefined) {
      throw new Error(`PROMPT_COMPOSER_PANEL_RENDER_FACTS_MISSING:${panel.id}`)
    }
    return {
      panelId: panel.id,
      shotNumber: panel.sourceShotNumber,
      renderFacts: panel.renderFactsJson,
    }
  })
}

export async function composeEditImagePrompts(input: ComposePromptInput): Promise<{
  readonly panelCount: number
}> {
  const panels = await loadPanelsForEditScript(input)
  const panelFacts = panelFactInputs(panels)
  const raw = await runComposerPrompt({
    projectId: input.projectId,
    userId: input.userId,
    model: input.analysisModel,
    locale: input.locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_IMAGE_PROMPT_COMPOSE,
    action: 'edit_image_prompt_compose',
    composerInput: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      editScriptId: input.editScriptId,
      panels: panelFacts.map((panel) => ({
        panelId: panel.panelId,
        shotNumber: panel.shotNumber,
        renderFacts: panel.renderFacts,
      })),
    },
  })
  const parsed = imagePromptComposerOutputSchema.parse(raw)
  const promptByShot = validateImagePromptComposerOutput({
    panels: panelFacts,
    output: parsed.panels,
  })

  await prisma.$transaction(panels.map((panel) => {
    if (typeof panel.sourceShotNumber !== 'number') throw new Error(`PROMPT_COMPOSER_PANEL_SOURCE_SHOT_MISSING:${panel.id}`)
    const prompt = promptByShot.get(panel.sourceShotNumber)
    if (!prompt) throw new Error(`PROMPT_COMPOSER_IMAGE_PROMPT_MISSING:${panel.sourceShotNumber}`)
    return prisma.projectPanel.update({
      where: { id: panel.id },
      data: { imagePrompt: prompt },
    })
  }))

  return { panelCount: panels.length }
}

function segmentFactInputs(input: {
  readonly sourceSnapshot: Awaited<ReturnType<typeof buildStoryboardConsistencySource>>['sourceSnapshot']
}): SegmentPromptFactInput[] {
  return input.sourceSnapshot.generationSegments
    .filter((segment) => segment.shotNumbers.length >= 2)
    .map((segment) => {
      inferVideoGridModeForShotCount(segment.shotNumbers.length)
      const shots = segment.shotNumbers.map((shotNumber) => {
        const shot = input.sourceSnapshot.shots.find((candidate) => candidate.shotNumber === shotNumber)
        if (!shot) throw new Error(`VIDEO_PROMPT_COMPOSER_SHOT_MISSING:${shotNumber}`)
        return shot
      })
      const executions = segment.shotNumbers.map((shotNumber) => {
        const execution = input.sourceSnapshot.shotExecutionPlan.shots.find((candidate) => candidate.shotNumber === shotNumber)
        if (!execution) throw new Error(`VIDEO_PROMPT_COMPOSER_EXECUTION_MISSING:${shotNumber}`)
        return execution
      })
      const built = buildStoryboardVideoSegmentPromptFacts({
        segment,
        sourceGenerationSegmentId: segment.sourceGenerationSegmentId,
        shots,
        executions,
        assets: input.sourceSnapshot.assets,
        styleBible: input.sourceSnapshot.styleBible,
      })
      return {
        sourceGenerationSegmentId: segment.sourceGenerationSegmentId,
        shotNumbers: segment.shotNumbers,
        facts: built.facts,
      }
    })
}

function durationForShotNumbers(input: {
  readonly sourceSnapshot: Awaited<ReturnType<typeof buildStoryboardConsistencySource>>['sourceSnapshot']
  readonly shotNumbers: readonly number[]
}): number {
  return input.shotNumbers.reduce((total, shotNumber) => {
    const shot = input.sourceSnapshot.shots.find((candidate) => candidate.shotNumber === shotNumber)
    if (!shot) throw new Error(`VIDEO_PROMPT_COMPOSER_DURATION_SHOT_MISSING:${shotNumber}`)
    return total + shot.durationSec
  }, 0)
}

export async function composeEditVideoPrompts(input: ComposePromptInput): Promise<{
  readonly panelCount: number
  readonly videoGroupCount: number
}> {
  const [panels, source] = await Promise.all([
    loadPanelsForEditScript(input),
    buildStoryboardConsistencySource({
      projectId: input.projectId,
      episodeId: input.episodeId,
      editScriptId: input.editScriptId,
      userId: input.userId,
    }),
  ])
  const panelFacts = panelFactInputs(panels)
  const segmentFacts = segmentFactInputs({ sourceSnapshot: source.sourceSnapshot })
  const raw = await runComposerPrompt({
    projectId: input.projectId,
    userId: input.userId,
    model: input.analysisModel,
    locale: input.locale,
    promptId: AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT_COMPOSE,
    action: 'edit_video_prompt_compose',
    composerInput: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      editScriptId: input.editScriptId,
      panels: panelFacts.map((panel) => ({
        panelId: panel.panelId,
        shotNumber: panel.shotNumber,
        renderFacts: panel.renderFacts,
      })),
      generationSegments: segmentFacts,
    },
  })
  const parsed = videoPromptComposerOutputSchema.parse(raw)
  const validated = validateVideoPromptComposerOutput({
    panels: panelFacts,
    segments: segmentFacts,
    shotOutputs: parsed.shotPrompts,
    segmentOutputs: parsed.generationSegments,
  })

  await prisma.$transaction(panels.map((panel) => {
    if (typeof panel.sourceShotNumber !== 'number') throw new Error(`PROMPT_COMPOSER_PANEL_SOURCE_SHOT_MISSING:${panel.id}`)
    const prompt = validated.shotPrompts.get(panel.sourceShotNumber)
    if (!prompt) throw new Error(`PROMPT_COMPOSER_VIDEO_PROMPT_MISSING:${panel.sourceShotNumber}`)
    return prisma.projectPanel.update({
      where: { id: panel.id },
      data: { videoPrompt: prompt },
    })
  }))

  for (const segment of segmentFacts) {
    const prompt = validated.segmentPrompts.get(segment.sourceGenerationSegmentId)
    if (!prompt) throw new Error(`PROMPT_COMPOSER_SEGMENT_PROMPT_MISSING:${segment.sourceGenerationSegmentId}`)
    await upsertComposedVideoGroupPrompt({
      projectId: input.projectId,
      episodeId: input.episodeId,
      gridMode: inferVideoGridModeForShotCount(segment.shotNumbers.length),
      shotNumbers: segment.shotNumbers,
      durationSec: durationForShotNumbers({
        sourceSnapshot: source.sourceSnapshot,
        shotNumbers: segment.shotNumbers,
      }),
      prompt,
    })
  }

  return {
    panelCount: panels.length,
    videoGroupCount: segmentFacts.length,
  }
}

export function hasPrompt(value: string | null | undefined): boolean {
  return readPrompt(value).length > 0
}
