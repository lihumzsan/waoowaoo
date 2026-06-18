import { describe, expect, it } from 'vitest'
import type {
  ProjectClip,
  ProjectEditCinematographyShotPlan,
  ProjectEditDirectorDecoupage,
  ProjectEditScreenplay,
  ProjectEditScript,
  ProjectPanel,
  ProjectShot,
  ProjectStoryboard,
} from '@/types/project'
import {
  buildWorkspaceNodeCanvasProjection,
} from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'
import {
  WORKSPACE_CANVAS_BGM_SCORE_TO_FINAL_GAP_X,
  WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y,
} from '@/features/project-workspace/canvas/node-presentation-profiles'
import { resolveWorkspaceNodeRuntimePatch } from '@/features/project-workspace/canvas/workspace-node-runtime'
import {
  TASK_RUNTIME_TARGETS,
  taskRuntimeTargetQueryKey,
} from '@/lib/task/runtime-targets'

function t(key: string, values?: Record<string, string | number>): string {
  if (!values) return key
  return `${key}:${JSON.stringify(values)}`
}

function createClip(id: string, content: string): ProjectClip {
  return {
    id,
    summary: `${id} summary`,
    location: null,
    characters: null,
    props: null,
    content,
    screenplay: null,
  }
}

function createShot(id: string, shotId: string): ProjectShot {
  return {
    id,
    shotId,
    srtStart: 1,
    srtEnd: 3,
    srtDuration: 2,
    sequence: 'prompt sequence',
    locations: 'prompt location',
    characters: 'prompt character',
    plot: 'prompt plot',
    pov: 'prompt pov',
    imagePrompt: 'prompt image text',
    scale: 'medium',
    module: 'module-a',
    focus: 'robot light',
    zhSummarize: 'prompt summary',
    imageUrl: null,
    media: null,
  }
}

function createPanel(input: Partial<ProjectPanel> & Pick<ProjectPanel, 'id' | 'panelIndex'>): ProjectPanel {
  return {
    id: input.id,
    storyboardId: input.storyboardId ?? 'storyboard-1',
    panelIndex: input.panelIndex,
    panelNumber: input.panelNumber ?? input.panelIndex + 1,
    shotType: input.shotType ?? null,
    cameraMove: input.cameraMove ?? null,
    description: input.description ?? null,
    location: input.location ?? null,
    characters: input.characters ?? null,
    props: input.props ?? null,
    srtSegment: input.srtSegment ?? null,
    srtStart: input.srtStart ?? null,
    srtEnd: input.srtEnd ?? null,
    duration: input.duration ?? null,
    imagePrompt: input.imagePrompt ?? null,
    videoPrompt: null,
    imageUrl: input.imageUrl ?? null,
    candidateImages: input.candidateImages ?? null,
    media: input.media ?? null,
    imageHistory: input.imageHistory ?? null,
    firstLastFramePrompt: input.firstLastFramePrompt ?? null,
    videoUrl: input.videoUrl ?? null,
    videoModel: input.videoModel ?? null,
    videoErrorCode: input.videoErrorCode ?? null,
    videoErrorMessage: input.videoErrorMessage ?? null,
    videoGenerationMode: input.videoGenerationMode ?? null,
    lastVideoGenerationOptions: input.lastVideoGenerationOptions ?? null,
    videoMedia: input.videoMedia ?? null,
    linkedToNextPanel: input.linkedToNextPanel ?? null,
    sketchImageUrl: input.sketchImageUrl ?? null,
    sketchImageMedia: input.sketchImageMedia ?? null,
    previousImageUrl: input.previousImageUrl ?? null,
    previousImageMedia: input.previousImageMedia ?? null,
    photographyRules: input.photographyRules ?? null,
    actingNotes: input.actingNotes ?? null,
    imageTaskRunning: input.imageTaskRunning ?? false,
    videoTaskRunning: input.videoTaskRunning ?? false,
    imageErrorMessage: input.imageErrorMessage ?? null,
  }
}

function createStoryboard(input: {
  readonly id: string
  readonly clipId: string
  readonly panels: ProjectPanel[]
  readonly photographyPlan?: string | null
  readonly blockingArtifacts?: ProjectStoryboard['blockingArtifacts']
}): ProjectStoryboard {
  return {
    id: input.id,
    episodeId: 'episode-1',
    clipId: input.clipId,
    storyboardTextJson: null,
    panelCount: input.panels.length,
    storyboardImageUrl: null,
    candidateImages: null,
    lastError: null,
    photographyPlan: input.photographyPlan ?? null,
    panels: input.panels,
    blockingArtifacts: input.blockingArtifacts ?? [],
  }
}

function createStyleBible(): Record<string, unknown> {
  return {
    strategy: 'style_bible',
    rawUserStyle: '禅修短片',
    styleSummary: '低饱和自然光禅意电影质感。',
    stylePolicy: {
      visual: {
        negativePrompt: '避免商业广告感，避免高反差大片感。',
        imageFilterPrompt: '清澈空气感，35mm 镜头，克制高光。',
        lightingPrompt: '柔和自然光。',
        colorPrompt: '自然灰绿、木色、石灰色。',
        texturePrompt: '轻微柔焦，淡雅胶片颗粒。',
        compositionPrompt: '留白构图，稳定观察。',
      },
      camera: {
        movementPrompt: '避免炫技运镜。',
        lensAndDepthPrompt: '35mm，自然景深。',
        videoRhythmPrompt: '缓慢呼吸感节奏，克制剪辑。',
      },
      directing: {
        pointOfViewPrompt: 'restricted protagonist viewpoint',
        performancePrompt: 'restrained performance through small gestures',
        informationReleasePrompt: 'reveal information through reaction before event truth',
        rhythmPrompt: 'hold suspense pauses before faster turns',
      },
      sound: {
        soundFilterPrompt: '清澈低噪。',
      },
      hardBans: ['商业广告感', '高反差大片感', '炫技运镜'],
    },
  }
}

function createEditScreenplay(input?: Partial<ProjectEditScreenplay>): ProjectEditScreenplay {
  return {
    id: input?.id ?? 'screenplay-1',
    projectId: input?.projectId ?? 'project-1',
    episodeId: input?.episodeId ?? 'episode-1',
    userPrompt: input?.userPrompt ?? 'make a one minute sci-fi film',
    ...(input?.styleBible !== undefined ? { styleBible: input.styleBible } : {}),
    ...(input?.stylePreviews !== undefined ? { stylePreviews: input.stylePreviews } : {}),
    screenplayText: input?.screenplayText ?? '标题：《光影回溯》\n\n故事梗概：飞船追赶远古光线。',
    status: input?.status ?? 'ready',
  }
}

function createDirectorDecoupage(input?: Partial<ProjectEditDirectorDecoupage>): ProjectEditDirectorDecoupage {
  return {
    id: input?.id ?? 'director-1',
    projectId: input?.projectId ?? 'project-1',
    episodeId: input?.episodeId ?? 'episode-1',
    screenplayId: input?.screenplayId ?? 'screenplay-1',
    userPrompt: input?.userPrompt ?? 'make a one minute sci-fi film',
    status: input?.status ?? 'ready',
    shots: input?.shots ?? [
      {
        shotNumber: 1,
        durationSec: 3,
        dramaticPurpose: 'establish hesitation',
        visibleAction: 'Pilot stops before the sealed door.',
        audienceFocus: 'pilot hand and dark door seam',
        viewpoint: 'restricted protagonist viewpoint',
        revealPlan: 'hide the room beyond the door',
        performanceBeat: 'fear held in breath and fingers',
        continuityIn: 'footsteps stop before the door',
        continuityOut: 'continue along the pilot eyeline',
        charactersAndScene: 'Pilot outside the sealed door',
        sound: 'low room tone under stopped footsteps',
      },
    ],
    hardBans: input?.hardBans ?? [],
  }
}

function createSingleVideoEditScript(input?: Partial<ProjectEditScript>): ProjectEditScript {
  return {
    id: input?.id ?? 'edit-video',
    projectId: input?.projectId ?? 'project-1',
    episodeId: input?.episodeId ?? 'episode-1',
    userPrompt: input?.userPrompt ?? 'single video',
    ...(input?.styleBible !== undefined ? { styleBible: input.styleBible } : {}),
    title: input?.title ?? 'Single Video',
    logline: input?.logline ?? null,
    durationSec: input?.durationSec ?? 2,
    shotCount: input?.shotCount ?? 1,
    status: input?.status ?? 'ready',
    assetReviewStatus: input?.assetReviewStatus ?? 'pending',
    shots: input?.shots ?? [
      {
        shotNumber: 1,
        durationSec: 2,
        dramaticPurpose: 'test dramatic purpose',
        visibleAction: 'A camera watches the room.',
        audienceFocus: 'test audience focus',
        viewpoint: 'test viewpoint',
        revealPlan: 'test reveal plan',
        performanceBeat: 'test performance beat',
        continuityIn: 'test continuity in',
        continuityOut: 'test continuity out',
        charactersAndScene: 'Empty room',
        sound: 'low room tone',
      },
    ],
    videoBlocks: input?.videoBlocks ?? [
      {
        kind: 'single',
        shotNumbers: [1],
        reason: 'One isolated beat.',
        prompt: 'Edit-first single video prompt.',
      },
    ],
    requirements: input?.requirements ?? [],
  }
}

function createCinematographyShotPlan(
  input?: Partial<ProjectEditCinematographyShotPlan>,
): ProjectEditCinematographyShotPlan {
  return {
    id: input?.id ?? 'cinematography-1',
    projectId: input?.projectId ?? 'project-1',
    episodeId: input?.episodeId ?? 'episode-1',
    editScriptId: input?.editScriptId ?? 'edit-1',
    status: input?.status ?? 'ready',
    shots: input?.shots ?? [
      {
        shotNumber: 1,
        shotScale: 'medium shot',
        lens: '35mm',
        depthOfField: 'natural depth',
        cameraPosition: 'front of the scene',
        cameraHeight: 'eye level',
        cameraAngle: 'neutral',
        movement: 'static',
        composition: 'balanced composition',
        lighting: 'soft motivated light',
        axisAndEyeline: 'consistent screen direction',
        continuityIn: 'continue from previous beat',
        continuityOut: 'lead into next beat',
      },
    ],
    hardBans: input?.hardBans ?? [],
  }
}

function nodesOverlap(left: {
  readonly position: { readonly x: number; readonly y: number }
  readonly data: { readonly width: number; readonly height: number }
}, right: {
  readonly position: { readonly x: number; readonly y: number }
  readonly data: { readonly width: number; readonly height: number }
}): boolean {
  return (
    left.position.x < right.position.x + right.data.width &&
    left.position.x + left.data.width > right.position.x &&
    left.position.y < right.position.y + right.data.height &&
    left.position.y + left.data.height > right.position.y
  )
}

describe('workspace node canvas projection', () => {
  it('keeps the canvas empty when the episode has no generated data', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.map((node) => node.id)).toEqual([])
    expect(projection.edges).toEqual([])
  })

  it('projects real story, clips, and shots without old video fallback nodes', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'A real story',
      clips: [
        createClip('clip-1', 'first clip content'),
        createClip('clip-2', 'second clip content'),
      ],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({
              id: 'panel-2',
              panelIndex: 1,
              description: 'second panel',
              videoUrl: 'https://example.com/panel-2.mp4',
            }),
            createPanel({
              id: 'panel-1',
              panelIndex: 0,
              description: 'first panel',
              imageUrl: 'https://example.com/panel-1.png',
              media: {
                id: 'media-panel-1',
                publicId: 'media-panel-1',
                url: 'https://example.com/panel-1.png',
                mimeType: 'image/png',
                sizeBytes: null,
                width: 1080,
                height: 1920,
                durationMs: null,
              },
            }),
          ],
        }),
      ],
      savedLayouts: [],
      defaultVideoModel: 'project-video-model',
      translate: t,
    })

    expect(projection.nodes.map((node) => node.id)).toEqual([
      'analysis:episode-1',
      'clip:clip-1',
      'clip:clip-2',
      'shot:panel-1',
      'shot:panel-2',
    ])
    expect(projection.edges.map((edge) => `${edge.source}->${edge.target}`)).toContain('analysis:episode-1->clip:clip-1')
    expect(projection.edges.map((edge) => `${edge.source}->${edge.target}`)).toContain('clip:clip-1->shot:panel-1')

    const clipNode = projection.nodes.find((node) => node.id === 'clip:clip-1')
    expect(clipNode?.data.action).toEqual({
      type: 'regenerate_storyboard_text',
      storyboardId: 'storyboard-1',
    })

    const shotNode = projection.nodes.find((node) => node.id === 'shot:panel-1')
    expect(shotNode?.data.action).toEqual({ type: 'generate_image', panelId: 'panel-1' })
    expect(shotNode?.data.previewImageUrl).toBe('https://example.com/panel-1.png')
    expect(shotNode?.data.previewAspectRatio).toBeCloseTo(1080 / 1920)
    expect(shotNode?.data.previewDisplayHeight).toBeGreaterThan(118)
    expect(projection.nodes.some((node) => node.id === 'image:panel-1')).toBe(false)
    expect(projection.nodes.some((node) => node.data.kind === 'videoClip')).toBe(false)
    expect(projection.nodes.some((node) => node.data.kind === 'finalTimeline')).toBe(false)
  })

  it('projects an edit screenplay card before the edit-first table', () => {
    const editScreenplay = createEditScreenplay()
    const editScript = createSingleVideoEditScript({ videoBlocks: [] })
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      editScreenplay,
      editScript,
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.map((node) => node.id)).toEqual([
      'edit-screenplay:screenplay-1',
      'edit-process:edit-video',
      'edit-script:edit-video',
      'edit-cinematography-shot-plan:edit-script:edit-video',
    ])
    expect(projection.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      'edit-screenplay:screenplay-1->edit-process:edit-video',
      'edit-process:edit-video->edit-script:edit-video',
      'edit-script:edit-video->edit-cinematography-shot-plan:edit-script:edit-video',
    ])

    const screenplayNode = projection.nodes.find((node) => node.id === 'edit-screenplay:screenplay-1')
    expect(screenplayNode?.data.kind).toBe('editScreenplay')
    expect(screenplayNode?.data.layoutNodeType).toBe('editScreenplay')
    expect(screenplayNode?.data.targetType).toBe('editScreenplay')
    expect(screenplayNode?.data.title).toBe('光影回溯')
    expect(screenplayNode?.data.body).toContain('飞船追赶远古光线')
    expect(screenplayNode?.data.editScreenplayDetails).toEqual({
      screenplayText: editScreenplay.screenplayText,
      userPrompt: editScreenplay.userPrompt,
    })
    expect(screenplayNode?.data.action).toBeUndefined()

    const editScriptNode = projection.nodes.find((node) => node.id === 'edit-script:edit-video')
    expect(editScriptNode?.position.y).toBeGreaterThan(screenplayNode?.position.y ?? 0)
    const processNode = projection.nodes.find((node) => node.id === 'edit-process:edit-video')
    expect(processNode?.data.kind).toBe('editProcessGroup')
    expect(processNode?.data.layoutNodeType).toBe('editPipelineStep')
    expect(processNode?.data.targetType).toBe('editPipelineStep')
    expect(processNode?.data.editProcessGroupDetails?.steps.map((step) => step.key)).toEqual([
      'timeline', 'visibleAction', 'camera', 'audio', 'primaryTable', 'assetExtract',
    ])
    expect(processNode?.data.editProcessGroupDetails?.steps[0]).toMatchObject({
      key: 'timeline',
      badge: 'P1',
      items: [
        {
          title: 'nodeFields.shotIndex:{"index":1}',
          fields: [{ label: 'nodeFields.duration', value: '2s' }],
        },
      ],
    })
  })

  it('adds a stable director decoupage pending node when a ready screenplay has no edit script yet', () => {
    const editScreenplay = createEditScreenplay()
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      editScreenplay,
      editScript: null,
      savedLayouts: [],
      translate: t,
    })

    const screenplayNode = projection.nodes.find((node) => node.id === 'edit-screenplay:screenplay-1')
    expect(screenplayNode?.data.actionLabel).toBe('actions.generateEditDirectorDecoupage')
    expect(screenplayNode?.data.action).toEqual({
      type: 'generate_edit_director_decoupage',
      screenplayId: 'screenplay-1',
    })
    const directorNode = projection.nodes.find((node) => node.id === 'edit-director-decoupage:screenplay:screenplay-1')
    expect(directorNode?.data.targetType).toBe('editScreenplay')
    expect(directorNode?.data.targetId).toBe('screenplay-1')
    expect(directorNode?.data.statusLabel).toBe('status.pending')
    expect(directorNode?.data.action).toEqual({
      type: 'generate_edit_director_decoupage',
      screenplayId: 'screenplay-1',
    })
    expect(projection.edges).toContainEqual(expect.objectContaining({
      source: 'edit-screenplay:screenplay-1',
      target: 'edit-director-decoupage:screenplay:screenplay-1',
    }))
  })

  it('projects legacy edit screenplay rows without a user prompt', () => {
    const editScreenplay = {
      ...createEditScreenplay(),
      userPrompt: undefined,
    } as unknown as ProjectEditScreenplay
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      editScreenplay,
      savedLayouts: [],
      translate: t,
    })

    const screenplayNode = projection.nodes.find((node) => node.id === 'edit-screenplay:screenplay-1')
    expect(screenplayNode?.data.kind).toBe('editScreenplay')
    expect(screenplayNode?.data.editScreenplayDetails).toEqual({
      screenplayText: editScreenplay.screenplayText,
      userPrompt: '',
    })
  })

  it('keeps the director decoupage node visible after the core edit table is ready', () => {
    const editScreenplay = createEditScreenplay({ styleBible: createStyleBible() })
    const editDirectorDecoupage = createDirectorDecoupage({
      id: 'director-ready',
      screenplayId: editScreenplay.id,
    })
    const editScript = createSingleVideoEditScript({ id: 'edit-after-director', styleBible: editScreenplay.styleBible })
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      editScreenplay,
      editDirectorDecoupage,
      editScript,
      savedLayouts: [],
      translate: t,
    })

    const directorNode = projection.nodes.find((node) => node.id === 'edit-director-decoupage:screenplay:screenplay-1')
    const processNode = projection.nodes.find((node) => node.id === 'edit-process:edit-after-director')
    expect(directorNode?.data.kind).toBe('editDirectorDecoupage')
    expect(directorNode?.data.layoutNodeType).toBe('editDirectorDecoupage')
    expect(directorNode?.data.targetType).toBe('editScreenplay')
    expect(directorNode?.data.editPipelineStepDetails?.items[0]).toMatchObject({
      title: 'nodeFields.shotIndex:{"index":1}',
      fields: expect.arrayContaining([
        { label: 'nodeFields.dramaticPurpose', value: 'establish hesitation' },
        { label: 'nodeFields.viewpoint', value: 'restricted protagonist viewpoint' },
        { label: 'nodeFields.continuityOut', value: 'continue along the pilot eyeline' },
      ]),
      body: 'Pilot stops before the sealed door.',
    })
    expect(processNode?.data.kind).toBe('editProcessGroup')
    expect(processNode && directorNode ? processNode.position.y : 0).toBeGreaterThan(
      directorNode ? directorNode.position.y + directorNode.data.height : 0,
    )
    expect(projection.edges).toContainEqual(expect.objectContaining({
      id: 'edge:director-decoupage-edit-process:edit-after-director',
      source: 'edit-director-decoupage:screenplay:screenplay-1',
      target: 'edit-process:edit-after-director',
    }))
  })

  it('projects the style bible as the style source between screenplay and edit generation', () => {
    const styleBible = createStyleBible()
    const editScreenplay = createEditScreenplay({
      styleBible,
      stylePreviews: [
        {
          id: 'style-preview-confirmed',
          projectId: 'project-1',
          episodeId: 'episode-1',
          screenplayId: 'screenplay-1',
          styleKey: 'style_b',
          aspectRatio: '16:9',
          title: '自然光主方案',
          summary: '低饱和自然光，克制胶片感。',
          styleBible,
          gridImagePrompt: 'single image, 3x3 grid, nine cinematic frames, no text',
          imageKey: 'style-preview/confirmed.png',
          imageUrl: 'https://cdn.example.com/style-preview-confirmed.png',
          status: 'confirmed',
          taskId: 'task-confirmed',
          errorMessage: null,
        },
      ],
    })
    const editScript = createSingleVideoEditScript({ videoBlocks: [], styleBible })
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      editScreenplay,
      editScript,
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.map((node) => node.id)).toEqual([
      'edit-screenplay:screenplay-1',
      'edit-style-bible:screenplay-1',
      'edit-process:edit-video',
      'edit-script:edit-video',
      'edit-cinematography-shot-plan:edit-script:edit-video',
    ])
    expect(projection.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      'edit-screenplay:screenplay-1->edit-style-bible:screenplay-1',
      'edit-style-bible:screenplay-1->edit-process:edit-video',
      'edit-process:edit-video->edit-script:edit-video',
      'edit-script:edit-video->edit-cinematography-shot-plan:edit-script:edit-video',
    ])

    const styleNode = projection.nodes.find((node) => node.id === 'edit-style-bible:screenplay-1')
    const timelineNode = projection.nodes.find((node) => node.id === 'edit-process:edit-video')
    expect(styleNode?.data.kind).toBe('editStyleBible')
    expect(styleNode?.data.layoutNodeType).toBe('editStyleBible')
    expect(styleNode?.data.targetType).toBe('editStyleBible')
    expect(styleNode?.data.title).toBe('nodes.editStyleBible.title')
    expect(styleNode?.data.body).toBe('低饱和自然光禅意电影质感。')
    expect(styleNode?.data.previewImageUrl).toBe('https://cdn.example.com/style-preview-confirmed.png')
    expect(styleNode?.data.styleBibleDetails?.styleSummary).toBe('低饱和自然光禅意电影质感。')
    expect(styleNode?.data.styleBibleDetails?.visual.imageFilterPrompt).toBe('清澈空气感，35mm 镜头，克制高光。')
    expect(styleNode?.data.styleBibleDetails?.hardBans).toEqual(['商业广告感', '高反差大片感', '炫技运镜'])
    expect(timelineNode?.position.y ?? 0).toBeGreaterThanOrEqual(
      (styleNode?.position.y ?? 0) + (styleNode?.data.height ?? 0),
    )
    expect(styleNode && timelineNode ? nodesOverlap(styleNode, timelineNode) : true).toBe(false)
  })

  it('keeps transient screenplay style preview candidates out of the canvas before confirmation', () => {
    const styleBible = createStyleBible()
    const editScreenplay = createEditScreenplay({
      styleBible: null,
      status: 'style_preview_ready',
      stylePreviews: [
        {
          id: 'style-preview-a',
          projectId: 'project-1',
          episodeId: 'episode-1',
          screenplayId: 'screenplay-1',
          styleKey: 'style_a',
          aspectRatio: '9:16',
          title: '自然光主方案',
          summary: '低饱和自然光，克制胶片感。',
          styleBible,
          gridImagePrompt: 'single image, 3x3 grid, nine cinematic frames, no text',
          imageKey: 'style-preview/a.png',
          imageUrl: 'https://cdn.example.com/a.png',
          status: 'completed',
          taskId: 'task-a',
          errorMessage: null,
        },
        {
          id: 'style-preview-b',
          projectId: 'project-1',
          episodeId: 'episode-1',
          screenplayId: 'screenplay-1',
          styleKey: 'style_b',
          aspectRatio: '16:9',
          title: '夜色情绪',
          summary: '暗部更强，情绪更悬疑。',
          styleBible,
          gridImagePrompt: 'single image, 3x3 grid, nine cinematic frames, no text',
          imageKey: 'style-preview/b.png',
          imageUrl: 'https://cdn.example.com/b.png',
          status: 'completed',
          taskId: 'task-b',
          errorMessage: null,
        },
        {
          id: 'style-preview-c',
          projectId: 'project-1',
          episodeId: 'episode-1',
          screenplayId: 'screenplay-1',
          styleKey: 'style_c',
          aspectRatio: '21:9',
          title: '作者化留白',
          summary: '更克制、更安静的作者化方案。',
          styleBible,
          gridImagePrompt: 'single image, 3x3 grid, nine cinematic frames, no text',
          imageKey: 'style-preview/c.png',
          imageUrl: 'https://cdn.example.com/c.png',
          status: 'completed',
          taskId: 'task-c',
          errorMessage: null,
        },
      ],
    })

    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      editScreenplay,
      savedLayouts: [],
      translate: t,
    })

    const previewNodes = projection.nodes.filter((node) => node.data.kind === 'editStylePreview')
    expect(projection.nodes.some((node) => node.data.kind === 'editStyleBible')).toBe(false)
    expect(previewNodes).toEqual([])
    expect(projection.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([])
  })

  it('keeps long edit screenplay cards from covering the edit pipeline in the default layout', () => {
    const editScreenplay = createEditScreenplay({
      screenplayText: [
        '标题：《四季轮回》',
        '故事梗概：师傅在四季更迭中教导弟子，万物皆有终始，而生命在轮回中永恒。',
        '角色表：',
        '师傅：年迈长者，白须垂胸，身着灰色粗布长袍，神态安详。',
        '弟子：年轻僧人，光头，身着棕色棉麻僧袍，眼神清澈。',
        ...Array.from({ length: 20 }, (_item, index) => (
          `场景 ${index + 1}：山间小径上，师傅与弟子缓步前行，风吹过桃花与落叶，画面保持安静留白。`
        )),
      ].join('\n\n'),
    })
    const editScript = createSingleVideoEditScript({ videoBlocks: [] })

    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      editScreenplay,
      editScript,
      savedLayouts: [],
      translate: t,
    })

    const screenplayNode = projection.nodes.find((node) => node.id === 'edit-screenplay:screenplay-1')
    const timelineNode = projection.nodes.find((node) => node.id === 'edit-process:edit-video')

    expect(screenplayNode?.data.height).toBeGreaterThan(380)
    expect(timelineNode?.position.y ?? 0).toBeGreaterThanOrEqual(
      (screenplayNode?.position.y ?? 0) + (screenplayNode?.data.height ?? 0),
    )
    expect(screenplayNode && timelineNode ? nodesOverlap(screenplayNode, timelineNode) : true).toBe(false)
  })

  it('binds final timeline running state to the final render task target', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'A real story',
      clips: [createClip('clip-1', 'clip content')],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({
              id: 'panel-1',
              panelIndex: 0,
              imageUrl: 'https://example.com/panel-1.png',
              videoUrl: 'https://example.com/panel-1.mp4',
            }),
          ],
        }),
      ],
      editScript: createSingleVideoEditScript(),
      savedLayouts: [],
      translate: t,
    })

    const finalNode = projection.nodes.find((node) => node.id === 'final:episode-1')
    const target = TASK_RUNTIME_TARGETS.projectEpisodeFinalRender('episode-1')
    expect(target).not.toBeNull()
    expect(finalNode?.data.runtimeTargets).toEqual(target ? [target] : [])
    if (!finalNode || !target) throw new Error('FINAL_NODE_TARGET_MISSING')
    const patch = resolveWorkspaceNodeRuntimePatch({
      node: finalNode,
      statesByQueryKey: new Map([[
        taskRuntimeTargetQueryKey(target),
        {
          phase: 'processing',
          runningTaskId: 'task-final',
          runningTaskType: 'final_video_render',
          lastError: null,
        },
      ]]),
      isOptimisticallyRunning: false,
      labels: {
        running: 'status.aiEditing',
        failed: 'status.failed',
      },
    })
    expect(patch.statusLabel).toBe('status.aiEditing')
    expect(patch.isRunning).toBe(true)
  })

  it('shows a running edit table placeholder while the assistant is generating it', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'A real story',
      clips: [],
      storyboards: [],
      editScriptPending: true,
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.map((node) => node.id)).toEqual([
      'analysis:episode-1',
      'edit-script:pending:episode-1',
    ])

    const pendingNode = projection.nodes.find((node) => node.id === 'edit-script:pending:episode-1')
    expect(pendingNode?.data.kind).toBe('editScript')
    expect(pendingNode?.data.statusLabel).toBe('status.processing')
    expect(pendingNode?.data.isRunning).toBe(true)
    expect(pendingNode?.data.title).toBe('nodes.editScript.pendingTitle')
    expect(projection.edges.map((edge) => `${edge.source}->${edge.target}`)).toContain(
      'analysis:episode-1->edit-script:pending:episode-1',
    )
  })

  it('does not invent a screenplay placeholder before a stable ProjectEditScreenplay target exists', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'A real story',
      clips: [],
      storyboards: [],
      activeAssistantOperationId: 'generate_edit_screenplay',
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.map((node) => node.id)).toEqual([
      'analysis:episode-1',
    ])
    expect(projection.edges.map((edge) => `${edge.source}->${edge.target}`)).not.toContain(
      'analysis:episode-1->edit-screenplay:pending:episode-1',
    )
  })

  it('keeps a persisted generating edit table visible after refresh', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      savedLayouts: [],
      translate: t,
      editScript: {
        id: 'edit-generating',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: '做一个科幻短片',
        title: 'Generating edit table',
        logline: null,
        durationSec: 60,
        shotCount: 0,
        status: 'generating',
        assetReviewStatus: 'pending',
        shots: [],
        videoBlocks: [],
        requirements: [],
      },
    })

    const node = projection.nodes.find((item) => item.id === 'edit-script:edit-generating')

    expect(projection.nodes.map((item) => item.id)).toEqual([
      'edit-process:edit-generating',
      'edit-script:edit-generating',
    ])
    const processNode = projection.nodes.find((item) => item.id === 'edit-process:edit-generating')
    const timelineStep = processNode?.data.editProcessGroupDetails?.steps.find((step) => step.key === 'timeline')
    expect(timelineStep?.statusLabel).toBe('status.processing')
    expect(processNode?.data.isRunning).toBe(true)
    expect(node?.data.kind).toBe('editScript')
    expect(node?.data.title).toBe('nodes.editScript.pendingTitle')
    expect(node?.data.body).toBe('nodes.editScript.pendingBody')
    expect(node?.data.statusLabel).toBe('status.processing')
    expect(node?.data.isRunning).toBe(true)
    expect(node?.data.actionLabel).toBeUndefined()
    expect(node?.data.editScriptDetails).toBeUndefined()
  })

  it('projects completed generation steps while the edit table is still generating', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      savedLayouts: [],
      translate: t,
      editScript: {
        id: 'edit-partial',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: '做一个科幻短片',
        screenplayText: '标题：《科幻短片》',
        title: 'Sci-Fi Short',
        logline: 'A quiet signal wakes a station.',
        durationSec: 3,
        shotCount: 1,
        status: 'generating',
        assetReviewStatus: 'pending',
        shots: [
          {
            shotNumber: 1,
            durationSec: 3,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'A station corridor flickers awake.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Station corridor',
            sound: '',
          },
        ],
        videoBlocks: [],
        requirements: [],
      },
    })

    const processNode = projection.nodes.find((node) => node.id === 'edit-process:edit-partial')
    const steps = processNode?.data.editProcessGroupDetails?.steps ?? []
    const timelineStep = steps.find((step) => step.key === 'timeline')
    const visualStep = steps.find((step) => step.key === 'visibleAction')
    const cameraStep = steps.find((step) => step.key === 'camera')
    const editNode = projection.nodes.find((node) => node.id === 'edit-script:edit-partial')

    expect(timelineStep?.statusLabel).toBe('status.ready')
    expect(visualStep?.statusLabel).toBe('status.ready')
    expect(cameraStep?.statusLabel).toBe('status.ready')
    expect(editNode?.data.title).toBe('Sci-Fi Short')
    expect(editNode?.data.editScriptDetails?.shots).toHaveLength(1)
    expect(editNode?.data.editScriptDetails?.shots[0]?.visibleAction).toBe('A station corridor flickers awake.')
  })

  it('shows final render failures on the final timeline node', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'A real story',
      clips: [createClip('clip-1', 'clip content')],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({
              id: 'panel-1',
              panelIndex: 0,
              imageUrl: 'https://example.com/panel-1.png',
              videoUrl: 'https://example.com/panel-1.mp4',
            }),
          ],
        }),
      ],
      editScript: createSingleVideoEditScript(),
      savedLayouts: [],
      translate: t,
    })

    const finalNode = projection.nodes.find((node) => node.id === 'final:episode-1')
    const target = TASK_RUNTIME_TARGETS.projectEpisodeFinalRender('episode-1')
    if (!finalNode || !target) throw new Error('FINAL_NODE_TARGET_MISSING')
    const patch = resolveWorkspaceNodeRuntimePatch({
      node: finalNode,
      statesByQueryKey: new Map([[
        taskRuntimeTargetQueryKey(target),
        {
          phase: 'failed',
          runningTaskId: null,
          runningTaskType: 'final_video_render',
          lastError: {
            code: 'PROVIDER_FAILED',
            message: 'Google music network failed',
          },
        },
      ]]),
      isOptimisticallyRunning: false,
      labels: {
        running: 'status.aiEditing',
        failed: 'status.failed',
      },
    })
    expect(patch.statusLabel).toBe('status.failed')
    expect(patch.isRunning).toBe(false)
    expect(patch.meta).toBe('Google music network failed')
  })

  it('adds a BGM score node and keeps final render disabled until BGM is completed', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'A real story',
      clips: [createClip('clip-1', 'clip content')],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({
              id: 'panel-1',
              panelIndex: 0,
              imageUrl: 'https://example.com/panel-1.png',
              videoUrl: 'https://example.com/panel-1.mp4',
            }),
          ],
        }),
      ],
      editScript: createSingleVideoEditScript(),
      savedLayouts: [],
      translate: t,
    })

    const bgmNode = projection.nodes.find((node) => node.id === 'bgm-score:episode-1')
    const finalNode = projection.nodes.find((node) => node.id === 'final:episode-1')
    expect(bgmNode?.data.kind).toBe('bgmScore')
    expect(bgmNode?.data.defaultExpanded).toBe(false)
    expect(bgmNode?.data.width).toBe(420)
    expect(bgmNode?.data.height).toBe(320)
    expect(bgmNode?.style).toMatchObject({ width: 420, height: 320 })
    expect(bgmNode?.data.action).toEqual({ type: 'generate_bgm_score' })
    expect(finalNode?.position.x).toBe(
      (bgmNode?.position.x ?? 0) + (bgmNode?.data.width ?? 0) + WORKSPACE_CANVAS_BGM_SCORE_TO_FINAL_GAP_X,
    )
    expect(finalNode && bgmNode ? nodesOverlap(finalNode, bgmNode) : true).toBe(false)
    expect(finalNode?.data.actionDisabled).toBe(true)
    expect(projection.edges.map((edge) => `${edge.source}->${edge.target}`)).toContain('bgm-score:episode-1->final:episode-1')
  })

  it('passes generated BGM score design into the expandable canvas node', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'A real story',
      clips: [createClip('clip-1', 'clip content')],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({
              id: 'panel-1',
              panelIndex: 0,
              imageUrl: 'https://example.com/panel-1.png',
              videoUrl: 'https://example.com/panel-1.mp4',
            }),
          ],
        }),
      ],
      editScript: createSingleVideoEditScript(),
      finalVideo: {
        id: 'editor-1',
        episodeId: 'episode-1',
        renderStatus: null,
        renderTaskId: null,
        outputUrl: null,
        updatedAt: '2026-05-11T04:50:59.342Z',
        bgmScore: {
          schemaVersion: 2,
          status: 'completed',
          taskId: 'task-bgm',
          editScriptId: 'edit-video',
          timelineSignature: 'sig',
          durationSeconds: 2,
          musicModel: 'music-model',
          plan: {
            durationSeconds: 2,
            creativeBrief: {
              cueType: 'continuous instrumental underscore',
              genre: 'sci-fi drama',
              mood: 'awe',
              narrativeFunction: 'connect the final edit',
            },
            scoreDesign: {
              overview: 'One coherent reveal cue.',
              sections: [
                {
                  category: 'Reveal',
                  title: 'Planet reveal',
                  purpose: 'support awe without literal sound effects',
                  startSec: 0,
                  endSec: 2,
                  content: 'Open harmony and wide register.',
                },
              ],
            },
            virtualLayers: [
              {
                name: 'wide pad',
                purpose: 'internal color',
                content: 'Text-only layer inside the single final cue.',
              },
            ],
            promptSections: [
              {
                title: 'Main prompt',
                purpose: 'provider prompt basis',
                startSec: 0,
                endSec: 2,
                content: 'Generate one continuous reveal cue.',
              },
            ],
            finalPrompt: 'Generate one complete continuous instrumental cinematic BGM track for 2 seconds.',
            negativePrompt: 'no vocals',
          },
          mix: {
            mediaId: 'media-mix',
            url: 'https://example.com/bgm-mix.m4a',
            storageKey: 'music/bgm-mix.m4a',
            mimeType: 'audio/mp4',
            durationMs: 2000,
          },
        },
      },
      savedLayouts: [],
      translate: t,
    })

    const bgmNode = projection.nodes.find((node) => node.id === 'bgm-score:episode-1')
    const finalNode = projection.nodes.find((node) => node.id === 'final:episode-1')
    expect(bgmNode?.data.defaultExpanded).toBe(true)
    expect(bgmNode?.data.bgmScoreDetails?.mixUrl).toBe('https://example.com/bgm-mix.m4a')
    expect(bgmNode?.data.bgmScoreDetails?.scoreOverview).toBe('One coherent reveal cue.')
    expect(bgmNode?.data.bgmScoreDetails?.designSections[0]).toMatchObject({
      category: 'Reveal',
      title: 'Planet reveal',
    })
    expect(bgmNode?.data.bgmScoreDetails?.virtualLayers[0]).toMatchObject({
      name: 'wide pad',
    })
    expect(bgmNode?.data.bgmScoreDetails?.finalPrompt).toContain('one complete continuous')
    expect(finalNode?.data.actionDisabled).toBe(false)
  })

  it('marks completed BGM without saved score design as missing prompt design', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'A real story',
      clips: [createClip('clip-1', 'clip content')],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({
              id: 'panel-1',
              panelIndex: 0,
              imageUrl: 'https://example.com/panel-1.png',
              videoUrl: 'https://example.com/panel-1.mp4',
            }),
          ],
        }),
      ],
      editScript: createSingleVideoEditScript(),
      finalVideo: {
        id: 'editor-1',
        episodeId: 'episode-1',
        renderStatus: null,
        renderTaskId: null,
        outputUrl: null,
        updatedAt: '2026-05-11T04:50:59.342Z',
        bgmScore: {
          schemaVersion: 1,
          status: 'completed',
          taskId: 'task-bgm',
          editScriptId: 'edit-video',
          timelineSignature: 'sig',
          durationSeconds: 2,
          musicModel: 'music-model',
          mix: {
            mediaId: 'media-mix',
            url: 'https://example.com/bgm-mix.m4a',
            storageKey: 'music/bgm-mix.m4a',
            mimeType: 'audio/mp4',
            durationMs: 2000,
          },
        },
      },
      savedLayouts: [],
      translate: t,
    })

    const bgmNode = projection.nodes.find((node) => node.id === 'bgm-score:episode-1')
    expect(bgmNode?.data.meta).toBe('nodes.bgmScore.readyMissingPromptDesign')
    expect(bgmNode?.data.bgmScoreDetails?.hasPromptDesign).toBe(false)
    expect(bgmNode?.data.bgmScoreDetails?.promptDesignMissing).toBe(true)
  })

  it('shows completed final render output on the final timeline node', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'A real story',
      clips: [createClip('clip-1', 'clip content')],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({
              id: 'panel-1',
              panelIndex: 0,
              imageUrl: 'https://example.com/panel-1.png',
              videoUrl: 'https://example.com/panel-1.mp4',
            }),
          ],
        }),
      ],
      editScript: createSingleVideoEditScript(),
      finalVideo: {
        id: 'editor-1',
        episodeId: 'episode-1',
        renderStatus: 'completed',
        renderTaskId: 'task-1',
        outputUrl: '/m/final-video.mp4',
        updatedAt: '2026-05-11T04:50:59.342Z',
      },
      savedLayouts: [],
      translate: t,
    })

    const finalNode = projection.nodes.find((node) => node.id === 'final:episode-1')
    expect(finalNode?.data.statusLabel).toBe('status.finalReady')
    expect(finalNode?.data.meta).toBe('nodes.final.outputReady')
    expect(finalNode?.data.finalDetails?.outputUrl).toBe('/m/final-video.mp4')
    expect(finalNode?.data.finalDetails?.renderStatus).toBe('completed')
  })

  it('uses saved layout only for node position and preserves business ordering', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'A real story',
      clips: [createClip('clip-1', 'clip content')],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({ id: 'panel-late', panelIndex: 9, panelNumber: 9 }),
            createPanel({ id: 'panel-early', panelIndex: 0, panelNumber: 1 }),
          ],
        }),
      ],
      savedLayouts: [
        {
          nodeKey: 'shot:panel-early',
          x: 999,
          y: 888,
          width: 320,
          height: 214,
          zIndex: 0,
          locked: true,
          collapsed: false,
        },
      ],
      translate: t,
    })

    const shotNodes = projection.nodes.filter((node) => node.data.kind === 'shot')
    expect(shotNodes.map((node) => node.id)).toEqual(['shot:panel-early', 'shot:panel-late'])
    expect(shotNodes[0].position).toEqual({ x: 999, y: 888 })
  })

  it('places panel-derived nodes in a five-column default grid', () => {
    const panels = Array.from({ length: 6 }, (_item, index) => createPanel({
      id: `panel-${index + 1}`,
      panelIndex: index,
      imageUrl: `https://example.com/panel-${index + 1}.png`,
    }))

    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'A real story',
      clips: [createClip('clip-1', 'clip content')],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels,
        }),
      ],
      savedLayouts: [],
      translate: t,
    })

    const shotNodes = projection.nodes.filter((node) => node.data.kind === 'shot')
    expect(shotNodes).toHaveLength(6)
    expect(projection.nodes.filter((node) => node.data.kind === 'imageAsset')).toHaveLength(0)
    expect(shotNodes[1].position.x).toBeGreaterThan(shotNodes[0].position.x)
    expect(shotNodes[1].position.y).toBe(shotNodes[0].position.y)
    expect(shotNodes[5].position.x).toBe(shotNodes[0].position.x)
    expect(shotNodes[5].position.y).toBeGreaterThan(shotNodes[0].position.y)
  })

  it('repairs overlapping saved node positions without changing business ordering', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({ id: 'panel-1', panelIndex: 0 }),
            createPanel({ id: 'panel-2', panelIndex: 1 }),
          ],
        }),
      ],
      savedLayouts: [
        {
          nodeKey: 'shot:panel-1',
          x: 100,
          y: 100,
          width: 320,
          height: 560,
          zIndex: 0,
          locked: false,
          collapsed: false,
        },
        {
          nodeKey: 'shot:panel-2',
          x: 100,
          y: 100,
          width: 320,
          height: 560,
          zIndex: 1,
          locked: false,
          collapsed: false,
        },
      ],
      translate: t,
    })

    const shotNodes = projection.nodes.filter((node) => node.data.kind === 'shot')
    expect(shotNodes).toHaveLength(2)
    expect(shotNodes[0].position).toEqual({ x: 100, y: 100 })
    expect(shotNodes[1].position.x).toBe(100)
    expect(shotNodes[1].position.y).toBeGreaterThan(shotNodes[0].position.y)
  })

  it('sizes tall video segment cards and pushes the next row below them', () => {
    const panels = Array.from({ length: 6 }, (_item, index) => createPanel({
      id: `panel-${index + 1}`,
      panelIndex: index,
      panelNumber: index + 1,
      imageUrl: `https://example.com/shot-${index + 1}.png`,
    }))
    const videoBlocks = Array.from({ length: 6 }, (_item, index) => ({
      kind: 'single' as const,
      shotNumbers: [index + 1],
      reason: `A deliberately long video segment reason ${index + 1}. `.repeat(12),
      prompt: `A deliberately long video segment prompt ${index + 1}. `.repeat(18),
    }))

    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels,
        }),
      ],
      savedLayouts: [],
      translate: t,
      defaultSequenceVideoModel: null,
      editScript: createSingleVideoEditScript({
        id: 'edit-tall-video',
        shotCount: 6,
        durationSec: 24,
        shots: videoBlocks.map((block, index) => ({
          shotNumber: index + 1,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: `Shot ${index + 1}`,
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Room',
          sound: 'room tone',
        })),
        videoBlocks,
      }),
    })

    const videoPlanNodes = projection.nodes.filter((node) => node.data.kind === 'videoPlan')
    expect(videoPlanNodes).toHaveLength(6)
    expect(videoPlanNodes[0].data.height).toBeGreaterThan(560)
    expect(videoPlanNodes[5].position.x).toBe(videoPlanNodes[0].position.x)
    expect(videoPlanNodes[5].position.y).toBeGreaterThan(videoPlanNodes[0].position.y)
    videoPlanNodes.forEach((node, index) => {
      videoPlanNodes.slice(index + 1).forEach((otherNode) => {
        expect(nodesOverlap(node, otherNode)).toBe(false)
      })
    })
  })

  it('projects full visual business details into typed node data', () => {
    const screenplay = JSON.stringify({
      scenes: [
        {
          scene_number: 1,
          heading: { int_ext: 'EXT', location: '城市街道_雨夜', time: '夜晚' },
          description: '雨夜街道',
          characters: ['小机器人', '小女孩'],
          content: [
            { type: 'action', text: '小机器人举起发光路灯。' },
            { type: 'dialogue', character: '小女孩', text: '我们到家了吗？' },
          ],
        },
      ],
    })
    const clip: ProjectClip = {
      ...createClip('clip-rich', 'original clip text'),
      summary: 'rich summary',
      location: '["城市街道_雨夜"]',
      characters: JSON.stringify([{ name: '小机器人', appearance: '初始形象' }]),
      props: '["发光路灯"]',
      screenplay,
      start: 2,
      end: 8,
      duration: 6,
      shotCount: 5,
    }
    const panel = createPanel({
      id: 'panel-rich',
      panelIndex: 0,
      shotType: '全景',
      cameraMove: '缓慢推进',
      description: 'rich panel description',
      location: '城市街道_雨夜',
      characters: JSON.stringify([{ name: '小女孩', appearance: '初始形象' }]),
      props: '["发光路灯"]',
      srtSegment: '小女孩说话',
      srtStart: 2,
      srtEnd: 4,
      duration: 2,
      imagePrompt: 'rich image prompt',
      videoPrompt: null,
      candidateImages: JSON.stringify(['https://example.com/a.png', 'PENDING:1']),
      imageHistory: 'image history json',
      sketchImageUrl: 'https://example.com/sketch.png',
      previousImageUrl: 'https://example.com/previous.png',
      firstLastFramePrompt: 'first last prompt',
      videoUrl: 'https://example.com/video.mp4',
      videoGenerationMode: 'firstlastframe',
      lastVideoGenerationOptions: { duration: 5, enhance: true },
      videoModel: 'video-model',
      linkedToNextPanel: true,
      photographyRules: JSON.stringify({
        cameraPlan: {
          shotBlocking: {
            absolutePosition: '中景靠近左侧墙面',
            screenPosition: '画面左三分之一',
          },
        },
      }),
      actingNotes: 'acting notes',
      imageErrorMessage: 'image failed',
      videoErrorMessage: 'video failed',
    })

    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: 'story',
      clips: [clip],
      storyboards: [{
        ...createStoryboard({ id: 'storyboard-rich', clipId: 'clip-rich', panels: [panel] }),
        storyboardTextJson: 'storyboard json',
        photographyPlan: 'photography plan',
        lastError: 'storyboard failed',
      }],
      shots: [createShot('shot-rich', '01')],
      editScript: createSingleVideoEditScript({
        id: 'edit-rich',
        title: 'Rich Detail Script',
        videoBlocks: [
          {
            kind: 'single',
            shotNumbers: [1],
            reason: 'The shot should remain isolated.',
            prompt: 'Edit-first rich video prompt.',
          },
        ],
      }),
      savedLayouts: [],
      translate: t,
    })

    const clipNode = projection.nodes.find((node) => node.id === 'clip:clip-rich')
    expect(clipNode?.data.body).toContain('"scenes"')
    expect(clipNode?.data.scriptDetails?.screenplayText).toBe(screenplay)
    expect(clipNode?.data.scriptDetails?.originalText).toBe('original clip text')
    expect(clipNode?.data.scriptDetails?.characters).toEqual([{ name: '小机器人', appearance: '初始形象' }])
    expect(clipNode?.data.scriptDetails?.locations).toEqual(['城市街道_雨夜'])
    expect(clipNode?.data.scriptDetails?.props).toEqual(['发光路灯'])
    expect(clipNode?.data.scriptDetails?.scenes[0]?.lines).toEqual([
      { kind: 'action', speaker: null, text: '小机器人举起发光路灯。' },
      { kind: 'dialogue', speaker: '小女孩', text: '我们到家了吗？' },
    ])

    const shotNode = projection.nodes.find((node) => node.id === 'shot:panel-rich')
    expect(shotNode?.data.shotDetails).toMatchObject({
      shotType: '全景',
      cameraMove: '缓慢推进',
      location: '城市街道_雨夜',
      srtSegment: '小女孩说话',
      imagePrompt: 'rich image prompt',
      videoPrompt: null,
      photographyRules: JSON.stringify({
        cameraPlan: {
          shotBlocking: {
            absolutePosition: '中景靠近左侧墙面',
            screenPosition: '画面左三分之一',
          },
        },
      }),
      shotBlocking: {
        absolutePosition: '中景靠近左侧墙面',
        screenPosition: '画面左三分之一',
      },
      actingNotes: 'acting notes',
      storyboardTextJson: 'storyboard json',
      photographyPlan: 'photography plan',
      errorMessage: 'image failed',
    })
    expect(shotNode?.data.shotDetails?.characters).toEqual([{ name: '小女孩', appearance: '初始形象' }])
    expect(shotNode?.data.shotDetails?.promptShot?.plot).toBe('prompt plot')

    expect(shotNode?.data.previewImageUrl).toBe('https://example.com/a.png')
    expect(shotNode?.data.imageDetails).toMatchObject({
      imagePrompt: 'rich image prompt',
      candidateImages: ['https://example.com/a.png', 'PENDING:1'],
      imageHistory: 'image history json',
      sketchImageUrl: 'https://example.com/sketch.png',
      previousImageUrl: 'https://example.com/previous.png',
      errorMessage: 'image failed',
    })

    const videoPlanNode = projection.nodes.find((node) => node.id === 'video-plan:edit-rich:1')
    expect(videoPlanNode?.data.kind).toBe('videoPlan')
    expect(videoPlanNode?.data.videoPlanDetails).toMatchObject({
      kind: 'single',
      shotNumbers: [1],
      prompt: 'Edit-first rich video prompt.',
      outputUrl: 'https://example.com/video.mp4',
    })
    expect(projection.nodes.some((node) => node.data.kind === 'videoClip')).toBe(false)

    const finalNode = projection.nodes.find((node) => node.id === 'final:episode-1')
    expect(finalNode?.data.finalDetails).toMatchObject({
      totalShots: 1,
      totalImages: 1,
      totalVideos: 1,
      totalDuration: 2,
    })
    expect(projection.nodes.some((node) => node.data.kind === 'finalTimeline')).toBe(true)
  })

  it('projects edit-first table and required asset nodes on the canvas', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      savedLayouts: [],
      translate: t,
      editScript: {
        id: 'edit-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: 'one minute sci-fi',
        title: 'Orbital Silence',
        logline: 'A pilot meets a machine intelligence.',
        durationSec: 60,
        shotCount: 2,
        status: 'ready',
        assetReviewStatus: 'pending',
        shots: [
          {
            shotNumber: 1,
            durationSec: 30,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'Pilot crosses the docking bay.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Pilot / Docking Bay',
            sound: 'air hum',
          },
          {
            shotNumber: 2,
            durationSec: 30,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'A red machine eye opens.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Pilot / AI Chamber',
            sound: 'sub bass pulse',
          },
        ],
        videoBlocks: [
          {
            kind: 'group',
            shotNumbers: [1, 2],
            gridMode: '2x2',
            reason: 'Shared corridor motion should be generated as one segment.',
            prompt: 'Edit-first continuous corridor prompt.',
          },
        ],
        requirements: [
          {
            id: 'req-character',
            kind: 'character',
            name: 'Pilot',
            description: 'A quiet astronaut in a minimal suit.',
            shotNumbers: [1, 2],
            status: 'pending',
            targetId: null,
            errorMessage: null,
          },
          {
            id: 'req-location',
            kind: 'location',
            name: 'Docking Bay',
            description: 'A sterile white docking bay with red warning light.\nPossible positions:\n- wide entrance angle\n- central axis view\n- distant observation point near the airlock',
            shotNumbers: [1],
            status: 'completed',
            targetId: 'location-1',
            taskTargetType: 'LocationImage',
            taskTargetId: 'location-1',
            errorMessage: null,
            previewImageUrl: 'https://example.com/location.png',
            spatialProfileStatus: 'ready',
            spatialProfileModel: 'vision-model',
            spatialProfileJson: {
              schemaVersion: 1,
              sceneSummary: 'Docking bay left airlock and central platform.',
              anchors: [{
                id: 'anchor-platform',
                label: 'central platform',
                screenArea: 'middle of the bay',
                depthLayer: 'midground',
                spatialRelations: ['beside the warning light'],
              }],
              depthLayout: {
                foreground: 'floor markings',
                midground: 'central platform',
                background: 'airlock wall',
              },
              lightingDirection: 'red light from rear wall',
            },
          },
        ],
      },
    })

    expect(projection.nodes.map((node) => node.id)).toEqual([
      'edit-process:edit-1',
      'edit-script:edit-1',
      'edit-asset-group:edit-1',
      'edit-cinematography-shot-plan:edit-script:edit-1',
    ])
    const editNode = projection.nodes.find((node) => node.id === 'edit-script:edit-1')
    expect(editNode?.data.kind).toBe('editScript')
    expect(editNode?.data.action).toEqual({ type: 'generate_edit_assets', editScriptId: 'edit-1' })
    expect(editNode?.data.editScriptDetails?.shots).toHaveLength(2)
    expect(editNode?.data.width).toBeGreaterThan(700)
    expect(editNode?.data.height).toBeGreaterThan(400)

    const processNode = projection.nodes.find((node) => node.id === 'edit-process:edit-1')
    const processSteps = processNode?.data.editProcessGroupDetails?.steps ?? []
    const visualStep = processSteps.find((step) => step.key === 'visibleAction')
    expect(visualStep?.items[0]).toMatchObject({
      title: 'nodeFields.shotIndex:{"index":1}',
      fields: [{ label: 'nodeFields.charactersAndScene', value: 'Pilot / Docking Bay' }],
      body: 'Pilot crosses the docking bay.',
    })
    const assetStep = processSteps.find((step) => step.key === 'assetExtract')
    expect(assetStep?.items).toHaveLength(2)

    expect(projection.nodes.some((node) => node.id === 'video-plan:edit-1:1')).toBe(false)
    const consistencyNode = projection.nodes.find((node) => node.id === 'space-consistency:edit-script:edit-1')
    expect(consistencyNode).toBeUndefined()

    // 资产合并为单张 editAssetGroup 卡，卡内逐资产保留缩略图与单独操作
    const assetGroupNode = projection.nodes.find((node) => node.id === 'edit-asset-group:edit-1')
    expect(assetGroupNode?.data.kind).toBe('editAssetGroup')
    const groupAssets = assetGroupNode?.data.editAssetGroupDetails?.assets ?? []
    expect(groupAssets).toHaveLength(2)

    const characterAsset = groupAssets.find((asset) => asset.requirementId === 'req-character')
    expect(characterAsset?.action).toEqual({
      type: 'generate_edit_asset',
      editScriptId: 'edit-1',
      requirementId: 'req-character',
    })

    const locationAsset = groupAssets.find((asset) => asset.requirementId === 'req-location')
    expect(locationAsset?.kind).toBe('location')
    expect(locationAsset?.action).toEqual({
      type: 'regenerate_edit_asset_image',
      assetId: 'location-1',
      kind: 'location',
    })
    expect(locationAsset?.previewImageUrl).toBe('https://example.com/location.png')
    expect(locationAsset?.shotNumbers).toEqual([1])

    expect(Math.abs(
      (assetGroupNode?.position.y ?? 0)
      - ((editNode?.position.y ?? 0) + (editNode?.data.height ?? 0) + WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y),
    )).toBeLessThanOrEqual(16)
  })

  it('enriches edit script preview shots with storyboard image prompts and media urls', () => {
    const editScript = createSingleVideoEditScript({
      id: 'edit-preview',
      durationSec: 6,
      shotCount: 2,
      shots: [
        {
          shotNumber: 1,
          durationSec: 3,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Pilot crosses the docking bay.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Pilot / Docking Bay',
          sound: 'air hum',
        },
        {
          shotNumber: 2,
          durationSec: 3,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'A red machine eye opens.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Pilot / AI Chamber',
          sound: 'sub bass pulse',
        },
      ],
      videoBlocks: [
        {
          kind: 'group',
          shotNumbers: [1, 2],
          gridMode: '2x2',
          reason: 'Continuous beat.',
          prompt: 'Continuous video block prompt.',
        },
      ],
    })
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [
        createStoryboard({
          id: 'storyboard-preview',
          clipId: 'clip-preview',
          panels: [
            createPanel({
              id: 'panel-preview-1',
              storyboardId: 'storyboard-preview',
              panelIndex: 0,
              panelNumber: 1,
              imagePrompt: 'Storyboard image prompt for shot one.',
              videoPrompt: null,
              imageUrl: 'https://example.com/shot-one.png',
              videoUrl: 'https://example.com/shot-one.mp4',
            }),
            createPanel({
              id: 'panel-preview-2',
              storyboardId: 'storyboard-preview',
              panelIndex: 1,
              panelNumber: 2,
              imagePrompt: 'Storyboard image prompt for shot two.',
              videoPrompt: null,
              imageUrl: 'https://example.com/shot-two.png',
              videoUrl: null,
            }),
          ],
        }),
      ],
      savedLayouts: [],
      translate: t,
      editScript,
    })

    const editNode = projection.nodes.find((node) => node.id === 'edit-script:edit-preview')
    expect(editNode?.data.editScriptDetails?.shots[0]).toMatchObject({
      shotNumber: 1,
      imagePrompt: 'Storyboard image prompt for shot one.',
      imageUrl: 'https://example.com/shot-one.png',
      videoUrl: 'https://example.com/shot-one.mp4',
    })
    expect(editNode?.data.editScriptDetails?.shots[1]).toMatchObject({
      shotNumber: 2,
      imagePrompt: 'Storyboard image prompt for shot two.',
      imageUrl: 'https://example.com/shot-two.png',
      videoUrl: null,
    })
  })

  it('projects video arrangement nodes only after storyboard images exist', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({
              id: 'panel-1',
              panelIndex: 0,
              panelNumber: 1,
              imageUrl: 'https://example.com/shot-1.png',
              media: {
                id: 'media-shot-1',
                publicId: 'media-shot-1',
                url: 'https://example.com/shot-1.png',
                mimeType: 'image/png',
                sizeBytes: null,
                width: 1920,
                height: 1080,
                durationMs: null,
              },
            }),
            createPanel({
              id: 'panel-2',
              panelIndex: 1,
              panelNumber: 2,
              imageUrl: 'https://example.com/shot-2.png',
              media: {
                id: 'media-shot-2',
                publicId: 'media-shot-2',
                url: 'https://example.com/shot-2.png',
                mimeType: 'image/png',
                sizeBytes: null,
                width: 1920,
                height: 1080,
                durationMs: null,
              },
            }),
          ],
        }),
      ],
      savedLayouts: [],
      translate: t,
      defaultSequenceVideoModel: 'ark::sequence-project-model',
      editScript: {
        id: 'edit-2',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: 'short sci-fi',
        title: 'Orbital Silence',
        logline: 'A pilot meets a machine intelligence.',
        durationSec: 9,
        shotCount: 2,
        status: 'ready',
        assetReviewStatus: 'pending',
        shots: [
          {
            shotNumber: 1,
            durationSec: 5,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'Pilot crosses the docking bay.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Pilot / Docking Bay',
            sound: 'air hum',
          },
          {
            shotNumber: 2,
            durationSec: 4,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'A red machine eye opens.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Pilot / AI Chamber',
            sound: 'sub bass pulse',
          },
        ],
        videoBlocks: [
          {
            kind: 'group',
            shotNumbers: [1, 2],
            gridMode: '2x2',
            reason: 'Shared camera movement should be generated as one segment.',
            prompt: 'Edit-first combined prompt.',
          },
        ],
        requirements: [],
      },
      videoGroups: [
        {
          id: 'group-1',
          projectId: 'project-1',
          episodeId: 'episode-1',
          gridMode: '2x2',
          shotNumbers: [1, 2],
          durationSec: 9,
          prompt: 'Combined continuous prompt.',
          status: 'failed',
          taskId: null,
          errorCode: 'SENSITIVE_CONTENT',
          errorMessage: 'previous generation attempt failed',
          referenceImageUrl: null,
          referenceImageMedia: null,
          videoUrl: 'https://example.com/group.mp4',
          videoMedia: null,
        },
      ],
    })

    const videoPlanNode = projection.nodes.find((node) => node.id === 'video-plan:edit-2:1')
    expect(videoPlanNode?.data.kind).toBe('videoPlan')
    expect(videoPlanNode?.data.width).toBe(420)
    expect(videoPlanNode?.data.height).toBeGreaterThan(560)
    expect(videoPlanNode?.data.statusLabel).toBe('status.ready')
    expect(videoPlanNode?.data.action).toEqual({
      type: 'generate_video_group',
      videoModel: 'ark::sequence-project-model',
      gridMode: '2x2',
      shotNumbers: [1, 2],
    })
    expect(videoPlanNode?.data.videoPlanDetails).toMatchObject({
      kind: 'group',
      shotNumbers: [1, 2],
      durationSec: 9,
      prompt: 'Edit-first combined prompt.',
      outputUrl: 'https://example.com/group.mp4',
      validationMessage: null,
      errorMessage: null,
      sourceImages: [
        { shotNumber: 1, imageUrl: 'https://example.com/shot-1.png', aspectRatio: 1920 / 1080 },
        { shotNumber: 2, imageUrl: 'https://example.com/shot-2.png', aspectRatio: 1920 / 1080 },
      ],
    })
    expect(projection.nodes.some((node) => node.id.startsWith('video:'))).toBe(false)
    expect(projection.nodes.some((node) => node.id.startsWith('video-group:'))).toBe(false)
    expect(projection.edges.some((edge) => edge.id === 'edge:shot-video-plan:video-plan:edit-2:1')).toBe(true)
  })

  it('does not fall back to the default video model when the video segment model is missing', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({
              id: 'panel-1',
              panelIndex: 0,
              panelNumber: 1,
              imageUrl: 'https://example.com/shot-1.png',
            }),
            createPanel({
              id: 'panel-2',
              panelIndex: 1,
              panelNumber: 2,
              imageUrl: 'https://example.com/shot-2.png',
            }),
          ],
        }),
      ],
      savedLayouts: [],
      translate: t,
      defaultVideoModel: 'ark::default-panel-model',
      defaultSequenceVideoModel: null,
      editScript: {
        id: 'edit-3',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: 'short sci-fi',
        title: 'Orbital Silence',
        logline: 'A pilot meets a machine intelligence.',
        durationSec: 9,
        shotCount: 2,
        status: 'ready',
        assetReviewStatus: 'pending',
        shots: [
          {
            shotNumber: 1,
            durationSec: 5,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'Pilot crosses the docking bay.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Pilot / Docking Bay',
            sound: 'air hum',
          },
          {
            shotNumber: 2,
            durationSec: 4,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'A red machine eye opens.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Pilot / AI Chamber',
            sound: 'sub bass pulse',
          },
        ],
        videoBlocks: [
          {
            kind: 'group',
            shotNumbers: [1, 2],
            gridMode: '2x2',
            reason: 'Shared camera movement should be generated as one segment.',
            prompt: 'Edit-first combined prompt.',
          },
        ],
        requirements: [],
      },
    })

    const videoPlanNode = projection.nodes.find((node) => node.id === 'video-plan:edit-3:1')
    expect(videoPlanNode?.data.action).toBeUndefined()
    expect(videoPlanNode?.data.statusLabel).toBe('status.failed')
    expect(videoPlanNode?.data.videoPlanDetails?.assetReferenceVideoModel).toBe('')
    expect(videoPlanNode?.data.videoPlanDetails?.errorMessage).toBe('errors.sequenceVideoModelMissing')
  })

  it('projects one-shot video segment blocks without separate video nodes', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({ id: 'panel-1', panelIndex: 0, panelNumber: 1, imageUrl: 'https://example.com/shot-1.png' }),
          ],
        }),
      ],
      savedLayouts: [],
      translate: t,
      defaultVideoModel: 'google::default-panel-model',
      defaultSequenceVideoModel: 'google::veo-test',
      editScript: {
        id: 'edit-single',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: 'single beat',
        title: 'Quiet Door',
        logline: null,
        durationSec: 4,
        shotCount: 1,
        status: 'ready',
        assetReviewStatus: 'pending',
        shots: [
          {
            shotNumber: 1,
            durationSec: 4,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'A door opens slowly.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Empty corridor',
            sound: 'soft hinge',
          },
        ],
        videoBlocks: [
          {
            kind: 'single',
            shotNumbers: [1],
            reason: 'This beat should stay isolated.',
            prompt: 'Edit-first single shot prompt.',
          },
        ],
        requirements: [],
      },
    })

    const videoPlanNode = projection.nodes.find((node) => node.id === 'video-plan:edit-single:1')
    expect(videoPlanNode?.data.kind).toBe('videoPlan')
    expect(videoPlanNode?.data.action).toEqual({
      type: 'generate_video',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      panelId: 'panel-1',
      videoModel: 'google::veo-test',
    })
    expect(videoPlanNode?.data.videoPlanDetails?.prompt).toBe('Edit-first single shot prompt.')
    expect(projection.nodes.some((node) => node.id.startsWith('video:'))).toBe(false)
  })

  it('does not mark video segment nodes as running from storyboard image tasks', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [
        createStoryboard({
          id: 'storyboard-1',
          clipId: 'clip-1',
          panels: [
            createPanel({ id: 'panel-image-pending', panelIndex: 0, panelNumber: 1 }),
          ],
        }),
      ],
      savedLayouts: [],
      translate: t,
      defaultVideoModel: 'google::default-panel-model',
      defaultSequenceVideoModel: 'google::veo-test',
      editScript: {
        id: 'edit-image-pending',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: 'single beat',
        title: 'Quiet Door',
        logline: null,
        durationSec: 4,
        shotCount: 1,
        status: 'ready',
        assetReviewStatus: 'pending',
        shots: [
          {
            shotNumber: 1,
            durationSec: 4,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'A door opens slowly.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Empty corridor',
            sound: 'soft hinge',
          },
        ],
        videoBlocks: [
          {
            kind: 'single',
            shotNumbers: [1],
            reason: 'This beat should stay isolated.',
            prompt: 'Edit-first single shot prompt.',
          },
        ],
        requirements: [],
      },
    })

    const videoPlanNode = projection.nodes.find((node) => node.id === 'video-plan:edit-image-pending:1')
    expect(videoPlanNode?.data.runtimeTargets).toEqual([
      TASK_RUNTIME_TARGETS.projectPanelVideo('panel-image-pending'),
    ])
    expect(videoPlanNode?.data.runtimeTargets).not.toContainEqual(
      TASK_RUNTIME_TARGETS.projectPanelImage('panel-image-pending'),
    )
  })

  it('offers edit-first storyboard generation after all required assets are ready', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      savedLayouts: [],
      translate: t,
      editScript: {
        id: 'edit-ready',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: 'one minute sci-fi',
        title: 'Orbital Silence',
        logline: 'A pilot meets a machine intelligence.',
        durationSec: 60,
        shotCount: 1,
        status: 'ready',
        assetReviewStatus: 'pending',
        shots: [
          {
            shotNumber: 1,
            durationSec: 60,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'Pilot watches the station rotate.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Pilot / Station',
            sound: 'low air hum',
          },
        ],
        videoBlocks: [
          {
            kind: 'single',
            shotNumbers: [1],
            reason: 'Standalone station shot.',
            prompt: 'Edit-first station prompt.',
          },
        ],
        requirements: [
          {
            id: 'req-character',
            kind: 'character',
            name: 'Pilot',
            description: 'A quiet astronaut in a minimal suit.',
            shotNumbers: [1],
            status: 'completed',
            targetId: 'character-1',
            errorMessage: null,
            previewImageUrl: 'https://example.com/pilot.png',
          },
          {
            id: 'req-location',
            kind: 'location',
            name: 'Station',
            description: 'A rotating station observation deck.',
            shotNumbers: [1],
            status: 'completed',
            targetId: 'location-1',
            errorMessage: null,
            previewImageUrl: 'https://example.com/station.png',
          },
        ],
      },
    })

    const editNode = projection.nodes.find((node) => node.id === 'edit-script:edit-ready')
    expect(editNode?.data.action).toEqual({
      type: 'generate_edit_cinematography_shot_plan',
      editScriptId: 'edit-ready',
    })
    expect(editNode?.data.actionDisabled).toBe(false)
    const cinematographyNode = projection.nodes.find((node) => node.id === 'edit-cinematography-shot-plan:edit-script:edit-ready')
    expect(cinematographyNode?.data.kind).toBe('editCinematographyShotPlan')
    expect(cinematographyNode?.data.layoutNodeType).toBe('editCinematographyShotPlan')
    expect(cinematographyNode?.data.action).toEqual({
      type: 'generate_edit_cinematography_shot_plan',
      editScriptId: 'edit-ready',
    })
    expect(cinematographyNode?.data.actionDisabled).toBe(false)
    expect(projection.edges).toContainEqual(expect.objectContaining({
      id: 'edge:edit-script-cinematography-shot-plan:edit-ready',
      source: 'edit-script:edit-ready',
      target: 'edit-cinematography-shot-plan:edit-script:edit-ready',
    }))
    expect(projection.edges).toContainEqual(expect.objectContaining({
      id: 'edge:edit-asset-cinematography-shot-plan:edit-asset-group:edit-ready',
      source: 'edit-asset-group:edit-ready',
      target: 'edit-cinematography-shot-plan:edit-script:edit-ready',
    }))
    expect(projection.nodes.some((node) => node.id === 'video-plan:edit-ready:1')).toBe(false)
    const consistencyNode = projection.nodes.find((node) => node.id === 'space-consistency:edit-script:edit-ready')
    expect(consistencyNode).toBeUndefined()
  })

  it('marks the cinematography node running from the active assistant operation', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      savedLayouts: [],
      translate: t,
      activeAssistantOperationId: 'generate_edit_cinematography_shot_plan',
      editScript: createSingleVideoEditScript({
        id: 'edit-cinematography-running',
        requirements: [
          {
            id: 'req-location',
            kind: 'location',
            name: 'Station',
            description: 'A rotating station observation deck.',
            shotNumbers: [1],
            status: 'completed',
            targetId: 'location-1',
            errorMessage: null,
            previewImageUrl: 'https://example.com/station.png',
          },
        ],
      }),
    })

    const cinematographyNode = projection.nodes.find((node) => node.id === 'edit-cinematography-shot-plan:edit-script:edit-cinematography-running')
    const editNode = projection.nodes.find((node) => node.id === 'edit-script:edit-cinematography-running')
    expect(cinematographyNode?.data.statusLabel).toBe('status.processing')
    expect(cinematographyNode?.data.isRunning).toBe(true)
    expect(cinematographyNode?.data.action).toBeUndefined()
    expect(editNode?.data.action).toBeUndefined()
  })

  it('blocks spatial blocking generation until a scene asset image is ready', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      savedLayouts: [],
      translate: t,
      editScript: createSingleVideoEditScript({
        id: 'edit-missing-location-image',
        requirements: [
          {
            id: 'req-character',
            kind: 'character',
            name: 'Pilot',
            description: 'A quiet astronaut in a minimal suit.',
            shotNumbers: [1],
            status: 'completed',
            targetId: 'character-1',
            errorMessage: null,
            previewImageUrl: 'https://example.com/pilot.png',
          },
          {
            id: 'req-location',
            kind: 'location',
            name: 'Station',
            description: 'A rotating station observation deck.',
            shotNumbers: [1],
            status: 'completed',
            targetId: 'location-1',
            errorMessage: null,
            previewImageUrl: null,
          },
        ],
      }),
    })

    const editNode = projection.nodes.find((node) => node.id === 'edit-script:edit-missing-location-image')
    expect(editNode?.data.action).toEqual({
      type: 'generate_edit_assets',
      editScriptId: 'edit-missing-location-image',
    })
    const consistencyNode = projection.nodes.find((node) => node.id === 'space-consistency:edit-script:edit-missing-location-image')
    expect(consistencyNode).toBeUndefined()
  })

  it('marks the pending space consistency node running from the active assistant operation', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [],
      savedLayouts: [],
      translate: t,
      activeAssistantOperationId: 'generate_edit_script_storyboard_spatial_blocking',
      editScript: createSingleVideoEditScript({
        id: 'edit-spatial-running',
        requirements: [
          {
            id: 'req-location',
            kind: 'location',
            name: 'Station',
            description: 'A rotating station observation deck.',
            shotNumbers: [1],
            status: 'completed',
            targetId: 'location-1',
            errorMessage: null,
            previewImageUrl: 'https://example.com/station.png',
          },
        ],
      }),
      editCinematographyShotPlan: createCinematographyShotPlan({
        id: 'cinematography-spatial-running',
        editScriptId: 'edit-spatial-running',
      }),
    })

    const spaceNode = projection.nodes.find((node) => node.id === 'space-consistency:edit-script:edit-spatial-running')
    expect(spaceNode?.data.statusLabel).toBe('status.processing')
    expect(spaceNode?.data.isRunning).toBe(true)
    expect(spaceNode?.data.action).toBeUndefined()
  })

  it('projects spatial blocking details as a space consistency node before panels', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [
        createStoryboard({
          id: 'storyboard-spatial',
          clipId: 'clip-spatial',
          panels: [
            createPanel({ id: 'panel-spatial-1', storyboardId: 'storyboard-spatial', panelIndex: 0, panelNumber: 1 }),
          ],
          photographyPlan: JSON.stringify({
            consistencyMode: 'spatial_text_blocking',
            currentStage: 'panel_prompts_ready',
            cameraPlanOutput: {
              strategy: 'spatial_text_blocking',
              panels: [{
                panelIndex: 0,
                sourceShotNumber: 1,
                sourceVideoBlockId: 'edit-spatial:videoBlock:1',
                shotScale: 'medium shot',
                cameraPosition: 'over the disciple shoulder',
                cameraHeight: 'eye-level',
                cameraAngle: 'three-quarter frontal',
                composition: 'flower bed anchors the lower third',
                cameraMovement: 'slow push-in',
                lensAndDepth: 'mild telephoto shallow depth',
                screenDirection: 'old monk screen left, disciple screen right',
                aestheticIntent: 'quiet balanced teaching composition',
                emotionalEffect: 'calm attention',
                continuityNote: 'preserve eyeline',
                shotBlocking: {
                  absolutePosition: 'middle ground near incense burner',
                  relativePosition: 'old monk beside young disciple',
                  screenPosition: 'center-left',
                },
              }],
            },
          }),
          blockingArtifacts: [{
            id: 'artifact-spatial-profile-1',
            storyboardId: 'storyboard-spatial',
            kind: 'spatial_profile',
            sourceVideoBlockId: null,
            groupIndex: 0,
            prompt: null,
            imageUrl: null,
            candidateImages: null,
            metadataJson: {
                requirementId: 'loc-1',
                targetId: 'location-1',
                name: 'Temple courtyard',
                shotNumbers: [1],
                spatialProfile: {
                  sceneSummary: 'Wood door at left rear, incense burner in midground.',
                  anchors: [{
                    id: 'anchor-left-door',
                    label: 'Left wood door',
                    screenArea: 'left rear',
                    depthLayer: 'background',
                    spatialRelations: ['Long table sits to the right of the door'],
                  }],
                  depthLayout: {
                    foreground: 'stone path',
                    midground: 'incense burner',
                    background: 'left wood door and wall',
                  },
                  lightingDirection: 'soft light from upper right',
                },
            },
            status: 'completed',
            errorMessage: null,
          }],
        }),
      ],
      savedLayouts: [],
      translate: t,
      editScript: {
        id: 'edit-spatial',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: 'temple lesson',
        title: 'Temple Lesson',
        logline: null,
        durationSec: 8,
        shotCount: 1,
        status: 'ready',
        assetReviewStatus: 'pending',
        shots: [
          {
            shotNumber: 1,
            durationSec: 8,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'Old monk teaches the young disciple.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Temple courtyard',
            sound: 'wind',
          },
        ],
        videoBlocks: [
          {
            kind: 'single',
            shotNumbers: [1],
            reason: 'Fixed courtyard blocking.',
            prompt: 'Temple lesson.',
          },
        ],
        requirements: [],
      },
      editCinematographyShotPlan: createCinematographyShotPlan({
        id: 'cinematography-spatial',
        editScriptId: 'edit-spatial',
      }),
    })

    const spaceNode = projection.nodes.find((node) => node.id === 'space-consistency:storyboard-spatial')
    const editNode = projection.nodes.find((node) => node.id === 'edit-script:edit-spatial')
    const cinematographyNode = projection.nodes.find((node) => node.id === 'edit-cinematography-shot-plan:edit-script:edit-spatial')
    const shotNode = projection.nodes.find((node) => node.id === 'shot:panel-spatial-1')
    expect(spaceNode?.data.kind).toBe('spaceConsistency')
    expect(spaceNode?.data.previewImageUrl).toBeNull()
    expect(spaceNode?.data.action).toEqual({
      type: 'generate_edit_storyboard_spatial_blocking',
      editScriptId: 'edit-spatial',
    })
    expect(spaceNode && editNode ? spaceNode.position.x : 0).toBeGreaterThan(
      editNode ? editNode.position.x + editNode.data.width : 0,
    )
    expect(cinematographyNode?.data.kind).toBe('editCinematographyShotPlan')
    expect(cinematographyNode?.data.editPipelineStepDetails?.items[0]).toMatchObject({
      fields: expect.arrayContaining([
        { label: 'nodeFields.shotScale', value: 'medium shot' },
        { label: 'nodeFields.lens', value: '35mm' },
        { label: 'nodeFields.cameraPosition', value: 'front of the scene' },
      ]),
      body: 'balanced composition',
    })
    expect(spaceNode && cinematographyNode ? spaceNode.position.x : 0).toBeGreaterThan(
      cinematographyNode ? cinematographyNode.position.x + cinematographyNode.data.width : 0,
    )
    expect(spaceNode && cinematographyNode ? Math.abs(
      (spaceNode.position.y + spaceNode.data.height / 2)
      - (cinematographyNode.position.y + cinematographyNode.data.height / 2),
    ) : Number.MAX_SAFE_INTEGER).toBeLessThanOrEqual(1)
    expect(shotNode && spaceNode ? shotNode.position.x : 0).toBeGreaterThan(
      spaceNode ? spaceNode.position.x + spaceNode.data.width : 0,
    )
    expect(spaceNode?.data.spaceConsistencyDetails).toMatchObject({
      spatialProfileCount: 1,
      cameraPlanCount: 1,
      spatialProfiles: [
        {
          name: 'Temple courtyard',
          anchors: [{
            label: 'Left wood door',
            screenArea: 'left rear',
            depthLayer: 'background',
            spatialRelations: ['Long table sits to the right of the door'],
          }],
          depthLayout: {
            foreground: 'stone path',
            midground: 'incense burner',
            background: 'left wood door and wall',
          },
          lightingDirection: 'soft light from upper right',
        },
      ],
      cameraPlans: [
        {
          sourceShotNumber: 1,
          shotScale: 'medium shot',
          cameraMovement: 'slow push-in',
          aestheticIntent: 'quiet balanced teaching composition',
          shotBlocking: {
            absolutePosition: 'middle ground near incense burner',
            relativePosition: 'old monk beside young disciple',
            screenPosition: 'center-left',
          },
        },
      ],
    })
    expect(projection.edges).toContainEqual(expect.objectContaining({
      id: 'edge:space-consistency-source:storyboard-spatial',
      source: 'edit-cinematography-shot-plan:edit-script:edit-spatial',
      target: 'space-consistency:storyboard-spatial',
    }))
    expect(projection.edges.some((edge) => edge.id === 'edge:space-consistency-shot:storyboard-spatial')).toBe(true)
  })

  it('does not treat persisted space consistency stages as live running task state', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [
        createStoryboard({
          id: 'storyboard-spatial-processing',
          clipId: 'clip-spatial',
          panels: [],
          photographyPlan: JSON.stringify({
            consistencyMode: 'spatial_text_blocking',
            currentStage: 'spatial_profile_ready',
          }),
        }),
      ],
      savedLayouts: [],
      translate: t,
    })

    const spaceNode = projection.nodes.find((node) => node.id === 'space-consistency:storyboard-spatial-processing')
    expect(spaceNode?.data.isRunning).toBe(false)
    expect(spaceNode?.data.statusLabel).toBe('status.ready')
  })

  it('offers storyboard generation from a ready spatial blocking node before panels exist', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyText: '',
      clips: [],
      storyboards: [
        createStoryboard({
          id: 'storyboard-spatial-ready',
          clipId: 'clip-spatial',
          panels: [],
          photographyPlan: JSON.stringify({
            consistencyMode: 'spatial_text_blocking',
            currentStage: 'spatial_profile_ready',
            sourceEditScriptId: 'edit-spatial-ready',
          }),
        }),
      ],
      savedLayouts: [],
      translate: t,
      editScript: createSingleVideoEditScript({
        id: 'edit-spatial-ready',
        status: 'ready',
        requirements: [],
      }),
      editCinematographyShotPlan: createCinematographyShotPlan({
        id: 'cinematography-spatial-ready',
        editScriptId: 'edit-spatial-ready',
      }),
    })

    const spaceNode = projection.nodes.find((node) => node.id === 'space-consistency:storyboard-spatial-ready')
    expect(spaceNode?.data.actionLabel).toBe('actions.regenerateSpatialBlocking')
    expect(spaceNode?.data.action).toEqual({
      type: 'generate_edit_storyboard_spatial_blocking',
      editScriptId: 'edit-spatial-ready',
    })
    expect(spaceNode?.data.secondaryActionLabel).toBe('actions.generateStoryboard')
    expect(spaceNode?.data.secondaryAction).toEqual({
      type: 'generate_edit_storyboard',
      editScriptId: 'edit-spatial-ready',
    })
  })
})
