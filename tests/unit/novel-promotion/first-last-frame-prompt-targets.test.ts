import { describe, expect, it } from 'vitest'
import { buildFirstLastFramePromptTargets } from '@/lib/novel-promotion/stages/video-stage-runtime/task-targets'

describe('first/last-frame prompt task targets', () => {
  it('tracks linked first panels with the prompt target key and task type', () => {
    expect(buildFirstLastFramePromptTargets([{
      id: 'storyboard-1',
      panels: [{
        id: 'panel-1',
        panelIndex: 0,
        linkedToNextPanel: true,
        firstLastFramePrompt: 'Existing prompt',
      }],
    }])).toEqual([{
      key: 'panel-first-last-prompt:panel-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      types: ['generate_first_last_frame_prompt'],
      resource: 'video',
      hasOutput: true,
    }])
  })
})
