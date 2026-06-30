/**
 * Mutations 模块导出
 */

// ==================== Asset Hub (全局资产) ====================
export {
    // 角色相关
    useGenerateCharacterImage,
    useSelectCharacterImage,
    useUndoCharacterImage,
    useUploadCharacterImage,
    useDeleteCharacter,
    useDeleteCharacterAppearance,
    // 场景相关
    useGenerateLocationImage,
    useSelectLocationImage,
    useUndoLocationImage,
    useUploadLocationImage,
    useDeleteLocation,
    // 编辑相关
    useUpdateCharacterName,
    useUpdateLocationName,
    useUpdateCharacterAppearanceDescription,
    useUpdateLocationSummary,
    useAiModifyCharacterDescription,
    useAiModifyLocationDescription,
    useAiModifyPropDescription,
    useUploadAssetHubTempMedia,
    useAiDesignCharacter,
    useExtractAssetHubReferenceCharacterDescription,
    useCreateAssetHubCharacter,
} from './useAssetHubMutations'

// ==================== Project (项目资产) ====================
export * from './useCharacterMutations'
export * from './useLocationMutations'
export * from './useStoryboardMutations'
export * from './useVideoMutations'
export * from './useProjectConfigMutations'
export * from './useEpisodeMutations'
