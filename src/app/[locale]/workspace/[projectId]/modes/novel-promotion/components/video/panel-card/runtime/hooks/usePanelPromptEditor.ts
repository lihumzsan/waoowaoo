import { useCallback, useState } from 'react'

interface UsePanelPromptEditorParams {
  localPrompt: string
  onUpdateLocalPrompt: (value: string) => void
  onSavePrompt: (value: string) => Promise<void>
  controlledValue?: string
  onControlledValueChange?: (value: string) => void
}

export function usePanelPromptEditor({
  localPrompt,
  onUpdateLocalPrompt,
  onSavePrompt,
  controlledValue,
  onControlledValueChange,
}: UsePanelPromptEditorParams) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState(localPrompt)
  const effectiveEditingPrompt = controlledValue ?? editingPrompt

  const handleStartEdit = useCallback(() => {
    setEditingPrompt(localPrompt)
    setIsEditing(true)
  }, [localPrompt])

  const handleSave = useCallback(async () => {
    if (controlledValue === undefined) onUpdateLocalPrompt(editingPrompt)
    setIsEditing(false)
    await onSavePrompt(effectiveEditingPrompt)
  }, [controlledValue, editingPrompt, effectiveEditingPrompt, onSavePrompt, onUpdateLocalPrompt])

  const handleCancelEdit = useCallback(() => {
    setEditingPrompt(localPrompt)
    setIsEditing(false)
  }, [localPrompt])

  return {
    isEditing,
    editingPrompt: effectiveEditingPrompt,
    setEditingPrompt: onControlledValueChange || setEditingPrompt,
    handleStartEdit,
    handleSave,
    handleCancelEdit,
  }
}
