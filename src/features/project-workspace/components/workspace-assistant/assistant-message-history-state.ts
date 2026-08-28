import type { UIMessage } from 'ai'

export type AssistantMessageHistoryPage = {
  readonly scopeKey: string
  readonly threadId: string | null
  readonly messages: readonly UIMessage[]
  readonly before: string | null
  readonly hasMore: boolean
}

export type AssistantMessageHistoryRequestIdentity = {
  readonly requestId: number
  readonly scopeKey: string
  readonly threadId: string
  readonly before: string
}

export type AssistantMessageHistoryState = {
  readonly scopeKey: string
  readonly threadId: string | null
  readonly messages: UIMessage[]
  readonly before: string | null
  readonly hasMore: boolean
  readonly loadedEarlier: boolean
  readonly activeRequest: AssistantMessageHistoryRequestIdentity | null
}

export type AssistantMessageHistoryAction =
  | {
      readonly type: 'view_synced'
      readonly page: AssistantMessageHistoryPage
    }
  | {
      readonly type: 'load_started'
      readonly request: AssistantMessageHistoryRequestIdentity
    }
  | {
      readonly type: 'load_succeeded'
      readonly request: AssistantMessageHistoryRequestIdentity
      readonly page: {
        readonly messages: readonly UIMessage[]
        readonly before: string | null
        readonly hasMore: boolean
      }
    }
  | {
      readonly type: 'load_failed'
      readonly request: AssistantMessageHistoryRequestIdentity
    }

export function createAssistantMessageHistoryState(
  page: AssistantMessageHistoryPage,
): AssistantMessageHistoryState {
  return {
    scopeKey: page.scopeKey,
    threadId: page.threadId,
    messages: [...page.messages],
    before: page.before,
    hasMore: page.hasMore,
    loadedEarlier: false,
    activeRequest: null,
  }
}

export function isAssistantMessageHistoryRequestCurrent(
  state: AssistantMessageHistoryState,
  request: AssistantMessageHistoryRequestIdentity,
): boolean {
  return state.activeRequest?.requestId === request.requestId
    && state.activeRequest.scopeKey === request.scopeKey
    && state.activeRequest.threadId === request.threadId
    && state.activeRequest.before === request.before
}

function mergeLatestMessages(
  current: readonly UIMessage[],
  latest: readonly UIMessage[],
): { readonly messages: UIMessage[]; readonly reset: boolean } {
  if (current.length === 0) return { messages: [...latest], reset: false }
  if (latest.length === 0) return { messages: [], reset: true }
  const currentIndexById = new Map(current.map((message, index) => [message.id, index] as const))
  const firstOverlap = latest
    .map((message, index) => ({ latestIndex: index, currentIndex: currentIndexById.get(message.id) }))
    .find((entry) => entry.currentIndex !== undefined)
  if (!firstOverlap || firstOverlap.currentIndex === undefined) {
    return { messages: [...latest], reset: true }
  }
  const prefix = current.slice(0, firstOverlap.currentIndex)
  const latestIds = new Set(latest.map((message) => message.id))
  return {
    messages: [
      ...prefix.filter((message) => !latestIds.has(message.id)),
      ...latest,
    ],
    reset: false,
  }
}

function prependEarlierMessages(
  current: readonly UIMessage[],
  earlier: readonly UIMessage[],
): UIMessage[] {
  const currentIds = new Set(current.map((message) => message.id))
  return [
    ...earlier.filter((message) => !currentIds.has(message.id)),
    ...current,
  ]
}

export function reduceAssistantMessageHistoryState(
  state: AssistantMessageHistoryState,
  action: AssistantMessageHistoryAction,
): AssistantMessageHistoryState {
  if (action.type === 'view_synced') {
    const latest = createAssistantMessageHistoryState(action.page)
    if (state.scopeKey !== latest.scopeKey || state.threadId !== latest.threadId) return latest
    const merged = mergeLatestMessages(state.messages, latest.messages)
    if (merged.reset) return latest
    if (state.loadedEarlier) {
      return { ...state, messages: merged.messages }
    }
    const cursorChanged = state.before !== latest.before
    return {
      ...state,
      messages: merged.messages,
      before: latest.before,
      hasMore: latest.hasMore,
      activeRequest: cursorChanged ? null : state.activeRequest,
    }
  }

  if (action.type === 'load_started') {
    if (
      state.activeRequest
      || !state.hasMore
      || state.scopeKey !== action.request.scopeKey
      || state.threadId !== action.request.threadId
      || state.before !== action.request.before
    ) return state
    return { ...state, activeRequest: action.request }
  }

  if (!isAssistantMessageHistoryRequestCurrent(state, action.request)) return state

  if (action.type === 'load_failed') {
    return { ...state, activeRequest: null }
  }

  return {
    ...state,
    messages: prependEarlierMessages(state.messages, action.page.messages),
    before: action.page.before,
    hasMore: action.page.hasMore,
    loadedEarlier: true,
    activeRequest: null,
  }
}
