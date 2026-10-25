import { z } from 'zod'
import { VOICE_CHARACTER_REFERENCE_ROLE, VOICE_DESIGN_LANGUAGE_OPTIONS } from '@/lib/voice/voice-design-contract'

export type VoiceDesignLanguage = (typeof VOICE_DESIGN_LANGUAGE_OPTIONS)[number]

export const selectCharacterVoiceInputSchema = z.object({
  characterResourceId: z.string().trim().min(1).max(32),
  voiceResourceId: z.string().trim().min(1).max(32),
  voiceContentVersion: z.number().int().positive(),
  expectedSelectionRevision: z.number().int().nonnegative(),
}).strict()

export type SelectCharacterVoiceInput = z.infer<typeof selectCharacterVoiceInputSchema>

export const selectCharacterVoiceOutputSchema = z.object({
  success: z.literal(true),
  characterResourceId: z.string().min(1),
  voiceResourceId: z.string().min(1),
  voiceContentVersion: z.number().int().positive(),
  selectionRevision: z.number().int().positive(),
}).strict()

export interface WorkspaceResourceVoiceSelectAction {
  readonly execution: 'direct'
  readonly operationId: 'select_character_voice'
  readonly input: SelectCharacterVoiceInput
}

export interface WorkspaceResourceVoiceCandidateAction {
  readonly execution: 'planned'
  readonly operationId: 'create_audio'
  readonly input: {
    readonly request: {
      readonly kind: 'new'
      readonly items: readonly [{
        readonly itemId: string
        readonly name: string
        readonly folderPath: string | null
        readonly count: 1
        readonly mediaType: 'audio'
        readonly audioKind: 'voice'
        readonly schemaId: 'project.voice_reference'
        readonly prompt: string
        readonly previewText: string
        readonly language: VoiceDesignLanguage
        readonly references: readonly [{
          readonly resourceId: string
          readonly contentVersion: number
          readonly role: typeof VOICE_CHARACTER_REFERENCE_ROLE
          readonly channel: 'context'
        }]
      }]
    }
  }
}

export interface WorkspaceResourceVoiceDesignView {
  readonly description: string | null
  readonly previewText: string | null
  readonly language: VoiceDesignLanguage | null
  readonly character: {
    readonly resourceId: string
    readonly contentVersion: number
    readonly name: string
    readonly available: boolean
  } | null
  readonly isSelected: boolean
  readonly selectUnavailableReason: 'character_unavailable' | 'audio_unavailable' | 'video_unsupported' | 'duration_unsupported' | null
  readonly candidateAction: WorkspaceResourceVoiceCandidateAction | null
  readonly selectAction: WorkspaceResourceVoiceSelectAction | null
}

export interface WorkspaceResourceSelectedVoiceView {
  readonly resourceId: string
  readonly contentVersion: number
  readonly name: string
  readonly url: string | null
  readonly durationMs: number | null
  readonly description: string | null
  readonly previewText: string | null
  readonly language: VoiceDesignLanguage | null
  readonly available: boolean
}

export interface WorkspaceResourceCharacterVoiceSelectionView {
  readonly revision: number
  readonly selectedVoice: WorkspaceResourceSelectedVoiceView | null
}

export function readVoiceDesignFields(input: {
  readonly prompt: string | null
  readonly generationOptions: unknown
}): Pick<WorkspaceResourceVoiceDesignView, 'description' | 'previewText' | 'language'> {
  const options = input.generationOptions !== null
    && typeof input.generationOptions === 'object'
    && !Array.isArray(input.generationOptions)
    ? input.generationOptions as Record<string, unknown>
    : null
  const language = options?.language
  return {
    description: input.prompt,
    previewText: typeof options?.previewText === 'string' ? options.previewText : null,
    language: VOICE_DESIGN_LANGUAGE_OPTIONS.find((option) => option === language) ?? null,
  }
}
