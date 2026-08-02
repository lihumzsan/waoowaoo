/**
 * 统一的 Query Keys 定义
 * 所有缓存 key 在此集中管理，避免不一致
 */
const globalAssetsRoot = () => ['global-assets'] as const
const unifiedAssetsRoot = () => [...globalAssetsRoot(), 'unified'] as const

export const queryKeys = {
    assets: {
        all: () => unifiedAssetsRoot(),
        list: (params: {
            folderId?: string | null
            kind?: 'character' | 'location' | 'prop' | null
        }) => [
            ...unifiedAssetsRoot(),
            params.folderId ?? '',
            params.kind ?? '',
        ] as const,
    },

    // ============ 中心资产库（Asset Hub）============
    globalAssets: {
        all: globalAssetsRoot,
        characters: (folderId?: string | null) =>
            folderId ? ['global-assets', 'characters', folderId] as const : ['global-assets', 'characters'] as const,
        locations: (folderId?: string | null) =>
            folderId ? ['global-assets', 'locations', folderId] as const : ['global-assets', 'locations'] as const,
        folders: () => ['global-assets', 'folders'] as const,
    },

    // ============ 用户模型 ============
    userModels: {
        all: () => ['user-models'] as const,
    },

    operationPlans: {
        all: (projectId: string) =>
            ['operation-plan-preview', projectId] as const,
        preview: (projectId: string, operationId: string, inputKey: string) =>
            ['operation-plan-preview', projectId, operationId, inputKey] as const,
    },

    // ============ 任务轮询 ============
    tasks: {
        all: (projectId: string) => ['tasks', projectId] as const,
        target: (projectId: string, targetType: string, targetId: string) =>
            ['tasks', projectId, targetType, targetId] as const,
        snapshot: (projectId: string, targetType: string, targetId: string, typeKey: string) =>
            ['tasks', projectId, targetType, targetId, 'snapshot', typeKey] as const,
        targetStatesAll: (projectId: string) =>
            ['task-target-states', projectId] as const,
        targetStates: (projectId: string, serializedTargets: string) =>
            ['task-target-states', projectId, serializedTargets] as const,
        targetStateOverlay: (projectId: string) =>
            ['task-target-states-overlay', projectId] as const,
    },

    // ============ 项目数据 ============
    project: {
        canvasLayout: (projectId: string, folderKey: string) =>
            ['project', projectId, 'canvas-layout', folderKey] as const,
        workspaceResourcesAll: (projectId: string) =>
            ['project', projectId, 'workspace-resources'] as const,
        workspaceResources: (projectId: string) =>
            ['project', projectId, 'workspace-resources'] as const,
        assistantThread: (projectId: string) =>
            ['project', projectId, 'assistant-thread'] as const,
    },

    // ============ 顶层便捷函数 ============
    /**
     * 项目基础数据
     */
    projectData: (projectId: string) => ['project-data', projectId] as const,

} as const

/**
 * 类型导出，用于类型推断
 */
export type QueryKeys = typeof queryKeys
