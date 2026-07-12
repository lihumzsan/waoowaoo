import type { SoundscapePlanSource, SoundscapeRawPlanSection } from '@/lib/soundscape/types'
import type { WorkspaceCanvasSoundscapeDetails } from '../node-canvas-types'

export function buildSoundscapeStreamView(
  sources: readonly SoundscapePlanSource[],
  sections: readonly SoundscapeRawPlanSection[],
): Pick<WorkspaceCanvasSoundscapeDetails, 'sources' | 'sections'> {
  const sourceIndexById = new Map(sources.map((source, index) => [source.sourceId, index + 1]))
  return {
    sources: sources.map((source, index) => ({
      key: source.sourceId,
      sourceIndex: index + 1,
      prompt: source.prompt,
      loopDurationSeconds: source.loopDurationSeconds,
      promptInfluence: source.promptInfluence,
    })),
    sections: sections.map((section, index) => {
      const sourceIndex = sourceIndexById.get(section.sourceId)
      if (!sourceIndex) throw new Error(`SOUNDSCAPE_SECTION_SOURCE_UNKNOWN:${section.sourceId}`)
      return {
        key: `${section.sourceId}:${section.fromClipOrder}:${section.toClipOrder}:${index}`,
        sourceIndex,
        rangeKind: 'clip',
        rangeStart: section.fromClipOrder,
        rangeEnd: section.toClipOrder,
        perspective: section.perspective,
        intensity: section.intensity,
        transitionIn: section.transitionIn,
        transitionOut: section.transitionOut,
      }
    }),
  }
}
