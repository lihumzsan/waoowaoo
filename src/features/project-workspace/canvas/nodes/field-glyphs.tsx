/* eslint-disable no-restricted-syntax */
// 画布卡片字段图标（线性 SVG）。隔离在此文件以便对 inline <svg> 关闭该 lint 规则，
// 让 WorkspaceNode 保持整洁。按字段语义自动匹配图标。
import React from 'react'

const GLYPHS: Record<string, string> = {
  dot: 'M12 12h.01',
  clock: 'M12 8v4l3 2 M21 12a9 9 0 11-18 0 9 9 0 0118 0',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18 M12 8a4 4 0 100 8 4 4 0 000-8 M12 12h.01',
  motion: 'M14 4l6 8-6 8 M4 12h12',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6',
  perspective: 'M3 20l18-7L3 6v5l12 2-12 2z',
  info: 'M12 16v-4 M12 8h.01 M21 12a9 9 0 11-18 0 9 9 0 0118 0',
  pulse: 'M3 12h4l2-6 4 12 2-6h6',
  link: 'M9 15l6-6 M11 6l1-1a4 4 0 016 6l-1 1 M13 18l-1 1a4 4 0 01-6-6l1-1',
  people: 'M17 21v-2a4 4 0 00-8 0v2 M13 7a4 4 0 11-8 0 4 4 0 018 0',
  sound: 'M11 5L6 9H2v6h4l5 4V5z M15.5 8.5a5 5 0 010 7 M19 5a9 9 0 010 14',
  frame: 'M3 6h18v12H3z M3 10h18',
  camera: 'M2 8h4l2-2h8l2 2h4v11H2z M12 16a3 3 0 100-6 3 3 0 000 6',
  lens: 'M12 3a9 9 0 100 18 9 9 0 000-18 M12 8a4 4 0 100 8 4 4 0 000-8',
  layers: 'M12 3l9 5-9 5-9-5 9-5z M3 13l9 5 9-5 M3 17l9 5 9-5',
  pin: 'M12 21s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12z M12 9a2 2 0 100 4 2 2 0 000-4',
  updown: 'M12 3v18 M7 8l5-5 5 5 M7 16l5 5 5-5',
  angle: 'M4 20V6 M4 20h16 M5 13a11 11 0 0111 7',
  move: 'M12 2v20 M2 12h20 M9 5l3-3 3 3 M9 19l3 3 3-3 M5 9l-3 3 3 3 M19 9l3 3-3 3',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8 M12 2v2 M12 20v2 M4 12H2 M22 12h-2 M5 5l1.5 1.5 M17.5 17.5L19 19 M6.5 17.5L5 19 M19 5l-1.5 1.5',
  axis: 'M3 12h18 M15 7l5 5-5 5 M9 17l-5-5 5-5',
  grid: 'M3 3h18v18H3z M9 3v18 M15 3v18 M3 9h18 M3 15h18',
  palette: 'M12 3a9 9 0 1 0 0 18 1.5 1.5 0 001.4-2 1.5 1.5 0 011.4-2H17a4 4 0 004-4 9 9 0 00-9.4-8z',
  texture: 'M4 4h16v16H4z M4 9h16 M4 14h16 M9 4v16 M14 4v16',
  funnel: 'M3 4h18l-7 9v6l-4-2v-4z',
  ban: 'M5.5 5.5l13 13 M21 12a9 9 0 11-18 0 9 9 0 0118 0',
  clapper: 'M3 8h18v11H3z M3 8l2-4h3l-1.5 4 M9 4h3l-1.5 4 M14 4h3l-1.5 4',
}

export function FieldGlyph({ name, className = 'h-3.5 w-3.5' }: { readonly name: string; readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={GLYPHS[name] ?? GLYPHS.dot} />
    </svg>
  )
}

export function glyphForField(label: string): string {
  const l = label
  if (l.includes('时长')) return 'clock'
  if (l.includes('戏剧') || l.includes('目的')) return 'target'
  if (l.includes('可见') || l.includes('动作')) return 'motion'
  if (l.includes('焦点')) return 'eye'
  if (l.includes('视角')) return 'perspective'
  if (l.includes('信息')) return 'info'
  if (l.includes('节拍') || l.includes('节奏')) return 'pulse'
  if (l.includes('衔接')) return 'link'
  if (l.includes('人物') || l.includes('表演') || l.includes('角色')) return 'people'
  if (l.includes('声音') || l.includes('音')) return 'sound'
  if (l.includes('景别')) return 'frame'
  if (l.includes('焦段')) return 'lens'
  if (l.includes('景深')) return 'layers'
  if (l.includes('机位高度') || l.includes('高度')) return 'updown'
  if (l.includes('机位')) return 'pin'
  if (l.includes('角度')) return 'angle'
  if (l.includes('运动') || l.includes('运镜') || l.includes('移')) return 'move'
  if (l.includes('光')) return 'sun'
  if (l.includes('轴线')) return 'axis'
  if (l.includes('构图')) return 'grid'
  if (l.includes('色彩') || l.includes('颜色')) return 'palette'
  if (l.includes('质感')) return 'texture'
  if (l.includes('滤镜')) return 'funnel'
  if (l.includes('负向') || l.includes('约束')) return 'ban'
  return 'dot'
}
