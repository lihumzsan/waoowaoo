import { readFileSync } from 'node:fs'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } }, status: 'authenticated' }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/components/Navbar', () => ({ default: () => createElement('nav') }))
vi.mock('@/app/[locale]/workspace/video-tools/VideoUploadCard', () => ({
  default: () => createElement('div', { 'data-upload-card': true }),
}))
vi.mock('@/app/[locale]/workspace/video-tools/FreeVoiceToolCard', () => ({
  default: () => createElement('section', { 'data-free-voice-tool': true }, 'freeVoice.title'),
}))

import VideoToolsPage from '@/app/[locale]/workspace/video-tools/page'

vi.stubGlobal('React', React)

describe('video tools page', () => {
  it('renders the current result without any recent-concatenation history controls', () => {
    const html = renderToStaticMarkup(createElement(VideoToolsPage))

    expect(html).toContain('result.title')
    expect(html).not.toContain('history.title')
    expect(html).not.toContain('actions.refresh')
  })

  it('renders free voice as a video-tools level tool', () => {
    const html = renderToStaticMarkup(createElement(VideoToolsPage))

    expect(html).toContain('data-free-voice-tool')
    expect(html).toContain('freeVoice.title')
  })

  it('keeps result download on the native video controls only', () => {
    const source = readFileSync('src/app/[locale]/workspace/video-tools/page.tsx', 'utf8')

    expect(source).toContain('controls preload="metadata"')
    expect(source).not.toContain("t('actions.download')")
  })

  it('keeps direct mode as the default and renders only validated AI diagnostics', () => {
    const source = readFileSync('src/app/[locale]/workspace/video-tools/page.tsx', 'utf8')

    expect(source).toContain("useState<'direct' | 'ai_bridge'>('direct')")
    expect(source).toContain('useState<4 | 6 | 8>(4)')
    expect(source).toContain('resolveVideoSeamDiagnostics(currentTask?.result || null)')
    expect(source).toContain('<VideoSeamDiagnostics diagnostics={diagnostics}')
  })

  it('selects truthful workflow copy for the active seam mode', () => {
    const source = readFileSync('src/app/[locale]/workspace/video-tools/page.tsx', 'utf8')

    expect(source).toContain("seamMode === 'ai_bridge' ? t('workflowNoteAi') : t('workflowNoteDirect')")
    expect(source).not.toContain("{t('workflowNote')}")
  })
})
