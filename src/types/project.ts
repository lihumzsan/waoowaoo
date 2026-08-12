// ============================================
// 基础项目类型
// ============================================
export interface BaseProject {
  id: string
  name: string
  description: string | null
  userId: string
  videoRatio: string | null
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

export type Project = BaseProject
