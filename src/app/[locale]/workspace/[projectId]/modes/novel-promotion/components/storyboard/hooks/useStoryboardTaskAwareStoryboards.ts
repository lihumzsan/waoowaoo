'use client'

import { useMemo } from 'react'
import { NovelPromotionStoryboard } from '@/types/project'
import { useStoryboardTaskPresentation } from '@/lib/query/hooks/useTaskPresentation'

interface TaskTarget {
  key: string
  targetType: string
  targetId: string
  types: string[]
  resource: 'text' | 'image'
  hasOutput: boolean
}

interface UseStoryboardTaskAwareStoryboardsProps {
  projectId: string
  initialStoryboards: NovelPromotionStoryboard[]
  isRunningPhase: (phase: string | null | undefined) => boolean
}

function buildStoryboardTextTargets(storyboards: NovelPromotionStoryboard[]): TaskTarget[] {
  const targets: TaskTarget[] = []

  for (const storyboard of storyboards) {
    targets.push({
      key: `storyboard:${storyboard.id}`,
      targetType: 'NovelPromotionStoryboard',
      targetId: storyboard.id,
      types: ['regenerate_storyboard_text', 'insert_panel'],
      resource: 'text',
      hasOutput: !!(storyboard.panels || []).length,
    })
    if (storyboard.episodeId) {
      targets.push({
        key: `episode:${storyboard.episodeId}`,
        targetType: 'NovelPromotionEpisode',
        targetId: storyboard.episodeId,
        types: ['regenerate_storyboard_text', 'insert_panel'],
        resource: 'text',
        hasOutput: !!(storyboard.panels || []).length,
      })
    }
  }

  return targets
}

function buildPanelImageTargets(storyboards: NovelPromotionStoryboard[]): TaskTarget[] {
  const targets: TaskTarget[] = []

  for (const storyboard of storyboards) {
    for (const panel of storyboard.panels || []) {
      targets.push({
        key: `panel-image:${panel.id}`,
        targetType: 'NovelPromotionPanel',
        targetId: panel.id,
        types: ['image_panel', 'panel_variant', 'modify_asset_image'],
        resource: 'image',
        hasOutput: !!panel.imageUrl,
      })
    }
  }

  return targets
}

export function useStoryboardTaskAwareStoryboards({
  projectId,
  initialStoryboards,
  isRunningPhase,
}: UseStoryboardTaskAwareStoryboardsProps) {
  const storyboardTextTargets = useMemo(
    () => buildStoryboardTextTargets(initialStoryboards),
    [initialStoryboards],
  )
  const panelImageTargets = useMemo(
    () => buildPanelImageTargets(initialStoryboards),
    [initialStoryboards],
  )
  const taskTargets = useMemo(
    () => [...storyboardTextTargets, ...panelImageTargets],
    [panelImageTargets, storyboardTextTargets],
  )

  const taskStates = useStoryboardTaskPresentation(
    projectId,
    taskTargets,
    !!projectId && taskTargets.length > 0,
  )

  const taskAwareStoryboards = useMemo(() => {
    return initialStoryboards.map((storyboard) => ({
      ...storyboard,
      storyboardTaskRunning:
        isRunningPhase(taskStates.getTaskState(`storyboard:${storyboard.id}`)?.phase) ||
        isRunningPhase(taskStates.getTaskState(`episode:${storyboard.episodeId}`)?.phase),
      panels: (storyboard.panels || []).map((panel) => {
        const panelImageTaskState = taskStates.getTaskState(`panel-image:${panel.id}`)
        const panelImageRunning = isRunningPhase(panelImageTaskState?.phase)
        return {
          ...panel,
          imageTaskRunning: panelImageRunning,
          imageTaskIntent: panelImageTaskState?.intent,
        }
      }),
    }))
  }, [
    initialStoryboards,
    isRunningPhase,
    taskStates,
  ])

  return {
    taskAwareStoryboards,
  }
}
