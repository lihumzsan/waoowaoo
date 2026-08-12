import { describe, expect, it } from 'vitest'
import { assertWorkspaceResourceInputExpectation } from '@/lib/workspace-resource/persistence'

describe('WorkspaceResource input preflight', () => {
  it('rejects an audio Resource when the role requires video', () => {
    expect(() => assertWorkspaceResourceInputExpectation({
      resourceId: 'audio_one',
      mediaType: 'audio',
      schemaId: 'project.sound_effect_audio',
      contentKind: 'media',
    }, {
      expectedMediaType: 'video',
    })).toThrow('WORKSPACE_RESOURCE_INPUT_MEDIA_TYPE_MISMATCH:audio_one')
  })

  it('rejects sound-effect semantics when the role requires background music', () => {
    expect(() => assertWorkspaceResourceInputExpectation({
      resourceId: 'sound_one',
      mediaType: 'audio',
      schemaId: 'project.sound_effect_audio',
      contentKind: 'media',
    }, {
      expectedMediaType: 'audio',
      allowedSchemaIds: ['project.bgm_audio', 'project.upload_audio'],
    })).toThrow('WORKSPACE_RESOURCE_INPUT_SCHEMA_MISMATCH:sound_one')
  })

  it('accepts an uploaded audio Resource as user-declared background music', () => {
    expect(() => assertWorkspaceResourceInputExpectation({
      resourceId: 'upload_one',
      mediaType: 'audio',
      schemaId: 'project.upload_audio',
      contentKind: 'media',
    }, {
      expectedMediaType: 'audio',
      allowedSchemaIds: ['project.bgm_audio', 'project.upload_audio'],
    })).not.toThrow()
  })
})
