import {
  formatLocationAvailableSlotsText,
  parseLocationAvailableSlots,
} from '@/lib/location-available-slots'

type Locale = 'zh' | 'en'

export function buildLocationImagePromptCore(params: {
  description: string
  availableSlotsRaw?: string | null
  locale: Locale
}): string {
  const promptBody = params.description.trim()
  const slotText = formatLocationAvailableSlotsText(
    parseLocationAvailableSlots(params.availableSlotsRaw),
    params.locale,
  )

  const spatialConstraints = params.locale === 'en'
    ? 'Use a wide, complete environment composition that clearly shows the main structure, foreground/midground/background, and visible spatial boundaries. Every anchor object or anchor area implied by the available slots must be clearly visible in the frame, and each slot must still have enough open space around it for a character to be placed there later. Do not generate a generic partial background, cropped anchor, or ambiguous layout that makes the slot positions unusable.'
    : '必须使用宽广完整的场景全景构图，清楚展示主要结构、前景/中景/背景和空间边界。可站位置中提到的关键锚物或区域必须在画面中清晰可见，且每个位置附近都要保留足够的空白区域，方便后续角色落位。禁止生成局部裁切、锚点缺失、空间关系模糊的泛化背景。'

  if (!slotText) {
    return `${promptBody}\n\n${spatialConstraints}`.trim()
  }

  const slotHeader = params.locale === 'en'
    ? 'This scene must clearly support the following fixed character positions:'
    : '该场景必须清楚支持以下固定人物位置：'

  return `${promptBody}\n\n${slotHeader}\n${slotText}\n\n${spatialConstraints}`.trim()
}
