import type {
  ProjectPolicySnapshot,
} from '@/lib/project-context/types'

export interface ProjectProjectionProgress {
  storyboardCount: number
  panelCount: number
}

export interface ProjectProjectionLite {
  projectId: string
  projectName: string
  episodeId?: string | null
  episodeName?: string | null
  selectedScopeRef?: string | null
  policy: ProjectPolicySnapshot
  progress: ProjectProjectionProgress
}

export interface ProjectProjectionPanelSnapshot {
  panelId: string
  editScriptId: string | null
  storyboardId: string
  panelIndex: number
  panelNumber: number | null
  shotType: string | null
  cameraMove: string | null
  description: string | null
  location: string | null
  characters: string | null
  props: string | null
  duration: number | null
  imagePrompt: string | null
  imageUrl: string | null
  imageMediaId: string | null
  candidateImages: string | null
  videoPrompt: string | null
  videoUrl: string | null
  lastVideoGenerationOptions: Record<string, string | number | boolean> | null
  videoMediaId: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectProjectionFull extends ProjectProjectionLite {
  episodeDetail: null | {
    panels: ProjectProjectionPanelSnapshot[]
    panelLimit: number
    totalPanelCount: number
    truncated: boolean
  }
}
