import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NodeProps } from '@xyflow/react'
import WorkspaceNode, {
  dispatchNodeAction,
  nodeFreezesMeasurementWhileRunning,
  nodeNeedsActualHeightMeasurement,
  videoElementAspectRatio,
} from '@/features/project-workspace/canvas/nodes/WorkspaceNode'
import {
  initialPreviewDetailsExpanded,
  previewShotMediaKind,
} from '@/features/project-workspace/canvas/details/EditScriptPreviewDetail'
import type { WorkspaceCanvasFlowNode, WorkspaceCanvasNodeData } from '@/features/project-workspace/canvas/node-canvas-types'

vi.mock('@xyflow/react', () => ({
  Handle: () => <span data-testid="handle" />,
  Position: { Left: 'left', Right: 'right' },
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (!values) return key
    return `${key}:${JSON.stringify(values)}`
  },
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name }: { readonly name: string }) => <span data-icon={name} />,
}))

function renderNode(data: WorkspaceCanvasNodeData): string {
  const props = { data } as NodeProps<WorkspaceCanvasFlowNode>
  return renderToStaticMarkup(<WorkspaceNode {...props} />)
}

describe('workspace node rendering', () => {
  it('measures dynamic content nodes so their canvas shell can match actual content height', () => {
    expect(nodeNeedsActualHeightMeasurement('videoPlan')).toBe(true)
    expect(nodeNeedsActualHeightMeasurement('bgmScore')).toBe(true)
    expect(nodeNeedsActualHeightMeasurement('shot')).toBe(false)
    expect(nodeFreezesMeasurementWhileRunning('videoPlan')).toBe(true)
    expect(nodeFreezesMeasurementWhileRunning('bgmScore')).toBe(false)
  })

  it('dispatches inline node actions with the node id so running state can stay anchored', async () => {
    const onAction = vi.fn()
    const action = {
      type: 'generate_video_group',
      videoModel: 'video-model-1',
      gridMode: '2x2',
      shotNumbers: [1, 2],
    } as const

    await dispatchNodeAction({
      kind: 'videoPlan',
      layoutNodeType: 'videoPlan',
      targetType: 'editScript',
      targetId: 'edit-1:video-block:1',
      nodeId: 'video-plan:edit-1:1',
      title: 'Video plan',
      eyebrow: 'Plan',
      body: 'reason',
      meta: 'shots',
      statusLabel: 'Ready',
      width: 420,
      height: 560,
      onAction,
    }, action)

    expect(onAction).toHaveBeenCalledWith(action, 'video-plan:edit-1:1')
  })

  it('uses intrinsic video dimensions to avoid letterboxing video plan output previews', () => {
    expect(videoElementAspectRatio({ videoWidth: 1920, videoHeight: 1080 })).toBeCloseTo(16 / 9)
    expect(videoElementAspectRatio({ videoWidth: 1080, videoHeight: 1920 })).toBeCloseTo(9 / 16)
    expect(videoElementAspectRatio({ videoWidth: 0, videoHeight: 1080 })).toBeNull()
  })

  it('uses shot text as the edit script preview fallback when storyboard media is missing', () => {
    expect(previewShotMediaKind({
      videoUrl: 'https://example.com/shot.mp4',
      imageUrl: 'https://example.com/shot.png',
      dramaticPurpose: 'test dramatic purpose',
      visibleAction: 'Shot action text.',
      audienceFocus: 'test audience focus',
      viewpoint: 'test viewpoint',
      revealPlan: 'test reveal plan',
      performanceBeat: 'test performance beat',
      continuityIn: 'test continuity in',
      continuityOut: 'test continuity out',
    })).toBe('video')
    expect(previewShotMediaKind({
      videoUrl: null,
      imageUrl: 'https://example.com/shot.png',
      dramaticPurpose: 'test dramatic purpose',
      visibleAction: 'Shot action text.',
      audienceFocus: 'test audience focus',
      viewpoint: 'test viewpoint',
      revealPlan: 'test reveal plan',
      performanceBeat: 'test performance beat',
      continuityIn: 'test continuity in',
      continuityOut: 'test continuity out',
    })).toBe('image')
    expect(previewShotMediaKind({
      videoUrl: null,
      imageUrl: null,
      dramaticPurpose: 'test dramatic purpose',
      visibleAction: 'Shot action text.',
      audienceFocus: 'test audience focus',
      viewpoint: 'test viewpoint',
      revealPlan: 'test reveal plan',
      performanceBeat: 'test performance beat',
      continuityIn: 'test continuity in',
      continuityOut: 'test continuity out',
    })).toBe('text')
    expect(previewShotMediaKind({
      videoUrl: null,
      imageUrl: null,
      dramaticPurpose: 'test dramatic purpose',
      visibleAction: ' ',
      audienceFocus: 'test audience focus',
      viewpoint: 'test viewpoint',
      revealPlan: 'test reveal plan',
      performanceBeat: 'test performance beat',
      continuityIn: 'test continuity in',
      continuityOut: 'test continuity out',
    })).toBe('empty')
  })

  it('keeps edit script preview prompt details expanded by default', () => {
    expect(initialPreviewDetailsExpanded()).toBe(true)
  })

  it('shows space consistency profile stats while generation is running', () => {
    const html = renderNode({
      kind: 'spaceConsistency',
      layoutNodeType: 'spaceConsistency',
      targetType: 'storyboard',
      targetId: 'storyboard-1',
      title: 'Space consistency',
      eyebrow: 'Text Blocking',
      body: 'generation body',
      meta: 'meta',
      statusLabel: 'Processing',
      isRunning: true,
      width: 460,
      height: 620,
      spaceConsistencyDetails: {
        storyboardId: 'storyboard-1',
        stage: 'spatial_profile_ready',
        spatialProfileCount: 1,
        cameraPlanCount: 0,
        spatialProfiles: [],
        cameraPlans: [],
      },
    })

    expect(html).toContain('spaceConsistencyStats')
    expect(html).toContain('Processing')
    expect(html).not.toContain('spatialProfiles')
  })

  it('shows space consistency spatial profile rows after profile analysis succeeds', () => {
    const html = renderNode({
      kind: 'spaceConsistency',
      layoutNodeType: 'spaceConsistency',
      targetType: 'storyboard',
      targetId: 'storyboard-1',
      title: 'Space consistency',
      eyebrow: 'Text Blocking',
      body: 'generation body',
      meta: 'meta',
      statusLabel: 'Ready',
      isRunning: false,
      width: 460,
      height: 620,
      spaceConsistencyDetails: {
        storyboardId: 'storyboard-1',
        stage: 'spatial_profile_ready',
        spatialProfileCount: 1,
        cameraPlanCount: 0,
        spatialProfiles: [{
          requirementId: 'loc-1',
          targetId: 'location-1',
          name: 'Temple courtyard',
          shotNumbers: [1],
          sceneSummary: 'Wood door at left rear, incense burner in midground.',
          anchors: [{
            label: 'Left wood door',
            screenArea: 'left rear',
            depthLayer: 'background',
            spatialRelations: [],
          }],
          depthLayout: null,
          lightingDirection: null,
          rawProfile: null,
        }],
        cameraPlans: [],
      },
    })

    expect(html).toContain('Temple courtyard')
    expect(html).toContain('Wood door at left rear')
  })

  it('renders expanded spatial profile details in space consistency nodes', () => {
    const html = renderNode({
      kind: 'spaceConsistency',
      layoutNodeType: 'spaceConsistency',
      targetType: 'storyboard',
      targetId: 'storyboard-1',
      title: 'Space consistency',
      eyebrow: 'Text Blocking',
      body: 'generation body',
      meta: 'meta',
      statusLabel: 'Ready',
      isRunning: false,
      expanded: true,
      width: 460,
      height: 620,
      spaceConsistencyDetails: {
        storyboardId: 'storyboard-1',
        stage: 'spatial_profile_ready',
        spatialProfileCount: 1,
        cameraPlanCount: 0,
        spatialProfiles: [{
          requirementId: 'loc-1',
          targetId: 'location-1',
          name: 'Temple courtyard',
          shotNumbers: [1],
          sceneSummary: 'Wood door at left rear, incense burner in midground.',
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
          rawProfile: {
            sceneSummary: 'Wood door at left rear, incense burner in midground.',
          },
        }],
        cameraPlans: [],
      },
    })

    expect(html).toContain('Left wood door')
    expect(html).toContain('stone path')
    expect(html).toContain('soft light from upper right')
  })

  it('renders storage keys through the signed storage display route', () => {
    const html = renderNode({
      kind: 'editRequiredAsset',
      layoutNodeType: 'editRequiredAsset',
      targetType: 'editAssetRequirement',
      targetId: 'req-1',
      title: 'Asset node',
      eyebrow: 'Asset',
      body: 'asset description',
      meta: 'shots 1',
      statusLabel: 'Ready',
      width: 360,
      height: 380,
      onAction: vi.fn(),
      previewImageUrl: 'images/character-1.jpg',
      editAssetDetails: {
        editScriptId: 'edit-1',
        requirementId: 'req-1',
        kind: 'character',
        description: 'asset description',
        shotNumbers: [1],
        targetId: 'asset-target-id',
        errorMessage: null,
      },
    })

    expect(html).toContain('/api/storage/sign?key=images%2Fcharacter-1.jpg')
    expect(html).toContain('object-contain')
    expect(html).toContain('style="height:240px"')
    expect(html).toContain('cursor-zoom-in')
    expect(html).toContain('aria-label="editPrompt"')
    expect(html).not.toContain('Asset ID')
    expect(html).not.toContain('asset-target-id')
    expect(html).not.toContain('shots 1')
    expect(html).not.toContain('src="images/character-1.jpg"')
  })

  it('renders location edit asset spatial profile status and JSON when expanded', () => {
    const html = renderNode({
      kind: 'editRequiredAsset',
      layoutNodeType: 'editRequiredAsset',
      targetType: 'editAssetRequirement',
      targetId: 'req-location',
      title: 'Location asset node',
      eyebrow: 'Location',
      body: 'location description',
      meta: 'shots 1',
      statusLabel: 'Ready',
      expanded: true,
      width: 360,
      height: 520,
      previewImageUrl: 'https://example.com/location.jpg',
      editAssetDetails: {
        editScriptId: 'edit-1',
        requirementId: 'req-location',
        kind: 'location',
        description: 'location description',
        shotNumbers: [1],
        targetId: 'location-1',
        errorMessage: null,
        spatialProfileStatus: 'ready',
        spatialProfileModel: 'vision-model',
        spatialProfileAnalyzedAt: '2026-05-27T08:00:00.000Z',
        spatialProfileJson: {
          sceneSummary: 'Wood door at left rear',
          anchors: [{ label: 'Left wood door' }],
        },
      },
    })

    expect(html).toContain('spatialProfile')
    expect(html).toContain('spatialProfileStatus.ready')
    expect(html).toContain('vision-model')
    expect(html).toContain('Wood door at left rear')
  })

  it('renders edit pipeline step cards with only that step fields', () => {
    const html = renderNode({
      kind: 'editPipelineStep',
      layoutNodeType: 'editPipelineStep',
      targetType: 'editPipelineStep',
      targetId: 'edit-1:visibleAction',
      title: 'Visible Action',
      eyebrow: 'Edit Step',
      body: 'step body',
      meta: '2 items',
      statusLabel: 'Ready',
      width: 420,
      height: 360,
      indexLabel: 'P2',
      editPipelineStepDetails: {
        items: [
          {
            title: 'Shot 1',
            fields: [{ label: 'Characters / Scene', value: 'Pilot / Docking Bay' }],
            body: 'Pilot crosses the docking bay.',
          },
          {
            title: 'Shot 2',
            fields: [{ label: 'Characters / Scene', value: 'AI Chamber' }],
            body: 'A red machine eye opens.',
            chips: ['2'],
          },
        ],
      },
    })

    expect(html).toContain('data-icon="chart"')
    expect(html).toContain('Visible Action')
    expect(html).toContain('Pilot / Docking Bay')
    expect(html).toContain('Pilot crosses the docking bay.')
    expect(html).toContain('AI Chamber')
    expect(html).not.toContain('videoPrompt')
    expect(html).not.toContain('Sound')
  })

  it('renders cinematography shot plan nodes with shot-level camera fields', () => {
    const html = renderNode({
      kind: 'editCinematographyShotPlan',
      layoutNodeType: 'editCinematographyShotPlan',
      targetType: 'editCinematographyShotPlan',
      targetId: 'cinematography-1',
      title: 'Cinematography Shot Plan',
      eyebrow: 'Cinematography Module',
      body: 'shot plan body',
      meta: '1 shot',
      statusLabel: 'Ready',
      width: 460,
      height: 620,
      indexLabel: 'C',
      editPipelineStepDetails: {
        items: [
          {
            title: 'Shot 1',
            fields: [
              { label: 'Shot Scale', value: 'close-up' },
              { label: 'Lens', value: '50mm' },
              { label: 'Camera Position', value: 'right front of actor' },
            ],
            body: 'Hand in foreground, door seam in background.',
          },
        ],
      },
    })

    expect(html).toContain('data-icon="image"')
    expect(html).toContain('Cinematography Shot Plan')
    expect(html).toContain('close-up')
    expect(html).toContain('50mm')
    expect(html).toContain('right front of actor')
    expect(html).toContain('Hand in foreground')
  })

  it('renders an edit script video preview entry from the core edit table node', () => {
    const html = renderNode({
      kind: 'editScript',
      layoutNodeType: 'editScript',
      targetType: 'editScript',
      targetId: 'edit-1',
      title: 'Core edit table',
      eyebrow: 'Core Edit Table',
      body: 'A short action scene.',
      meta: '2 shots · 6s',
      statusLabel: 'Ready',
      width: 720,
      height: 520,
      editScriptDetails: {
        screenplayText: 'screenplay',
        durationSec: 6,
        shotCount: 2,
        shots: [
          {
            shotNumber: 1,
            durationSec: 3,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'Pilot enters the docking bay.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Pilot / Docking bay',
            imagePrompt: 'Docking bay image prompt',
            sound: 'Low engine rumble',
            imageUrl: 'https://example.com/shot-1.png',
            videoUrl: null,
          },
          {
            shotNumber: 2,
            durationSec: 3,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'Warning lights pulse red.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'AI chamber',
            imagePrompt: null,
            sound: 'Alarm beep',
            imageUrl: null,
            videoUrl: null,
          },
        ],
      },
    })

    expect(html).toContain('viewVideoPreview')
    expect(html).toContain('Pilot enters the docking bay.')
  })

  it('renders video plan generation mode switches with storyboard references first before video exists', () => {
    const html = renderNode({
      kind: 'videoPlan',
      layoutNodeType: 'videoPlan',
      targetType: 'editScript',
      targetId: 'edit-1:video-block:1',
      title: 'Video plan node',
      eyebrow: 'Video Plan',
      body: 'reason',
      meta: 'shots 1, 2',
      statusLabel: 'Pending',
      width: 360,
      height: 620,
      onAction: vi.fn(),
      videoPlanDetails: {
        editScriptId: 'edit-1',
        blockIndex: 0,
        kind: 'group',
        shotNumbers: [1, 2],
        durationSec: 6,
        gridMode: '2x2',
        reason: 'continuous action',
        prompt: 'final video prompt',
        assetReferenceVideoModel: 'video-model-1',
        outputUrl: null,
        outputAspectRatio: null,
        errorMessage: null,
        sourceImages: [
          {
            panelId: 'panel-1',
            storyboardId: 'storyboard-1',
            panelIndex: 0,
            shotNumber: 1,
            imageUrl: 'https://example.com/shot-1.png',
            aspectRatio: 16 / 9,
          },
          {
            panelId: 'panel-2',
            storyboardId: 'storyboard-1',
            panelIndex: 1,
            shotNumber: 2,
            imageUrl: 'https://example.com/shot-2.png',
            aspectRatio: 16 / 9,
          },
        ],
        assetReferences: [
          {
            id: 'asset-1',
            name: 'Hero',
            kind: 'character',
            imageUrl: 'https://example.com/hero.png',
            shotNumbers: [1, 2],
          },
        ],
      },
    })

    expect(html).not.toContain('videoPlanReference')
    expect(html).not.toContain('videoPlanOutput')
    expect(html).toContain('storyboardReferenceVideoMode')
    expect(html).toContain('assetReferenceVideoMode')
    expect(html).toContain('generateStoryboardReferenceVideo')
    expect(html).toContain('https://example.com/shot-1.png')
    expect(html).toContain('https://example.com/shot-2.png')
    expect(html).not.toContain('https://example.com/hero.png')
  })

  it('renders video plan storyboard image placeholders for missing panel images', () => {
    const html = renderNode({
      kind: 'videoPlan',
      layoutNodeType: 'videoPlan',
      targetType: 'editScript',
      targetId: 'edit-1:video-block:2',
      title: 'Video plan node',
      eyebrow: 'Video Plan',
      body: 'reason',
      meta: 'shots 3, 4',
      statusLabel: 'Pending',
      width: 360,
      height: 620,
      onAction: vi.fn(),
      videoPlanDetails: {
        editScriptId: 'edit-1',
        blockIndex: 1,
        kind: 'group',
        shotNumbers: [3, 4],
        durationSec: 5,
        gridMode: '2x2',
        reason: 'missing images',
        prompt: 'final video prompt',
        assetReferenceVideoModel: 'video-model-1',
        outputUrl: null,
        outputAspectRatio: null,
        errorMessage: null,
        sourceImages: [
          { panelId: 'panel-3', storyboardId: 'storyboard-1', panelIndex: 2, shotNumber: 3, imageUrl: null, aspectRatio: null },
          { panelId: 'panel-4', storyboardId: 'storyboard-1', panelIndex: 3, shotNumber: 4, imageUrl: null, aspectRatio: null },
        ],
        assetReferences: [],
      },
    })

    expect(html).toContain('>3</div>')
    expect(html).toContain('>4</div>')
    expect(html).toContain('disabled=""')
  })

  it('keeps the video plan footer mounted while a generation action is running', () => {
    const html = renderNode({
      kind: 'videoPlan',
      layoutNodeType: 'videoPlan',
      targetType: 'editScript',
      targetId: 'edit-1:video-block:1',
      nodeId: 'video-plan:edit-1:1',
      title: 'Video plan node',
      eyebrow: 'Video Plan',
      body: 'reason',
      meta: 'shots 1, 2',
      statusLabel: 'Processing',
      isRunning: true,
      width: 420,
      height: 620,
      onAction: vi.fn(),
      onToggleExpanded: vi.fn(),
      actionLabel: 'Generate video',
      action: {
        type: 'generate_video_group',
        videoModel: 'video-model-1',
        gridMode: '2x2',
        shotNumbers: [1, 2],
      },
      secondaryActionLabel: 'Arrange',
      secondaryAction: {
        type: 'open_video_block_arrangement',
        editScriptId: 'edit-1',
        blockIndex: 0,
      },
      videoPlanDetails: {
        editScriptId: 'edit-1',
        blockIndex: 0,
        kind: 'group',
        shotNumbers: [1, 2],
        durationSec: 6,
        gridMode: '2x2',
        reason: 'continuous action',
        prompt: 'final video prompt',
        assetReferenceVideoModel: 'video-model-1',
        outputUrl: null,
        outputAspectRatio: null,
        errorMessage: null,
        sourceImages: [
          { panelId: 'panel-1', storyboardId: 'storyboard-1', panelIndex: 0, shotNumber: 1, imageUrl: 'https://example.com/shot-1.png', aspectRatio: 16 / 9 },
          { panelId: 'panel-2', storyboardId: 'storyboard-1', panelIndex: 1, shotNumber: 2, imageUrl: 'https://example.com/shot-2.png', aspectRatio: 16 / 9 },
        ],
        assetReferences: [],
      },
    })

    expect(html).toContain('shots 1, 2')
    expect(html).toContain('expandDetails')
    expect(html).toContain('Generate video')
    expect(html).toContain('Arrange')
    expect(html).toContain('disabled=""')
  })

  it('renders script clip summary by default without internal scroll', () => {
    const html = renderNode({
      kind: 'scriptClip',
      layoutNodeType: 'scriptClip',
      targetType: 'clip',
      targetId: 'clip-1',
      title: 'Script node',
      eyebrow: 'Script',
      body: 'screenplay raw',
      meta: 'clip #1',
      statusLabel: 'Ready',
      width: 320,
      height: 360,
      indexLabel: 'C1',
      scriptDetails: {
        originalText: 'original source text',
        screenplayText: 'screenplay raw',
        scenes: [{
          sceneNumber: 1,
          heading: 'EXT · Street · Night',
          description: 'rain street',
          characters: ['Robot'],
          lines: [{ kind: 'dialogue', speaker: 'Girl', text: 'hello' }],
        }],
        characters: [{ name: 'Robot', appearance: 'Default' }],
        locations: ['Street'],
        props: ['Lamp'],
        timeRange: '1s - 3s',
        duration: 2,
        shotCount: 1,
      },
    })

    expect(html).toContain('Robot / Default')
    expect(html).toContain('Street')
    expect(html).toContain('screenplay raw')
    expect(html).not.toContain('EXT · Street · Night')
    expect(html).not.toContain('original source text')
    expect(html).not.toContain('hello')
    expect(html).not.toContain('overflow-y-auto')
  })

  it('renders shot, image, video, and final summaries without internal scroll', () => {
    const shotHtml = renderNode({
      kind: 'shot',
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: 'panel-1',
      title: 'Shot node',
      eyebrow: 'Shot',
      body: 'shot description',
      meta: 'location',
      statusLabel: 'Ready',
      width: 320,
      height: 380,
      shotDetails: {
        shotType: 'wide',
        cameraMove: 'push in',
        characters: [{ name: 'Girl' }],
        location: 'Street',
        props: ['Lamp'],
        srtSegment: 'dialogue text',
        imagePrompt: 'image prompt',
        photographyRules: 'photo rules',
        actingNotes: 'acting notes',
        promptShot: {
          plot: 'prompt plot',
        },
      },
    })
    const imageHtml = renderNode({
      kind: 'imageAsset',
      layoutNodeType: 'imageAsset',
      targetType: 'panel',
      targetId: 'panel-1',
      title: 'Image node',
      eyebrow: 'Image',
      body: 'image body',
      meta: 'bound',
      statusLabel: 'Ready',
      width: 300,
      height: 390,
      imageDetails: {
        imagePrompt: 'image prompt',
        candidateImages: ['https://example.com/a.png'],
        imageHistory: 'history',
        sketchImageUrl: 'https://example.com/sketch.png',
        previousImageUrl: 'https://example.com/previous.png',
      },
    })
    const videoHtml = renderNode({
      kind: 'videoClip',
      layoutNodeType: 'videoClip',
      targetType: 'panel',
      targetId: 'panel-1',
      title: 'Video node',
      eyebrow: 'Video',
      body: 'video body',
      meta: 'bound',
      statusLabel: 'Ready',
      width: 300,
      height: 410,
      videoDetails: {
        firstLastFramePrompt: 'first last prompt',
        videoGenerationMode: 'firstlastframe',
        videoUrl: 'https://example.com/video.mp4',
      },
    })
    const finalHtml = renderNode({
      kind: 'finalTimeline',
      layoutNodeType: 'finalTimeline',
      targetType: 'episode',
      targetId: 'episode-1',
      title: 'Final node',
      eyebrow: 'Final',
      body: 'final body',
      meta: 'order',
      statusLabel: 'Ready',
      width: 340,
      height: 280,
      finalDetails: {
        totalShots: 1,
        totalImages: 1,
        totalVideos: 1,
        totalDuration: 2,
        orderedVideoLabels: ['panel-1'],
      },
    })

    expect(shotHtml).toContain('Street')
    expect(shotHtml).toContain('Girl')
    expect(shotHtml).toContain('shot description')
    expect(shotHtml).not.toContain('photo rules')
    expect(shotHtml).not.toContain('acting notes')
    expect(imageHtml).toContain('image prompt')
    expect(imageHtml).not.toContain('history')
    expect(imageHtml).not.toContain('https://example.com/sketch.png')
    expect(videoHtml).toContain('video body')
    expect(videoHtml).toContain('<video')
    expect(videoHtml).toContain('src="https://example.com/video.mp4"')
    expect(videoHtml).not.toContain('alt="Video node"')
    expect(videoHtml).not.toContain('first last prompt')
    expect(videoHtml).not.toContain('lip.mp4')
    expect(finalHtml).not.toContain('panel-1')
    expect(`${shotHtml}${imageHtml}${videoHtml}${finalHtml}`).not.toContain('StoryboardCanvas')
    expect(`${shotHtml}${imageHtml}${videoHtml}${finalHtml}`).not.toContain('overflow-y-auto')
  })

  it('renders candidate image controls on shot nodes after regeneration creates candidates', () => {
    const html = renderNode({
      kind: 'shot',
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: 'panel-1',
      title: 'Shot candidate node',
      eyebrow: 'Shot',
      body: 'shot description',
      meta: 'location',
      statusLabel: 'Ready',
      width: 320,
      height: 440,
      previewImageUrl: 'https://example.com/current.png',
      imageDetails: {
        imagePrompt: 'image prompt',
        candidateImages: [
          'PENDING:queued',
          'https://example.com/candidate-1.png',
          'https://example.com/candidate-2.png',
        ],
      },
      shotDetails: {
        characters: [],
        location: 'Street',
        props: [],
      },
      onAction: vi.fn(),
    })

    expect(html).toContain('https://example.com/current.png')
    expect(html).toContain('https://example.com/candidate-1.png')
    expect(html).toContain('https://example.com/candidate-2.png')
    expect(html).not.toContain('PENDING:queued')
    expect(html).toContain('candidateImages')
    expect(html).toContain('selectCandidate')
    expect(html).toContain('cancelCandidate')
    expect(html.match(/cursor-zoom-in/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('keeps shot node text non-selectable and removes the redundant large shot title', () => {
    const html = renderNode({
      kind: 'shot',
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: 'panel-1',
      title: 'Selectable shot title',
      eyebrow: 'Shot',
      indexLabel: '01',
      body: 'selectable shot description',
      meta: 'selectable meta',
      statusLabel: 'Ready',
      width: 320,
      height: 380,
      shotDetails: {
        shotType: 'wide',
        cameraMove: 'push in',
        characters: [{ name: 'Selectable character' }],
        location: 'Selectable street',
        props: ['Selectable lamp'],
        imagePrompt: 'selectable image prompt',
      },
    })

    expect(html).toContain('select-none')
    expect(html).not.toContain('select-text')
    expect(html).not.toContain('Selectable shot title</h2>')
    expect(html).toMatch(/select-none[^"]*">01<\/span>/)
    expect(html).toMatch(/select-none[^"]*">selectable shot description<\/p>/)
    expect(html).toMatch(/select-none[^"]*">Selectable character<\/span>/)
  })

  it('renders edit actions for image, video, and arrangement prompts only when save targets exist', () => {
    const onAction = vi.fn()
    const shotHtml = renderNode({
      kind: 'shot',
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      title: 'Editable shot',
      eyebrow: 'Shot',
      body: 'shot description',
      meta: 'location',
      statusLabel: 'Ready',
      width: 320,
      height: 520,
      expanded: true,
      onAction,
      shotDetails: {
        shotType: 'wide',
        cameraMove: 'push in',
        characters: [],
        location: 'Street',
        props: [],
        imagePrompt: 'editable image prompt',
        shotBlocking: {
          absolutePosition: 'Street midground near the lamp',
          screenPosition: 'left third',
        },
      },
    })
    const videoPlanHtml = renderNode({
      kind: 'videoPlan',
      layoutNodeType: 'videoPlan',
      targetType: 'editScript',
      targetId: 'edit-1:video-block:1',
      title: 'Video plan',
      eyebrow: 'Plan',
      body: 'reason',
      meta: 'shots',
      statusLabel: 'Ready',
      width: 420,
      height: 560,
      expanded: true,
      onAction,
      videoPlanDetails: {
        editScriptId: 'edit-1',
        blockIndex: 0,
        kind: 'group',
        shotNumbers: [1, 2],
        durationSec: 8,
        gridMode: '2x2',
        reason: 'motion continuity',
        prompt: 'editable arrangement prompt',
        sourceImages: [
          { shotNumber: 1, imageUrl: 'https://example.com/shot-1.png', aspectRatio: 16 / 9 },
          { shotNumber: 2, imageUrl: 'https://example.com/shot-2.png', aspectRatio: 16 / 9 },
        ],
        assetReferences: [
          {
            id: 'asset-1',
            name: 'Pilot',
            kind: 'character',
            imageUrl: 'https://example.com/pilot.png',
            shotNumbers: [1, 2],
          },
        ],
      },
    })

    expect(shotHtml.match(/aria-label="editPrompt"/g)).toHaveLength(2)
    expect(shotHtml).toContain('shotBlocking')
    expect(shotHtml).toContain('Street midground near the lamp')
    expect(shotHtml).toContain('fullFinalPrompt')
    expect(shotHtml).toContain('editable image prompt')
    expect(videoPlanHtml.match(/aria-label="editPrompt"/g)).toHaveLength(1)
    expect(`${shotHtml}${videoPlanHtml}`).toContain('data-icon="edit"')
    expect(`${shotHtml}${videoPlanHtml}`).not.toContain('<textarea')
    expect(videoPlanHtml).not.toContain('gridMode')
    expect(videoPlanHtml).toContain('videoPlanModelMissing')
    expect(videoPlanHtml).toContain('https://example.com/shot-1.png')
    expect(videoPlanHtml).toContain('https://example.com/shot-2.png')
    expect(videoPlanHtml.match(/cursor-zoom-in/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(videoPlanHtml).not.toContain('videoPlanPendingVideo')
    expect(videoPlanHtml).not.toContain('linkedShots')
    expect(videoPlanHtml).toContain('grid grid-cols-2')
    expect(videoPlanHtml).toContain('block h-28 w-full cursor-zoom-in overflow-hidden')
    expect(videoPlanHtml).toContain('h-full w-full object-contain')
    expect(videoPlanHtml).not.toContain('overflow-x-auto')
  })

  it('renders playable BGM mix and dynamic score prompt details when the BGM node is expanded', () => {
    const html = renderNode({
      kind: 'bgmScore',
      layoutNodeType: 'bgmScore',
      targetType: 'episode',
      targetId: 'episode-1',
      title: 'BGM Score',
      eyebrow: 'Music',
      body: 'continuous BGM',
      meta: 'ready',
      statusLabel: 'Ready',
      width: 420,
      height: 320,
      expanded: true,
      expandedLayout: 'wide',
      bgmScoreDetails: {
        status: 'completed',
        durationSeconds: 12,
        musicModel: 'music-model',
        hasPromptDesign: true,
        promptDesignMissing: false,
        designSectionCount: 1,
        promptSectionCount: 1,
        virtualLayerCount: 1,
        mixUrl: 'https://example.com/final-mix.m4a',
        errorMessage: null,
        scoreOverview: 'One coherent suspense cue.',
        designSections: [
          {
            category: 'Cue Arc',
            title: 'Tense entrance',
            purpose: 'hold continuity',
            startSec: 0,
            endSec: 12,
            content: 'Sparse harmony with restrained motion.',
          },
        ],
        virtualLayers: [
          {
            name: 'low piano color',
            purpose: 'internal arrangement layer only',
            content: 'Adds noir weight inside the single cue.',
          },
        ],
        promptSections: [
          {
            title: 'Main prompt block',
            purpose: 'provider prompt basis',
            startSec: 0,
            endSec: 12,
            content: 'Generate a single continuous suspense BGM track.',
          },
        ],
        finalPrompt: 'Generate one complete continuous instrumental cinematic BGM track for 12 seconds.',
        negativePrompt: 'no vocals',
      },
    })

    expect(html).toContain('finalBgmMix')
    expect(html).toContain('lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]')
    expect(html).toContain('src="https://example.com/final-mix.m4a"')
    expect(html).toContain('scoreDesignSections')
    expect(html).toContain('Tense entrance')
    expect(html).toContain('virtualLayers')
    expect(html).toContain('low piano color')
    expect(html).toContain('finalMusicPrompt')
    expect(html).not.toContain('stemAudio')
  })

  it('shows a clear missing prompt design message for completed legacy BGM data', () => {
    const html = renderNode({
      kind: 'bgmScore',
      layoutNodeType: 'bgmScore',
      targetType: 'episode',
      targetId: 'episode-1',
      title: 'BGM Score',
      eyebrow: 'Music',
      body: 'continuous BGM',
      meta: 'ready',
      statusLabel: 'Ready',
      width: 420,
      height: 320,
      expanded: true,
      bgmScoreDetails: {
        status: 'completed',
        durationSeconds: 12,
        musicModel: 'music-model',
        hasPromptDesign: false,
        promptDesignMissing: true,
        designSectionCount: 0,
        promptSectionCount: 0,
        virtualLayerCount: 0,
        mixUrl: 'https://example.com/final-mix.m4a',
        errorMessage: null,
        scoreOverview: null,
        designSections: [],
        virtualLayers: [],
        promptSections: [],
        finalPrompt: null,
        negativePrompt: null,
      },
    })

    expect(html).toContain('promptDesignMissing')
    expect(html).toContain('promptDesignMissingDescription')
    expect(html).not.toContain('designSectionCount')
    expect(html).not.toContain('promptSectionCount')
    expect(html).not.toContain('virtualLayerCount')
  })

  it('renders disabled storyboard generation with placeholders before panel images exist', () => {
    const html = renderNode({
      kind: 'videoPlan',
      layoutNodeType: 'videoPlan',
      targetType: 'editScript',
      targetId: 'edit-1:video-block:1',
      title: 'Video plan',
      eyebrow: 'Plan',
      body: 'reason',
      meta: 'shots',
      statusLabel: 'Pending',
      width: 420,
      height: 560,
      videoPlanDetails: {
        editScriptId: 'edit-1',
        blockIndex: 0,
        kind: 'group',
        shotNumbers: [1, 2],
        durationSec: 8,
        gridMode: '2x2',
        reason: 'motion continuity',
        prompt: 'editable arrangement prompt',
        sourceImages: [
          { shotNumber: 1, imageUrl: null, aspectRatio: null },
          { shotNumber: 2, imageUrl: null, aspectRatio: null },
        ],
        assetReferences: [],
      },
    })

    expect(html).toContain('>1</div>')
    expect(html).toContain('>2</div>')
    expect(html).toContain('videoPlanPrompt')
    expect(html).toContain('editable arrangement prompt')
  })

  it('renders required asset prompt below an image placeholder and keeps it editable', () => {
    const html = renderNode({
      kind: 'editRequiredAsset',
      layoutNodeType: 'editRequiredAsset',
      targetType: 'editAssetRequirement',
      targetId: 'req-1',
      title: 'Required asset',
      eyebrow: 'Asset',
      body: 'asset prompt should not be in preview',
      meta: 'shots 1, 2',
      statusLabel: 'Pending',
      width: 420,
      height: 520,
      onAction: vi.fn(),
      editAssetDetails: {
        editScriptId: 'edit-1',
        requirementId: 'req-1',
        kind: 'character',
        description: 'asset prompt should be editable below',
        shotNumbers: [1, 2],
        targetId: null,
        errorMessage: null,
      },
    })

    expect(html).toContain('data-icon="imageAlt"')
    expect(html).toContain('imagePrompt')
    expect(html).toContain('asset prompt should be editable below')
    expect(html).toContain('aria-label="editPrompt"')
    expect(html).toContain('linkedShots')
    expect(html).not.toContain('asset prompt should not be in preview')
  })

  it('does not render empty expanded detail sections as blank cards', () => {
    const emptyShotHtml = renderNode({
      kind: 'shot',
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: 'panel-empty',
      title: 'Empty shot',
      eyebrow: 'Shot',
      body: 'shot description',
      meta: 'location',
      statusLabel: 'Ready',
      width: 320,
      height: 520,
      expanded: true,
      shotDetails: {
        shotType: 'wide',
        cameraMove: 'push in',
        characters: [],
        location: 'Street',
        props: [],
        srtSegment: 'shot description',
        imagePrompt: 'image prompt',
        photographyRules: '',
        actingNotes: null,
        errorMessage: null,
      },
    })
    const errorShotHtml = renderNode({
      kind: 'shot',
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: 'panel-error',
      title: 'Error shot',
      eyebrow: 'Shot',
      body: 'shot description',
      meta: 'location',
      statusLabel: 'Ready',
      width: 320,
      height: 520,
      expanded: true,
      shotDetails: {
        shotType: 'wide',
        cameraMove: 'push in',
        characters: [],
        location: 'Street',
        props: [],
        srtSegment: 'shot description',
        imagePrompt: 'image prompt',
        photographyRules: '',
        actingNotes: null,
        errorMessage: 'image generation failed',
      },
    })
    const emptyImageHtml = renderNode({
      kind: 'imageAsset',
      layoutNodeType: 'imageAsset',
      targetType: 'panel',
      targetId: 'panel-image-empty',
      title: 'Image node',
      eyebrow: 'Image',
      body: 'image body',
      meta: 'bound',
      statusLabel: 'Ready',
      width: 300,
      height: 390,
      expanded: true,
      imageDetails: {
        imagePrompt: 'image prompt',
        candidateImages: [],
        imageHistory: null,
        errorMessage: null,
      },
    })
    const emptyVideoHtml = renderNode({
      kind: 'videoClip',
      layoutNodeType: 'videoClip',
      targetType: 'panel',
      targetId: 'panel-video-empty',
      title: 'Video node',
      eyebrow: 'Video',
      body: 'video body',
      meta: 'bound',
      statusLabel: 'Ready',
      width: 300,
      height: 410,
      expanded: true,
      videoDetails: {
        firstLastFramePrompt: null,
        errorMessage: null,
      },
    })

    expect(emptyShotHtml).not.toContain('>error<')
    expect(emptyShotHtml).not.toContain('>actingNotes<')
    expect(emptyShotHtml).not.toContain('>photographyRules<')
    expect(errorShotHtml).toContain('>error<')
    expect(errorShotHtml).toContain('image generation failed')
    expect(emptyImageHtml).not.toContain('>error<')
    expect(emptyImageHtml).not.toContain('>imageHistory<')
    expect(emptyVideoHtml).not.toContain('>error<')
    expect(emptyVideoHtml).not.toContain('>firstLastFramePrompt<')
  })
})
