'use client'

import { useTranslations } from 'next-intl'
import { StoryboardShotLayoutVariants } from './storyboard-shot-ui-claude-variants'
import { buildStoryboardShotUiClaudeCopy } from './storyboard-shot-ui-claude-data'

export default function StoryboardShotUiClaudeClient() {
  const t = useTranslations('storyboardShotUiClaude')
  const copy = buildStoryboardShotUiClaudeCopy(t)

  return (
    <main className="min-h-screen bg-[var(--glass-bg-canvas)] text-[var(--glass-text-primary)]">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6 px-5 py-6 lg:px-8">
        <header className="space-y-2">
          <h1 className="text-xl font-semibold text-[var(--glass-text-primary)]">{copy.page.title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-[var(--glass-text-secondary)]">{copy.page.subtitle}</p>
        </header>
        <StoryboardShotLayoutVariants copy={copy} />
      </div>
    </main>
  )
}
