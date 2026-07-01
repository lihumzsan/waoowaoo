export type Translate = (key: string, values?: Record<string, string | number>) => string

export type ShotTone = 'violet' | 'teal' | 'amber' | 'crimson'

export type LayoutId = 'vertical' | 'landscape' | 'poster' | 'editorial' | 'datasheet'

export interface StoryboardShot {
  readonly id: string
  readonly number: string
  readonly status: string
  readonly scene: string
  readonly shotType: string
  readonly characters: readonly string[]
  readonly props: readonly string[]
  readonly cost: string
  readonly prompt: string
  readonly tone: ShotTone
}

export interface LayoutCopy {
  readonly id: LayoutId
  readonly title: string
  readonly description: string
}

export interface StoryboardShotUiClaudeCopy {
  readonly page: {
    readonly title: string
    readonly subtitle: string
  }
  readonly card: {
    readonly eyebrow: string
    readonly sceneLabel: string
    readonly shotTypeLabel: string
    readonly charactersLabel: string
    readonly propsLabel: string
  }
  readonly fields: {
    readonly finalImagePrompt: string
    readonly shot: string
    readonly promptOnlyNote: string
  }
  readonly actions: {
    readonly copyPrompt: string
    readonly regenerateImage: string
    readonly generateImage: string
    readonly expand: string
    readonly collapse: string
  }
  readonly layouts: readonly [LayoutCopy, LayoutCopy, LayoutCopy, LayoutCopy, LayoutCopy]
  readonly shots: readonly StoryboardShot[]
}
