export type VideoGenerationOptionValue = string | number | boolean
export type VideoGenerationOptions = Record<string, VideoGenerationOptionValue>

export interface BatchVideoGenerationPlanParams {
  episodeId: string
  generationOptions?: VideoGenerationOptions
  mode?: 'single' | 'grid' | 'auto' | 'asset-reference'
  gridMode?: '2x2' | '3x3'
  shotNumbers?: readonly number[]
  segmentIndex?: number
  referenceImageUrls?: readonly string[]
}

export interface BatchVideoGenerationPlanRequest {
  operationId: string
  input: {
    all: boolean
    episodeId: string
    generationOptions?: VideoGenerationOptions
    mode?: 'single' | 'grid' | 'auto' | 'asset-reference'
    gridMode?: '2x2' | '3x3'
    shotNumbers?: readonly number[]
    segmentIndex?: number
    referenceImageUrls?: readonly string[]
  }
}

export function resolveBatchVideoGenerationOperationId(params: {
  all?: boolean
  mode?: 'single' | 'grid' | 'auto' | 'asset-reference'
}): string {
  if (params.mode === 'auto') return 'generate_episode_videos_auto'
  if (params.mode === 'asset-reference') {
    return params.all === true ? 'generate_episode_asset_reference_videos' : 'generate_asset_reference_video'
  }
  if (params.mode === 'grid') {
    return params.all === true ? 'generate_episode_video_groups' : 'generate_video_group'
  }
  return params.all === true ? 'generate_episode_videos' : 'generate_panel_video'
}

export function buildBatchVideoGenerationPlanRequest(params: BatchVideoGenerationPlanParams): BatchVideoGenerationPlanRequest {
  const all = !(
    (params.mode === 'grid' && Array.isArray(params.shotNumbers) && params.shotNumbers.length > 0)
    || (params.mode === 'asset-reference' && typeof params.segmentIndex === 'number')
  )
  const input: BatchVideoGenerationPlanRequest['input'] = {
    all,
    episodeId: params.episodeId,
  }
  if (params.mode === 'grid' || params.mode === 'auto' || params.mode === 'asset-reference') {
    input.mode = params.mode
  }
  if (params.mode === 'grid') {
    input.gridMode = params.gridMode === '3x3' ? '3x3' : '2x2'
    if (Array.isArray(params.shotNumbers) && params.shotNumbers.length > 0) {
      input.shotNumbers = params.shotNumbers
    }
  }
  if (typeof params.segmentIndex === 'number') input.segmentIndex = params.segmentIndex
  if (Array.isArray(params.referenceImageUrls) && params.referenceImageUrls.length > 0) {
    input.referenceImageUrls = params.referenceImageUrls
  }
  if (params.generationOptions && typeof params.generationOptions === 'object') {
    input.generationOptions = params.generationOptions
  }
  return {
    operationId: resolveBatchVideoGenerationOperationId({
      all: input.all,
      mode: input.mode,
    }),
    input,
  }
}
