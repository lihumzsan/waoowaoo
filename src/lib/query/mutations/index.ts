/**
 * Mutations 模块导出
 */

// ==================== Asset Hub (全局资产) ====================
export {
    // 角色相关
    useSelectCharacterImage,
    useUndoCharacterImage,
    useUploadCharacterImage,
    useDeleteCharacter,
    useDeleteCharacterAppearance,
    // 场景相关
    useSelectLocationImage,
    useUndoLocationImage,
    useUploadLocationImage,
    useDeleteLocation,
    // 编辑相关
    useUpdateCharacterName,
    useUpdateLocationName,
    useUpdateCharacterAppearanceDescription,
    useUpdateLocationSummary,
    useUploadAssetHubTempMedia,
    useCreateAssetHubCharacter,
} from './useAssetHubMutations'
