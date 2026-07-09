export type DefaultModelEmptyStateType =
  | 'llm'
  | 'image'
  | 'video'
  | 'music'
  | 'soundEffect'

type Translator = (key: string) => string

const EMPTY_STATE_TRANSLATION_KEYS: Record<
  DefaultModelEmptyStateType,
  { description: string }
> = {
  llm: {
    description: 'defaultModelEmptyState.llmDescription',
  },
  image: {
    description: 'defaultModelEmptyState.imageDescription',
  },
  video: {
    description: 'defaultModelEmptyState.videoDescription',
  },
  music: {
    description: 'defaultModelEmptyState.musicDescription',
  },
  soundEffect: {
    description: 'defaultModelEmptyState.soundEffectDescription',
  },
}

export function getDefaultModelEmptyStateText(
  modelType: DefaultModelEmptyStateType,
  t: Translator,
): { title: string; description: string } {
  const keys = EMPTY_STATE_TRANSLATION_KEYS[modelType]
  return {
    title: t('defaultModelEmptyState.genericTitle'),
    description: t(keys.description),
  }
}
