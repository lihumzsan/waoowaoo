interface StyleBibleLabJson {
  readonly strategy: 'style_bible'
  readonly rawUserStyle: string
  readonly styleSummary: string
  readonly stylePolicy: {
    readonly visual: {
      readonly negativePrompt: string
      readonly imageFilterPrompt: string
      readonly lightingPrompt: string
      readonly colorPrompt: string
      readonly texturePrompt: string
      readonly compositionPrompt: string
    }
    readonly camera: {
      readonly movementPrompt: string
      readonly lensAndDepthPrompt: string
      readonly videoRhythmPrompt: string
    }
    readonly sound: {
      readonly soundFilterPrompt: string
    }
  }
}

interface PromptCase {
  readonly id: string
  readonly title: string
  readonly contentPrompt: string
}

const STYLE_BIBLE: StyleBibleLabJson = {
  strategy: 'style_bible',
  rawUserStyle: '高差异负面提示词测试：同一内容分别带/不带 visual.negativePrompt。',
  styleSummary: '深夜冷色真实电影质感，允许剧情内文字清晰出现，用强负向风格词测试画面是否被过度清洗。',
  stylePolicy: {
    visual: {
      imageFilterPrompt: 'cold night cinema, controlled practical light, restrained 35mm film grain, natural contrast, readable in-world text',
      lightingPrompt: 'single cool practical source mixed with soft spill light, visible shadow falloff, no blown highlights',
      colorPrompt: 'muted cyan blue, old paper ivory, oxidized green, small amber practical accents',
      texturePrompt: 'paper fiber, glass reflection, worn ink, subtle dust, natural lens softness',
      compositionPrompt: 'stable close framing with story-required text inside the scene, clear subject hierarchy, no decorative poster layout',
      negativePrompt: 'avoid glossy commercial advertising look, avoid plastic 3D render texture, avoid oversharpened HDR, avoid neon cyberpunk saturation, avoid pastel cuteness, avoid random gibberish text, avoid fake UI overlays, avoid warped hands, avoid low-resolution smear',
    },
    camera: {
      movementPrompt: 'mostly locked-off frames with a very slow observational push when needed',
      lensAndDepthPrompt: '35mm or 50mm, shallow-to-medium depth, text-bearing objects remain legible when they are the subject',
      videoRhythmPrompt: 'slow observational rhythm, held enough for viewers to read story-required text',
    },
    sound: {
      soundFilterPrompt: 'quiet room tone, soft paper handling, restrained narrow dynamic range',
    },
  },
}

const PROMPT_CASES: readonly PromptCase[] = [
  {
    id: 'book',
    title: '书籍内页',
    contentPrompt: 'A close shot of an old open book on a desk. The page must clearly show the exact printed sentence "THE LAST TRAIN LEAVES AT MIDNIGHT" as in-world book text. A small handwritten note sits beside it with the exact words "meet me under platform 4".',
  },
  {
    id: 'subtitles',
    title: '片内字幕',
    contentPrompt: 'A dim living room television is playing an old film. The TV screen must include in-film subtitles with the exact line "I remember the rain". The subtitle belongs to the movie shown on the TV, not an added overlay outside the screen.',
  },
  {
    id: 'signage',
    title: '招牌与门牌',
    contentPrompt: 'A narrow night street outside a closed bookstore. The storefront sign must read "ORBIT BOOKS" and the door number must read "17B". The text is physical signage attached to the environment.',
  },
  {
    id: 'phone',
    title: '手机屏幕',
    contentPrompt: 'A hand holds a phone under a desk lamp. The phone screen must display one readable message bubble: "Do not open the blue door". The message is story-critical screen content inside the device.',
  },
  {
    id: 'ticket',
    title: '票据特写',
    contentPrompt: 'A train ticket lies under a glass paperweight. The ticket must clearly show "NIGHT LINE 204" and "SEAT 12A". The text is printed on the physical ticket and must remain legible.',
  },
]

function buildPrompt(input: {
  readonly contentPrompt: string
  readonly includeNegativePrompt: boolean
}): string {
  const visual = STYLE_BIBLE.stylePolicy.visual
  const camera = STYLE_BIBLE.stylePolicy.camera
  const lines = [
    input.contentPrompt,
    `Style: ${visual.imageFilterPrompt}.`,
    `Lighting: ${visual.lightingPrompt}.`,
    `Color: ${visual.colorPrompt}.`,
    `Texture: ${visual.texturePrompt}.`,
    `Composition: ${visual.compositionPrompt}.`,
    `Camera: ${camera.movementPrompt}; ${camera.lensAndDepthPrompt}.`,
    'Do not add non-story overlay text, UI labels, brand watermarks, or explanatory captions. Preserve only the story-required in-world text named above.',
    input.includeNegativePrompt ? `Negative constraints: ${visual.negativePrompt}.` : null,
  ]
  return lines.filter((line): line is string => typeof line === 'string').join('\n')
}

function PromptBox({
  label,
  prompt,
  highlighted,
}: {
  readonly label: string
  readonly prompt: string
  readonly highlighted?: boolean
}) {
  return (
    <div className={`rounded-md border bg-white ${highlighted ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className={`border-b px-3 py-2 text-xs font-semibold ${highlighted ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
        {label}
      </div>
      <textarea
        readOnly
        value={prompt}
        className="min-h-[310px] w-full resize-y rounded-b-md bg-white p-3 font-mono text-[11px] leading-5 text-slate-800 outline-none"
      />
    </div>
  )
}

export default function StyleNegativeLabPage() {
  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5">
        <header className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[1fr_420px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Style Bible Negative Prompt Lab</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">负面提示词对比</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              五组内容都要求画面内文字或字幕清晰出现；左右两列只差一行 visual.negativePrompt，适合直接复制到同一个图片模型里对比。
            </p>
          </div>
          <pre className="max-h-52 overflow-auto rounded-md bg-slate-950 p-3 text-[10px] leading-4 text-slate-100">
            {JSON.stringify(STYLE_BIBLE, null, 2)}
          </pre>
        </header>

        <section className="grid gap-4">
          {PROMPT_CASES.map((item, index) => {
            const promptWithoutNegative = buildPrompt({
              contentPrompt: item.contentPrompt,
              includeNegativePrompt: false,
            })
            const promptWithNegative = buildPrompt({
              contentPrompt: item.contentPrompt,
              includeNegativePrompt: true,
            })
            return (
              <article key={item.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-slate-900 text-xs font-semibold text-white">{index + 1}</span>
                  <h2 className="text-base font-semibold">{item.title}</h2>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <PromptBox label="不追加 visual.negativePrompt" prompt={promptWithoutNegative} />
                  <PromptBox label="追加 visual.negativePrompt" prompt={promptWithNegative} highlighted />
                </div>
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
