import type { CapabilitySelections } from '@/lib/ai-registry/types'

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

export type ProjectEditAssetKind = 'character' | 'location'
export type ProjectEditAssetStatus = 'pending' | 'generating' | 'completed' | 'failed'

export interface ProjectEditScriptShot {
  shotId: string
  shotNumber: number
  shotPurpose: 'establishing' | 'action' | 'reaction' | 'insert' | 'atmosphere' | 'transition'
  durationSec: number
  scene: {
    locationId: string
    name: string
    subScene: string
  }
  action: string
  characters: Array<{
    characterId: string
    name: string
    performance: string
  }>
  dialogue: Array<{
    characterId: string
    line: string
  }>
  synchronousSound: string
}

export interface ProjectEditAssetRequirement {
  id: string
  kind: ProjectEditAssetKind
  name: string
  description: string
  shotIds: string[]
  status: ProjectEditAssetStatus
  targetId: string | null
  taskTargetType?: 'CharacterAppearance' | 'LocationImage' | null
  taskTargetId?: string | null
  errorMessage: string | null
  previewImageUrl?: string | null
}

export interface ProjectEditBible {
  id: string
  projectId: string
  episodeId: string
  sourceDocumentId?: string
  sourceKind?: string
  sourceText?: string | null
  version?: number
  status: string
  lockedAt?: string | Date | null
  generationTaskId?: string | null
  bible?: unknown | null
  beatSheet?: unknown | null
  ledger?: unknown | null
  emotionalCurve?: unknown | null
  diagnostics?: unknown | null
  scriptStructure?: unknown | null
  styleBible?: unknown
  stylePreviews?: ProjectEditStylePreview[]
  textPreview?: string | null
  bibleText?: string | null
  userPrompt?: string
  chapters?: ProjectEditChapter[]
  createdAt?: string | Date
  updatedAt?: string | Date
}

export interface ProjectEditChapter {
  id: string
  chapterIndex: number
  title: string
  summary: string
  sourceStart: number
  sourceEnd: number
  targetDurationSec: number
  beatIds: string[]
  eventIds: string[]
  status: string
  renderStatus?: string | null
  outputMediaId?: string | null
}

export interface ProjectEditStylePreview {
  id: string
  projectId: string
  episodeId: string
  bibleId?: string
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
  chapterId?: string
  editScriptId: string
  status: string
  generationTaskId?: string | null
  generationSegments: Array<{
    segmentId: string
    shots: Array<{
      shotId: string
      shotNumber: number
      shotScale: string
      cameraMovement: {
        movement: string
        stability: 'locked' | 'stable' | 'smooth' | 'subtle_shake' | 'handheld'
      }
    }>
  }>
}

export interface ProjectEditScript {
  id: string
  projectId: string
  episodeId: string
  chapterId?: string
  bibleId?: string
  sourceDocumentId?: string
  sourceStart?: number
  sourceEnd?: number
  userPrompt?: string
  styleBible?: unknown
  sourceText?: string | null
  bibleText?: string | null
  durationSec: number
  shotCount: number
  status: string
  generationTaskId?: string | null
  assetReviewStatus: 'pending' | 'approved'
  shots: ProjectEditScriptShot[]
  generationSegments: ProjectEditScriptGenerationSegment[]
  requirements: ProjectEditAssetRequirement[]
}

export interface ProjectEditScriptGenerationSegment {
  videoSegmentId: string
  segmentId: string
  shotIds: string[]
  continuity: string
}

export type ProjectMusicScoreStatus = 'pending' | 'planning' | 'planned' | 'generating' | 'completed' | 'failed'

export interface ProjectMusicScore {
  id?: string | null
  status: ProjectMusicScoreStatus
  taskId?: string | null
  timelineSignature?: string | null
  designSignature?: string | null
  durationSeconds?: number | null
  musicModel?: string | null
  cues?: unknown
  mix?: {
    mediaId: string
    url: string
    storageKey: string
    mimeType: string
    durationMs: number
  } | null
  diagnostics?: unknown
  errorMessage?: string | null
}

export interface ProjectFinalVideo {
  /** Null until a real final render record exists; BGM resources remain independently projectable. */
  id: string | null
  episodeId: string
  renderStatus: string | null
  renderTaskId: string | null
  outputUrl: string | null
  updatedAt: string | null
  musicScore?: ProjectMusicScore | null
  bgmDesign?: {
    id: string | null
    status: string
    taskId: string | null
    timelineSignature: string | null
    designSignature: string | null
    analysisModel: string | null
    musicModel: string | null
    design: unknown
    diagnostics: unknown
    updatedAt: string | null
  } | null
}

export interface ProjectVideoSegment {
  id: string
  projectId: string
  episodeId: string
  chapterId: string
  editScriptId: string
  segmentId: string
  inputSignature: string
  durationSec: number
  status: string
  generationTaskId: string | null
  errorMessage: string | null
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
  videoSegments?: ProjectVideoSegment[]
}

export interface ProjectWorkflowData {
  globalAssetText: string | null
  analysisModel: string | null
  imageModel: string | null
  characterModel: string | null
  locationModel: string | null
  editModel: string | null
  videoModel: string | null
  musicModel: string | null
  videoRatio: string | null
  capabilityOverrides?: CapabilitySelections | string | null
  videoResolution?: string | null
  imageResolution?: string | null
  lastEpisodeId?: string | null
  characters?: Character[]
  locations?: Location[]
  props?: Prop[]
  episodes?: ProjectEpisodeSummary[]
  videoSegments?: ProjectVideoSegment[]
}

// ============================================
// 完整项目类型
// ============================================
export interface Project extends BaseProject, ProjectWorkflowData {}
