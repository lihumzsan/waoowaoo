import { ROUTE_CATALOG, type RouteCatalogEntry } from './route-catalog'

export type RouteBehaviorMatrixEntry = {
  routeFile: string
  contractGroup: RouteCatalogEntry['contractGroup']
  caseId: string
  tests: ReadonlyArray<string>
}

const CONTRACT_TESTS_BY_GROUP: Record<RouteCatalogEntry['contractGroup'], ReadonlyArray<string>> = {
  'llm-observe-routes': ['tests/integration/api/contract/llm-observe-routes.test.ts'],
  'direct-submit-routes': [
    'tests/integration/api/contract/direct-submit-text-routes.test.ts',
    'tests/integration/api/contract/direct-submit-media-routes.test.ts',
    'tests/integration/api/contract/direct-submit-run-routes.test.ts',
  ],
  'crud-assets-routes': ['tests/integration/api/contract/asset-crud-routes.test.ts'],
  'crud-asset-hub-routes': ['tests/integration/api/contract/asset-crud-routes.test.ts'],
  'task-infra-routes': [
    'tests/integration/api/contract/task-queue-routes.test.ts',
    'tests/integration/api/contract/task-run-routes.test.ts',
  ],
  'user-project-routes': ['tests/integration/api/contract/project-crud-routes.test.ts'],
  'auth-routes': ['tests/integration/api/contract/project-crud-routes.test.ts'],
  'payment-routes': ['tests/integration/api/contract/payment-routes.test.ts'],
  'infra-routes': ['tests/integration/api/contract/infra-routes.test.ts'],
}

function resolveChainTest(routeFile: string): string {
  if (routeFile.startsWith('src/app/api/payments/')) {
    return 'tests/integration/api/contract/payment-routes.test.ts'
  }
  if (routeFile.includes('/generate-video/')) {
    return 'tests/integration/chain/video.chain.test.ts'
  }
  if (
    routeFile.includes('/analyze')
    || routeFile.includes('/bible-conversion')
    || routeFile.includes('/reference-to-character')
  ) {
    return 'tests/integration/chain/text.chain.test.ts'
  }
  return 'tests/integration/chain/image.chain.test.ts'
}

function resolveBehaviorTests(entry: RouteCatalogEntry): ReadonlyArray<string> {
  const tests = [...CONTRACT_TESTS_BY_GROUP[entry.contractGroup]]
  const chainTest = resolveChainTest(entry.routeFile)
  if (!tests.includes(chainTest)) {
    tests.push(chainTest)
  }
  return tests
}

export const ROUTE_BEHAVIOR_MATRIX: ReadonlyArray<RouteBehaviorMatrixEntry> = ROUTE_CATALOG.map((entry) => ({
  routeFile: entry.routeFile,
  contractGroup: entry.contractGroup,
  caseId: `ROUTE:${entry.routeFile.replace(/^src\/app\/api\//, '').replace(/\/route\.ts$/, '')}`,
  tests: resolveBehaviorTests(entry),
}))

export const ROUTE_BEHAVIOR_COUNT = ROUTE_BEHAVIOR_MATRIX.length
