import type { DemoProjectSnapshot } from '@/lib/demo/demo-snapshot'
import matrixDemoSnapshot from '@/demo-data/matrix-demo.json'

const DEMO_PROJECTS = {
  'matrix-demo': matrixDemoSnapshot as unknown as DemoProjectSnapshot,
} satisfies Record<string, DemoProjectSnapshot>

export const demoProjectSlugs = Object.keys(DEMO_PROJECTS)

export function getDemoProjectSnapshot(slug: string): DemoProjectSnapshot | null {
  return Object.prototype.hasOwnProperty.call(DEMO_PROJECTS, slug)
    ? DEMO_PROJECTS[slug as keyof typeof DEMO_PROJECTS]
    : null
}
