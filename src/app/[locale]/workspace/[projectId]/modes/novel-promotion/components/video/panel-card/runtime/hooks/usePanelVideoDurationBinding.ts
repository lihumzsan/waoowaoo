import { useEffect, useMemo, useState } from 'react'
import type { MatchedVoiceLine, VideoDurationBinding } from '../../../types'
import {
  normalizeVideoDurationBinding,
  resolveAudioDrivenVideoTiming,
} from '@/lib/video-duration/audio-binding'

interface UsePanelVideoDurationBindingParams {
  binding?: VideoDurationBinding | null
  matchedVoiceLines: MatchedVoiceLine[]
  selectedModel?: string
}

export function usePanelVideoDurationBinding({
  binding,
  matchedVoiceLines,
  selectedModel,
}: UsePanelVideoDurationBindingParams) {
  const normalizedBinding = useMemo(
    () => normalizeVideoDurationBinding(binding),
    [binding],
  )
  const [localBinding, setLocalBinding] = useState<VideoDurationBinding>(normalizedBinding)

  useEffect(() => {
    setLocalBinding(normalizedBinding)
  }, [normalizedBinding])

  const availableVoiceLines = useMemo(
    () => matchedVoiceLines.filter((voiceLine) => voiceLine.audioUrl),
    [matchedVoiceLines],
  )

  const selectedVoiceLineIds = useMemo(
    () => normalizeVideoDurationBinding(localBinding).voiceLineIds ?? [],
    [localBinding],
  )

  const timing = useMemo(
    () => resolveAudioDrivenVideoTiming({
      binding: localBinding,
      candidates: availableVoiceLines.map((voiceLine) => ({
        id: voiceLine.id,
        audioDuration: voiceLine.audioDuration,
      })),
      modelKey: selectedModel,
    }),
    [availableVoiceLines, localBinding, selectedModel],
  )

  const selectedCount = useMemo(() => {
    const selected = new Set(selectedVoiceLineIds)
    return availableVoiceLines.filter((voiceLine) => selected.has(voiceLine.id)).length
  }, [availableVoiceLines, selectedVoiceLineIds])

  const setMode = (mode: 'manual' | 'match_audio') => {
    setLocalBinding((previous) => {
      const next = normalizeVideoDurationBinding(previous)
      next.mode = mode
      if (mode === 'manual') {
        next.voiceLineIds = []
      } else if ((next.voiceLineIds?.length ?? 0) === 0) {
        next.voiceLineIds = availableVoiceLines[0]?.id ? [availableVoiceLines[0].id] : []
      }
      return next
    })
  }

  const toggleVoiceLine = (voiceLineId: string) => {
    setLocalBinding((previous) => {
      const next = normalizeVideoDurationBinding(previous)
      next.mode = 'match_audio'
      const current = new Set(next.voiceLineIds ?? [])
      if (current.has(voiceLineId)) current.delete(voiceLineId)
      else current.add(voiceLineId)
      next.voiceLineIds = Array.from(current)
      return next
    })
  }

  return {
    localBinding,
    setLocalBinding,
    setMode,
    toggleVoiceLine,
    availableVoiceLines,
    selectedVoiceLineIds,
    selectedCount,
    timing,
    hasAvailableVoiceLines: availableVoiceLines.length > 0,
    isAudioDriven: normalizeVideoDurationBinding(localBinding).mode === 'match_audio',
    hasValidAudioSelection: !!timing,
  }
}
