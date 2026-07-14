/**
 * 统一的 Query Keys 定义
 * 所有缓存 key 在此集中管理，避免不一致
 */
const globalAssetsRoot = () => ['global-assets'] as const
const projectAssetsRoot = (projectId: string) => ['project-assets', projectId] as const
const unifiedAssetsRoot = (
    scope: 'global' | 'project',
    projectId?: string | null,
) => scope === 'global'
    ? [...globalAssetsRoot(), 'unified'] as const
    : [...projectAssetsRoot(projectId ?? ''), 'unified'] as const

export const queryKeys = {
    assets: {
        all: (scope: 'global' | 'project', projectId?: string | null) =>
            unifiedAssetsRoot(scope, projectId),
        list: (params: {
            scope: 'global' | 'project'
            projectId?: string | null
            folderId?: string | null
            kind?: 'character' | 'location' | 'prop' | null
        }) => [
            ...unifiedAssetsRoot(params.scope, params.projectId),
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

    // ============ 项目资产 ============
    projectAssets: {
        all: projectAssetsRoot,
        characters: (projectId: string) => ['project-assets', projectId, 'characters'] as const,
        locations: (projectId: string) => ['project-assets', projectId, 'locations'] as const,
        detail: (projectId: string) => ['project-assets', projectId, 'detail'] as const,
    },

    // ============ 视频片段 ============
    videoSegments: {
        all: (episodeId: string) => ['video-segments', episodeId] as const,
    },

    // ============ 用户模型 ============
    userModels: {
        all: () => ['user-models'] as const,
    },

    operationPlans: {
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
        pending: (projectId: string, episodeId?: string) =>
            episodeId
                ? ['pending-tasks', projectId, episodeId] as const
                : ['pending-tasks', projectId] as const,
    },

    // ============ 项目数据 ============
    project: {
        detail: (projectId: string) => ['project', projectId] as const,
        episodes: (projectId: string) => ['project', projectId, 'episodes'] as const,
        data: (projectId: string) => ['project', projectId, 'data'] as const,
        canvasLayout: (projectId: string, episodeId: string) =>
            ['project', projectId, 'canvas-layout', episodeId] as const,
        context: (projectId: string, episodeId?: string | null, contextScope?: string | null) =>
            ['project', projectId, 'context', episodeId ?? '', contextScope ?? ''] as const,
        assistantThread: (projectId: string, episodeId?: string | null) =>
            ['project', projectId, 'assistant-thread', episodeId ?? ''] as const,
        editBible: (projectId: string, episodeId: string) =>
            ['project', projectId, 'edit-bible', episodeId] as const,
        editScript: (projectId: string, episodeId: string) =>
            ['project', projectId, 'edit-script', episodeId] as const,
        editShotExecutionPlan: (projectId: string, episodeId: string) =>
            ['project', projectId, 'edit-shot-execution-plan', episodeId] as const,
    },

    // ============ 顶层便捷函数 ============
    /**
     * 项目基础数据
     */
    projectData: (projectId: string) => ['project-data', projectId] as const,

    /**
     * 剧集详情数据
     */
    episodeData: (projectId: string, episodeId: string) =>
        ['episode-data', projectId, episodeId] as const,
} as const

/**
 * 类型导出，用于类型推断
 */
export type QueryKeys = typeof queryKeys
