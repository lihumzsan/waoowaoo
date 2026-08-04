'use client'

import { createContext, useContext, type ReactNode } from 'react'

type WorkspaceAssistantWorkspaceLinkContextValue = {
  readonly openWorkspacePath: (workspacePath: string) => void
}

const WorkspaceAssistantWorkspaceLinkContext = createContext<
  WorkspaceAssistantWorkspaceLinkContextValue | null
>(null)

/** Decode one model-authored project link without allowing host/runtime navigation. */
export function projectWorkspacePathFromHref(href: string): string | null {
  const encodedPath = href.split(/[?#]/u, 1)[0] ?? ''
  let workspacePath: string
  try {
    workspacePath = decodeURIComponent(encodedPath).normalize('NFC')
  } catch {
    return null
  }
  if (
    !workspacePath
    || workspacePath.startsWith('/')
    || workspacePath.startsWith('.')
    || workspacePath.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(workspacePath)
    || /^[a-z][a-z\d+.-]*:/i.test(workspacePath)
  ) return null
  return workspacePath.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
    ? workspacePath
    : null
}

export function WorkspaceAssistantWorkspaceLinkProvider(props: {
  readonly openWorkspacePath: (workspacePath: string) => void
  readonly children: ReactNode
}) {
  return (
    <WorkspaceAssistantWorkspaceLinkContext.Provider value={{
      openWorkspacePath: props.openWorkspacePath,
    }}>
      {props.children}
    </WorkspaceAssistantWorkspaceLinkContext.Provider>
  )
}

export function useWorkspaceAssistantWorkspaceLink(): WorkspaceAssistantWorkspaceLinkContextValue | null {
  return useContext(WorkspaceAssistantWorkspaceLinkContext)
}
