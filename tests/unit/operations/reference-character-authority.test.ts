import { describe, expect, it } from 'vitest'
import { createExtraOperations } from '@/lib/operations/domains/extra/extra-ops'
import { createAssetHubLlmOperations } from '@/lib/operations/domains/asset-hub/asset-hub-llm-ops'
import { getTaskDefinition } from '@/lib/task/definition'
import { TASK_TYPE } from '@/lib/task/types'

describe('reference character generation authority', () => {
  it('requires immutable plan approval for both image-generation Operations', () => {
    for (const operation of [
      createExtraOperations().reference_to_character,
      createAssetHubLlmOperations().asset_hub_reference_to_character,
    ]) {
      expect(operation?.confirmation).toMatchObject({ kind: 'billable_media', required: true })
      expect(operation?.plan).toEqual(expect.any(Function))
      expect(operation?.commit).toEqual(expect.any(Function))
      expect(operation?.execute).toBeUndefined()
    }
  })

  it('registers image generation and text extraction as distinct billing contracts', () => {
    expect(getTaskDefinition(TASK_TYPE.REFERENCE_TO_CHARACTER).billingPolicy).toBe('image')
    expect(getTaskDefinition(TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER).billingPolicy).toBe('image')
    expect(getTaskDefinition(TASK_TYPE.REFERENCE_CHARACTER_DESCRIPTION_EXTRACT).billingPolicy).toBe('text')
    expect(getTaskDefinition(TASK_TYPE.ASSET_HUB_REFERENCE_CHARACTER_DESCRIPTION_EXTRACT).billingPolicy).toBe('text')
  })

  it('keeps extraction Operations direct and unable to commit image plans', () => {
    for (const operation of [
      createExtraOperations().extract_reference_character_description,
      createAssetHubLlmOperations().asset_hub_extract_reference_character_description,
    ]) {
      expect(operation?.confirmation?.kind ?? 'none').toBe('none')
      expect(operation?.execute).toEqual(expect.any(Function))
      expect(operation?.plan).toBeUndefined()
      expect(operation?.commit).toBeUndefined()
    }
  })
})
