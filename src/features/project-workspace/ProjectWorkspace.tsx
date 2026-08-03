'use client'

import { useCallback, useRef, useState } from 'react'
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

function ProjectWorkspaceContent(props: ProjectWorkspaceProps) {
  const { projectId } = props
  const [selection, setSelection] = useState<WorkspaceCanvasSelection | null>(null)
  // Assistant context is set only by an explicit discuss action, never by
  // canvas selection alone; the chip above the composer mirrors this state.
  const [assistantContext, setAssistantContext] = useState<WorkspaceCanvasSelection | null>(null)
  const [draft, setDraft] = useState<WorkspaceAssistantDraftRequest | null>(null)
  const [activeFocus, setActiveFocus] = useState<WorkspaceAssistantActiveFocusRequest | null>(null)
  const selectionRef = useRef<WorkspaceCanvasSelection | null>(null)
  const changeSelection = useCallback((next: WorkspaceCanvasSelection | null) => {
    selectionRef.current = next
    setSelection(next)
  }, [])
  const requestAssistantDraft = useCallback((request: WorkspaceAssistantDraftRequest) => {
    setAssistantContext(selectionRef.current)
    setDraft(request)
  }, [])
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <WorkspaceAssistantPanel
        projectId={projectId}
        selection={assistantContext}
        draftRequest={draft}
        onDraftRequestConsumed={(requestId) => {
          setDraft((current) => current?.requestId === requestId ? null : current)
        }}
        onClearSelection={() => setAssistantContext(null)}
        autoStartDraft={props.assistantAutoStartDraft ?? null}
        autoStartKey={props.assistantAutoStartKey ?? null}
        onAutoStartConsumed={props.onAssistantAutoStartConsumed}
        onActiveOperationChange={setActiveFocus}
      />
      <div className="h-full min-w-0 overflow-hidden pr-[var(--workspace-assistant-panel-width,420px)]">
        <ProjectWorkspaceCanvas
          selection={selection}
          onSelectionChange={changeSelection}
          onAssistantDraftRequest={requestAssistantDraft}
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
