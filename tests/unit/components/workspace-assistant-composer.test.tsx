import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceAssistantComposer } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantComposer'

vi.mock('next-intl', () => ({
  useLocale: () => 'zh',
  useTranslations: () => (key: string) => key,
}))

describe('WorkspaceAssistantComposer', () => {
  it('renders a compact arrow-only send button without the assistant hint copy', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceAssistantComposer, {
        value: '继续生成核心剪辑表',
        error: null,
        pending: false,
        attachments: [],
        assistantPermissionMode: 'ask',
        onChange: () => undefined,
        onSubmit: async () => undefined,
        onAttachClick: () => undefined,
        onRemoveAttachment: () => undefined,
        onAssistantPermissionModeChange: () => undefined,
      }),
    )

    expect(html).toContain('aria-label="panel.send"')
    expect(html).toContain('lucide-arrow-right')
    expect(html).toContain('aria-label="panel.permissionModeToggle"')
    expect(html).toContain('aria-label="attachments.openUpload"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('lucide-lock')
    expect(html).toContain('lucide-chevron-down')
    expect(html).toContain('rows="2"')
    expect(html).not.toContain('min-h-[7.25rem]')
    expect(html).toContain('min-h-10')
    expect(html).toContain('mt-1 flex h-8 shrink-0 items-center justify-between')
    expect(html).toContain('glass-selection-control inline-flex h-6')
    expect(html).toContain('h-6')
    expect(html).toContain('h-8 w-8')
    expect(html).not.toContain('>panel.send<')
    expect(html).not.toContain('panel.assistantHint')
    expect(html).not.toContain('通用助手会先读取项目状态')
  })

  it('uses a short creative phrase instead of an instructional placeholder', () => {
    const zhMessages = JSON.parse(readFileSync(join(process.cwd(), 'messages/zh/assistantAgent.json'), 'utf8')) as {
      panel: {
        composerPlaceholder: string
        permissionModeToggle: string
        permissionModeMenuTitle: string
        permissionModeDescriptionAsk: string
        permissionModeDescriptionAuto: string
      }
    }
    const enMessages = JSON.parse(readFileSync(join(process.cwd(), 'messages/en/assistantAgent.json'), 'utf8')) as {
      panel: {
        composerPlaceholder: string
        permissionModeToggle: string
        permissionModeMenuTitle: string
        permissionModeDescriptionAsk: string
        permissionModeDescriptionAuto: string
      }
    }

    expect(zhMessages.panel.composerPlaceholder).toBe('和 AI 一起创造')
    expect(zhMessages.panel.composerPlaceholder).not.toContain('读取项目状态')
    expect(zhMessages.panel.permissionModeToggle).toContain('打开切换菜单')
    expect(zhMessages.panel.permissionModeMenuTitle).toBe('权限模式')
    expect(zhMessages.panel.permissionModeDescriptionAsk).toContain('只读查询直接执行')
    expect(zhMessages.panel.permissionModeDescriptionAuto).toContain('业务选择仍必须等用户决定')
    expect(enMessages.panel.composerPlaceholder).toBe('Create with AI')
    expect(enMessages.panel.composerPlaceholder).not.toContain('read project state')
    expect(enMessages.panel.permissionModeToggle).toContain('Open mode menu')
    expect(enMessages.panel.permissionModeMenuTitle).toBe('Permission mode')
    expect(enMessages.panel.permissionModeDescriptionAsk).toContain('read-only queries run directly')
    expect(enMessages.panel.permissionModeDescriptionAuto).toContain('content choices still wait for the user')
  })
})
