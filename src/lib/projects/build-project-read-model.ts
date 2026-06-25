import type {
  Character,
  Location,
  ProjectEpisodeSummary,
  ProjectWorkflowData,
  Prop,
  ProjectShot,
  ProjectStoryboard,
  ProjectVideoGroup,
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
  storyboardModel?: string | null
  editModel?: string | null
  videoModel?: string | null
  singleShotVideoModel?: string | null
  sequenceVideoModel?: string | null
  musicModel?: string | null
  videoRatio?: string | null
  capabilityOverrides?: ProjectWorkflowData['capabilityOverrides']
  videoResolution?: string | null
  imageResolution?: string | null
  lastEpisodeId?: string | null
  importStatus?: string | null
  characters?: ProjectRecord[]
  locations?: ProjectLocationLike[]
  episodes?: ProjectRecord[]
  storyboards?: ProjectRecord[]
  shots?: ProjectRecord[]
  videoGroups?: ProjectRecord[]
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
    storyboardModel: source.storyboardModel ?? null,
    editModel: source.editModel ?? null,
    videoModel: source.videoModel ?? null,
    singleShotVideoModel: source.singleShotVideoModel ?? source.videoModel ?? null,
    sequenceVideoModel: source.sequenceVideoModel ?? null,
    musicModel: source.musicModel ?? null,
    videoRatio: source.videoRatio ?? null,
    capabilityOverrides: source.capabilityOverrides ?? null,
    videoResolution: source.videoResolution ?? null,
    imageResolution: source.imageResolution ?? null,
    lastEpisodeId: source.lastEpisodeId ?? null,
    importStatus: source.importStatus ?? null,
    characters: (source.characters || []) as unknown as Character[],
    locations: assets.locations || [],
    props: assets.props || [],
    episodes: (source.episodes || []) as unknown as ProjectEpisodeSummary[],
    storyboards: (source.storyboards || []) as unknown as ProjectStoryboard[],
    shots: (source.shots || []) as unknown as ProjectShot[],
    videoGroups: (source.videoGroups || []) as unknown as ProjectVideoGroup[],
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
