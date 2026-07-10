import {
  EDIT_FIRST_CHOICE_TOOL_IDS,
  describe,
  expect,
  isProjectAgentOperationAlwaysEnabled,
  isProjectAgentOperationEnabled,
  it,
  registry,
  resolveProjectAgentToolset,
  workflow,
} from './toolset.fixture'

describe('project agent live operation enablement', () => {
  it('enables only the current stage operations plus the next action', () => {
    const toolset = resolveProjectAgentToolset({
      registry: registry(),
      context: { episodeId: 'episode-1' },
    })
    const current = workflow('ready_to_generate_edit_script', ['plan_chapters'])

    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: current,
      operationId: 'plan_chapters',
    })).toBe(true)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: current,
      operationId: 'generate_edit_script',
    })).toBe(false)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: current,
      operationId: 'generate_edit_script_assets',
    })).toBe(false)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: current,
      operationId: 'generate_episode_videos',
    })).toBe(false)
  })

  it('enables the next stage operation as soon as the workflow advances mid-run', () => {
    const toolset = resolveProjectAgentToolset({
      registry: registry(),
      context: { episodeId: 'episode-1' },
      resumeOperationId: 'generate_edit_script',
    })

    const beforeContinuation = workflow('edit_script_generating', [])
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: beforeContinuation,
      operationId: 'generate_edit_script_assets',
    })).toBe(false)

    // The resumed operation completed inside this run and advanced the stage:
    // the next edit-script tool must light up without re-registering the toolset.
    const afterContinuation = workflow('ready_to_generate_assets', ['generate_edit_script_assets'])
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: afterContinuation,
      operationId: 'generate_edit_script_assets',
    })).toBe(true)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: afterContinuation,
      operationId: 'ingest_script',
    })).toBe(false)
  })

  it('keeps the resumed approval operation enabled even when the workflow has moved on', () => {
    const toolset = resolveProjectAgentToolset({
      registry: registry(),
      context: { episodeId: 'episode-1' },
      resumeOperationId: 'ingest_script',
    })
    const movedOn = workflow('bible_ready_for_review', ['generate_edit_style_previews'])

    expect(isProjectAgentOperationAlwaysEnabled(toolset, 'ingest_script')).toBe(true)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: movedOn,
      operationId: 'ingest_script',
    })).toBe(true)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: movedOn,
      operationId: 'generate_edit_style_previews',
    })).toBe(true)
  })

  it('does not always enable a workflow operation just because it follows a choice result', () => {
    const toolset = resolveProjectAgentToolset({
      registry: registry(),
      context: { episodeId: 'episode-1' },
    })
    const review = workflow('bible_ready_for_review', ['generate_edit_style_previews'])

    expect(isProjectAgentOperationAlwaysEnabled(toolset, 'ingest_script')).toBe(false)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: review,
      operationId: 'ingest_script',
    })).toBe(false)
  })

  it('treats core read tools as always enabled while choice tools follow workflow stage gates', () => {
    const toolset = resolveProjectAgentToolset({
      registry: registry(),
      context: { episodeId: 'episode-1' },
    })
    const review = workflow('bible_ready_for_review', ['generate_edit_style_previews'])
    const styleChoice = workflow('needs_style_choice', ['generate_edit_style_previews'])
    const intake = workflow('ready_to_ingest_script', ['ingest_script'])
    const scriptReview = workflow('script_ready_for_review', ['revise_script'])

    expect(isProjectAgentOperationAlwaysEnabled(toolset, 'get_project_context')).toBe(true)
    expect(isProjectAgentOperationAlwaysEnabled(toolset, 'get_project_snapshot')).toBe(true)
    expect(isProjectAgentOperationAlwaysEnabled(toolset, EDIT_FIRST_CHOICE_TOOL_IDS.bible_review)).toBe(false)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: intake,
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.script_intake,
    })).toBe(true)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: review,
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.script_intake,
    })).toBe(false)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: scriptReview,
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.script_review,
    })).toBe(true)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: review,
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.script_review,
    })).toBe(false)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: review,
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
    })).toBe(true)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: styleChoice,
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
    })).toBe(false)
    expect(isProjectAgentOperationAlwaysEnabled(toolset, 'generate_edit_script')).toBe(false)
  })

  it('enables script revision during review and bible generation after script approval', () => {
    const toolset = resolveProjectAgentToolset({
      registry: registry(),
      context: { episodeId: 'episode-1' },
    })
    const scriptReview = workflow('script_ready_for_review', ['revise_script'])
    const approved = workflow('ready_to_generate_bible', ['generate_bible_from_script'])

    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: scriptReview,
      operationId: 'revise_script',
    })).toBe(true)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: scriptReview,
      operationId: 'generate_bible_from_script',
    })).toBe(false)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: approved,
      operationId: 'generate_bible_from_script',
    })).toBe(true)
  })

  it('keeps stage capability rules like bible revision during review', () => {
    const toolset = resolveProjectAgentToolset({
      registry: registry(),
      context: { episodeId: 'episode-1' },
    })
    const review = workflow('bible_ready_for_review', ['generate_edit_style_previews'])

    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: review,
      operationId: 'revise_bible',
    })).toBe(true)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: review,
      operationId: 'generate_edit_script',
    })).toBe(false)
  })

  it('enables asset revision but not missing-asset generation while asset review is waiting on feedback', () => {
    const toolset = resolveProjectAgentToolset({
      registry: registry(),
      context: { episodeId: 'episode-1' },
    })
    const assetReview = workflow('assets_ready_for_review', ['revise_edit_script_assets'])

    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: assetReview,
      operationId: 'revise_edit_script_assets',
    })).toBe(true)
    expect(isProjectAgentOperationEnabled({
      toolset,
      workflow: assetReview,
      operationId: 'generate_edit_script_assets',
    })).toBe(false)
  })
})
