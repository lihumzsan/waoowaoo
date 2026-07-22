import type { ProjectPolicySnapshot } from '@/lib/project-context/types'
import type { CreativeResourceCardView } from '@/lib/creative-resource/contracts'

export interface ProjectProjectionResourceSummary {
  totalCount: number
  readyCount: number
  failedCount: number
}

export interface ProjectProjectionLite {
  projectId: string
  projectName: string
  episodeId?: string | null
  episodeName?: string | null
  selectedScopeRef?: string | null
  policy: ProjectPolicySnapshot
  resources: ProjectProjectionResourceSummary
}

export interface ProjectProjectionFull extends ProjectProjectionLite {
  creativeResources: CreativeResourceCardView[]
}
