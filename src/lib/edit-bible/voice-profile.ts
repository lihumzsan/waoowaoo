import { z } from 'zod'

const voiceProfileIntrinsicTextSchema = z.string().trim().min(1)

export const editBibleCharacterVoiceProfileSchema = z.object({
  ageImpression: voiceProfileIntrinsicTextSchema,
  pitchRange: voiceProfileIntrinsicTextSchema,
  timbre: voiceProfileIntrinsicTextSchema,
  resonance: voiceProfileIntrinsicTextSchema,
  vocalWeight: voiceProfileIntrinsicTextSchema,
  texture: voiceProfileIntrinsicTextSchema,
}).strict()

export type EditBibleCharacterVoiceProfile = z.infer<typeof editBibleCharacterVoiceProfileSchema>

export function formatEditBibleCharacterVoiceProfile(profile: EditBibleCharacterVoiceProfile): string {
  return [
    `ageImpression=${profile.ageImpression}`,
    `pitchRange=${profile.pitchRange}`,
    `timbre=${profile.timbre}`,
    `resonance=${profile.resonance}`,
    `vocalWeight=${profile.vocalWeight}`,
    `texture=${profile.texture}`,
  ].join('; ')
}
