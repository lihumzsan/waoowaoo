/**
 * React Query Hooks 统一导出
 * 
 * 使用示例：
 * import { useProjectAssets } from '@/lib/query/hooks'
 */

// 中心资产库
export {
    useAssets,
    useAssetActions,
    useRefreshAssets,
} from './useAssets'

export {
    useGlobalCharacters,
    useGlobalLocations,
    useGlobalProps,
    useGlobalFolders,
    useCreateFolder,
    useUpdateFolder,
    useDeleteFolder,
    useRefreshGlobalAssets,
    type GlobalCharacter,
    type GlobalCharacterAppearance,
    type GlobalLocation,
    type GlobalLocationImage,
    type GlobalProp,
    type GlobalFolder,
} from './useGlobalAssets'
export {
    useSelectCharacterImage,
    useUndoCharacterImage,
    useUploadCharacterImage,
    useDeleteCharacter,
    useDeleteCharacterAppearance,
    useSelectLocationImage,
    useUndoLocationImage,
    useUploadLocationImage,
    useDeleteLocation,
    useUpdateCharacterName,
    useUpdateLocationName,
    useUpdateCharacterAppearanceDescription,
    useUpdateLocationSummary,
    useCreateAssetHubLocation,
    useUploadAssetHubTempMedia,
    useCreateAssetHubCharacter,
} from '../mutations/useAssetHubMutations'

// 项目资产
export {
    useProjectAssets,
    useProjectCharacters,
    useProjectLocations,
    useProjectProps,
    useRefreshProjectAssets,
    type ProjectAssetsData,
} from './useProjectAssets'
export {
    useSelectProjectCharacterImage,
    useUndoProjectCharacterImage,
    useUploadProjectCharacterImage,
    useDeleteProjectCharacter,
    useDeleteProjectAppearance,
    useUpdateProjectCharacterName,
    useSelectProjectLocationImage,
    useUndoProjectLocationImage,
    useUploadProjectLocationImage,
    useDeleteProjectLocation,
    useUpdateProjectLocationName,
    useUpdateProjectAppearanceDescription,
    useUpdateProjectLocationDescription,
    useUpdateProjectCharacterIntroduction,
    useCreateProjectLocation,
    useUploadProjectTempMedia,
    useCreateProjectCharacter,
    useCreateProjectCharacterAppearance,
    useCopyProjectAssetFromGlobal,
    useUpdateProjectConfig,
    useUpdateProjectEpisodeField,
    useConfirmProjectCharacterSelection,
    useConfirmProjectLocationSelection,
    useDownloadRemoteBlob,
} from '../mutations/useProjectMutations'

export type {
    Character,
    CharacterAppearance,
    Location,
    LocationImage,
    Prop,
    PropImage,
} from '@/types/project'

// 实时任务
export {
    useSSE,
} from './useSSE'

export {
    useAssetTaskPresentation,
    useVideoTaskPresentation,
    type TaskPresentationTarget,
} from './useTaskPresentation'

// 项目数据
export {
    useProjectData,
    useRefreshProjectData,
    useEpisodeData,
    useEpisodes,
    useRefreshEpisodeData,
    useRefreshAll,
    type Episode,
} from './useProjectData'

export {
    useProjectContext,
} from './useProjectContext'

export {
    useCreativeResources,
} from './useCreativeResources'

export {
    projectEditBibleQueryOptions,
    useProjectEditBible,
    useProjectEditBibleResponse,
} from './useProjectBible'

export {
    useProjectAssistantThread,
    useProjectAssistantThreadSync,
} from './useProjectAssistantThread'


export {
    useUserModels,
    type UserModelOption as QueryUserModelOption,
    type UserModelsPayload as QueryUserModelsPayload,
} from './useUserModels'
