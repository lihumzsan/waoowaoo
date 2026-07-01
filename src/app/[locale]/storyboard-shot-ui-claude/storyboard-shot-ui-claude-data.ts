import type {
  LayoutCopy,
  LayoutId,
  ShotTone,
  StoryboardShot,
  StoryboardShotUiClaudeCopy,
  Translate,
} from './storyboard-shot-ui-claude-types'

const layoutIds: readonly [LayoutId, LayoutId, LayoutId, LayoutId, LayoutId] = [
  'vertical',
  'landscape',
  'poster',
  'editorial',
  'datasheet',
]

const shotTones: readonly ShotTone[] = ['violet', 'teal', 'amber', 'crimson']

function layout(t: Translate, index: number): LayoutCopy {
  const id = layoutIds[index]
  return {
    id,
    title: t(`layouts.${id}.title`),
    description: t(`layouts.${id}.description`),
  }
}

function splitList(value: string): readonly string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function shot(t: Translate, index: number): StoryboardShot {
  const key = `shots.${index}`
  return {
    id: `shot-${index + 1}`,
    number: t(`${key}.number`),
    status: t(`${key}.status`),
    scene: t(`${key}.scene`),
    shotType: t(`${key}.shotType`),
    characters: splitList(t(`${key}.characters`)),
    props: splitList(t(`${key}.props`)),
    cost: t(`${key}.cost`),
    prompt: t(`${key}.prompt`),
    tone: shotTones[index % shotTones.length],
  }
}

export function buildStoryboardShotUiClaudeCopy(t: Translate): StoryboardShotUiClaudeCopy {
  return {
    page: {
      title: t('page.title'),
      subtitle: t('page.subtitle'),
    },
    card: {
      eyebrow: t('card.eyebrow'),
      sceneLabel: t('card.sceneLabel'),
      shotTypeLabel: t('card.shotTypeLabel'),
      charactersLabel: t('card.charactersLabel'),
      propsLabel: t('card.propsLabel'),
    },
    fields: {
      finalImagePrompt: t('fields.finalImagePrompt'),
      shot: t('fields.shot'),
      promptOnlyNote: t('fields.promptOnlyNote'),
    },
    actions: {
      copyPrompt: t('actions.copyPrompt'),
      regenerateImage: t('actions.regenerateImage'),
      generateImage: t('actions.generateImage'),
      expand: t('actions.expand'),
      collapse: t('actions.collapse'),
    },
    layouts: [layout(t, 0), layout(t, 1), layout(t, 2), layout(t, 3), layout(t, 4)],
    shots: [shot(t, 0), shot(t, 1), shot(t, 2), shot(t, 3)],
  }
}
