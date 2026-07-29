import type { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import type { WorkspaceCanvasFlowNode } from '../../node-canvas-types'

export interface WorkspaceCanvasNodeRendererProps {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
}

export type WorkspaceCanvasNodeRenderer = (props: WorkspaceCanvasNodeRendererProps) => ReactNode
