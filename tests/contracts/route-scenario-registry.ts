import type { NextRequest } from 'next/server'
import type { BehaviorScenario } from '../harness/behavior-scenario'
import { buildMockRequest } from '../helpers/request'
import { ROUTE_CATALOG, type RouteCatalogEntry, type RouteFile } from './route-catalog'

type RouteMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
type RouteParam = string | readonly string[]
type RouteContext = { readonly params: Promise<Record<string, RouteParam>> }
type RouteHandler = (request: NextRequest, context: RouteContext) => Promise<Response>
type RouteModule = Partial<Record<RouteMethod, unknown>>

const ROUTE_METHODS: readonly RouteMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']

function resolveParamValue(paramName: string): RouteParam {
  if (paramName.startsWith('...')) return ['missing-file.txt']
  const key = paramName.toLowerCase()
  if (key.includes('project')) return 'project-1'
  if (key.includes('task')) return 'task-1'
  if (key.includes('run')) return 'run-1'
  if (key.includes('operation')) return 'operation-1'
  if (key.includes('character')) return 'character-1'
  if (key.includes('location')) return 'location-1'
  if (key.includes('appearance')) return '0'
  if (key.includes('episode')) return 'episode-1'
  if (key.includes('asset')) return 'asset-1'
  if (key.includes('variant')) return 'variant-1'
  if (key.includes('folder')) return 'folder-1'
  if (key.includes('batch')) return 'batch-1'
  return `${paramName}-1`
}

function toRequestTarget(routeFile: RouteFile): {
  readonly path: string
  readonly params: Record<string, RouteParam>
} {
  const params: Record<string, RouteParam> = {}
  let path = routeFile.replace(/^src\/app/, '').replace(/\/route\.ts$/, '')
  path = path.replace(/\[([^\]]+)\]/g, (_match, paramName: string) => {
    const value = resolveParamValue(paramName)
    params[paramName.replace(/^\.\.\./, '')] = value
    return typeof value === 'string' ? value : value.join('/')
  })

  if (routeFile === 'src/app/api/auth/[...nextauth]/route.ts') {
    params.nextauth = ['session']
    path = '/api/auth/session'
  }

  const url = new URL(path, 'http://localhost:3000')
  url.searchParams.set('projectId', 'project-1')
  url.searchParams.set('key', 'missing/file.png')
  return { path: `${url.pathname}${url.search}`, params }
}

function buildScenarioBody(): Record<string, unknown> {
  return {
    projectId: 'project-1',
    taskId: 'task-1',
    targetType: 'panel',
    targetId: 'panel-1',
    targets: [{ targetType: 'panel', targetId: 'panel-1' }],
    name: 'Scenario',
    type: 'character',
    content: 'scenario input',
    userInstruction: 'scenario input',
    referenceImageUrl: 'https://example.com/reference.png',
  }
}

function scenarioId(routeFile: RouteFile): string {
  return `ROUTE:${routeFile.replace(/^src\/app\/api\//, '').replace(/\/route\.ts$/, '')}`
}

async function loadRouteModule(routeFile: RouteFile): Promise<RouteModule> {
  const modulePath = `@/${routeFile.replace(/^src\//, '').replace(/\.ts$/, '')}`
  return await import(modulePath) as RouteModule
}

async function executeRouteContract(entry: RouteCatalogEntry): Promise<void> {
  const mod = await loadRouteModule(entry.routeFile)
  const { path, params } = toRequestTarget(entry.routeFile)
  let executedMethods = 0

  for (const method of ROUTE_METHODS) {
    const candidate = mod[method]
    if (typeof candidate !== 'function') continue
    executedMethods += 1
    const handler = candidate as RouteHandler
    const request = buildMockRequest({
      path,
      method,
      ...(method === 'GET' ? {} : { body: buildScenarioBody() }),
    })
    const response = await handler(request, { params: Promise.resolve(params) })
    if (!(response instanceof Response)) {
      throw new Error(`${entry.routeFile}#${method} did not return a Response`)
    }
    if (entry.access === 'protected' && (response.status < 400 || response.status >= 500)) {
      throw new Error(`${entry.routeFile}#${method} bypassed its rejection contract: ${response.status}`)
    }
    if (entry.access === 'public' && response.status >= 500) {
      throw new Error(`${entry.routeFile}#${method} failed its public request contract: ${response.status}`)
    }
  }

  if (executedMethods === 0) {
    throw new Error(`${entry.routeFile} does not export a supported route method`)
  }
}

export const ROUTE_SCENARIO_REGISTRY: readonly BehaviorScenario<RouteFile>[] = ROUTE_CATALOG.map((entry) => {
  const id = scenarioId(entry.routeFile)
  return {
    id,
    identity: entry.routeFile,
    severity: entry.access === 'protected' ? 'P1' : 'P2',
    invariantIds: ['TG-03'],
    historicalDefectIds: [],
    layers: ['integration-api', 'contract'],
    async execute(context) {
      await executeRouteContract(entry)
      context.recordExecution(id)
    },
  }
})
