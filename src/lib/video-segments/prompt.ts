import type { EditGenerationSegment, EditGenerationSegmentExecution, EditScriptShot } from '@/lib/edit-script/types'
import type { EditScriptDialogueVoiceContext } from '@/lib/edit-script/voice-profiles'
import type { VideoSegmentReferenceImage } from './types'

function line(label: string, value: string): string {
  const normalized = value.trim()
  return normalized ? `${label}: ${normalized}` : `${label}: none`
}

export function buildVideoSegmentPrompt(input: {
  readonly visualStyle: string
  readonly segment: EditGenerationSegment
  readonly execution: EditGenerationSegmentExecution
  readonly shots: readonly EditScriptShot[]
  readonly references: readonly VideoSegmentReferenceImage[]
  readonly voiceContext: EditScriptDialogueVoiceContext
}): string {
  const executionByShotId = new Map(input.execution.shots.map((shot) => [shot.shotId, shot]))
  const voiceShotById = new Map(input.voiceContext.shots.map((shot) => [shot.shotId, shot]))
  const referenceLines = input.references.map((reference) =>
    `[${String(reference.order)}] ${reference.kind} "${reference.name}"; preserve this approved identity and design exactly.`,
  )
  let elapsedSec = 0
  const shotBlocks = input.shots.map((shot) => {
    const execution = executionByShotId.get(shot.shotId)
    if (!execution) throw new Error(`VIDEO_SEGMENT_EXECUTION_SHOT_MISSING:${shot.shotId}`)
    const startSec = elapsedSec
    elapsedSec += shot.durationSec
    const characterLines = shot.characters.map((character) =>
      `${character.name}: ${character.performance || 'natural performance driven by the action'}`,
    )
    const voiceLines = voiceShotById.get(shot.shotId)?.dialogue.map((dialogue) =>
      `${dialogue.name} [voice: ${dialogue.voiceProfile}]: ${dialogue.line}`,
    ) ?? []
    return [
      `SHOT ${String(shot.shotNumber)} | ${String(startSec)}s-${String(elapsedSec)}s`,
      line('Shot scale', execution.shotScale),
      line('Camera movement', execution.cameraMovement.movement),
      `Camera stability: ${execution.cameraMovement.stability}`,
      line('Location', [shot.scene.name, shot.scene.subScene].filter(Boolean).join(' — ')),
      line('Action', shot.action),
      `Performance:\n${characterLines.length > 0 ? characterLines.join('\n') : 'No character performance.'}`,
      `Dialogue and intrinsic voices:\n${voiceLines.length > 0 ? voiceLines.join('\n') : 'No dialogue.'}`,
      line('Synchronized sound', shot.synchronousSound),
    ].join('\n')
  })

  return [
    'Generate one continuous, full-frame video segment. Do not create a collage, grid, split screen, contact sheet, captions, or text overlays.',
    line('Visual style', input.visualStyle),
    'Use every supplied image only as an approved character or location reference. Preserve identity, wardrobe, and environment design while following the timeline below.',
    `REFERENCE MANIFEST\n${referenceLines.join('\n')}`,
    `CONTINUITY ACROSS THIS SEGMENT\n${input.segment.continuity}`,
    shotBlocks.join('\n\n'),
    'AUDIO CONTRACT\nGenerate native synchronized audio. Include the written dialogue with the specified intrinsic voices and the listed short synchronized sounds. Do not replace dialogue with narration. Do not invent a long continuous ambience bed; episode-wide ambience is mixed separately.',
  ].join('\n\n')
}
