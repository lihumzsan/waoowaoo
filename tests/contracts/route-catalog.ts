export type RouteCategory =
  | 'assets'
  | 'asset-hub'
  | 'projects'
  | 'tasks'
  | 'user'
  | 'auth'
  | 'payments'
  | 'infra'
  | 'system'

export type RouteContractGroup =
  | 'llm-observe-routes'
  | 'direct-submit-routes'
  | 'crud-assets-routes'
  | 'crud-asset-hub-routes'
  | 'task-infra-routes'
  | 'user-project-routes'
  | 'auth-routes'
  | 'payment-routes'
  | 'infra-routes'

export type RouteCatalogEntry = {
  routeFile: RouteFile
  category: RouteCategory
  contractGroup: RouteContractGroup
  access: 'protected' | 'public'
}

export const ROUTE_FILES = [
  'src/app/api/admin/credits/grant/route.ts',
  'src/app/api/admin/download-logs/route.ts',
  'src/app/api/assistant/text-attachments/route.ts',
  'src/app/api/asset-hub/ai-design-character/route.ts',
  'src/app/api/asset-hub/ai-design-location/route.ts',
  'src/app/api/asset-hub/ai-modify-character/route.ts',
  'src/app/api/asset-hub/ai-modify-location/route.ts',
  'src/app/api/asset-hub/ai-modify-prop/route.ts',
  'src/app/api/asset-hub/appearances/route.ts',
  'src/app/api/asset-hub/characters/[characterId]/appearances/[appearanceIndex]/route.ts',
  'src/app/api/asset-hub/characters/[characterId]/route.ts',
  'src/app/api/asset-hub/characters/route.ts',
  'src/app/api/asset-hub/folders/[folderId]/route.ts',
  'src/app/api/asset-hub/folders/route.ts',
  'src/app/api/asset-hub/locations/[locationId]/route.ts',
  'src/app/api/asset-hub/locations/route.ts',
  'src/app/api/asset-hub/picker/route.ts',
  'src/app/api/asset-hub/reference-to-character/route.ts',
  'src/app/api/asset-hub/upload-image/route.ts',
  'src/app/api/asset-hub/upload-temp/route.ts',
  'src/app/api/assets/[assetId]/copy/route.ts',
  'src/app/api/assets/[assetId]/generate/plan/route.ts',
  'src/app/api/assets/[assetId]/generate/route.ts',
  'src/app/api/assets/[assetId]/revert-render/route.ts',
  'src/app/api/assets/[assetId]/route.ts',
  'src/app/api/assets/[assetId]/select-render/route.ts',
  'src/app/api/assets/[assetId]/upload-render/route.ts',
  'src/app/api/assets/[assetId]/variants/[variantId]/route.ts',
  'src/app/api/assets/route.ts',
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/app/api/auth/register/route.ts',
  'src/app/api/cos/image/route.ts',
  'src/app/api/deployment/route.ts',
  'src/app/api/files/[...path]/route.ts',
  'src/app/api/mutation-batches/[batchId]/revert/route.ts',
  'src/app/api/payments/recharge/config/route.ts',
  'src/app/api/payments/stripe/checkout/route.ts',
  'src/app/api/payments/stripe/webhook/route.ts',
  'src/app/api/storage/sign/route.ts',
  'src/app/api/projects/[projectId]/ai-create-character/route.ts',
  'src/app/api/projects/[projectId]/ai-create-location/route.ts',
  'src/app/api/projects/[projectId]/ai-modify-appearance/route.ts',
  'src/app/api/projects/[projectId]/ai-modify-location/route.ts',
  'src/app/api/projects/[projectId]/ai-modify-prop/route.ts',
  'src/app/api/projects/[projectId]/assistant/session-state/route.ts',
  'src/app/api/projects/[projectId]/canvas-layout/route.ts',
  'src/app/api/projects/[projectId]/character/appearance/route.ts',
  'src/app/api/projects/[projectId]/character/confirm-selection/route.ts',
  'src/app/api/projects/[projectId]/character/route.ts',
  'src/app/api/projects/[projectId]/bible/route.ts',
  'src/app/api/projects/[projectId]/bible/style-preview/route.ts',
  'src/app/api/projects/[projectId]/chapters/route.ts',
  'src/app/api/projects/[projectId]/edit-script/route.ts',
  'src/app/api/projects/[projectId]/edit-script/assets/generate/route.ts',
  'src/app/api/projects/[projectId]/edit-script/shot-execution-plan/route.ts',
  'src/app/api/projects/[projectId]/edit-script/storyboard/generate/route.ts',
  'src/app/api/projects/[projectId]/episodes/[episodeId]/route.ts',
  'src/app/api/projects/[projectId]/episodes/route.ts',
  'src/app/api/projects/[projectId]/final-video-render/route.ts',
  'src/app/api/projects/[projectId]/generate-bgm/route.ts',
  'src/app/api/projects/[projectId]/generate-soundscape/route.ts',
  'src/app/api/projects/[projectId]/generate-video/route.ts',
  'src/app/api/projects/[projectId]/plan-soundscape/route.ts',
  'src/app/api/projects/[projectId]/location/confirm-selection/route.ts',
  'src/app/api/projects/[projectId]/location/route.ts',
  'src/app/api/projects/[projectId]/operations/[operationId]/plan/route.ts',
  'src/app/api/projects/[projectId]/panel/route.ts',
  'src/app/api/projects/[projectId]/panel/select-candidate/route.ts',
  'src/app/api/projects/[projectId]/reference-to-character/route.ts',
  'src/app/api/projects/[projectId]/regenerate-panel-image/route.ts',
  'src/app/api/projects/[projectId]/config/route.ts',
  'src/app/api/projects/[projectId]/storyboards/route.ts',
  'src/app/api/projects/[projectId]/video-proxy/route.ts',
  'src/app/api/projects/[projectId]/workflow-lab/route.ts',
  'src/app/api/projects/[projectId]/assets/route.ts',
  'src/app/api/projects/[projectId]/assistant/chat/route.ts',
  'src/app/api/projects/[projectId]/assistant/chat/log/route.ts',
  'src/app/api/projects/[projectId]/assistant/runs/[runId]/route.ts',
  'src/app/api/projects/[projectId]/assistant/runs/[runId]/approval/route.ts',
  'src/app/api/projects/[projectId]/assistant/runs/[runId]/choice/route.ts',
  'src/app/api/projects/[projectId]/assistant/runs/[runId]/task-follow-up/route.ts',
  'src/app/api/projects/[projectId]/assistant/waits/route.ts',
  'src/app/api/projects/[projectId]/context/route.ts',
  'src/app/api/projects/[projectId]/costs/route.ts',
  'src/app/api/projects/[projectId]/data/route.ts',
  'src/app/api/projects/[projectId]/route.ts',
  'src/app/api/projects/route.ts',
  'src/app/api/sse/replay/route.ts',
  'src/app/api/sse/route.ts',
  'src/app/api/system/boot-id/route.ts',
  'src/app/api/task-target-states/route.ts',
  'src/app/api/tasks/[taskId]/route.ts',
  'src/app/api/tasks/dismiss/route.ts',
  'src/app/api/tasks/route.ts',
  'src/app/api/user-preference/route.ts',
  'src/app/api/user/api-config/route.ts',
  'src/app/api/user/api-config/test-connection/route.ts',
  'src/app/api/user/api-config/test-provider/route.ts',
  'src/app/api/user/balance/route.ts',
  'src/app/api/user/costs/details/route.ts',
  'src/app/api/user/costs/route.ts',
  'src/app/api/user/invite-codes/redeem/route.ts',
  'src/app/api/user/models/route.ts',
  'src/app/api/user/security/route.ts',
  'src/app/api/user/transactions/route.ts',
] as const

export type RouteFile = (typeof ROUTE_FILES)[number]

const PUBLIC_ROUTE_FILES = new Set<RouteFile>([
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/app/api/auth/register/route.ts',
  'src/app/api/cos/image/route.ts',
  'src/app/api/deployment/route.ts',
  'src/app/api/files/[...path]/route.ts',
  'src/app/api/payments/stripe/webhook/route.ts',
  'src/app/api/system/boot-id/route.ts',
])

function resolveCategory(routeFile: string): RouteCategory {
  if (routeFile.startsWith('src/app/api/assets/')) return 'assets'
  if (routeFile.startsWith('src/app/api/asset-hub/')) return 'asset-hub'
  if (routeFile.startsWith('src/app/api/projects/')) return 'projects'
  if (
    routeFile.startsWith('src/app/api/tasks/')
    || routeFile === 'src/app/api/task-target-states/route.ts'
    || routeFile === 'src/app/api/sse/replay/route.ts'
  ) {
    return 'tasks'
  }
  if (routeFile.startsWith('src/app/api/user/') || routeFile === 'src/app/api/user-preference/route.ts') return 'user'
  if (routeFile.startsWith('src/app/api/auth/')) return 'auth'
  if (routeFile.startsWith('src/app/api/payments/')) return 'payments'
  if (routeFile.startsWith('src/app/api/system/')) return 'system'
  return 'infra'
}

function resolveContractGroup(routeFile: string): RouteContractGroup {
  if (
    routeFile.includes('/ai-')
    || routeFile.includes('/analyze')
    || routeFile.includes('/reference-to-character/')
  ) {
    return 'llm-observe-routes'
  }
  if (
    routeFile.endsWith('/generate-bgm/route.ts')
    || routeFile.endsWith('/generate-soundscape/route.ts')
    || routeFile.endsWith('/plan-soundscape/route.ts')
    || routeFile.endsWith('/generate-video/route.ts')
    || routeFile.endsWith('/final-video-render/route.ts')
    || routeFile.endsWith('/generate/route.ts')
    || routeFile.endsWith('/generate/plan/route.ts')
    || routeFile.endsWith('/operations/[operationId]/plan/route.ts')
    || routeFile.endsWith('/regenerate-panel-image/route.ts')
    || routeFile.includes('/edit-script/prompts/')
  ) {
    return 'direct-submit-routes'
  }
  if (routeFile.startsWith('src/app/api/assets/')) return 'crud-assets-routes'
  if (routeFile.startsWith('src/app/api/asset-hub/')) return 'crud-asset-hub-routes'
  if (
    routeFile.startsWith('src/app/api/tasks/')
    || routeFile === 'src/app/api/task-target-states/route.ts'
    || routeFile === 'src/app/api/sse/replay/route.ts'
    || routeFile === 'src/app/api/sse/route.ts'
  ) {
    return 'task-infra-routes'
  }
  if (routeFile.startsWith('src/app/api/projects/') || routeFile.startsWith('src/app/api/user/')) {
    return 'user-project-routes'
  }
  if (routeFile.startsWith('src/app/api/auth/')) return 'auth-routes'
  if (routeFile.startsWith('src/app/api/payments/')) return 'payment-routes'
  return 'infra-routes'
}

export const ROUTE_CATALOG: ReadonlyArray<RouteCatalogEntry> = ROUTE_FILES.map((routeFile) => ({
  routeFile,
  category: resolveCategory(routeFile),
  contractGroup: resolveContractGroup(routeFile),
  access: PUBLIC_ROUTE_FILES.has(routeFile) ? 'public' : 'protected',
}))

export const ROUTE_COUNT = ROUTE_CATALOG.length
