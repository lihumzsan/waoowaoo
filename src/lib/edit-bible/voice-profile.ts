import { z } from 'zod'

const dynamicDeliveryStatePattern = /语速|音量|句尾|低声|喊叫|哭腔|情绪|停顿|急促|大声|小声|压低|\b(?:pace|speed|volume|emotion|whisper|shout|crying|delivery)\b/i

export const editBibleCharacterVoiceProfileSchema = z.string()
  .trim()
  .min(1)
  .max(48)
  .refine((value) => !dynamicDeliveryStatePattern.test(value), {
    message: 'voiceProfile must describe intrinsic timbre only, not delivery state',
  })

export type EditBibleCharacterVoiceProfile = z.infer<typeof editBibleCharacterVoiceProfileSchema>
