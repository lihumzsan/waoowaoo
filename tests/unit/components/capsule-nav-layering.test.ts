import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CapsuleNav, EpisodeSelector, ProjectNameEditor } from '@/components/ui/CapsuleNav'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name, className }: { name: string; className?: string }) =>
    createElement('span', { 'data-icon': name, className }),
}))

const capsuleNavSource = readFileSync(resolve(process.cwd(), 'src/components/ui/CapsuleNav.tsx'), 'utf8')

describe('CapsuleNav layering', () => {
  it('keeps fixed workspace navigation below modal overlays', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement('div', null,
        createElement(CapsuleNav, {
          items: [
            { id: 'config', icon: 'sparkles', label: '配置', status: 'active' as const },
          ],
          activeId: 'config',
          onItemClick: () => undefined,
          projectId: 'project-1',
        }),
        createElement(EpisodeSelector, {
          episodes: [
            { id: 'episode-1', title: '剧集 1' },
          ],
          currentId: 'episode-1',
          onSelect: () => undefined,
          projectName: '项目 A',
        }),
      ),
    )

    expect(html).toContain('fixed top-20 left-1/2 -translate-x-1/2 z-40')
    expect(html).toContain('fixed top-20 left-6 z-40')
    expect(html).not.toContain('z-50 animate-fadeInDown')
    expect(html).not.toContain('z-[60]')
  })
})

describe('EpisodeSelector layout', () => {
  it('keeps episode edit and delete actions visible after long titles truncate', () => {
    expect(capsuleNavSource).toContain('className={`w-full min-w-0 flex items-center gap-3 p-3 rounded-xl transition-all')
    expect(capsuleNavSource).toContain('className="min-w-0 flex-1 flex items-center gap-3 text-left"')
    expect(capsuleNavSource).toContain('<div className="min-w-0 flex-1">')
    expect(capsuleNavSource).toContain('className="w-7 h-7 shrink-0 rounded-lg hover:bg-[var(--glass-bg-surface-strong)]')
    expect(capsuleNavSource).toContain('className="w-7 h-7 shrink-0 rounded-lg hover:bg-[var(--glass-tone-danger-bg)]')
  })
})

describe('ProjectNameEditor', () => {
  it('renders a compact inline project rename affordance when rename is available', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(ProjectNameEditor, {
        projectName: '听雨',
        onRename: async () => undefined,
        t: (key: string) => key,
      }),
    )

    expect(html).toContain('data-icon="folder"')
    expect(html).toContain('title="editProjectName"')
    expect(html).toContain('听雨')
    expect(html).toContain('mb-1 flex items-center gap-1.5 px-2 py-1.5')
    expect(html).not.toContain('rounded-xl border')
    expect(html).not.toContain('glass-tone-info-bg')
    expect(html).not.toContain('>project<')
  })

  it('does not render a disabled project edit button without a rename handler', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(ProjectNameEditor, {
        projectName: '听雨',
        t: (key: string) => key,
      }),
    )

    expect(html).toContain('data-icon="folder"')
    expect(html).not.toContain('title="editProjectName"')
  })
})
