import {
  bible,
  buildWorkspaceNodeCanvasProjection,
  describe,
  editBibleNode,
  expect,
  isWorkspaceCanvasLifecycleRunning,
  it,
  t,
  workflow,
} from './project-canvas-resource-lifecycle.fixture'

describe('project canvas resource lifecycle', () => {
  it('treats style confirmation as a succeeded artifact instead of a running node', () => {
    const node = editBibleNode({ status: 'confirmed' })

    expect(node.data.lifecycle.phase).toBe('succeeded')
    expect(isWorkspaceCanvasLifecycleRunning(node.data.lifecycle)).toBe(false)
  })

  it('projects the confirmed Style Bible image through the required media loading contract', () => {
    const styleImageUrl = 'https://cdn.example/style-confirmed.png'
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_generate_edit_script'),
      editBible: bible('confirmed', {
        styleBible: {
          rawUserStyle: null,
          styleSummary: 'Cold cinematic realism',
          stylePolicy: {
            directing: {
              pointOfViewPrompt: 'subjective',
              performancePrompt: 'restrained',
              informationReleasePrompt: 'gradual',
              rhythmPrompt: 'measured',
            },
            visual: {
              imageFilterPrompt: 'film grain',
              lightingPrompt: 'low key',
              colorPrompt: 'cold blue',
              texturePrompt: 'tactile',
              compositionPrompt: 'deep frames',
            },
            camera: {
              movementPrompt: 'slow dolly',
              lensAndDepthPrompt: '35mm shallow depth',
              videoRhythmPrompt: 'measured cuts',
            },
            sound: { soundFilterPrompt: 'distant industrial hum' },
          },
        },
        stylePreviews: [{
          id: 'style-1',
          projectId: 'project-1',
          episodeId: 'episode-1',
          bibleId: 'bible-1',
          styleKey: 'style_a',
          aspectRatio: '16:9',
          title: 'Cold realism',
          summary: 'Cold realism',
          styleBible: {},
          gridImagePrompt: 'grid',
          imageKey: 'style.png',
          imageUrl: styleImageUrl,
          status: 'confirmed',
          taskId: 'task-style-1',
          errorMessage: null,
        }],
      }),
      savedLayouts: [],
      translate: t,
    })

    const styleNode = projection.nodes.find((node) => node.data.kind === 'editStyleBible')
    expect(styleNode?.data.mediaLoadingContext).toEqual({ styleImageUrl })
  })

  it('does not use assistant focus as the edit bible lifecycle authority', () => {
    const node = editBibleNode({ status: 'ready_for_review', activeAssistantOperationId: 'ingest_script' })

    expect(node.data.lifecycle.phase).toBe('succeeded')
    expect(isWorkspaceCanvasLifecycleRunning(node.data.lifecycle)).toBe(false)
  })
})
