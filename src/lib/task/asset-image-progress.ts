import { TASK_TYPE } from './types'
import type { EstimatedTaskProgressSource } from '@/lib/query/hooks/useEstimatedTaskProgress'

/**
 * 由资产图片(角色 / 场景 / 道具)的运行态构造统一的进度来源。
 * 让资产图片复用系统唯一进度来源(useEstimatedTaskProgress / calculateEstimatedTaskProgress),
 * 与画布上的分镜 / 图片 / 视频共用同一套加载 UI。
 *
 * 返回 null 表示既未运行也未失败 —— 加载组件据此不渲染。
 */
export function buildAssetImageProgressSource(input: {
  readonly assetKind: 'character' | 'location'
  readonly targetId: string
  readonly running: boolean
  readonly failed?: boolean
}): EstimatedTaskProgressSource | null {
  if (!input.running && !input.failed) return null
  return {
    phase: input.running ? 'processing' : 'failed',
    runningTaskType:
      input.assetKind === 'character' ? TASK_TYPE.IMAGE_CHARACTER : TASK_TYPE.IMAGE_LOCATION,
    targetType: input.assetKind === 'character' ? 'asset-character-image' : 'asset-location-image',
    targetId: input.targetId,
  }
}
