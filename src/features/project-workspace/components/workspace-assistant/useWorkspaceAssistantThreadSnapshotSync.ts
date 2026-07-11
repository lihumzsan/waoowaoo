import { useCallback, useRef, type MutableRefObject } from 'react'
import type { UIMessage } from 'ai'
import {
  areWorkspaceAssistantMessagesEqual,
  resolveWorkspaceAssistantThreadSnapshotMessages,
} from './thread-sync'

type PersistedAssistantThread = {
  readonly id: string
  readonly messages: readonly UIMessage[]
}

export function useWorkspaceAssistantThreadSnapshotSync(params: {
  chatId: string
  latestMessagesRef: MutableRefObject<UIMessage[]>
  setMessages: (messages: UIMessage[]) => void
}) {
  const { chatId, latestMessagesRef, setMessages } = params
  const acceptedIdentityRef = useRef<{ chatId: string; threadId: string } | null>(null)
  return useCallback((persistedThread: PersistedAssistantThread | null) => {
    const acceptedThreadId = acceptedIdentityRef.current?.chatId === chatId
      ? acceptedIdentityRef.current.threadId
      : null
    const nextMessages = resolveWorkspaceAssistantThreadSnapshotMessages(
      latestMessagesRef.current,
      persistedThread,
      acceptedThreadId,
    )
    acceptedIdentityRef.current = persistedThread
      ? { chatId, threadId: persistedThread.id }
      : null
    if (areWorkspaceAssistantMessagesEqual(latestMessagesRef.current, nextMessages)) return
    latestMessagesRef.current = nextMessages
    setMessages(nextMessages)
  }, [chatId, latestMessagesRef, setMessages])
}
