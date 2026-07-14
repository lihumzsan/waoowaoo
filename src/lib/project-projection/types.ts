import type { ProjectPolicySnapshot } from '@/lib/project-context/types'

export interface ProjectProjectionProgress {
  plannedVideoSegmentCount: number
  completedVideoSegmentCount: number
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

export interface ProjectProjectionVideoSegmentSnapshot {
  id: string
  editScriptId: string
  chapterId: string
  segmentId: string
  inputSignature: string
  durationSec: number
  status: string
  generationTaskId: string | null
  errorMessage: string | null
  videoMediaId: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectProjectionFull extends ProjectProjectionLite {
  episodeDetail: null | {
    videoSegments: ProjectProjectionVideoSegmentSnapshot[]
  }
}
