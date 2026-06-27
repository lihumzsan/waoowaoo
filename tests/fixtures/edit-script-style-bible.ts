import type { EditScriptStyleBible } from '@/lib/edit-script/types'

export function buildZenStyleBibleFixture(): EditScriptStyleBible {
  return {
    rawUserStyle: '禅修短片',
    styleSummary: '禅意电影感，安静、克制、自然。',
    stylePolicy: {
      visual: {
        imageFilterPrompt: '轻微柔焦，35mm镜头，克制高光。',
        lightingPrompt: '清晨漫射光，阴影柔软，不过曝。',
        colorPrompt: '低饱和，自然灰绿、木色、石灰色。',
        texturePrompt: '木纹、石面、薄雾与旧纸感，真实不塑料。',
        compositionPrompt: '留白克制，人物与空间保持安静距离。',
      },
      camera: {
        movementPrompt: '静态或极慢推拉，避免炫技运镜。',
        lensAndDepthPrompt: '35mm镜头，中浅景深，自然透视。',
        videoRhythmPrompt: '缓慢呼吸式节奏，镜头停留足够久，慢剪辑，镜头之间自然过渡。',
      },
      directing: {
        pointOfViewPrompt: 'restricted protagonist viewpoint',
        performancePrompt: 'restrained performance through small gestures',
        informationReleasePrompt: 'reveal information through reaction before event truth',
        rhythmPrompt: 'hold suspense pauses before faster turns',
      },
      sound: {
        soundFilterPrompt: '低噪、近自然声场、不过度压缩。',
      },
    },
  }
}
