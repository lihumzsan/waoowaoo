import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('glass input focus style', () => {
  it('uses a single focus border instead of a blue glow on shared form controls', () => {
    const css = readFileSync('src/styles/ui-semantic-glass.css', 'utf8')

    expect(css).toContain('box-shadow: inset 0 0 0 1px var(--glass-stroke-focus);')
    expect(css).not.toContain('0 0 0 3px var(--glass-focus-ring)')
  })

  it('keeps legacy form inputs from using Tailwind focus ring glows', () => {
    const files = [
      'src/components/shared/assets/AiModifyDescriptionField.tsx',
      'src/components/ui/config-modals/ModelCapabilityDropdown.tsx',
      'src/features/project-workspace/components/assets/AddLocationModal.tsx',
    ]

    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')

    expect(source).not.toContain('focus-within:shadow')
    expect(source).not.toMatch(/focus:ring-[124]/)
    expect(source).not.toContain('shadow-[0_0_0_3px')
  })
})
