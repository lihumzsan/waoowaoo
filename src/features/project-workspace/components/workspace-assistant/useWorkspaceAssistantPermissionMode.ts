'use client'

import { useCallback, useState } from 'react'
import {
  isAssistantPermissionMode,
  type AssistantPermissionMode,
} from '@/lib/project-agent/permission-mode'

const WORKSPACE_ASSISTANT_PERMISSION_MODE_STORAGE_KEY = 'workspace-assistant-permission-mode'

function readStoredAssistantPermissionMode(): AssistantPermissionMode {
  if (typeof window === 'undefined') return 'ask'
  const storedValue = window.localStorage.getItem(WORKSPACE_ASSISTANT_PERMISSION_MODE_STORAGE_KEY)
  return isAssistantPermissionMode(storedValue) ? storedValue : 'ask'
}

export function useWorkspaceAssistantPermissionMode() {
  const [mode, setModeState] = useState<AssistantPermissionMode>(readStoredAssistantPermissionMode)
  const setMode = useCallback((nextMode: AssistantPermissionMode) => {
    setModeState(nextMode)
    window.localStorage.setItem(WORKSPACE_ASSISTANT_PERMISSION_MODE_STORAGE_KEY, nextMode)
  }, [])

  return [mode, setMode] as const
}
