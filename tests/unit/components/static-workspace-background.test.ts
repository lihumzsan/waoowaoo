import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('static workspace background', () => {
  it('uses a static gradient without the full-screen aurora animation', () => {
    const componentSource = readFileSync(
      resolve(process.cwd(), 'src/components/ui/SharedComponents.tsx'),
      'utf8',
    )
    const workspaceSource = readFileSync(
      resolve(process.cwd(), 'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/NovelPromotionWorkspace.tsx'),
      'utf8',
    )
    const animationSource = readFileSync(
      resolve(process.cwd(), 'src/styles/animations.css'),
      'utf8',
    )

    expect(componentSource).toContain('export function WorkspaceBackground()')
    expect(componentSource).toContain('radial-gradient')
    expect(componentSource).toContain('pointer-events-none')
    expect(componentSource).not.toMatch(/animate-(?:aurora|blob)/)
    expect(componentSource).not.toContain('blur-[100px]')
    expect(componentSource).not.toContain('w-[200%]')
    expect(workspaceSource).toContain("import { WorkspaceBackground }")
    expect(workspaceSource).toContain('<WorkspaceBackground />')
    expect(workspaceSource).not.toContain('AnimatedBackground')
    expect(animationSource).not.toMatch(/@keyframes\s+(?:aurora|blob)/)
    expect(animationSource).not.toMatch(/\.animate-(?:aurora|blob)/)
    expect(animationSource).not.toMatch(/\.animation-delay-(?:2000|4000)/)
  })
})
