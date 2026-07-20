import type { EditGenerationSegment, EditGenerationSegmentExecution, EditScriptShot } from '@/lib/edit-script/types'
import type { EditScriptDialogueVoiceContext } from '@/lib/edit-script/voice-profiles'
import type { VideoSegmentReferenceImage } from './types'

function line(label: string, value: string): string {
  const normalized = value.trim()
  return normalized ? `${label}: ${normalized}` : `${label}: none`
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function buildSoundCueTimeline(input: {
  readonly segment: EditGenerationSegment
  readonly shots: readonly EditScriptShot[]
  readonly voiceContext: EditScriptDialogueVoiceContext
}): string {
  if (input.segment.soundCues.length === 0) return 'AUDIO TIMELINE\nNo optional cross-shot sound cues.'

  const shotById = new Map(input.shots.map((shot) => [shot.shotId, shot]))
  const shotStartById = new Map<string, number>()
  let cursorSec = 0
  input.shots.forEach((shot) => {
    shotStartById.set(shot.shotId, cursorSec)
    cursorSec += shot.durationSec
  })
  const voiceShotById = new Map(input.voiceContext.shots.map((shot) => [shot.shotId, shot]))

  const lines = input.segment.soundCues.map((cue) => {
    const sourceShot = cue.sourceShotId ? shotById.get(cue.sourceShotId) : undefined
    if (cue.sourceShotId && !sourceShot) {
      throw new Error(`VIDEO_SEGMENT_SOUND_CUE_SOURCE_SHOT_MISSING:${cue.sourceShotId}`)
    }
    const sourceStartSec = cue.sourceShotId ? shotStartById.get(cue.sourceShotId) : undefined
    const sourceEndSec = sourceStartSec === undefined || sourceShot === undefined
      ? undefined
      : sourceStartSec + sourceShot.durationSec
    const sourceShotNumber = sourceShot?.shotNumber ?? 'unknown'
    const relation = sourceStartSec === undefined || sourceEndSec === undefined
      ? 'no single visual source; keep it native to the segment'
      : cue.startSec < sourceStartSec && cue.endSec > sourceEndSec
        ? `leads before Shot ${String(sourceShotNumber)} and carries beyond it`
        : cue.startSec < sourceStartSec
          ? `leads before the visual source of Shot ${String(sourceShotNumber)} is revealed`
          : cue.endSec > sourceEndSec
            ? `continues after the visual source of Shot ${String(sourceShotNumber)}`
            : `plays within Shot ${String(sourceShotNumber)}`
    if (cue.kind === 'dialogue') {
      const voiceLines = cue.sourceShotId ? voiceShotById.get(cue.sourceShotId)?.dialogue ?? [] : []
      if (voiceLines.length === 0) {
        throw new Error(`VIDEO_SEGMENT_SOUND_CUE_DIALOGUE_MISSING:${cue.sourceShotId ?? 'missing'}`)
      }
      return `${formatSeconds(cue.startSec)}s-${formatSeconds(cue.endSec)}s | dialogue cue | ${relation}; use the exact dialogue and intrinsic voice listed in Shot ${String(sourceShotNumber)}; ${cue.description}`
    }
    return `${formatSeconds(cue.startSec)}s-${formatSeconds(cue.endSec)}s | ${cue.kind} | ${relation}; ${cue.description}`
  })
  return `AUDIO TIMELINE\n${lines.join('\n')}`
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
    buildSoundCueTimeline({ segment: input.segment, shots: input.shots, voiceContext: input.voiceContext }),
    shotBlocks.join('\n\n'),
    'AUDIO CONTRACT\nGenerate native audio for this one continuous video segment. Include shot-local synchronized sounds and use the optional audio timeline when present; a cue may begin before its visual source is revealed or continue across a shot boundary. Include written dialogue with the specified intrinsic voices, do not replace dialogue with narration, do not duplicate one sound event in multiple fields, and do not generate BGM or a separate audio track.',
  ].join('\n\n')
}
