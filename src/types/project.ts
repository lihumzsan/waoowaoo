import type { CapabilitySelections } from '@/lib/ai-registry/types'
import type { LocationSpatialProfileStatus } from '@/lib/location-spatial-profile/types'

export type ProjectVideoGenerationOptionValue = string | number | boolean
export type ProjectVideoGenerationOptions = Record<string, ProjectVideoGenerationOptionValue>

// ============================================
// 基础项目类型
// ============================================
export interface BaseProject {
  id: string
  name: string
  description: string | null
  userId: string
  createdAt: Date
  updatedAt: Date
}

// ============================================
// 通用资产类型
// ============================================

export interface MediaRef {
  id: string
  publicId: string
  url: string
  mimeType: string | null
  sizeBytes: number | null
  width: number | null
  height: number | null
  durationMs: number | null
}

// 角色形象（独立表）
// 🔥 V6.5: characterId 改为可选以兼容 useProjectAssets 返回的数据
export interface CharacterAppearance {
  id: string
  characterId?: string            // 可选，API 响应可能不包含
  appearanceIndex: number           // 形象序号：0, 1, 2...（0 = 主形象）
  changeReason: string              // "初始形象"、"落水湿身"
  description: string | null
  descriptions: string[] | null     // 3个描述变体
  imageUrl: string | null           // 选中的图片
  media?: MediaRef | null
  imageUrls: string[]               // 候选图片数组
  imageMedias?: MediaRef[]
  previousImageUrl: string | null   // 上一次的图片URL（用于撤回）
  previousMedia?: MediaRef | null
  previousImageUrls: string[]         // 上一次的图片数组（用于撤回）
  previousImageMedias?: MediaRef[]
  previousDescription: string | null  // 上一次的描述（用于撤回）
  previousDescriptions: string[] | null  // 上一次的描述数组（用于撤回）
  selectedIndex: number | null      // 用户选中的图片索引
  // 任务态字段（由 tasks + hook 派生，不再依赖数据库持久化）
  imageTaskRunning?: boolean
  imageErrorMessage?: string | null  // 图片生成错误消息
  lastError?: { code: string; message: string } | null  // 结构化错误（来自 task target state）
}

// 角色
// 🔥 V6.5: aliases 改为可选数组以兼容 useProjectAssets
export interface Character {
  id: string
  name: string
  aliases?: string[] | null         // 可选，别名数组
  introduction?: string | null      // 角色介绍（叙述视角、称呼映射等）
  appearances: CharacterAppearance[]  // 独立表关联
  // 角色档案
  profileData?: string | null             // JSON格式的角色档案
  profileConfirmed?: boolean             // 视觉档案是否已生成
}

// 场景图片（独立表）
// 🔥 V6.5: locationId 改为可选以兼容 useProjectAssets
export interface LocationImage {
  id: string
  locationId?: string               // 可选，API 响应可能不包含
  imageIndex: number              // 图片索引：0, 1, 2
  description: string | null
  imageUrl: string | null
  spatialProfileJson?: unknown | null
  spatialProfileStatus?: LocationSpatialProfileStatus | null
  spatialProfileError?: string | null
  spatialProfileAnalyzedAt?: string | Date | null
  spatialProfileModel?: string | null
  media?: MediaRef | null
  previousImageUrl: string | null // 上一次的图片URL（用于撤回）
  previousMedia?: MediaRef | null
  previousDescription: string | null  // 上一次的描述（用于撤回）
  isSelected: boolean
  // 任务态字段（由 tasks + hook 派生，不再依赖数据库持久化）
  imageTaskRunning?: boolean
  imageErrorMessage?: string | null  // 图片生成错误消息
  lastError?: { code: string; message: string } | null  // 结构化错误（来自 task target state）
}

// 场景
export interface Location {
  id: string
  name: string
  summary: string | null            // 场景简要描述（用途/人物关联）
  selectedImageId?: string | null   // 选中的图片ID（单一真源）
  images: LocationImage[]           // 独立表关联
}

export type PropImage = LocationImage

export interface Prop {
  id: string
  name: string
  summary: string | null
  selectedImageId?: string | null
  images: PropImage[]
}

export interface AssetLibraryCharacter {
  id: string
  name: string
  description: string
  imageUrl: string | null
  media?: MediaRef | null
}

export interface AssetLibraryLocation {
  id: string
  name: string
  description: string
  imageUrl: string | null
  media?: MediaRef | null
}

// ============================================
// 项目工作流类型
// ============================================

export interface ProjectPanel {
  id: string
  storyboardId: string
  panelIndex: number
  panelNumber: number | null
  shotType: string | null
  cameraMove: string | null
  description: string | null
  location: string | null
  characters: string | null
  props: string | null
  srtSegment: string | null
  srtStart: number | null
  srtEnd: number | null
  duration: number | null
  imagePrompt: string | null
  imageUrl: string | null
  candidateImages?: string | null
  media?: MediaRef | null
  imageHistory: string | null
  videoPrompt: string | null
  firstLastFramePrompt?: string | null
  videoUrl: string | null
  videoModel?: string | null
  videoErrorCode?: string | null
  videoErrorMessage?: string | null
  videoGenerationMode?: 'normal' | 'firstlastframe' | null
  lastVideoGenerationOptions?: ProjectVideoGenerationOptions | null
  videoMedia?: MediaRef | null
  linkedToNextPanel?: boolean | null
  sketchImageUrl?: string | null
  sketchImageMedia?: MediaRef | null
  previousImageUrl?: string | null
  previousImageMedia?: MediaRef | null
  sourceShotNumber?: number | null
  sourceGenerationSegmentId?: string | null
  executionSnapshotJson?: unknown | null
  renderFactsJson?: unknown | null
  actingNotes: string | null        // 演技指导数据JSON
  // 任务态字段（由 tasks + hook 派生，不再依赖数据库持久化）
  imageTaskRunning?: boolean
  videoTaskRunning?: boolean
  imageErrorMessage?: string | null  // 图片生成错误消息
}

export interface ProjectStoryboard {
  id: string
  episodeId: string
  editScriptId: string | null
  createdAt?: string | Date
  updatedAt?: string | Date
  storyboardTextJson: string | null
  panelCount: number
  storyboardImageUrl: string | null
  media?: MediaRef | null
  storyboardTaskRunning?: boolean
  candidateImages?: string | null
  lastError?: string | null  // 最后一次生成失败的错误信息
  photographyPlan?: string | null  // 摄影方案JSON
  panels?: ProjectPanel[]
}

export type ProjectEditAssetKind = 'character' | 'location'
export type ProjectEditAssetStatus = 'pending' | 'generating' | 'completed' | 'failed'

export interface ProjectEditScriptShot {
  shotNumber: number
  durationSec: number
  scene: { name: string }
  action: string
  characters: Array<{
    name: string
    visibility: 'visible' | 'partial' | 'hidden' | 'occluded' | 'offscreen'
    role: 'focus' | 'supporting' | 'listener' | 'hidden_subject' | 'background'
    performance: string
  }>
  keyObjects: Array<{
    name: string
    role: string
  }>
  sound: string
}

export interface ProjectEditAssetRequirement {
  id: string
  kind: ProjectEditAssetKind
  name: string
  description: string
  shotNumbers: number[]
  status: ProjectEditAssetStatus
  targetId: string | null
  taskTargetType?: 'CharacterAppearance' | 'LocationImage' | null
  taskTargetId?: string | null
  errorMessage: string | null
  previewImageUrl?: string | null
  spatialProfileJson?: unknown | null
  spatialProfileStatus?: LocationSpatialProfileStatus | null
  spatialProfileError?: string | null
  spatialProfileAnalyzedAt?: string | Date | null
  spatialProfileModel?: string | null
}

export interface ProjectEditScreenplay {
  id: string
  projectId: string
  episodeId: string
  userPrompt: string
  styleBible?: unknown
  stylePreviews?: ProjectEditStylePreview[]
  screenplayText: string
  status: string
}

export interface ProjectEditStylePreview {
  id: string
  projectId: string
  episodeId: string
  screenplayId: string
  styleKey: `style_${'a' | 'b' | 'c'}` | `style_${'a' | 'b' | 'c'}_${number}`
  aspectRatio: '9:16' | '16:9' | '21:9'
  title: string
  summary: string
  styleBible: unknown
  gridImagePrompt: string
  imageKey: string | null
  imageUrl: string | null
  status: 'pending' | 'generating' | 'completed' | 'confirmed' | 'failed'
  taskId: string | null
  errorMessage: string | null
}

export interface ProjectEditShotExecutionPlan {
  id: string
  projectId: string
  episodeId: string
  editScriptId: string
  status: string
  shots: {
    shotNumber: number
    camera: {
      shotScale: string
      lens: string
      focus: string
      height: string
      position: string
      angle: string
      movement: string
      composition: string
      lighting: string
    }
    blocking: {
      axis: {
        type: string
        subjects: string[]
        screenDirection: string
      }
      characters: Array<{
        name: string
        visibility: 'visible' | 'partial' | 'hidden' | 'occluded' | 'offscreen'
        position: string
        screenPosition: string
        facing: string
        eyeline: string
      }>
      objects: Array<{
        name: string
        position: string
        screenPosition: string
      }>
      spatialNote: string
    }
  }[]
}

export interface ProjectEditScript {
  id: string
  projectId: string
  episodeId: string
  screenplayId?: string
  userPrompt?: string
  styleBible?: unknown
  screenplayText?: string | null
  durationSec: number
  shotCount: number
  status: string
  assetReviewStatus: 'pending' | 'approved'
  shots: ProjectEditScriptShot[]
  generationSegments: ProjectEditScriptGenerationSegment[]
  requirements: ProjectEditAssetRequirement[]
}

export interface ProjectEditScriptGenerationSegment {
  shotNumbers: number[]
  continuity: string
}

export type ProjectBgmScoreStatus = 'pending' | 'generating' | 'completed' | 'failed'

export interface ProjectBgmScoreTimedTextSection {
  category?: string | null
  title: string
  purpose?: string | null
  startSec?: number | null
  endSec?: number | null
  content: string
}

export interface ProjectBgmScoreVirtualLayer {
  name: string
  purpose: string
  content: string
}

export interface ProjectBgmScorePlan {
  durationSeconds: number
  creativeBrief: {
    cueType: string
    genre: string
    mood: string
    narrativeFunction: string
  }
  scoreDesign: {
    overview: string
    sections: ProjectBgmScoreTimedTextSection[]
  }
  virtualLayers: ProjectBgmScoreVirtualLayer[]
  promptSections: ProjectBgmScoreTimedTextSection[]
  finalPrompt: string
}

export interface ProjectBgmScore {
  schemaVersion: number
  status: ProjectBgmScoreStatus
  taskId: string
  editScriptId: string
  timelineSignature: string
  durationSeconds: number
  musicModel: string
  plan?: ProjectBgmScorePlan
  mix?: {
    mediaId: string
    url: string
    storageKey: string
    mimeType: string
    durationMs: number
  } | null
  errorMessage?: string | null
}

export interface ProjectFinalVideo {
  id: string
  episodeId: string
  renderStatus: string | null
  renderTaskId: string | null
  outputUrl: string | null
  updatedAt: string | null
  bgmScore?: ProjectBgmScore | null
}

export interface ProjectVideoGroup {
  id: string
  projectId: string
  episodeId: string
  gridMode: '2x2' | '3x3' | string
  shotNumbers: number[] | unknown
  durationSec: number
  prompt: string | null
  status: string
  taskId: string | null
  errorCode: string | null
  errorMessage: string | null
  referenceImageUrl: string | null
  referenceImageMedia?: MediaRef | null
  videoUrl: string | null
  videoMedia?: MediaRef | null
}

export interface ProjectEpisodeSummary {
  id: string
  episodeNumber: number
  name: string
  description: string | null
  novelText: string | null
  audioUrl: string | null
  media?: MediaRef | null
  srtContent: string | null
  createdAt: Date
  updatedAt: Date
  editScript?: ProjectEditScript | null
  finalVideo?: ProjectFinalVideo | null
  videoGroups?: ProjectVideoGroup[]
}

export interface ProjectWorkflowData {
  globalAssetText: string | null
  analysisModel: string | null
  imageModel: string | null
  characterModel: string | null
  locationModel: string | null
  storyboardModel: string | null
  editModel: string | null
  videoModel: string | null
  singleShotVideoModel: string | null
  sequenceVideoModel: string | null
  musicModel: string | null
  videoRatio: string | null
  capabilityOverrides?: CapabilitySelections | string | null
  videoResolution?: string | null
  imageResolution?: string | null
  lastEpisodeId?: string | null
  importStatus?: string | null
  characters?: Character[]
  locations?: Location[]
  props?: Prop[]
  episodes?: ProjectEpisodeSummary[]
  storyboards?: ProjectStoryboard[]
  videoGroups?: ProjectVideoGroup[]
}

// ============================================
// 完整项目类型
// ============================================
export interface Project extends BaseProject, ProjectWorkflowData {}
