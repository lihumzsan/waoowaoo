import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  formatRecommendedCapabilityLabel,
  ModelCapabilityDropdown,
} from '@/components/ui/config-modals/ModelCapabilityDropdown'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

describe('ModelCapabilityDropdown model label translation', () => {
  it('marks only the recommended capability option', () => {
    expect(formatRecommendedCapabilityLabel('9', 9, 9)).toBe('9（推荐）')
    expect(formatRecommendedCapabilityLabel('5', 5, 9)).toBe('5')
    expect(formatRecommendedCapabilityLabel('9', 9, undefined)).toBe('9')
  })

  it('marks the selected model label as non-translatable', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(ModelCapabilityDropdown, {
        models: [{
          value: 'comfyui::goon',
          label: 'ComfyUI · LTX2.3 Goon First/Last Frame',
        }],
        value: 'comfyui::goon',
        onModelChange: () => undefined,
        capabilityFields: [],
        capabilityOverrides: {},
        onCapabilityChange: () => undefined,
        compact: true,
      }),
    )

    expect(html).toMatch(
      /<span translate="no" class="[^"]*notranslate[^"]*">ComfyUI · LTX2\.3 Goon First\/Last Frame<\/span>/,
    )
  })
})
