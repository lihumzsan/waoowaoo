import type { WorkspaceResourceInputRef } from '@/lib/workspace-resource/contracts'

export function videoCompositionFixture(
  references: readonly WorkspaceResourceInputRef[],
) {
  return {
    name: 'Durability output',
    locale: 'en' as const,
    outputTarget: 'mp4' as const,
    jianyingProfile: null,
    format: {
      width: 480,
      height: 480,
      aspectRatio: '1:1',
      resolution: '480p',
      frameRate: '24/1',
    },
    composition: {
      schemaVersion: 1 as const,
      clips: references
        .filter((ref) => ref.role === 'source_video')
        .map((ref) => ({
          clipId: `clip-${String(ref.position)}`,
          source: {
            resourceId: ref.resourceId,
            contentVersion: ref.contentVersion,
          },
          sourceStartMs: 0,
          durationMs: 1000,
        })),
      textLayers: [],
      audio: { mode: 'preserve' as const, musicCues: [], soundCues: [] },
      contextReferences: [],
    },
    sourceFacts: references
      .filter((ref) => ref.role === 'source_video')
      .map((ref) => ({
        position: ref.position,
        durationMs: 1000,
        width: 16,
        height: 16,
        frameRate: '24/1',
      })),
  }
}
