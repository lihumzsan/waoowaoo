'use client'

/**
 * 首页 Hero 展示带:一条从左向右平移的卡片轨道,展示系统各类创作产物
 * (剧本 / 角色 / 场景 / 道具 / 分镜 / 音乐 / 人声 / 成片 / 时间轴 / 世界观 /
 *  风格参考 / 台词 / 音效 / 交付)。
 *
 * 卡片内全部为抽象图形,不含任何自然语言文字,因此无需 i18n。
 *
 * 性能约束见 src/styles/home-showcase.css 文件头:
 * 只使用 transform / opacity 动画;环境光是静态渐变;移动的卡片不使用 backdrop-filter。
 */

import { AppIcon } from '@/components/ui/icons'
import { BrandLogoShape } from '@/components/ui/icons/BrandLogoShape'

const CARD_W = 210
const CARD_H = 142
const CARD_R = 20

/** 卡片投影向下延伸约 60px;带遮罩的容器必须为其留出空间,否则投影会被裁掉 */
export const HOME_SHOWCASE_PAD_TOP = 40
export const HOME_SHOWCASE_PAD_BOTTOM = 76

const CARD_SHELL: React.CSSProperties = {
  width: CARD_W,
  height: CARD_H,
  borderRadius: CARD_R,
  padding: 1,
  background: 'linear-gradient(140deg, rgba(255,255,255,.96), rgba(255,255,255,.22) 46%, rgba(255,255,255,.62))',
  boxShadow: '0 26px 56px -24px rgba(15,32,66,.28), 0 6px 16px -10px rgba(15,32,66,.12)',
}

const CARD_INNER: React.CSSProperties = {
  borderRadius: CARD_R - 1,
  background: 'rgba(255,255,255,.82)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.92)',
}

function Card({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="relative shrink-0" style={CARD_SHELL}>
      <div className="flex h-full w-full flex-col overflow-hidden px-3.5 pb-3.5 pt-3" style={CARD_INNER}>
        {children}
      </div>
    </div>
  )
}

function Head({ w = 30, delay = 0 }: { readonly w?: number; readonly delay?: number }) {
  return (
    <div className="mb-2.5 flex shrink-0 items-center gap-2">
      <span className="h-1 rounded-full bg-[rgba(90,105,133,.34)]" style={{ width: w }} />
      <span
        className="home-dot ml-auto h-1.5 w-1.5 rounded-full bg-[var(--glass-accent-from)]"
        style={{ animationDelay: `${delay}s` }}
      />
    </div>
  )
}

/** 抽象画面:低饱和,与整体同色系 */
function Scene({ className = '', animated = true }: { readonly className?: string; readonly animated?: boolean }) {
  return (
    <span className={`relative block overflow-hidden bg-gradient-to-b from-[#e3ebfa] via-[#eaf0fa] to-[#eef3f2] ${className}`}>
      <span className={`absolute left-[18%] top-[15%] aspect-square w-[15%] rounded-full bg-white/85 ${animated ? 'home-drift' : ''}`} />
      <span className="absolute -bottom-[20%] -left-[10%] h-[50%] w-[72%] rounded-[55%] bg-[#d3e2dc]/85" />
      <span className="absolute -bottom-[24%] -right-[12%] h-[44%] w-[78%] rounded-[55%] bg-[#dbe3f0]/90" />
    </span>
  )
}

interface CardProps {
  readonly seed?: number
}

function CardScript({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={30} delay={-seed * 0.3} />
      <div className="flex flex-1 flex-col justify-center gap-2.5">
        {['54%', '100%', '82%', '68%', '92%'].map((w, i) => (
          <span key={i} className="block h-1 rounded-full bg-[rgba(90,105,133,.3)]" style={{ width: w }} />
        ))}
      </div>
    </Card>
  )
}

function CardCharacter({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={26} delay={-seed * 0.3} />
      <div className="flex flex-1 items-center gap-2.5">
        {['from-[#b3c8ee] to-[#d8e4f6]', 'from-[#bcd4c9] to-[#dfeae4]', 'from-[#e3dacd] to-[#f1ebe2]'].map((g, i) => (
          <span key={i} className={`relative h-11 w-11 shrink-0 rounded-full bg-gradient-to-br ring-1 ring-white/90 ${g}`}>
            <span className="absolute left-1/4 top-[18%] h-1/4 w-1/4 rounded-full bg-white/85" />
          </span>
        ))}
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="h-1 w-full rounded-full bg-[rgba(90,105,133,.28)]" />
          <span className="h-1 w-2/3 rounded-full bg-[rgba(90,105,133,.18)]" />
        </span>
      </div>
    </Card>
  )
}

function CardLocation({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={28} delay={-seed * 0.3} />
      <Scene className="w-full flex-1 rounded-[12px]" />
    </Card>
  )
}

function CardProp({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={22} delay={-seed * 0.3} />
      <div className="flex flex-1 items-center justify-between gap-2">
        {['rounded-[8px]', 'rounded-full', 'rotate-45 rounded-[3px]'].map((s, i) => (
          <span
            key={i}
            className={`relative h-10 w-10 bg-gradient-to-br from-[#ccd8ec] to-[#e8eef7] shadow-[0_3px_8px_rgba(15,32,66,.10)] ${s}`}
          >
            <span className="absolute left-1/4 top-[18%] h-1/4 w-1/4 rounded-full bg-white/90" />
          </span>
        ))}
      </div>
    </Card>
  )
}

function CardStoryboard({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={30} delay={-seed * 0.3} />
      <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="home-spot overflow-hidden rounded-[8px]" style={{ animationDelay: `${-(seed * 0.7 + i * 2.5)}s` }}>
            <Scene className="h-full w-full" animated={false} />
          </span>
        ))}
      </div>
    </Card>
  )
}

function CardMusic({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={24} delay={-seed * 0.3} />
      <div className="flex flex-1 items-end gap-[3px] pb-1">
        {Array.from({ length: 17 }, (_, i) => (
          <span
            key={i}
            className="home-eq w-full rounded-t-[2px] bg-gradient-to-t from-[rgba(47,123,255,.3)] to-[rgba(47,123,255,.7)]"
            style={{
              height: '100%',
              animationDelay: `${-((i % 6) * 0.18 + seed * 0.11)}s`,
              animationDuration: `${0.95 + (i % 4) * 0.22}s`,
            }}
          />
        ))}
      </div>
    </Card>
  )
}

function CardVoice({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={24} delay={-seed * 0.3} />
      <div className="flex flex-1 items-center gap-[3px]">
        {Array.from({ length: 19 }, (_, i) => (
          <span
            key={i}
            className="home-wave w-full rounded-full bg-[rgba(47,123,255,.48)]"
            style={{
              height: `${30 + Math.abs(Math.sin(i * 1.15)) * 60}%`,
              animationDelay: `${-((i % 7) * 0.13 + seed * 0.09)}s`,
              animationDuration: `${0.75 + (i % 5) * 0.15}s`,
            }}
          />
        ))}
      </div>
    </Card>
  )
}

function CardVideo({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={34} delay={-seed * 0.3} />
      <div className="relative flex-1 overflow-hidden rounded-[12px]">
        <Scene className="h-full w-full" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/75 bg-white/45">
            <AppIcon name="play" className="ml-0.5 h-3.5 w-3.5 text-white" fill="currentColor" strokeWidth={0} />
          </span>
        </span>
      </div>
      <div className="mt-2 flex shrink-0 items-center gap-2">
        <span className="home-dot h-1.5 w-1.5 rounded-full bg-[var(--glass-accent-from)]" style={{ animationDelay: `${-seed * 0.3}s` }} />
        <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-[rgba(90,105,133,.18)]">
          <span className="home-bar absolute inset-y-0 left-0 rounded-full bg-[var(--glass-accent-from)]/75" style={{ animationDelay: `${-seed * 1.4}s` }} />
        </span>
      </div>
    </Card>
  )
}

function CardWorld({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={28} delay={-seed * 0.3} />
      <div className="relative flex flex-1 items-center justify-center">
        {[52, 36, 20].map((d, i) => (
          <span
            key={i}
            className="absolute rounded-full border"
            style={{
              width: d,
              height: d,
              borderColor: i === 0 ? 'rgba(90,105,133,.22)' : 'rgba(47,123,255,.28)',
              borderStyle: i === 1 ? 'dashed' : 'solid',
            }}
          />
        ))}
        <span className="absolute h-2.5 w-2.5 rounded-full bg-[var(--glass-accent-from)]/70" />
        <span className="absolute right-3 top-1 h-1.5 w-1.5 rounded-full bg-[rgba(90,105,133,.3)]" />
        <span className="absolute bottom-2 left-4 h-1.5 w-1.5 rounded-full bg-[rgba(90,105,133,.3)]" />
      </div>
    </Card>
  )
}

function CardDialogue({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={26} delay={-seed * 0.3} />
      <div className="flex flex-1 flex-col justify-center gap-2">
        <span className="w-[74%] rounded-[10px] rounded-bl-[3px] bg-[rgba(90,105,133,.12)] px-2.5 py-2">
          <span className="block h-1 w-full rounded-full bg-[rgba(90,105,133,.3)]" />
          <span className="mt-1.5 block h-1 w-2/3 rounded-full bg-[rgba(90,105,133,.22)]" />
        </span>
        <span className="ml-auto w-[64%] rounded-[10px] rounded-br-[3px] bg-[rgba(47,123,255,.14)] px-2.5 py-2">
          <span className="block h-1 w-full rounded-full bg-[rgba(47,123,255,.4)]" />
          <span className="mt-1.5 block h-1 w-1/2 rounded-full bg-[rgba(47,123,255,.28)]" />
        </span>
      </div>
    </Card>
  )
}

const TIMELINE_LANES = [
  [
    { l: 0, w: 34 },
    { l: 40, w: 52 },
    { l: 98, w: 30 },
  ],
  [
    { l: 10, w: 46 },
    { l: 62, w: 40 },
  ],
  [
    { l: 0, w: 24 },
    { l: 30, w: 28 },
    { l: 64, w: 44 },
  ],
]

function CardTimeline({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={30} delay={-seed * 0.3} />
      <div className="flex flex-1 flex-col justify-center gap-2">
        {TIMELINE_LANES.map((lane, i) => (
          <span key={i} className="relative block h-4 w-full rounded-[5px] bg-[rgba(90,105,133,.09)]">
            {lane.map((c, j) => (
              <span
                key={j}
                className="absolute inset-y-[3px] rounded-[3px]"
                style={{
                  left: `${c.l}%`,
                  width: `${c.w}%`,
                  background: i === 1 ? 'rgba(47,123,255,.45)' : 'rgba(90,105,133,.3)',
                }}
              />
            ))}
          </span>
        ))}
      </div>
    </Card>
  )
}

const SFX_SPIKES = [18, 92, 30, 46, 74, 22, 58, 100, 26, 40, 66, 34]

function CardSfx({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={22} delay={-seed * 0.3} />
      <div className="flex flex-1 items-center gap-[5px]">
        {SFX_SPIKES.map((h, i) => (
          <span
            key={i}
            className="home-wave w-full rounded-full bg-[rgba(47,123,255,.42)]"
            style={{
              height: `${h}%`,
              animationDelay: `${-((i % 5) * 0.21 + seed * 0.08)}s`,
              animationDuration: `${1.1 + (i % 3) * 0.3}s`,
            }}
          />
        ))}
      </div>
    </Card>
  )
}

function CardPalette({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={26} delay={-seed * 0.3} />
      <div className="flex flex-1 flex-col justify-center gap-2.5">
        <div className="flex gap-1.5">
          {['#b3c8ee', '#c9d9ef', '#bcd4c9', '#e3dacd', '#cfd6e6'].map((c, i) => (
            <span key={i} className="h-9 flex-1 rounded-[6px] ring-1 ring-white/80" style={{ background: c }} />
          ))}
        </div>
        <span className="h-1 w-2/3 rounded-full bg-[rgba(90,105,133,.26)]" />
      </div>
    </Card>
  )
}

function CardExport({ seed = 0 }: CardProps) {
  return (
    <Card>
      <Head w={30} delay={-seed * 0.3} />
      <div className="flex flex-1 flex-col justify-center gap-2">
        {[0, 1].map((i) => (
          <span key={i} className="flex items-center gap-2 rounded-[8px] bg-[rgba(90,105,133,.08)] px-2 py-1.5">
            <span className="h-5 w-4 shrink-0 rounded-[3px] bg-[rgba(47,123,255,.3)]" />
            <span className="flex flex-1 flex-col gap-1">
              <span className="h-1 w-full rounded-full bg-[rgba(90,105,133,.28)]" />
              <span className="h-1 w-1/2 rounded-full bg-[rgba(90,105,133,.18)]" />
            </span>
          </span>
        ))}
        <span className="relative h-1 w-full overflow-hidden rounded-full bg-[rgba(90,105,133,.18)]">
          <span className="home-bar absolute inset-y-0 left-0 rounded-full bg-[var(--glass-accent-from)]/70" style={{ animationDelay: `${-seed * 1.1}s` }} />
        </span>
      </div>
    </Card>
  )
}

const BUILDERS = [
  CardVideo,
  CardCharacter,
  CardScript,
  CardMusic,
  CardStoryboard,
  CardVoice,
  CardLocation,
  CardTimeline,
  CardWorld,
  CardPalette,
  CardDialogue,
  CardProp,
  CardSfx,
  CardExport,
] as const

const BASE_OFFSET = [-22, 8, -10, 20, -4, 14, -18, 2, -14, 18, -6, 10, -20, 6]
const BOB_AMP = [-14, -9, -17, -11, -13, -8, -15, -10]
const BOB_DUR = [5.4, 6.8, 4.9, 7.4, 6.1, 5.7, 7.9, 6.4]
const BOB_TILT = [-1.2, 0.9, -0.6, 1.4, -1, 0.7, -1.5, 1.1]

/** 每张卡有各自的基线高度、浮动幅度/周期/相位与轻微倾斜,避免整排同高 */
function buildCards(count: number): React.ReactNode[] {
  return Array.from({ length: count }, (_, i) => {
    const Component = BUILDERS[i % BUILDERS.length]
    return (
      <span key={i} className="inline-block shrink-0" style={{ transform: `translateY(${BASE_OFFSET[i % BASE_OFFSET.length]}px)` }}>
        <span
          className="home-bob inline-block"
          style={{
            animationDuration: `${BOB_DUR[i % BOB_DUR.length]}s`,
            animationDelay: `${-(i * 1.37).toFixed(2)}s`,
            ['--home-bob' as string]: `${BOB_AMP[i % BOB_AMP.length]}px`,
            ['--home-tilt' as string]: `${BOB_TILT[i % BOB_TILT.length]}deg`,
          }}
        >
          <Component seed={i} />
        </span>
      </span>
    )
  })
}

const RAIL_FADE = 'linear-gradient(to right, transparent 0%, #000 13%, #000 87%, transparent 100%)'

/**
 * 展示带轨道。注意:内部不能使用 overflow-hidden —— 会把卡片投影裁掉;
 * 横向溢出由页面根节点兜底,两侧淡出由遮罩负责,遮罩容器已为投影留出上下内边距。
 */
export function HomeShowcaseRail({ count = 14, durationS = 72 }: { readonly count?: number; readonly durationS?: number }) {
  const cards = buildCards(count)
  return (
    <div
      className="pointer-events-none"
      style={{
        paddingTop: HOME_SHOWCASE_PAD_TOP,
        paddingBottom: HOME_SHOWCASE_PAD_BOTTOM,
        maskImage: RAIL_FADE,
        WebkitMaskImage: RAIL_FADE,
      }}
      aria-hidden
    >
      <div
        className="home-rail flex w-max items-center gap-6"
        style={{ animationDuration: `${durationS}s`, animationDirection: 'reverse' }}
      >
        {cards}
        {cards}
      </div>
    </div>
  )
}

/** 环境光:一次性绘制的静态渐变(不使用 filter,也不加动画) */
export function HomeShowcaseAmbient() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        background: [
          'radial-gradient(58vw 52vh at 6% 10%, rgba(147,180,245,.36), transparent 70%)',
          'radial-gradient(48vw 46vh at 97% 16%, rgba(198,188,238,.32), transparent 70%)',
          'radial-gradient(52vw 44vh at 28% 97%, rgba(242,220,192,.30), transparent 70%)',
          'radial-gradient(44vw 40vh at 86% 92%, rgba(191,224,205,.28), transparent 70%)',
        ].join(','),
      }}
      aria-hidden
    />
  )
}

/** 品牌标记:系统 logo 形状 + 液态动效 + 呼吸光环 */
export function HomeBrandMark({ size = 60 }: { readonly size?: number }) {
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <span
        className="home-halo absolute rounded-full"
        style={{
          width: size * 1.15,
          height: size * 1.15,
          background: 'radial-gradient(circle, rgba(47,123,255,.28), transparent 68%)',
        }}
      />
      <span className="home-mark relative inline-flex">
        <BrandLogoShape uid="home-brand-mark" size={size} />
      </span>
    </span>
  )
}
