'use client'

import { useState } from 'react'
import { WorkspaceProvider } from './WorkspaceProvider'
import WorkspaceAssistantPanel from './components/WorkspaceAssistantPanel'
import ProjectWorkspaceCanvas from './canvas/ProjectWorkspaceCanvas'
import type {
  WorkspaceAssistantDraftRequest,
  WorkspaceCanvasSelection,
} from './canvas/contracts/workspace-canvas-interactions'
import type { WorkspaceAssistantActiveFocusRequest } from './workspace-assistant-focus'
import type { ProjectWorkspaceProps } from './types'
import '@/styles/animations.css'

function ProjectWorkspaceContent({ projectId }: ProjectWorkspaceProps) {
  const [selection, setSelection] = useState<WorkspaceCanvasSelection | null>(null)
  const [draft, setDraft] = useState<WorkspaceAssistantDraftRequest | null>(null)
  const [activeFocus, setActiveFocus] = useState<WorkspaceAssistantActiveFocusRequest | null>(null)
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <WorkspaceAssistantPanel
        projectId={projectId}
        selection={selection}
        draftRequest={draft}
        onDraftRequestConsumed={(requestId) => {
          setDraft((current) => current?.requestId === requestId ? null : current)
        }}
        onClearSelection={() => setSelection(null)}
        onActiveOperationChange={setActiveFocus}
      />
      <div className="h-full min-w-0 overflow-hidden pr-[var(--workspace-assistant-panel-width,420px)]">
        <ProjectWorkspaceCanvas
          selection={selection}
          onSelectionChange={setSelection}
          onAssistantDraftRequest={setDraft}
          activeAssistantFocusRequest={activeFocus}
        />
      </div>
    </div>
  )
}

export default function ProjectWorkspace(props: ProjectWorkspaceProps) {
  return (
    <WorkspaceProvider projectId={props.projectId}>
      <ProjectWorkspaceContent {...props} />
    </WorkspaceProvider>
  )
}
