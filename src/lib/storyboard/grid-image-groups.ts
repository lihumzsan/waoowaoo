const GRID_CELL_COUNT = 4

export type StoryboardPanelImageGenerationMode = 'single' | 'grid'

export type StoryboardGridGroupingPanel = {
  readonly id: string
  readonly storyboardId: string
  readonly panelIndex: number
  readonly sourceGenerationSegmentId: string | null
}

export type StoryboardPanelImageSubmissionGroup =
  | {
    readonly kind: 'single'
    readonly panels: readonly [StoryboardGridGroupingPanel]
  }
  | {
    readonly kind: 'grid2x2'
    readonly sourceGenerationSegmentId: string
    readonly panels: readonly StoryboardGridGroupingPanel[]
  }

export function normalizeStoryboardPanelImageGenerationMode(value: unknown): StoryboardPanelImageGenerationMode {
  return value === 'single' ? 'single' : 'grid'
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function pushChunkedGridGroups(
  output: StoryboardPanelImageSubmissionGroup[],
  sourceGenerationSegmentId: string,
  panels: readonly StoryboardGridGroupingPanel[],
) {
  for (let index = 0; index < panels.length; index += GRID_CELL_COUNT) {
    const chunk = panels.slice(index, index + GRID_CELL_COUNT)
    if (chunk.length === 1) {
      output.push({ kind: 'single', panels: [chunk[0]] })
      continue
    }
    output.push({
      kind: 'grid2x2',
      sourceGenerationSegmentId,
      panels: chunk,
    })
  }
}

export function planStoryboardPanelImageSubmissionGroups(
  panels: readonly StoryboardGridGroupingPanel[],
  generationMode: StoryboardPanelImageGenerationMode = 'grid',
): StoryboardPanelImageSubmissionGroup[] {
  const sortedPanels = [...panels].sort((left, right) => {
    if (left.storyboardId !== right.storyboardId) return left.storyboardId.localeCompare(right.storyboardId)
    return left.panelIndex - right.panelIndex
  })
  if (generationMode === 'single') {
    return sortedPanels.map((panel) => ({ kind: 'single', panels: [panel] }))
  }
  const groupedPanels = new Map<string, {
    readonly sourceGenerationSegmentId: string
    readonly panels: StoryboardGridGroupingPanel[]
  }>()
  const output: StoryboardPanelImageSubmissionGroup[] = []

  for (const panel of sortedPanels) {
    const sourceGenerationSegmentId = normalizeString(panel.sourceGenerationSegmentId)
    if (!sourceGenerationSegmentId) {
      output.push({ kind: 'single', panels: [panel] })
      continue
    }
    const key = `${panel.storyboardId}:${sourceGenerationSegmentId}`
    const existing = groupedPanels.get(key)
    if (existing) {
      existing.panels.push(panel)
      continue
    }
    groupedPanels.set(key, {
      sourceGenerationSegmentId,
      panels: [panel],
    })
  }

  for (const group of groupedPanels.values()) {
    pushChunkedGridGroups(output, group.sourceGenerationSegmentId, group.panels)
  }

  return output.sort((left, right) => left.panels[0].panelIndex - right.panels[0].panelIndex)
}
