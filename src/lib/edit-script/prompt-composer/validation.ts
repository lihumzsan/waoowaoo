import { z } from 'zod'

export interface PanelPromptFactInput {
  readonly panelId: string
  readonly shotNumber: number
  readonly renderFacts: unknown
}

export interface SegmentPromptFactInput {
  readonly sourceGenerationSegmentId: string
  readonly shotNumbers: readonly number[]
  readonly facts: unknown
}

export interface ImagePromptComposerPanelOutput {
  readonly shotNumber: number
  readonly imagePrompt: string
}

export interface VideoPromptComposerShotOutput {
  readonly shotNumber: number
  readonly videoPrompt: string
}

export interface VideoPromptComposerSegmentOutput {
  readonly sourceGenerationSegmentId: string
  readonly shotNumbers: readonly number[]
  readonly prompt: string
}

export const imagePromptComposerOutputSchema = z.object({
  panels: z.array(z.object({
    shotNumber: z.number().int().positive(),
    imagePrompt: z.string().trim().min(1),
  }).strict()).min(1),
}).strict()

export const videoPromptComposerOutputSchema = z.object({
  shotPrompts: z.array(z.object({
    shotNumber: z.number().int().positive(),
    videoPrompt: z.string().trim().min(1),
  }).strict()).min(1),
  generationSegments: z.array(z.object({
    sourceGenerationSegmentId: z.string().trim().min(1),
    shotNumbers: z.array(z.number().int().positive()).min(2).max(9),
    prompt: z.string().trim().min(1),
  }).strict()),
}).strict()

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readCharacterFacts(renderFacts: unknown): ReadonlyArray<{
  readonly name: string
  readonly visibility: string
}> {
  const root = readRecord(renderFacts)
  const graph = root?.CHARACTER_GRAPH
  if (!Array.isArray(graph)) return []
  return graph.flatMap((item) => {
    const record = readRecord(item)
    const name = readString(record?.name)
    const visibility = readString(record?.visibility)
    return name && visibility ? [{ name, visibility }] : []
  })
}

function assertNoDuplicateNumbers(numbers: readonly number[], code: string) {
  const seen = new Set<number>()
  const duplicates: number[] = []
  for (const number of numbers) {
    if (seen.has(number)) duplicates.push(number)
    seen.add(number)
  }
  if (duplicates.length > 0) {
    throw new Error(`${code}:${duplicates.join(',')}`)
  }
}

function assertExactNumberSet(input: {
  readonly expected: readonly number[]
  readonly actual: readonly number[]
  readonly code: string
}) {
  assertNoDuplicateNumbers(input.expected, `${input.code}_EXPECTED_DUPLICATE`)
  assertNoDuplicateNumbers(input.actual, `${input.code}_ACTUAL_DUPLICATE`)
  const expected = new Set(input.expected)
  const actual = new Set(input.actual)
  const missing = [...expected].filter((number) => !actual.has(number))
  const extra = [...actual].filter((number) => !expected.has(number))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${input.code}:missing=${missing.join(',')}:extra=${extra.join(',')}`)
  }
}

function assertSameShotNumbers(input: {
  readonly expected: readonly number[]
  readonly actual: readonly number[]
  readonly code: string
}) {
  if (
    input.expected.length !== input.actual.length ||
    input.expected.some((shotNumber, index) => shotNumber !== input.actual[index])
  ) {
    throw new Error(`${input.code}:expected=${input.expected.join(',')}:actual=${input.actual.join(',')}`)
  }
}

function assertPromptKeepsPresentCharacters(input: {
  readonly prompt: string
  readonly renderFacts: unknown
  readonly code: string
}) {
  const missing = readCharacterFacts(input.renderFacts)
    .filter((character) => character.visibility !== 'offscreen')
    .filter((character) => !input.prompt.includes(character.name))
    .map((character) => character.name)
  if (missing.length > 0) {
    throw new Error(`${input.code}:${missing.join(',')}`)
  }
}

export function validateImagePromptComposerOutput(input: {
  readonly panels: readonly PanelPromptFactInput[]
  readonly output: readonly ImagePromptComposerPanelOutput[]
}): ReadonlyMap<number, string> {
  assertExactNumberSet({
    expected: input.panels.map((panel) => panel.shotNumber),
    actual: input.output.map((panel) => panel.shotNumber),
    code: 'IMAGE_PROMPT_COMPOSER_SHOT_COVERAGE_INVALID',
  })
  const factsByShot = new Map(input.panels.map((panel) => [panel.shotNumber, panel.renderFacts]))
  const promptByShot = new Map<number, string>()
  for (const panel of input.output) {
    const prompt = panel.imagePrompt.trim()
    if (!prompt) throw new Error(`IMAGE_PROMPT_COMPOSER_PROMPT_EMPTY:${panel.shotNumber}`)
    const facts = factsByShot.get(panel.shotNumber)
    assertPromptKeepsPresentCharacters({
      prompt,
      renderFacts: facts,
      code: `IMAGE_PROMPT_COMPOSER_CHARACTER_MISSING:${panel.shotNumber}`,
    })
    promptByShot.set(panel.shotNumber, prompt)
  }
  return promptByShot
}

export function validateVideoPromptComposerOutput(input: {
  readonly panels: readonly PanelPromptFactInput[]
  readonly segments: readonly SegmentPromptFactInput[]
  readonly shotOutputs: readonly VideoPromptComposerShotOutput[]
  readonly segmentOutputs: readonly VideoPromptComposerSegmentOutput[]
}): {
  readonly shotPrompts: ReadonlyMap<number, string>
  readonly segmentPrompts: ReadonlyMap<string, string>
} {
  assertExactNumberSet({
    expected: input.panels.map((panel) => panel.shotNumber),
    actual: input.shotOutputs.map((panel) => panel.shotNumber),
    code: 'VIDEO_PROMPT_COMPOSER_SHOT_COVERAGE_INVALID',
  })
  const expectedSegmentIds = input.segments.map((segment) => segment.sourceGenerationSegmentId)
  const actualSegmentIds = input.segmentOutputs.map((segment) => segment.sourceGenerationSegmentId)
  const duplicateIds = actualSegmentIds.filter((id, index) => actualSegmentIds.indexOf(id) !== index)
  if (duplicateIds.length > 0) {
    throw new Error(`VIDEO_PROMPT_COMPOSER_SEGMENT_DUPLICATE:${duplicateIds.join(',')}`)
  }
  const missingSegmentIds = expectedSegmentIds.filter((id) => !actualSegmentIds.includes(id))
  const extraSegmentIds = actualSegmentIds.filter((id) => !expectedSegmentIds.includes(id))
  if (missingSegmentIds.length > 0 || extraSegmentIds.length > 0) {
    throw new Error(`VIDEO_PROMPT_COMPOSER_SEGMENT_COVERAGE_INVALID:missing=${missingSegmentIds.join(',')}:extra=${extraSegmentIds.join(',')}`)
  }

  const factsByShot = new Map(input.panels.map((panel) => [panel.shotNumber, panel.renderFacts]))
  const shotPrompts = new Map<number, string>()
  for (const output of input.shotOutputs) {
    const prompt = output.videoPrompt.trim()
    if (!prompt) throw new Error(`VIDEO_PROMPT_COMPOSER_SHOT_PROMPT_EMPTY:${output.shotNumber}`)
    assertPromptKeepsPresentCharacters({
      prompt,
      renderFacts: factsByShot.get(output.shotNumber),
      code: `VIDEO_PROMPT_COMPOSER_SHOT_CHARACTER_MISSING:${output.shotNumber}`,
    })
    shotPrompts.set(output.shotNumber, prompt)
  }

  const segmentById = new Map(input.segments.map((segment) => [segment.sourceGenerationSegmentId, segment]))
  const segmentPrompts = new Map<string, string>()
  for (const output of input.segmentOutputs) {
    const prompt = output.prompt.trim()
    if (!prompt) throw new Error(`VIDEO_PROMPT_COMPOSER_SEGMENT_PROMPT_EMPTY:${output.sourceGenerationSegmentId}`)
    const segment = segmentById.get(output.sourceGenerationSegmentId)
    if (!segment) throw new Error(`VIDEO_PROMPT_COMPOSER_SEGMENT_UNKNOWN:${output.sourceGenerationSegmentId}`)
    assertSameShotNumbers({
      expected: segment.shotNumbers,
      actual: output.shotNumbers,
      code: `VIDEO_PROMPT_COMPOSER_SEGMENT_SHOTS_INVALID:${output.sourceGenerationSegmentId}`,
    })
    for (const shotNumber of segment.shotNumbers) {
      assertPromptKeepsPresentCharacters({
        prompt,
        renderFacts: factsByShot.get(shotNumber),
        code: `VIDEO_PROMPT_COMPOSER_SEGMENT_CHARACTER_MISSING:${output.sourceGenerationSegmentId}:${shotNumber}`,
      })
    }
    segmentPrompts.set(output.sourceGenerationSegmentId, prompt)
  }

  return { shotPrompts, segmentPrompts }
}
