'use client'

import VoiceDesignDialogBase, {
  type VoiceDesignMutationPayload,
  type VoiceDesignMutationResult,
} from '@/components/voice/VoiceDesignDialogBase'
import { useDesignProjectVoice } from '@/lib/query/hooks'

interface VoiceDesignDialogProps {
  isOpen: boolean
  characterId?: string
  speaker: string
  hasExistingVoice?: boolean
  onClose: () => void
  onSave: (voiceId: string, audioBase64: string) => void
  projectId: string
}

export default function VoiceDesignDialog({
  isOpen,
  characterId,
  speaker,
  hasExistingVoice = false,
  onClose,
  onSave,
  projectId,
}: VoiceDesignDialogProps) {
  const designVoiceMutation = useDesignProjectVoice(projectId)

  const handleDesignVoice = async (
    payload: VoiceDesignMutationPayload,
  ): Promise<VoiceDesignMutationResult> => {
    return await designVoiceMutation.mutateAsync({
      ...payload,
      ...(characterId ? { characterId } : {}),
    })
  }

  return (
    <VoiceDesignDialogBase
      isOpen={isOpen}
      speaker={speaker}
      hasExistingVoice={hasExistingVoice}
      onClose={onClose}
      onSave={onSave}
      onDesignVoice={handleDesignVoice}
    />
  )
}
