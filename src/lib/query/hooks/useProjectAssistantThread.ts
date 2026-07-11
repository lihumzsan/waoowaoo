'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import type { ProjectAssistantThreadSnapshot } from '@/lib/project-agent/types'
import { queryKeys } from '../keys'
import {
  isProjectAgentSessionEventWatermarkAtLeast,
  maxProjectAgentSessionEventWatermark,
  parseProjectAgentSessionEventWatermark,
} from '@/lib/project-agent/session-watermark'

interface ProjectAssistantThreadResponse {
  thread: ProjectAssistantThreadSnapshot | null
  eventWatermark: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isProjectAssistantThreadResponseFresh(params: {
  responseEventWatermark: string
  requiredEventWatermark: string
}): boolean {
  return isProjectAgentSessionEventWatermarkAtLeast({
    candidate: params.responseEventWatermark,
    required: params.requiredEventWatermark,
  })
}

export function useProjectAssistantThread(
  projectId: string | null,
  episodeId?: string | null,
  requiredEventWatermark = '0',
) {
  const queryClient = useQueryClient()
  const scopeKey = `${projectId ?? ''}:${episodeId ?? ''}`
  const queryKey = queryKeys.project.assistantThread(projectId || '', episodeId || '')
  const scopeKeyRef = useRef(scopeKey)
  const requiredEventWatermarkRef = useRef('0')
  const refetchedEventWatermarkRef = useRef('0')
  if (scopeKeyRef.current !== scopeKey) {
    scopeKeyRef.current = scopeKey
    requiredEventWatermarkRef.current = '0'
    refetchedEventWatermarkRef.current = '0'
  }
  requiredEventWatermarkRef.current = maxProjectAgentSessionEventWatermark(
    requiredEventWatermarkRef.current,
    requiredEventWatermark,
  )
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!projectId) throw new Error('projectId is required')
      const search = new URLSearchParams()
      if (episodeId) search.set('episodeId', episodeId)
      const response = await apiFetch(`/api/projects/${projectId}/assistant/chat?${search.toString()}`, {
        signal,
      })
      if (!response.ok) {
        throw new Error('Failed to load assistant thread')
      }
      const payload: unknown = await response.json().catch(() => null)
      if (!isRecord(payload)) throw new Error('PROJECT_ASSISTANT_THREAD_RESPONSE_INVALID')
      const eventWatermark = parseProjectAgentSessionEventWatermark(payload.eventWatermark)
      const cached = queryClient.getQueryData<ProjectAssistantThreadResponse>(queryKey)
      const minimumEventWatermark = maxProjectAgentSessionEventWatermark(
        requiredEventWatermarkRef.current,
        cached?.eventWatermark ?? '0',
      )
      if (!isProjectAssistantThreadResponseFresh({
        responseEventWatermark: eventWatermark,
        requiredEventWatermark: minimumEventWatermark,
      })) {
        throw new Error('PROJECT_ASSISTANT_THREAD_RESPONSE_STALE')
      }
      const thread = payload.thread ?? null
      if (thread !== null && !isRecord(thread)) {
        throw new Error('PROJECT_ASSISTANT_THREAD_RESPONSE_INVALID')
      }
      return {
        thread: thread as ProjectAssistantThreadSnapshot | null,
        eventWatermark,
      } satisfies ProjectAssistantThreadResponse
    },
    enabled: !!projectId,
    staleTime: 5000,
  })
  useEffect(() => {
    if (!projectId || isProjectAgentSessionEventWatermarkAtLeast({
      candidate: refetchedEventWatermarkRef.current,
      required: requiredEventWatermark,
    })) return
    refetchedEventWatermarkRef.current = requiredEventWatermark
    void query.refetch({ cancelRefetch: true })
  }, [projectId, query.refetch, requiredEventWatermark])
  return query
}

export function useProjectAssistantThreadSync(
  projectId: string | null,
  episodeId?: string | null,
) {
  const queryClient = useQueryClient()

  const clear = useCallback(async (): Promise<void> => {
    if (!projectId) throw new Error('projectId is required')
    const search = new URLSearchParams()
    if (episodeId) search.set('episodeId', episodeId)
    const response = await apiFetch(`/api/projects/${projectId}/assistant/chat?${search.toString()}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error('Failed to clear assistant thread')
    }
    const payload: unknown = await response.json().catch(() => null)
    if (!isRecord(payload)) throw new Error('PROJECT_ASSISTANT_THREAD_CLEAR_RESPONSE_INVALID')
    const eventWatermark = parseProjectAgentSessionEventWatermark(payload.eventWatermark)
    queryClient.setQueryData<ProjectAssistantThreadResponse>(
      queryKeys.project.assistantThread(projectId, episodeId || ''),
      { thread: null, eventWatermark },
    )
  }, [episodeId, projectId, queryClient])

  return {
    clear,
  }
}
