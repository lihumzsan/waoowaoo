/**
 * React Query Hooks 统一导出
 * 
 * 使用示例：
 * import { useProjectAssets, useGenerateProjectCharacterImage } from '@/lib/query/hooks'
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
    useGenerateCharacterImage,
    useSelectCharacterImage,
    useUndoCharacterImage,
    useUploadCharacterImage,
    useDeleteCharacter,
    useDeleteCharacterAppearance,
    useGenerateLocationImage,
    useSelectLocationImage,
    useUndoLocationImage,
    useUploadLocationImage,
    useDeleteLocation,
    useUpdateCharacterName,
    useUpdateLocationName,
    useUpdateCharacterAppearanceDescription,
    useUpdateLocationSummary,
    useAiModifyCharacterDescription,
    useAiModifyLocationDescription,
    useAiModifyPropDescription,
    useAiDesignLocation,
    useCreateAssetHubLocation,
    useUploadAssetHubTempMedia,
    useAiDesignCharacter,
    useExtractAssetHubReferenceCharacterDescription,
    useCreateAssetHubCharacter,
    useGenerateAssetHubCharacterFromReference,
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
    useGenerateProjectCharacterImage,
    useRegenerateCharacterGroup,
    useRegenerateSingleCharacterImage,
    useSelectProjectCharacterImage,
    useUndoProjectCharacterImage,
    useUploadProjectCharacterImage,
    useDeleteProjectCharacter,
    useDeleteProjectAppearance,
    useUpdateProjectCharacterName,
    useGenerateProjectLocationImage,
    useRegenerateLocationGroup,
    useRegenerateSingleLocationImage,
    useSelectProjectLocationImage,
    useUndoProjectLocationImage,
    useUploadProjectLocationImage,
    useDeleteProjectLocation,
    useUpdateProjectLocationName,
    useUpdateProjectAppearanceDescription,
    useUpdateProjectLocationDescription,
    useUpdateProjectCharacterIntroduction,
    useAiModifyProjectAppearanceDescription,
    useAiModifyProjectLocationDescription,
    useAiModifyProjectPropDescription,
    useAiCreateProjectLocation,
    useCreateProjectLocation,
    useAiCreateProjectCharacter,
    useUploadProjectTempMedia,
    useExtractProjectReferenceCharacterDescription,
    useCreateProjectCharacter,
    useGenerateProjectCharacterFromReference,
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

export {
    useRenderFinalVideo,
    usePlanBgmDesign,
} from './useFinalMedia'

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
    projectEditBibleQueryOptions,
    useProjectEditBible,
    useProjectEditBibleResponse,
    useProjectEditScript,
    useProjectEditShotExecutionPlan,
    useCreateProjectEditShotExecutionPlan,
    useCreateProjectEditBible,
    useCreateProjectEditScript,
    useConfirmProjectEditBible,
    useReviseProjectEditBible,
    useUpdateProjectEditScriptAssetRequirementDescription,
} from './useProjectEditScript'

export {
    useProjectAssistantThread,
    useProjectAssistantThreadSync,
} from './useProjectAssistantThread'


export {
    useUserModels,
    type UserModelOption as QueryUserModelOption,
    type UserModelsPayload as QueryUserModelsPayload,
} from './useUserModels'
