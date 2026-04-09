'use client'

import VoiceDesignDialogBase, {
  type VoiceDesignMutationPayload,
  type VoiceDesignMutationResult,
} from '@/components/voice/VoiceDesignDialogBase'
import { useDesignAssetHubVoice } from '@/lib/query/hooks'

interface VoiceDesignDialogProps {
  isOpen: boolean
  characterId?: string
  speaker: string
  hasExistingVoice?: boolean
  onClose: () => void
  onSave: (voiceId: string, audioBase64: string) => void
}

export default function VoiceDesignDialog({
  isOpen,
  characterId,
  speaker,
  hasExistingVoice = false,
  onClose,
  onSave,
}: VoiceDesignDialogProps) {
  const designVoiceMutation = useDesignAssetHubVoice()

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
