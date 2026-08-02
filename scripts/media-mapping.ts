export type MediaFieldMapping = {
  legacyField: string
  mediaIdField: string
}

export type MediaModelMapping = {
  model: string
  tableName: string
  fields: MediaFieldMapping[]
}

export const MEDIA_MODEL_MAPPINGS: MediaModelMapping[] = [
  {
    model: 'globalCharacterAppearance',
    tableName: 'global_character_appearances',
    fields: [
      { legacyField: 'imageUrl', mediaIdField: 'imageMediaId' },
      { legacyField: 'previousImageUrl', mediaIdField: 'previousImageMediaId' },
    ],
  },
  {
    model: 'globalLocationImage',
    tableName: 'global_location_images',
    fields: [
      { legacyField: 'imageUrl', mediaIdField: 'imageMediaId' },
      { legacyField: 'previousImageUrl', mediaIdField: 'previousImageMediaId' },
    ],
  },
]
