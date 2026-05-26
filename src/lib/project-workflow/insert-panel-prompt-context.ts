import {
  formatLocationAvailableSlotsText,
  parseLocationAvailableSlots,
} from '@/lib/location-available-slots'
import {
  formatLocationSpatialProfileForPrompt,
  parseLocationSpatialProfile,
} from '@/lib/location-spatial-profile/types'

type PromptLocationImage = {
  isSelected?: boolean
  description?: string | null
  availableSlots?: string | null
  spatialProfileJson?: unknown
}

type PromptLocationAsset = {
  name: string
  images?: PromptLocationImage[]
}

type Locale = 'zh' | 'en'

export function buildInsertPanelLocationsDescription(
  locations: PromptLocationAsset[],
  relatedLocations: string[],
  locale: Locale = 'zh',
): string {
  const filteredLocations = locations.filter(
    (location) => relatedLocations.length === 0 || relatedLocations.includes(location.name),
  )

  if (filteredLocations.length === 0) {
    return '无'
  }

  return filteredLocations
    .map((location) => {
      const selectedImage = location.images?.find((image) => image.isSelected) ?? location.images?.[0]
      const description = selectedImage?.description || '无描述'
      const slotsText = formatLocationAvailableSlotsText(
        parseLocationAvailableSlots(selectedImage?.availableSlots),
        locale,
      )
      const spatialProfileText = selectedImage?.spatialProfileJson
        ? formatLocationSpatialProfileForPrompt(parseLocationSpatialProfile(selectedImage.spatialProfileJson))
        : ''

      return [ `${location.name}: ${description}`, spatialProfileText, slotsText ].filter(Boolean).join('\n')
    })
    .join('\n')
}
