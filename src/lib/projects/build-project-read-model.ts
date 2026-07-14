import type {
  Character,
  Location,
  ProjectEpisodeSummary,
  ProjectWorkflowData,
  Prop,
  ProjectVideoSegment,
} from '@/types/project'

type ProjectLikeRecord = {
  id: string
  name: string
  userId: string
} & Record<string, unknown>

type ProjectRecord = Record<string, unknown>

type ProjectLocationLike = ProjectRecord & {
  assetKind?: string | null
}

type ProjectWorkflowSource = {
  globalAssetText?: string | null
  analysisModel?: string | null
  imageModel?: string | null
  characterModel?: string | null
  locationModel?: string | null
  editModel?: string | null
  videoModel?: string | null
  musicModel?: string | null
  soundEffectModel?: string | null
  videoRatio?: string | null
  capabilityOverrides?: ProjectWorkflowData['capabilityOverrides']
  videoResolution?: string | null
  imageResolution?: string | null
  lastEpisodeId?: string | null
  characters?: ProjectRecord[]
  locations?: ProjectLocationLike[]
  episodes?: ProjectRecord[]
  videoSegments?: ProjectRecord[]
}

function splitProjectLocations(locations: ProjectLocationLike[] | undefined): Pick<ProjectWorkflowData, 'locations' | 'props'> {
  const source = locations || []
  return {
    locations: source.filter((item) => item.assetKind !== 'prop') as unknown as Location[],
    props: source.filter((item) => item.assetKind === 'prop') as unknown as Prop[],
  }
}

function buildProjectWorkflowData(source: ProjectWorkflowSource): ProjectWorkflowData {
  const assets = splitProjectLocations(source.locations)

  return {
    globalAssetText: source.globalAssetText ?? null,
    analysisModel: source.analysisModel ?? null,
    imageModel: source.imageModel ?? null,
    characterModel: source.characterModel ?? null,
    locationModel: source.locationModel ?? null,
    editModel: source.editModel ?? null,
    videoModel: source.videoModel ?? null,
    musicModel: source.musicModel ?? null,
    soundEffectModel: source.soundEffectModel ?? null,
    videoRatio: source.videoRatio ?? null,
    capabilityOverrides: source.capabilityOverrides ?? null,
    videoResolution: source.videoResolution ?? null,
    imageResolution: source.imageResolution ?? null,
    lastEpisodeId: source.lastEpisodeId ?? null,
    characters: (source.characters || []) as unknown as Character[],
    locations: assets.locations || [],
    props: assets.props || [],
    episodes: (source.episodes || []) as unknown as ProjectEpisodeSummary[],
    videoSegments: (source.videoSegments || []) as unknown as ProjectVideoSegment[],
  }
}

export function buildProjectReadModel<TProject extends ProjectLikeRecord>(
  project: TProject,
  workflow: ProjectWorkflowSource,
): TProject & ProjectWorkflowData {
  return {
    ...project,
    ...buildProjectWorkflowData(workflow),
  }
}
