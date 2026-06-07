import type {
  ProjectClip,
  ProjectEditScreenplay,
  ProjectEditScript,
  ProjectFinalVideo,
  ProjectShot,
  ProjectStoryboard,
  ProjectVideoGroup,
} from '@/types/project'
import type {
  CanvasNodeLayoutSnapshot,
  ProjectCanvasLayoutSnapshot,
} from '@/lib/project-canvas/layout/canvas-layout-contract'

export const DEMO_SNAPSHOT_SCHEMA_VERSION = 1

export interface DemoProjectSnapshot {
  readonly schemaVersion: typeof DEMO_SNAPSHOT_SCHEMA_VERSION
  readonly slug: string
  readonly project: {
    readonly id: string
    readonly name: string
    readonly videoRatio: string | null
    readonly videoModel: string | null
    readonly singleShotVideoModel: string | null
    readonly sequenceVideoModel: string | null
  }
  readonly episode: {
    readonly id: string
    readonly episodeNumber: number
    readonly name: string
    readonly description: string | null
    readonly novelText: string | null
    readonly audioUrl: string | null
    readonly srtContent: string | null
  }
  readonly clips: readonly ProjectClip[]
  readonly storyboards: readonly ProjectStoryboard[]
  readonly shots: readonly ProjectShot[]
  readonly editScreenplay: ProjectEditScreenplay | null
  readonly editScript: ProjectEditScript | null
  readonly finalVideo: ProjectFinalVideo | null
  readonly videoGroups: readonly ProjectVideoGroup[]
  readonly layout: {
    readonly viewport: ProjectCanvasLayoutSnapshot['viewport']
    readonly nodeLayouts: readonly CanvasNodeLayoutSnapshot[]
  } | null
  readonly exportedAt: string
}

const PRIVATE_MEDIA_PATH_PREFIXES = [
  '/m/',
  '/api/files/',
  '/api/storage/sign',
]

const STORAGE_KEY_PREFIX_PATTERN = /^(images|image|videos|video|audio|music|uploads|tmp)\//i
const MEDIA_FILE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a)(?:[?#].*)?$/i
const LOCAL_URL_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?\//i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDemoPublicAssetPath(value: string): boolean {
  return value.startsWith('/demo-assets/')
}

export function isPrivateDemoMediaReference(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || isDemoPublicAssetPath(trimmed)) return false
  if (PRIVATE_MEDIA_PATH_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return true
  if (LOCAL_URL_PATTERN.test(trimmed)) return true
  return STORAGE_KEY_PREFIX_PATTERN.test(trimmed) && MEDIA_FILE_EXTENSION_PATTERN.test(trimmed)
}

export function findDemoSnapshotPrivateMediaReferences(value: unknown): string[] {
  const found = new Set<string>()

  function visit(current: unknown): void {
    if (typeof current === 'string') {
      if (isPrivateDemoMediaReference(current)) {
        found.add(current)
      }
      return
    }

    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }

    if (!isRecord(current)) return
    Object.values(current).forEach(visit)
  }

  visit(value)
  return [...found].sort()
}
