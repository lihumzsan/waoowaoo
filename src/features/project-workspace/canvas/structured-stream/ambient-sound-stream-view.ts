import type { AmbientSoundPlanSource, AmbientSoundRawPlanSection } from '@/lib/ambient-sound/types'
import type { WorkspaceCanvasAmbientSoundDetails } from '../node-canvas-types'

export function buildAmbientSoundStreamView(
  sources: readonly AmbientSoundPlanSource[],
  sections: readonly AmbientSoundRawPlanSection[],
): Pick<WorkspaceCanvasAmbientSoundDetails, 'sources' | 'sections'> {
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
      if (!sourceIndex) throw new Error(`AMBIENT_SOUND_SECTION_SOURCE_UNKNOWN:${section.sourceId}`)
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
