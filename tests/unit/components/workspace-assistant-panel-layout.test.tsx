import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from 'use-intl/core'
import { WorkspaceAssistantPanelHeader } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantPanelHeader'
import { WorkspaceAssistantPanelRail } from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantPanelRail'
import { WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE } from '@/features/project-workspace/components/WorkspaceAssistantPanel'
import {
  resolveProgressStageLabel,
  WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS,
} from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers'
import {
  buildWorkspaceAssistantPanelLayout,
  clampWorkspaceAssistantPanelWidth,
  WORKSPACE_ASSISTANT_PANEL_MAX_WIDTH_PX,
  WORKSPACE_ASSISTANT_PANEL_MIN_WIDTH_PX,
  WORKSPACE_ASSISTANT_PANEL_WIDTH_PX,
  WORKSPACE_ASSISTANT_RAIL_WIDTH_PX,
} from '@/features/project-workspace/components/workspace-assistant/panel-layout'

type ProgressTranslator = Parameters<typeof resolveProgressStageLabel>[1]

function createProgressTranslator(messages: {
  stage?: Record<string, string>
}): ProgressTranslator {
  return createTranslator({
    locale: 'zh',
    namespace: 'progress',
    messages: {
      progress: messages,
    },
  }) as ProgressTranslator
}

describe('workspace assistant panel layout', () => {
  it('returns expanded width when panel is visible', () => {
    expect(buildWorkspaceAssistantPanelLayout(false)).toEqual({
      occupiedWidthPx: 0,
      panelWidthPx: WORKSPACE_ASSISTANT_PANEL_WIDTH_PX,
      railWidthPx: WORKSPACE_ASSISTANT_RAIL_WIDTH_PX,
      translateXPx: 0,
      state: 'expanded',
    })
  })

  it('clamps custom expanded width into the supported resize range', () => {
    expect(buildWorkspaceAssistantPanelLayout(false, 640)).toEqual({
      occupiedWidthPx: 0,
      panelWidthPx: 640,
      railWidthPx: WORKSPACE_ASSISTANT_RAIL_WIDTH_PX,
      translateXPx: 0,
      state: 'expanded',
    })
    expect(clampWorkspaceAssistantPanelWidth(200)).toBe(WORKSPACE_ASSISTANT_PANEL_MIN_WIDTH_PX)
    expect(clampWorkspaceAssistantPanelWidth(1200)).toBe(WORKSPACE_ASSISTANT_PANEL_MAX_WIDTH_PX)
  })

  it('keeps the right-side overlay out of canvas layout when collapsed', () => {
    expect(buildWorkspaceAssistantPanelLayout(true)).toEqual({
      occupiedWidthPx: 0,
      panelWidthPx: WORKSPACE_ASSISTANT_RAIL_WIDTH_PX,
      railWidthPx: WORKSPACE_ASSISTANT_RAIL_WIDTH_PX,
      translateXPx: 0,
      state: 'collapsed',
    })
  })

  it('renders explicit collapse and expand controls for the sidebar rail', () => {
    const headerHtml = renderToStaticMarkup(
      createElement(WorkspaceAssistantPanelHeader, {
        collapseLabel: 'Collapse AI assistant sidebar',
        onCollapse: () => undefined,
      }),
    )
    const railHtml = renderToStaticMarkup(
      createElement(WorkspaceAssistantPanelRail, {
        expandLabel: 'Expand AI assistant sidebar',
        onExpand: () => undefined,
      }),
    )

    expect(headerHtml).toContain('Collapse AI assistant sidebar')
    expect(headerHtml).toContain('lucide-chevron-right')
    expect(headerHtml).not.toContain('Workspace Chat')
    expect(headerHtml).not.toContain('View full raw context')
    expect(headerHtml).not.toContain('Download Log')
    expect(headerHtml).not.toContain('lucide-file-text')
    expect(headerHtml).not.toContain('lucide-download')
    expect(headerHtml).toContain('bg-transparent')
    expect(headerHtml).not.toContain('bg-white/70')
    expect(headerHtml).not.toContain('sticky')
    expect(headerHtml).not.toContain('top-0')
    expect(headerHtml).not.toContain('z-10')
    expect(headerHtml).not.toContain('backdrop-blur')
    expect(railHtml).toContain('Expand AI assistant sidebar')
    expect(railHtml).toContain('lucide-chevron-left')
    expect(railHtml).not.toContain('Workspace Chat')
    expect(railHtml).not.toContain('lucide-sparkles')
  })

  it('keeps user messages as flat gray bubbles without border or shadow', () => {
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).toContain('bg-neutral-100')
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).not.toContain('border')
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).not.toContain('shadow')
    expect(WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS).not.toContain('backdrop-blur')
  })

  it('fades scrolled messages near the top boundary instead of clipping them hard', () => {
    expect(WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE.maskImage).toBe(
      'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
    )
    expect(WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE.WebkitMaskImage).toBe(WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE.maskImage)
  })

  it('keeps confirmation actions in the message stream without a duplicate pending action summary', () => {
    const panelSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/WorkspaceAssistantPanel.tsx'),
      'utf8',
    )
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )

    expect(panelSource).not.toContain('pendingActionsTitle')
    expect(panelSource).not.toContain('pendingConfirmationChip')
    expect(rendererSource).toContain("'confirmation-request'")
    expect(rendererSource).toContain('InlineConfirmationRequestDataCard')
  })

  it('resolves progress stage labels without crashing on missing translations', () => {
    const progressT = createProgressTranslator({
      stage: {
        editScriptVideoPrompt: '生成视频提示词',
      },
    })

    expect(resolveProgressStageLabel('progress.stage.editScriptVideoPrompt', progressT)).toBe('生成视频提示词')
    expect(resolveProgressStageLabel('progress.stage.missingStage', progressT)).toBe('MISSING_MESSAGE:progress.stage.missingStage')
    expect(resolveProgressStageLabel('外部阶段', progressT)).toBe('外部阶段')
  })

  it('keeps edit script video prompt stage translated in supported locales', () => {
    const zhProgressSource = readFileSync(join(process.cwd(), 'messages/zh/progress.json'), 'utf8')
    const enProgressSource = readFileSync(join(process.cwd(), 'messages/en/progress.json'), 'utf8')

    expect(zhProgressSource).toContain('"editScriptVideoPrompt"')
    expect(enProgressSource).toContain('"editScriptVideoPrompt"')
  })
})
