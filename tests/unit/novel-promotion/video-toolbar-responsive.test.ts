import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import VideoToolbar from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/VideoToolbar'

vi.stubGlobal('React', React)

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (
    values ? `${key}:${JSON.stringify(values)}` : key
  ),
}))

vi.mock('@/components/task/TaskStatusInline', () => ({
  default: () => React.createElement('span', null, 'task-status'),
}))

describe('VideoToolbar responsive layout', () => {
  it('stacks summary and wraps actions on narrow viewports', () => {
    const markup = renderToStaticMarkup(React.createElement(VideoToolbar, {
      totalPanels: 188,
      runningCount: 0,
      videosWithUrl: 182,
      failedCount: 0,
      isAnyTaskRunning: false,
      onGenerateAll: vi.fn(),
      onBack: vi.fn(),
    }))

    expect(markup).toContain('flex-col items-stretch gap-3 sm:flex-row')
    expect(markup).toContain('grid grid-cols-2 gap-2 sm:flex')
    expect(markup).toContain('justify-center')
    expect(markup).not.toContain('toolbar.downloadAll')
    expect(markup).toContain('toolbar.generateAll')
    expect(markup).toContain('toolbar.back')
  })

  it('fills the final mobile action row when the editor action is present', () => {
    const markup = renderToStaticMarkup(React.createElement(VideoToolbar, {
      totalPanels: 188,
      runningCount: 0,
      videosWithUrl: 182,
      failedCount: 0,
      isAnyTaskRunning: false,
      onGenerateAll: vi.fn(),
      onBack: vi.fn(),
      onEnterEditor: vi.fn(),
      videosReady: true,
    }))

    expect(markup).toContain('col-span-2 sm:col-span-1')
    expect(markup).not.toContain('toolbar.downloadAll')
  })
})
