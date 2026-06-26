'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import CardHierarchySection from './card-hierarchy-section'

/* ------------------------------------------------------------------ */
/* Mock data — story「最后的引力」, 10 shots / 31s（取自当前画布截图）        */
/* ------------------------------------------------------------------ */

interface MockShot {
  readonly shotNumber: number
  readonly durationSec: number
  readonly dramaticPurpose: string
  readonly visibleAction: string
  readonly audienceFocus: string
  readonly viewpoint: string
  readonly revealPlan: string
  readonly sound: string
  // 摄影指导
  readonly shotSize: string
  readonly lens: string
  readonly cameraMove: string
  readonly lighting: string
}

const MOCK_SHOTS: readonly MockShot[] = [
  {
    shotNumber: 1,
    durationSec: 3,
    dramaticPurpose: '建立火箭发射失败后的灾难性氛围与绝望感。',
    visibleAction: '控制室内红色的警报灯剧烈闪烁，将深邃的墨黑色与靛蓝色阴影投射在巨大的主屏幕上，屏幕显示一条骤然下坠并中断的红色火箭飞行轨迹图。',
    audienceFocus: '主屏幕上那条突然中断并闪烁着故障红光的轨迹线。',
    viewpoint: '客观视角，但强烈渲染埃尔森内心的绝望与冲击。',
    revealPlan: '隐藏埃尔森的身影；揭示火箭已坠毁、任务彻底失败的残酷事实。',
    sound: '刺耳且带回音的警报器鸣叫声，随后逐渐减弱，融入低频感器脉冲声。',
    shotSize: '远景 (Wide Shot)',
    lens: '35mm（中广角镜头）',
    cameraMove: '缓慢推入 (Slow Push-in)',
    lighting: '强烈的明暗对照法 (Chiaroscuro)',
  },
  {
    shotNumber: 2,
    durationSec: 3,
    dramaticPurpose: '展现埃尔森在毁灭性打击下的极度疲惫与不甘。',
    visibleAction: '埃尔森双手死死撑在控制台上，低着头。一滴汗水顺着他那有短胡茬的脸颊滑落，在控制台边缘摔碎。',
    audienceFocus: '埃尔森紧蹙的双手以及那滴摔落的汗水。',
    viewpoint: '埃尔森的感知视角，强调他承受的巨大生理与心理压力。',
    revealPlan: '隐藏埃尔森的双眼和表情；揭示他身体的颤抖和极度的虚脱感。',
    sound: '警报声退至背景，压闷的呼吸声被放大。旁白响起。',
    shotSize: '特写 (Close-up)',
    lens: '85mm（中焦人像镜头）',
    cameraMove: '漂移运镜 (Fluid drifting)',
    lighting: '单源强光，来自上方天窗',
  },
  {
    shotNumber: 3,
    durationSec: 3,
    dramaticPurpose: '表现团队的离散，凸显埃尔森作为孤勇者的绝对孤独。',
    visibleAction: '在埃尔森身后，几名工程师神色黯然地摘下耳机放在桌上，陆续转身走向控制室深处的黑暗中，留下埃尔森一人孤立在前景。',
    audienceFocus: '背景中工程师们离去的背影与前景静止不动的埃尔森。',
    viewpoint: '埃尔森的感知视角，体验被所有人放弃、独自留守的孤独感。',
    revealPlan: '揭示团队的解体和埃尔森的彻底孤立。',
    sound: '耳机放在台面上的轻微碰撞声，脚步声渐远。旁白继续。',
    shotSize: '中远景 (Medium Long Shot)',
    lens: '50mm（标准镜头）',
    cameraMove: '缓慢向后拉镜 (Slow Pull-out)',
    lighting: '冷峻的靛蓝色调，主屏幕红光熄灭',
  },
  {
    shotNumber: 4,
    durationSec: 3,
    dramaticPurpose: '建立办公室的破产危机氛围，展现埃尔森面临的最后绝境。',
    visibleAction: '深夜简朴的办公桌上，散乱着密密麻麻的账单和设计图纸。一个简易的火箭模型立在桌角，被冷光照亮。',
    audienceFocus: '桌上那张白纸黑字、带有强烈明暗对比的"最后清算"财务通知单。',
    viewpoint: '埃尔森的凝视视角，聚焦于逼近的破产现实。',
    revealPlan: '揭示他面临的财务困境和梦想与现实的残酷对立。',
    sound: '环境一片死寂，只有温暖的黑胶唱片般的微弱噪音。',
    shotSize: '中近景 (Medium Close-up)',
    lens: '40mm',
    cameraMove: '固定机位',
    lighting: '冷暖对比，桌面台灯暖光',
  },
  {
    shotNumber: 5,
    durationSec: 2,
    dramaticPurpose: '展现埃尔森对命运的拒绝和孤注一掷的决心。',
    visibleAction: '埃尔森的手猛地抓起那张"最后清算"通知单，五指用力将其揉成一个紧实的纸团，随后决然地将其扔进画面。',
    audienceFocus: '纸张被猛烈揉碎的动作，以及手部由于用力而产生的排线阴影变化。',
    viewpoint: '埃尔森的主动宣泄视角，展现他打破绝境的意志。',
    revealPlan: '揭示他拒绝妥协、誓死一搏的决心。',
    sound: '纸张被剧烈揉碎的沙沙声，在安静的房间里显得异常响亮。',
    shotSize: '特写 (Close-up)',
    lens: '85mm',
    cameraMove: '手持轻微晃动',
    lighting: '硬光侧打，强化手部肌理',
  },
  {
    shotNumber: 6,
    durationSec: 3,
    dramaticPurpose: '完成终极押注，展现不可动摇的信念。',
    visibleAction: '埃尔森将一张崭新的"资金调拨单"拉入光束中。他握紧钢笔，在签名栏上重重地写下自己的名字。',
    audienceFocus: '笔尖在纸上划过的轨迹，以及最终落成的苍劲签名。',
    viewpoint: '埃尔森的决断视角，这是他命运的签字画押。',
    revealPlan: '揭示他将全部资产注入最后一次发射的终极决定。',
    sound: '钢笔在纸张上沙沙作响，沉重而清晰。旁白响起。',
    shotSize: '特写 (Close-up)',
    lens: '100mm 微距',
    cameraMove: '固定机位',
    lighting: '聚光灯打亮签名区域',
  },
  {
    shotNumber: 7,
    durationSec: 3,
    dramaticPurpose: '展现终极挑战的舞台，营造史诗诗般的黎明期待感。',
    visibleAction: '黎明时分，地平线上泛起一抹电光紫与星爆金交织的微光。一枚高耸的白色火箭静静地立在巨大的发射架旁。',
    audienceFocus: '高耸入云的白色火箭剪影与绚丽背景的强烈对比。',
    viewpoint: '诗意而宏大的旁观者视角，将火箭视作人类意志的纪念碑。',
    revealPlan: '揭示发射前暴风雨来临前的极致宁静与力量积蓄。',
    sound: '风声呼啸掠过开阔的荒野，伴随着低沉空灵的模拟合成器长音。',
    shotSize: '大远景 (Extreme Wide Shot)',
    lens: '24mm 广角',
    cameraMove: '缓慢升镜',
    lighting: '黎明自然光，紫金色天空',
  },
  {
    shotNumber: 8,
    durationSec: 3,
    dramaticPurpose: '展现点火瞬间的毁灭性力量与希望的爆发。',
    visibleAction: '火箭底部突然喷射出排山倒海般的白色烟雾，伴随着炽热、璀璨的炽烈琥珀色火焰。火光瞬间撕裂了黎明的阴影。',
    audienceFocus: '喷涌而出的琥珀色火焰与翻滚的白色烟雾浪潮。',
    viewpoint: '象征性的、极具张力的低角度视角，仰望力量的释放。',
    revealPlan: '揭示点火成功，能量以不可阻挡之势爆发。',
    sound: '一声惊天动地的、带有温暖蒸汽质感的低频轰炸声。',
    shotSize: '中景 (Medium Shot)',
    lens: '50mm',
    cameraMove: '手持冲击晃动',
    lighting: '火焰主光，橙红强光',
  },
  {
    shotNumber: 9,
    durationSec: 4,
    dramaticPurpose: '展现梦想冲破重力束缚、飞向成功的壮丽高潮。',
    visibleAction: '火箭缓缓升空，随后加速冲向蔚蓝与金色交织的天空。它在空中留下一道由金色与白色烟雾组成的巨大轨迹。',
    audienceFocus: '火箭不断攀升、刺破苍穹的轨迹，以及天空中炸裂开来的金色光芒。',
    viewpoint: '诗意且流动的追踪视角，跟随火箭一同飞升，体验超越重力的释怀。',
    revealPlan: '揭示火箭成功升空、冲向无垠太空的壮丽景象。',
    sound: '引擎的轰鸣声达到澎湃的顶点，融入了一段高亢、充满希望的管弦乐。',
    shotSize: '跟拍远景 (Tracking Wide)',
    lens: '70-200mm 长焦',
    cameraMove: '追踪摇镜',
    lighting: '高调天空光，金色逆光',
  },
  {
    shotNumber: 10,
    durationSec: 4,
    dramaticPurpose: '完成埃尔森的情感救赎，为故事画上圆满温暖的句号。',
    visibleAction: '控制室内，埃尔森静静地站在窗前。窗外升起的炽热火光与金色晨曦交织，洒在他疲惫的脸上，勾勒出温暖的金边。',
    audienceFocus: '埃尔森脸上紧绷线条的消融，以及那抹久违的、温暖的微笑。',
    viewpoint: '埃尔森的个人救赎视角，这是他历经磨难后的内心平静。',
    revealPlan: '揭示埃尔森内心的释怀、和解与最终的胜利。',
    sound: '狂躁的引擎轰鸣声逐渐减弱，转化为充满希望的、温暖的合成器尾音。',
    shotSize: '中近景 (Medium Close-up)',
    lens: '85mm',
    cameraMove: '缓慢向前推镜',
    lighting: '暖金晨曦，柔和逆光',
  },
]

const TOTAL_DURATION = MOCK_SHOTS.reduce((sum, s) => sum + s.durationSec, 0)
const SHOT_COUNT = MOCK_SHOTS.length

/* ------------------------------------------------------------------ */
/* Tiny inline icons (self-contained, no registry dependency)          */
/* ------------------------------------------------------------------ */

function Chevron({ open }: { readonly open: boolean }) {
  return <AppIcon name={open ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
}
function Dot({ className = '' }: { readonly className?: string }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${className}`} />
}

/* ------------------------------------------------------------------ */
/* Pipeline overview — 「从0到全部成功」的整体生成布局（缩略示意）            */
/* ------------------------------------------------------------------ */

const PIPELINE_STAGES = [
  { key: 'screenplay', label: '剧本', desc: '《最后的引力》故事大纲与角色表', tone: 'bg-violet-100 text-violet-700' },
  { key: 'style', label: '风格圣经', desc: '冷峻写实 · 明暗对照 · 暖金点缀', tone: 'bg-fuchsia-100 text-fuchsia-700' },
  { key: 'editScript', label: '核心剪辑表', desc: `${SHOT_COUNT} 镜头 · ${TOTAL_DURATION}s`, tone: 'bg-sky-100 text-sky-700', heavy: true },
  { key: 'cinematography', label: '摄影指导', desc: `${SHOT_COUNT} 镜头机位 / 运镜 / 光线`, tone: 'bg-cyan-100 text-cyan-700', heavy: true },
  { key: 'asset', label: '资产需求', desc: '埃尔森 · 控制室 · 发射场', tone: 'bg-emerald-100 text-emerald-700' },
  { key: 'image', label: '分镜图像', desc: `${SHOT_COUNT} 张关键帧`, tone: 'bg-amber-100 text-amber-700' },
  { key: 'video', label: '视频片段', desc: `${SHOT_COUNT} 段已生成`, tone: 'bg-orange-100 text-orange-700' },
  { key: 'final', label: '最终成片', desc: `${TOTAL_DURATION}s 已合成`, tone: 'bg-slate-200 text-slate-700' },
] as const

function PipelineOverview({ activeKey }: { readonly activeKey: 'editScript' | 'cinematography' }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white/70 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
        <Dot className="bg-emerald-500" />
        全流程生成完成（模拟）— 下方聚焦演示信息密度最高的两个模块
      </div>
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        {PIPELINE_STAGES.map((stage, i) => (
          <div key={stage.key} className="flex items-center gap-2">
            <div
              className={`min-w-[148px] rounded-[14px] border p-3 transition ${
                'heavy' in stage && stage.key === activeKey
                  ? 'border-slate-900 bg-white shadow-sm ring-1 ring-slate-900'
                  : 'border-slate-200 bg-white/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${stage.tone}`}>
                  {stage.label}
                </span>
                <AppIcon name="check" className="h-3.5 w-3.5 text-emerald-500" />
              </div>
              <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-slate-500">{stage.desc}</p>
            </div>
            {i < PIPELINE_STAGES.length - 1 ? (
              <AppIcon name="arrowRight" className="h-4 w-4 shrink-0 text-slate-300" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Shared card chrome                                                   */
/* ------------------------------------------------------------------ */

function CardShell({
  eyebrow,
  title,
  meta,
  children,
  width,
}: {
  readonly eyebrow: string
  readonly title: string
  readonly meta: string
  readonly children: React.ReactNode
  readonly width: number
}) {
  return (
    <article
      className="rounded-[24px] border border-slate-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.06)]"
      style={{ width }}
    >
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{eyebrow}</p>
          <h2 className="mt-1 truncate text-lg font-semibold text-slate-900">{title}</h2>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{meta}</span>
      </header>
      <div className="p-4">{children}</div>
    </article>
  )
}

function FieldRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-3 text-xs leading-5">
      <span className="font-semibold text-slate-400">{label}</span>
      <span className="whitespace-pre-wrap break-words text-slate-600">{value}</span>
    </div>
  )
}

/* ================================================================== */
/* VARIANT A — 折叠摘要（默认折叠，逐镜展开）                              */
/* ================================================================== */

function VariantAEditScript() {
  const [open, setOpen] = useState<number | null>(1)
  return (
    <CardShell eyebrow="核心剪辑表" title="最后的引力" meta={`${SHOT_COUNT} 镜 · ${TOTAL_DURATION}s`} width={460}>
      <div className="mb-3 flex gap-2">
        <button className="inline-flex flex-1 items-center justify-center gap-2 rounded-[12px] bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
          ▶ 查看视频预览
        </button>
        <button className="rounded-[12px] border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">完整表格</button>
      </div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-[14px] border border-slate-100">
        {MOCK_SHOTS.map((shot) => {
          const isOpen = open === shot.shotNumber
          return (
            <div key={shot.shotNumber}>
              <button
                onClick={() => setOpen(isOpen ? null : shot.shotNumber)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 ${isOpen ? 'bg-slate-50' : ''}`}
              >
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                  {shot.shotNumber}
                </span>
                <span className="w-9 shrink-0 text-[11px] font-semibold text-slate-400">{shot.durationSec}s</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{shot.visibleAction}</span>
                <span className="shrink-0 text-slate-400"><Chevron open={isOpen} /></span>
              </button>
              {isOpen ? (
                <div className="space-y-2 bg-slate-50/60 px-3 pb-3 pt-1">
                  <FieldRow label="戏剧目的" value={shot.dramaticPurpose} />
                  <FieldRow label="可见动作" value={shot.visibleAction} />
                  <FieldRow label="观众焦点" value={shot.audienceFocus} />
                  <FieldRow label="信息释放" value={shot.revealPlan} />
                  <FieldRow label="声音" value={shot.sound} />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}

function VariantACinematography() {
  const [open, setOpen] = useState<number | null>(1)
  return (
    <CardShell eyebrow="摄影指导模块" title="摄影指导方案" meta={`${SHOT_COUNT} 镜`} width={460}>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-[14px] border border-slate-100">
        {MOCK_SHOTS.map((shot) => {
          const isOpen = open === shot.shotNumber
          return (
            <div key={shot.shotNumber}>
              <button
                onClick={() => setOpen(isOpen ? null : shot.shotNumber)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 ${isOpen ? 'bg-slate-50' : ''}`}
              >
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-[11px] font-bold text-white">
                  {shot.shotNumber}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">{shot.shotSize.split(' ')[0]}</span>
                  <span className="text-slate-400"> · {shot.cameraMove.split(' ')[0]}</span>
                </span>
                <span className="shrink-0 text-slate-400"><Chevron open={isOpen} /></span>
              </button>
              {isOpen ? (
                <div className="space-y-2 bg-slate-50/60 px-3 pb-3 pt-1">
                  <FieldRow label="景别" value={shot.shotSize} />
                  <FieldRow label="焦段" value={shot.lens} />
                  <FieldRow label="摄影运动" value={shot.cameraMove} />
                  <FieldRow label="光线" value={shot.lighting} />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}

/* ================================================================== */
/* VARIANT B — 网格卡片 · 卡内/整行就地展开（无弹窗）                       */
/* ================================================================== */

type BKind = 'script' | 'cine'
export type BExpandMode = 'row' | 'cell'
const B_COLS = 3

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function ShotDetailPanel({ shot, kind }: { readonly shot: MockShot; readonly kind: BKind }) {
  return (
    <div className="space-y-2.5 rounded-[14px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ${kind === 'cine' ? 'bg-cyan-600' : 'bg-slate-900'}`}>{shot.shotNumber}</span>
        <span className="text-sm font-semibold text-slate-900">镜头 {shot.shotNumber}</span>
        <span className="text-xs text-slate-400">{shot.durationSec}s</span>
      </div>
      <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
        {kind === 'script' ? (
          <>
            <FieldRow label="戏剧目的" value={shot.dramaticPurpose} />
            <FieldRow label="可见动作" value={shot.visibleAction} />
            <FieldRow label="观众焦点" value={shot.audienceFocus} />
            <FieldRow label="观看视角" value={shot.viewpoint} />
            <FieldRow label="信息释放" value={shot.revealPlan} />
            <FieldRow label="声音" value={shot.sound} />
          </>
        ) : (
          <>
            <FieldRow label="景别" value={shot.shotSize} />
            <FieldRow label="焦段" value={shot.lens} />
            <FieldRow label="摄影运动" value={shot.cameraMove} />
            <FieldRow label="光线" value={shot.lighting} />
          </>
        )}
      </div>
    </div>
  )
}

function BCardFace({ shot, kind, active }: { readonly shot: MockShot; readonly kind: BKind; readonly active: boolean }) {
  const accent = kind === 'cine' ? 'bg-cyan-600' : 'bg-slate-900'
  return (
    <>
      <div className="flex items-center justify-between">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ${accent}`}>{shot.shotNumber}</span>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
          {shot.durationSec}s <Chevron open={active} />
        </span>
      </div>
      {kind === 'script' ? (
        <>
          <p className="mt-2 line-clamp-2 text-[11px] font-semibold leading-4 text-slate-900">{shot.dramaticPurpose}</p>
          <p className="mt-1.5 line-clamp-3 text-[11px] leading-4 text-slate-500">{shot.visibleAction}</p>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs font-semibold text-slate-900">{shot.shotSize.split(' ')[0]}</p>
          <p className="mt-1 text-[11px] text-slate-500">{shot.cameraMove}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{shot.lens}</p>
        </>
      )}
    </>
  )
}

function BGrid({ kind, mode }: { readonly kind: BKind; readonly mode: BExpandMode }) {
  const [active, setActive] = useState<number | null>(1)
  const ring = kind === 'cine' ? 'border-cyan-500 ring-1 ring-cyan-500' : 'border-slate-900 ring-1 ring-slate-900'
  const hover = kind === 'cine' ? 'hover:border-cyan-400' : 'hover:border-slate-400'
  const toggle = (n: number) => setActive((cur) => (cur === n ? null : n))

  const cardClass = (on: boolean) =>
    `flex flex-col rounded-[14px] border bg-white p-3 text-left transition ${on ? ring : `border-slate-200 ${hover} hover:shadow-sm`}`

  // 卡片内展开：被选中的卡片直接在格子里向下长出详情（同列变高）
  if (mode === 'cell') {
    return (
      <div className="grid grid-cols-3 items-start gap-2.5">
        {MOCK_SHOTS.map((shot) => {
          const on = active === shot.shotNumber
          return (
            <button key={shot.shotNumber} onClick={() => toggle(shot.shotNumber)} className={cardClass(on)}>
              <BCardFace shot={shot} kind={kind} active={on} />
              {on ? (
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  {(kind === 'script'
                    ? [['观众焦点', shot.audienceFocus], ['信息释放', shot.revealPlan], ['声音', shot.sound]]
                    : [['焦段', shot.lens], ['光线', shot.lighting]]
                  ).map(([label, value]) => (
                    <FieldRow key={label} label={label} value={value} />
                  ))}
                </div>
              ) : null}
            </button>
          )
        })}
      </div>
    )
  }

  // 整行展开：被选中卡片所在「整行」下方插入一条满宽详情，网格始终对齐（推荐）
  return (
    <div className="space-y-2.5">
      {chunk(MOCK_SHOTS, B_COLS).map((row, rowIndex) => {
        const activeInRow = row.find((s) => s.shotNumber === active) ?? null
        return (
          <div key={rowIndex} className="space-y-2.5">
            <div className="grid grid-cols-3 gap-2.5">
              {row.map((shot) => {
                const on = active === shot.shotNumber
                return (
                  <button key={shot.shotNumber} onClick={() => toggle(shot.shotNumber)} className={cardClass(on)}>
                    <BCardFace shot={shot} kind={kind} active={on} />
                  </button>
                )
              })}
            </div>
            {activeInRow ? <ShotDetailPanel shot={activeInRow} kind={kind} /> : null}
          </div>
        )
      })}
    </div>
  )
}

function VariantBEditScript({ mode }: { readonly mode: BExpandMode }) {
  return (
    <CardShell eyebrow="核心剪辑表" title="最后的引力" meta={`${SHOT_COUNT} 镜 · ${TOTAL_DURATION}s`} width={720}>
      <div className="mb-3 flex gap-2">
        <button className="inline-flex items-center justify-center gap-2 rounded-[12px] bg-slate-900 px-3 py-2 text-xs font-semibold text-white">▶ 查看视频预览</button>
      </div>
      <BGrid kind="script" mode={mode} />
    </CardShell>
  )
}

function VariantBCinematography({ mode }: { readonly mode: BExpandMode }) {
  return (
    <CardShell eyebrow="摄影指导模块" title="摄影指导方案" meta={`${SHOT_COUNT} 镜`} width={720}>
      <BGrid kind="cine" mode={mode} />
    </CardShell>
  )
}

/* ================================================================== */
/* VARIANT C — 胶片时间轴（横向缩略 + 选中详情面板）                       */
/* ================================================================== */

function VariantCEditScript() {
  const [active, setActive] = useState(1)
  const shot = MOCK_SHOTS.find((s) => s.shotNumber === active)!
  return (
    <CardShell eyebrow="核心剪辑表" title="最后的引力" meta={`${SHOT_COUNT} 镜 · ${TOTAL_DURATION}s`} width={760}>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-2">
        {MOCK_SHOTS.map((s) => {
          const on = s.shotNumber === active
          return (
            <button
              key={s.shotNumber}
              onClick={() => setActive(s.shotNumber)}
              style={{ flexGrow: s.durationSec }}
              className={`min-w-[60px] shrink-0 rounded-[10px] border px-2 py-2 text-left transition ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}
            >
              <div className="flex items-center justify-between text-[10px] font-bold">
                <span>{s.shotNumber}</span>
                <span className={on ? 'text-slate-300' : 'text-slate-400'}>{s.durationSec}s</span>
              </div>
              <p className={`mt-1 line-clamp-2 text-[10px] leading-3 ${on ? 'text-slate-200' : 'text-slate-400'}`}>{s.dramaticPurpose}</p>
            </button>
          )
        })}
      </div>
      <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">{shot.shotNumber}</span>
          <span className="text-sm font-semibold text-slate-900">镜头 {shot.shotNumber}</span>
          <span className="text-xs text-slate-400">{shot.durationSec}s</span>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2">
          <FieldRow label="戏剧目的" value={shot.dramaticPurpose} />
          <FieldRow label="可见动作" value={shot.visibleAction} />
          <FieldRow label="观众焦点" value={shot.audienceFocus} />
          <FieldRow label="信息释放" value={shot.revealPlan} />
          <FieldRow label="观看视角" value={shot.viewpoint} />
          <FieldRow label="声音" value={shot.sound} />
        </div>
      </div>
    </CardShell>
  )
}

function VariantCCinematography() {
  const [active, setActive] = useState(1)
  const shot = MOCK_SHOTS.find((s) => s.shotNumber === active)!
  return (
    <CardShell eyebrow="摄影指导模块" title="摄影指导方案" meta={`${SHOT_COUNT} 镜`} width={760}>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-2">
        {MOCK_SHOTS.map((s) => {
          const on = s.shotNumber === active
          return (
            <button
              key={s.shotNumber}
              onClick={() => setActive(s.shotNumber)}
              className={`min-w-[88px] shrink-0 rounded-[10px] border px-2 py-2 text-left transition ${on ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-400'}`}
            >
              <div className="text-[10px] font-bold">{s.shotNumber}</div>
              <p className={`mt-0.5 text-[10px] ${on ? 'text-cyan-50' : 'text-slate-500'}`}>{s.shotSize.split(' ')[0]}</p>
            </button>
          )
        })}
      </div>
      <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-4">
        <div className="grid grid-cols-2 gap-x-5 gap-y-2">
          <FieldRow label="景别" value={shot.shotSize} />
          <FieldRow label="焦段" value={shot.lens} />
          <FieldRow label="摄影运动" value={shot.cameraMove} />
          <FieldRow label="光线" value={shot.lighting} />
        </div>
      </div>
    </CardShell>
  )
}

/* ================================================================== */
/* Reference — 现状（全表平铺）供对比                                     */
/* ================================================================== */

function CurrentEditScript() {
  return (
    <CardShell eyebrow="核心剪辑表（现状）" title="最后的引力" meta={`${SHOT_COUNT} 镜 · ${TOTAL_DURATION}s`} width={1100}>
      <div className="overflow-x-auto rounded-[12px] border border-slate-200">
        <table className="w-full border-collapse text-left">
          <thead className="bg-slate-50 text-[10px] font-semibold uppercase text-slate-400">
            <tr>
              {['镜头', '时长', '戏剧目的', '可见动作', '观众焦点', '观看视角', '信息释放', '声音'].map((h) => (
                <th key={h} className="border-l border-slate-100 px-3 py-2 first:border-l-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_SHOTS.map((s) => (
              <tr key={s.shotNumber} className="border-t border-slate-100 align-top">
                <td className="px-3 py-3 text-xs font-semibold text-slate-900">{s.shotNumber}</td>
                <td className="border-l border-slate-100 px-3 py-3 text-xs text-slate-500">{s.durationSec}s</td>
                <td className="border-l border-slate-100 px-3 py-3 text-xs text-slate-600">{s.dramaticPurpose}</td>
                <td className="border-l border-slate-100 px-3 py-3 text-xs text-slate-600">{s.visibleAction}</td>
                <td className="border-l border-slate-100 px-3 py-3 text-xs text-slate-600">{s.audienceFocus}</td>
                <td className="border-l border-slate-100 px-3 py-3 text-xs text-slate-600">{s.viewpoint}</td>
                <td className="border-l border-slate-100 px-3 py-3 text-xs text-slate-600">{s.revealPlan}</td>
                <td className="border-l border-slate-100 px-3 py-3 text-xs text-slate-600">{s.sound}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardShell>
  )
}

/* ================================================================== */
/* 剧本卡片 重设计                                                        */
/* ================================================================== */

const MOCK_LOGLINE = '面临破产的科技创业者在经历连续失败后，押上全部资产进行最后一次火箭发射并最终取得成功。'

const MOCK_CHARACTERS = [
  { name: '埃尔森', desc: '三十多岁，留着短胡茬，穿着起皱的深色衬衫。执着的虚构科技创业者，眼神疲惫但目光坚定，说话声音低沉。' },
]

const MOCK_SCENES = [
  {
    id: 1,
    title: '场景 1 · 内景 · 航天控制室 · 夜晚',
    action: '控制室内的警报器闪烁着红光，大屏幕上显示着火箭坠毁的轨迹图。埃尔森双手撑在控制台上，低着头，汗水顺着脸颊滑落。周围的工程师陆续摘下耳机，神色黯然离去。',
    vo: '当所有人都化为乌有的时候，你只能听见自己心跳的声音。',
  },
  {
    id: 2,
    title: '场景 2 · 内景 · 简朴的办公室 · 深夜',
    action: '桌上散落着账单和设计图纸，一个简易的火箭模型立在桌角。埃尔森坐在椅子上，手里拿着一支钢笔，死死盯着"最后清算"的财务通知单，深吸一口气，把它揉成一团，又在资金调拨单上重重签下名字。',
    vo: '把一切押在唯一的信仰上，这就是我们的规则。',
  },
  {
    id: 3,
    title: '场景 3 · 外景 · 发射场 · 黎明',
    action: '地平线上泛起微光，白色火箭静静立在发射架旁。火箭底部突然喷射出巨大的烟雾与火焰，腾空而起。控制室内，埃尔森站在窗前，看着窗外升起的火光，紧绷的脸庞松弛下来，露出一丝微笑。',
    vo: '',
  },
]

// 思路 1 · 结构化分区（梗概 + 角色 chip + 场景手风琴）
function ScreenplayStructured() {
  const [openScene, setOpenScene] = useState<number | null>(1)
  const [openChar, setOpenChar] = useState<string | null>(null)
  return (
    <CardShell eyebrow="剧本模块" title="最后的引力" meta="3 场景" width={460}>
      <div className="space-y-4">
        <section>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">故事梗概</p>
          <p className="text-xs leading-5 text-slate-600">{MOCK_LOGLINE}</p>
        </section>
        <section>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">角色 · {MOCK_CHARACTERS.length}</p>
          <div className="flex flex-wrap gap-1.5">
            {MOCK_CHARACTERS.map((c) => {
              const on = openChar === c.name
              return (
                <button
                  key={c.name}
                  onClick={() => setOpenChar(on ? null : c.name)}
                  className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs font-semibold transition ${on ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700 hover:bg-violet-100'}`}
                >
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${on ? 'bg-white/20' : 'bg-violet-600 text-white'}`}>{c.name.slice(0, 1)}</span>
                  {c.name}
                </button>
              )
            })}
          </div>
          {openChar ? (
            <p className="mt-2 rounded-[10px] bg-slate-50 p-2.5 text-xs leading-5 text-slate-600">
              {MOCK_CHARACTERS.find((c) => c.name === openChar)?.desc}
            </p>
          ) : null}
        </section>
        <section>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">场景 · {MOCK_SCENES.length}</p>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-[14px] border border-slate-100">
            {MOCK_SCENES.map((scene) => {
              const on = openScene === scene.id
              return (
                <div key={scene.id}>
                  <button
                    onClick={() => setOpenScene(on ? null : scene.id)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-slate-50 ${on ? 'bg-slate-50' : ''}`}
                  >
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-slate-900 text-[11px] font-bold text-white">{scene.id}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{scene.title.replace(/^场景 \d+ · /, '')}</span>
                    <Chevron open={on} />
                  </button>
                  {on ? (
                    <div className="space-y-2 bg-slate-50/60 px-3 pb-3 pt-1 text-xs leading-5">
                      <div>
                        <span className="font-semibold text-slate-400">动作　</span>
                        <span className="text-slate-600">{scene.action}</span>
                      </div>
                      {scene.vo ? (
                        <div>
                          <span className="font-semibold text-slate-400">旁白　</span>
                          <span className="italic text-slate-600">{scene.vo}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </CardShell>
  )
}

// 思路 2 · 标签页（梗概 / 角色 / 场景）
function ScreenplayTabs() {
  const [tab, setTab] = useState<'logline' | 'characters' | 'scenes'>('logline')
  const tabs = [
    { key: 'logline', label: '梗概' },
    { key: 'characters', label: `角色 ${MOCK_CHARACTERS.length}` },
    { key: 'scenes', label: `场景 ${MOCK_SCENES.length}` },
  ] as const
  return (
    <CardShell eyebrow="剧本模块" title="最后的引力" meta="标签页" width={460}>
      <div className="mb-3 flex gap-1 rounded-[12px] bg-slate-100 p-1">
        {tabs.map((tt) => (
          <button
            key={tt.key}
            onClick={() => setTab(tt.key)}
            className={`flex-1 rounded-[9px] py-1.5 text-xs font-semibold transition ${tab === tt.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            {tt.label}
          </button>
        ))}
      </div>
      {tab === 'logline' ? <p className="text-xs leading-6 text-slate-600">{MOCK_LOGLINE}</p> : null}
      {tab === 'characters' ? (
        <div className="space-y-2.5">
          {MOCK_CHARACTERS.map((c) => (
            <div key={c.name} className="rounded-[12px] border border-slate-100 p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-[11px] font-bold text-white">{c.name.slice(0, 1)}</span>
                <span className="text-sm font-semibold text-slate-900">{c.name}</span>
              </div>
              <p className="text-xs leading-5 text-slate-600">{c.desc}</p>
            </div>
          ))}
        </div>
      ) : null}
      {tab === 'scenes' ? (
        <div className="space-y-2.5">
          {MOCK_SCENES.map((scene) => (
            <div key={scene.id} className="rounded-[12px] border border-slate-100 p-3">
              <p className="mb-1 text-xs font-semibold text-slate-900">{scene.title}</p>
              <p className="text-xs leading-5 text-slate-600">{scene.action}</p>
              {scene.vo ? <p className="mt-1 text-xs italic leading-5 text-slate-500">旁白：{scene.vo}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </CardShell>
  )
}

/* ================================================================== */
/* 风格圣经卡片 重设计                                                    */
/* ================================================================== */

const MOCK_STYLE_SUMMARY = '极具艺术感的剧情类引力短片：以人物的运动与三维物体融合写实与水彩晕染风，硬朗与温润并存，强烈的明暗对照法（Chiaroscuro）贯穿全片，富有科技感与奋斗张力。'

const MOCK_COLOR_SWATCHES = [
  { name: 'deep ink black', hex: '#0b0f1a' },
  { name: 'midnight indigo', hex: '#1e1b4b' },
  { name: 'electric violet', hex: '#7c3aed' },
  { name: 'fiery amber', hex: '#f59e0b' },
  { name: 'starburst gold', hex: '#fbbf24' },
]

const MOCK_STYLE_GROUPS = [
  {
    key: 'visual', label: '视觉', tone: 'text-fuchsia-600',
    fields: [
      { label: '画面滤镜', value: 'graphic painterly 3D filter, dramatic ink shadows, halftone textures, artistic watercolor overlay' },
      { label: '光线', value: 'dramatic chiaroscuro, single-source stark lighting, expressive colorful rim lights' },
      { label: '质感', value: 'visible paint strokes, comic book halftone dots, hand-drawn cross-hatching, textured paper grain' },
      { label: '构图', value: 'highly graphic compositions, bold silhouettes against bright backgrounds, dynamic negative space' },
      { label: '负向提示', value: 'photorealistic, real human, live action, realistic 3D, CGI realist' },
    ],
  },
  {
    key: 'camera', label: '镜头', tone: 'text-sky-600',
    fields: [
      { label: '运镜', value: 'fluid painterly drifting shots, dynamic hand-held camera shake, dramatic vertical tilts' },
      { label: '焦点景深', value: 'stylized focus with painterly bokeh, graphic flat perspective mixed with deep 3D space' },
      { label: '节奏', value: 'expressive and emotional rhythm, slow-motion poetic sequences contrasting with sharp cuts' },
    ],
  },
  {
    key: 'audio', label: '声音', tone: 'text-emerald-600',
    fields: [
      { label: '声音设计', value: 'reverberant cinematic space texture with warm vinyl crackle and deep analog synth swells' },
    ],
  },
]

function StyleFieldRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-3 text-[11px] leading-4">
      <span className="font-semibold text-slate-400">{label}</span>
      <span className="break-words text-slate-600">{value}</span>
    </div>
  )
}

// 思路 1 · 分组属性 + 色板
function StyleBibleGrouped() {
  return (
    <CardShell eyebrow="风格圣经" title="Style Bible" meta="分组" width={460}>
      <div className="space-y-4">
        <p className="text-xs leading-5 text-slate-600">{MOCK_STYLE_SUMMARY}</p>

        <section>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">色彩</p>
          <div className="flex gap-1.5">
            {MOCK_COLOR_SWATCHES.map((c) => (
              <div key={c.hex} className="group relative flex-1" title={`${c.name} ${c.hex}`}>
                <div className="h-9 rounded-[8px] ring-1 ring-black/5" style={{ backgroundColor: c.hex }} />
                <p className="mt-1 truncate text-center text-[9px] text-slate-400">{c.name.split(' ').slice(-1)[0]}</p>
              </div>
            ))}
          </div>
        </section>

        {MOCK_STYLE_GROUPS.map((group) => (
          <section key={group.key}>
            <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide ${group.tone}`}>{group.label}</p>
            <div className="space-y-1.5 rounded-[12px] bg-slate-50 p-3">
              {group.fields.map((f) => (
                <StyleFieldRow key={f.label} label={f.label} value={f.value} />
              ))}
            </div>
          </section>
        ))}

      </div>
    </CardShell>
  )
}

// 思路 2 · 标签页分组（视觉 / 镜头 / 声音）
function StyleBibleTabs() {
  const [tab, setTab] = useState<string>('visual')
  const tabs = MOCK_STYLE_GROUPS.map((g) => ({ key: g.key, label: g.label }))
  const group = MOCK_STYLE_GROUPS.find((g) => g.key === tab)
  return (
    <CardShell eyebrow="风格圣经" title="Style Bible" meta="标签页" width={460}>
      <p className="mb-3 line-clamp-2 text-xs leading-5 text-slate-500">{MOCK_STYLE_SUMMARY}</p>
      <div className="mb-3 flex gap-1 rounded-[12px] bg-slate-100 p-1">
        {tabs.map((tt) => (
          <button
            key={tt.key}
            onClick={() => setTab(tt.key)}
            className={`flex-1 rounded-[9px] py-1.5 text-xs font-semibold transition ${tab === tt.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            {tt.label}
          </button>
        ))}
      </div>
      {group ? (
        <div className="space-y-3">
          {group.key === 'visual' ? (
            <div className="flex gap-1.5">
              {MOCK_COLOR_SWATCHES.map((c) => (
                <div key={c.hex} className="h-8 flex-1 rounded-[8px] ring-1 ring-black/5" style={{ backgroundColor: c.hex }} title={`${c.name} ${c.hex}`} />
              ))}
            </div>
          ) : null}
          <div className="space-y-1.5 rounded-[12px] bg-slate-50 p-3">
            {group.fields.map((f) => (
              <StyleFieldRow key={f.label} label={f.label} value={f.value} />
            ))}
          </div>
        </div>
      ) : null}
    </CardShell>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

type VariantKey = 'current' | 'A' | 'B' | 'C'

const VARIANTS: readonly { readonly key: VariantKey; readonly label: string; readonly hint: string }[] = [
  { key: 'current', label: '现状 · 全表平铺', hint: '1480px 宽，所有字段铺满，信息密度低、占地大' },
  { key: 'A', label: '方案 A · 折叠摘要', hint: '每镜一行（编号·时长·一句话动作），点击逐镜展开。最省空间' },
  { key: 'B', label: '方案 B · 网格卡片', hint: '镜头卡片网格，一眼扫完整体剧情，点击就地展开详情（无弹窗）' },
  { key: 'C', label: '方案 C · 胶片时间轴', hint: '横向胶片条（宽度=时长），选中查看详情。最贴近剪辑直觉' },
]

export default function CanvasCardLabClient() {
  const [view, setView] = useState<'shots' | 'hierarchy'>('shots')
  const [variant, setVariant] = useState<VariantKey>('A')
  const [bMode, setBMode] = useState<BExpandMode>('row')
  // 从 URL 同步初始视图（放在 effect 内，避免 SSR/CSR 水合不一致）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') === 'hierarchy') setView('hierarchy')
    const v = params.get('v')
    if (v === 'current' || v === 'A' || v === 'B' || v === 'C') setVariant(v)
    if (params.get('bmode') === 'cell') setBMode('cell')
  }, [])
  const active = useMemo(() => VARIANTS.find((v) => v.key === variant)!, [variant])

  return (
    <div className="min-h-screen bg-[#f4f5f7] px-8 py-8 text-slate-900">
      <div className="mx-auto max-w-[1200px]">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Canvas Card Lab</p>
          <h1 className="mt-1 text-2xl font-bold">无限画布 · 卡片布局方案</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            两个视图：「镜头卡片」对比核心剪辑表/摄影的网格方案；「全卡片层级体系」用一级/二级/三级重设计所有卡片。
          </p>
        </header>

        {/* 顶层视图切换 */}
        <div className="mb-6 inline-flex gap-1 rounded-full bg-slate-200/70 p-1">
          {([
            { key: 'shots', label: '镜头卡片方案' },
            { key: 'hierarchy', label: '全卡片 · 层级体系' },
          ] as const).map((vw) => (
            <button
              key={vw.key}
              onClick={() => setView(vw.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${view === vw.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              {vw.label}
            </button>
          ))}
        </div>

        {view === 'hierarchy' ? (
          <>
            <h2 className="text-xl font-bold">全卡片 · 层级体系</h2>
            <p className="mb-5 mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              与系统设计语言一致（中性灰白）。所有 AI 产物默认折叠到「一级」，逐层深入。核心改动：把 <span className="font-semibold text-slate-700">导演拆镜 + P1–P6 生成步骤</span> 合并成一张「生成过程」卡。每张卡片给两种内容化设计。
            </p>
            <CardHierarchySection />
          </>
        ) : (
        <>
        {/* variant switcher */}
        <div className="mb-5 flex flex-wrap gap-2">
          {VARIANTS.map((v) => (
            <button
              key={v.key}
              onClick={() => setVariant(v.key)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                variant === v.key ? 'bg-slate-900 text-white shadow' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="mb-4 rounded-[12px] bg-white px-4 py-2.5 text-xs text-slate-500 ring-1 ring-slate-200">
          <span className="font-semibold text-slate-700">{active.label}：</span> {active.hint}
        </p>

        {variant === 'B' ? (
          <div className="mb-6 flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-500">展开方式</span>
            {([
              { key: 'row', label: '整行展开（推荐）', hint: '满宽详情条插在整行下方，网格始终对齐' },
              { key: 'cell', label: '卡片内展开', hint: '卡片就地长高，同行其余卡片留白' },
            ] as const).map((m) => (
              <button
                key={m.key}
                onClick={() => setBMode(m.key)}
                title={m.hint}
                className={`rounded-full px-3 py-1.5 font-semibold transition ${
                  bMode === m.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        ) : null}

        {/* pipeline overview */}
        <div className="mb-8">
          <PipelineOverview activeKey="editScript" />
        </div>

        {/* focused cards */}
        <div className="space-y-8">
          {variant === 'current' ? (
            <CurrentEditScript />
          ) : (
            <div className="flex flex-wrap items-start gap-6">
              {variant === 'A' ? (<><VariantAEditScript /><VariantACinematography /></>) : null}
              {variant === 'B' ? (<><VariantBEditScript mode={bMode} /><VariantBCinematography mode={bMode} /></>) : null}
              {variant === 'C' ? (<><VariantCEditScript /><VariantCCinematography /></>) : null}
            </div>
          )}
        </div>

        {/* 其它高密度卡片重设计提案 */}
        <section className="mt-14 border-t border-slate-200 pt-8">
          <h2 className="text-xl font-bold">其它卡片 · 重设计提案</h2>
          <p className="mt-1 text-sm text-slate-500">剧本 与 风格圣经 现状都是「竖向长文平铺」，又长又难读。下面各给两个方向。</p>

          <div className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">剧本模块</span>
              <span className="text-xs text-slate-400">思路 1 结构化分区（推荐）／ 思路 2 标签页</span>
            </div>
            <div className="flex flex-wrap items-start gap-6">
              <ScreenplayStructured />
              <ScreenplayTabs />
            </div>
          </div>

          <div className="mt-10">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full bg-fuchsia-100 px-2.5 py-0.5 text-xs font-semibold text-fuchsia-700">风格圣经</span>
              <span className="text-xs text-slate-400">思路 1 分组属性 + 色板（推荐）／ 思路 2 标签页分组</span>
            </div>
            <div className="flex flex-wrap items-start gap-6">
              <StyleBibleGrouped />
              <StyleBibleTabs />
            </div>
          </div>
        </section>
        </>
        )}

        <footer className="mt-12 border-t border-slate-200 pt-4 text-xs text-slate-400">
          模拟数据 · 故事《最后的引力》 · {SHOT_COUNT} 镜头 / {TOTAL_DURATION}s — 仅用于布局评审
        </footer>
      </div>
    </div>
  )
}
