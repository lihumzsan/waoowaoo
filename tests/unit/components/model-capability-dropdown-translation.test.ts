import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ModelCapabilityDropdown } from '@/components/ui/config-modals/ModelCapabilityDropdown'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

describe('ModelCapabilityDropdown model label translation', () => {
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
